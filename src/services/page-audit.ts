import "server-only";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { auditFindings, pageAudits, personaVersions, personas } from "@/db/schema";
import { getQueue } from "@/adapters/queue";
import { JOB_TYPES } from "@/jobs/registry";
import { requireCapability, type BrandContext } from "@/lib/auth/context";
import { ImmutableError, NotFoundError, ValidationError } from "@/lib/errors";
import { recordAudit } from "./audit";

/**
 * Homepage / landing-page audits (§30).
 *
 * Generation happens in `src/jobs/handlers/generate-page-audit.ts`; this
 * module validates the request, enqueues generation, and is the read/review
 * surface. Audits are not versioned the way personas and prompt sets are —
 * each generation is a fresh, independent run against whatever page content
 * was supplied, so there is no approved-version lock to work around.
 */

export const generateAuditInputSchema = z.object({
  personaVersionId: z.string().min(1),
  promptSetVersionId: z.string().min(1).optional(),
  scope: z.enum(["homepage", "landing_page", "product_page"]).default("homepage"),
  url: z.string().trim().max(2000).optional(),
  pageTitle: z.string().trim().max(240).optional(),
  pageContent: z.string().trim().min(50).max(50_000),
});

export async function startPageAuditGeneration(
  ctx: BrandContext,
  input: z.infer<typeof generateAuditInputSchema>,
): Promise<{ jobId: string }> {
  requireCapability(ctx, "content:generate");
  const parsed = generateAuditInputSchema.parse(input);

  const [personaVersion] = await db
    .select({ status: personaVersions.status })
    .from(personaVersions)
    .where(
      and(
        eq(personaVersions.id, parsed.personaVersionId),
        eq(personaVersions.organizationId, ctx.organizationId),
        eq(personaVersions.brandId, ctx.brandId),
      ),
    )
    .limit(1);
  if (!personaVersion) throw new NotFoundError("Persona version");
  if (personaVersion.status !== "approved") {
    throw new ValidationError("Page audits require an approved persona version.");
  }

  const job = await getQueue().enqueue(
    JOB_TYPES.generatePageAudit,
    {
      brandId: ctx.brandId,
      personaVersionId: parsed.personaVersionId,
      promptSetVersionId: parsed.promptSetVersionId ?? null,
      scope: parsed.scope,
      url: parsed.url ?? null,
      pageTitle: parsed.pageTitle ?? null,
      pageContent: parsed.pageContent,
      requestedByUserId: ctx.userId,
    },
    { organizationId: ctx.organizationId, brandId: ctx.brandId },
  );

  await recordAudit({
    organizationId: ctx.organizationId,
    brandId: ctx.brandId,
    actorUserId: ctx.userId,
    action: "audit.generate",
    entityType: "persona_version",
    entityId: parsed.personaVersionId,
    metadata: { jobId: job.id, scope: parsed.scope, url: parsed.url ?? null },
  });

  return { jobId: job.id };
}

// ── Reads ───────────────────────────────────────────────────────────────────

export type AuditListRow = typeof pageAudits.$inferSelect & {
  personaName: string | null;
  findingCount: number;
  criticalCount: number;
  highCount: number;
};

export async function listPageAudits(ctx: BrandContext): Promise<AuditListRow[]> {
  const rows = await db
    .select({ audit: pageAudits, personaName: personas.name })
    .from(pageAudits)
    .leftJoin(personas, eq(personas.id, pageAudits.personaId))
    .where(
      and(eq(pageAudits.organizationId, ctx.organizationId), eq(pageAudits.brandId, ctx.brandId)),
    )
    .orderBy(desc(pageAudits.createdAt));

  if (rows.length === 0) return [];

  const counts = await db
    .select({
      pageAuditId: auditFindings.pageAuditId,
      severity: auditFindings.severity,
    })
    .from(auditFindings)
    .where(
      inArray(
        auditFindings.pageAuditId,
        rows.map((row) => row.audit.id),
      ),
    );

  const byAudit = new Map<string, { total: number; critical: number; high: number }>();
  for (const row of counts) {
    const bucket = byAudit.get(row.pageAuditId) ?? { total: 0, critical: 0, high: 0 };
    bucket.total++;
    if (row.severity === "critical") bucket.critical++;
    if (row.severity === "high") bucket.high++;
    byAudit.set(row.pageAuditId, bucket);
  }

  return rows.map((row) => {
    const bucket = byAudit.get(row.audit.id) ?? { total: 0, critical: 0, high: 0 };
    return {
      ...row.audit,
      personaName: row.personaName,
      findingCount: bucket.total,
      criticalCount: bucket.critical,
      highCount: bucket.high,
    };
  });
}

export type AuditFindingRow = typeof auditFindings.$inferSelect;

export type AuditDetail = typeof pageAudits.$inferSelect & {
  personaName: string | null;
  findings: AuditFindingRow[];
  homepageFindings: AuditFindingRow[];
  supportingPageFindings: AuditFindingRow[];
};

export async function getPageAuditDetail(ctx: BrandContext, auditId: string): Promise<AuditDetail> {
  const audit = await loadAudit(ctx, auditId);

  const [persona, findings] = await Promise.all([
    audit.personaId
      ? db
          .select({ name: personas.name })
          .from(personas)
          .where(eq(personas.id, audit.personaId))
          .limit(1)
      : Promise.resolve([]),
    db
      .select()
      .from(auditFindings)
      .where(eq(auditFindings.pageAuditId, auditId))
      .orderBy(asc(auditFindings.sequence)),
  ]);

  return {
    ...audit,
    personaName: persona[0]?.name ?? null,
    findings,
    homepageFindings: findings.filter((f) => !f.belongsOnSupportingPage),
    supportingPageFindings: findings.filter((f) => f.belongsOnSupportingPage),
  };
}

async function loadAudit(
  ctx: BrandContext,
  auditId: string,
): Promise<typeof pageAudits.$inferSelect> {
  const [row] = await db
    .select()
    .from(pageAudits)
    .where(
      and(
        eq(pageAudits.id, auditId),
        eq(pageAudits.organizationId, ctx.organizationId),
        eq(pageAudits.brandId, ctx.brandId),
      ),
    )
    .limit(1);
  if (!row) throw new NotFoundError("Page audit");
  return row;
}

// ── Review lifecycle ────────────────────────────────────────────────────────

export async function approvePageAudit(ctx: BrandContext, auditId: string): Promise<void> {
  requireCapability(ctx, "content:approve");
  const audit = await loadAudit(ctx, auditId);
  if (audit.reviewStatus === "approved") throw new ImmutableError("This audit");

  await db
    .update(pageAudits)
    .set({
      reviewStatus: "approved",
      approvedByUserId: ctx.userId,
      approvedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(pageAudits.id, auditId));

  await recordAudit({
    organizationId: ctx.organizationId,
    brandId: ctx.brandId,
    actorUserId: ctx.userId,
    action: "audit.approve",
    entityType: "page_audit",
    entityId: auditId,
    metadata: { decision: "approved" },
  });
}

export async function rejectPageAudit(
  ctx: BrandContext,
  auditId: string,
  reason: string,
): Promise<void> {
  requireCapability(ctx, "content:approve");
  const audit = await loadAudit(ctx, auditId);
  if (audit.reviewStatus === "approved") throw new ImmutableError("This audit");

  await db
    .update(pageAudits)
    .set({ reviewStatus: "rejected", updatedAt: new Date() })
    .where(eq(pageAudits.id, auditId));

  await recordAudit({
    organizationId: ctx.organizationId,
    brandId: ctx.brandId,
    actorUserId: ctx.userId,
    // "audit.approve" doubles as this audit's review-decision bucket, the
    // same pattern `segment.decision`/`opportunity.review` use.
    action: "audit.approve",
    entityType: "page_audit",
    entityId: auditId,
    metadata: { decision: "rejected", reason: reason.slice(0, 2000) },
  });
}
