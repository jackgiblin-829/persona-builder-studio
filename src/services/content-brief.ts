import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { contentBriefs, contentOpportunities, personas, users } from "@/db/schema";
import { getQueue } from "@/adapters/queue";
import { JOB_TYPES } from "@/jobs/registry";
import { requireCapability, type BrandContext } from "@/lib/auth/context";
import { AppError, ImmutableError, NotFoundError, ValidationError } from "@/lib/errors";
import { sanitizeBriefBody } from "@/lib/content-traceability";
import { briefSchema, type BriefOutput } from "@/prompts/schemas";
import { loadFieldsWithEvidence } from "./personas";
import { recordAudit } from "./audit";

/**
 * SEO briefs (§29).
 *
 * Generation happens in `src/jobs/handlers/generate-brief.ts`; this module
 * enqueues it and is the review/edit surface. A brief is versioned like a
 * persona or prompt set — `parentBriefId` chains revisions, and an approved
 * version is never edited in place (§33), only revised into a new one.
 */

export async function startBriefGeneration(
  ctx: BrandContext,
  input: { opportunityId: string; regenerateFromBriefId?: string },
): Promise<{ jobId: string }> {
  requireCapability(ctx, "content:generate");

  const [opportunity] = await db
    .select({ id: contentOpportunities.id, reviewStatus: contentOpportunities.reviewStatus })
    .from(contentOpportunities)
    .where(
      and(
        eq(contentOpportunities.id, input.opportunityId),
        eq(contentOpportunities.organizationId, ctx.organizationId),
        eq(contentOpportunities.brandId, ctx.brandId),
      ),
    )
    .limit(1);
  if (!opportunity) throw new NotFoundError("Content opportunity");
  if (opportunity.reviewStatus === "rejected") {
    throw new ValidationError("A rejected opportunity cannot be turned into a brief.");
  }

  if (input.regenerateFromBriefId) {
    const parent = await loadBrief(ctx, input.regenerateFromBriefId);
    if (parent.reviewStatus !== "approved" && parent.reviewStatus !== "rejected") {
      throw new AppError(
        "conflict",
        "This brief already has a pending draft or in-review version. Approve or reject it before regenerating.",
      );
    }
  }

  const job = await getQueue().enqueue(
    JOB_TYPES.generateBrief,
    {
      brandId: ctx.brandId,
      opportunityId: input.opportunityId,
      parentBriefId: input.regenerateFromBriefId ?? null,
      requestedByUserId: ctx.userId,
    },
    { organizationId: ctx.organizationId, brandId: ctx.brandId },
  );

  await recordAudit({
    organizationId: ctx.organizationId,
    brandId: ctx.brandId,
    actorUserId: ctx.userId,
    action: "brief.generate",
    entityType: "content_opportunity",
    entityId: input.opportunityId,
    metadata: { jobId: job.id, regeneratedFrom: input.regenerateFromBriefId ?? null },
  });

  return { jobId: job.id };
}

// ── Reads ───────────────────────────────────────────────────────────────────

export type BriefListRow = typeof contentBriefs.$inferSelect & {
  personaName: string | null;
  opportunityTitle: string | null;
};

export async function listBriefs(ctx: BrandContext): Promise<BriefListRow[]> {
  const rows = await db
    .select({
      brief: contentBriefs,
      personaName: personas.name,
      opportunityTitle: contentOpportunities.title,
    })
    .from(contentBriefs)
    .leftJoin(personas, eq(personas.id, contentBriefs.personaId))
    .leftJoin(contentOpportunities, eq(contentOpportunities.id, contentBriefs.opportunityId))
    .where(
      and(
        eq(contentBriefs.organizationId, ctx.organizationId),
        eq(contentBriefs.brandId, ctx.brandId),
      ),
    )
    .orderBy(desc(contentBriefs.createdAt));

  return rows.map((row) => ({
    ...row.brief,
    personaName: row.personaName,
    opportunityTitle: row.opportunityTitle,
  }));
}

export type BriefDetail = BriefListRow & {
  generatedByName: string | null;
  approvedByName: string | null;
  versions: { id: string; version: number; reviewStatus: string; createdAt: Date }[];
  mutable: boolean;
};

export async function getBriefDetail(ctx: BrandContext, briefId: string): Promise<BriefDetail> {
  const brief = await loadBrief(ctx, briefId);

  const [persona, opportunity, generatedBy, approvedBy] = await Promise.all([
    brief.personaId
      ? db
          .select({ name: personas.name })
          .from(personas)
          .where(eq(personas.id, brief.personaId))
          .limit(1)
      : Promise.resolve([]),
    brief.opportunityId
      ? db
          .select({ title: contentOpportunities.title })
          .from(contentOpportunities)
          .where(eq(contentOpportunities.id, brief.opportunityId))
          .limit(1)
      : Promise.resolve([]),
    brief.generatedByUserId
      ? db
          .select({ name: users.name })
          .from(users)
          .where(eq(users.id, brief.generatedByUserId))
          .limit(1)
      : Promise.resolve([]),
    brief.approvedByUserId
      ? db
          .select({ name: users.name })
          .from(users)
          .where(eq(users.id, brief.approvedByUserId))
          .limit(1)
      : Promise.resolve([]),
  ]);

  const lineage = await loadLineage(brief);

  return {
    ...brief,
    personaName: persona[0]?.name ?? null,
    opportunityTitle: opportunity[0]?.title ?? null,
    generatedByName: generatedBy[0]?.name ?? null,
    approvedByName: approvedBy[0]?.name ?? null,
    versions: lineage,
    mutable: brief.reviewStatus !== "approved" && brief.reviewStatus !== "rejected",
  };
}

async function loadLineage(
  brief: typeof contentBriefs.$inferSelect,
): Promise<{ id: string; version: number; reviewStatus: string; createdAt: Date }[]> {
  // Briefs form a short parent chain rather than a persona-style shared
  // identity row, so lineage is walked directly rather than joined by a
  // stable "brief id" the way persona versions share `personaId`.
  const chain: (typeof contentBriefs.$inferSelect)[] = [brief];
  let cursor = brief;
  while (cursor.parentBriefId) {
    const [parent] = await db
      .select()
      .from(contentBriefs)
      .where(eq(contentBriefs.id, cursor.parentBriefId))
      .limit(1);
    if (!parent) break;
    chain.push(parent);
    cursor = parent;
  }
  const [child] = await db
    .select()
    .from(contentBriefs)
    .where(eq(contentBriefs.parentBriefId, brief.id))
    .limit(1);
  if (child) chain.unshift(child);

  return chain
    .sort((a, b) => b.version - a.version)
    .map((row) => ({
      id: row.id,
      version: row.version,
      reviewStatus: row.reviewStatus,
      createdAt: row.createdAt,
    }));
}

async function loadBrief(
  ctx: BrandContext,
  briefId: string,
): Promise<typeof contentBriefs.$inferSelect> {
  const [row] = await db
    .select()
    .from(contentBriefs)
    .where(
      and(
        eq(contentBriefs.id, briefId),
        eq(contentBriefs.organizationId, ctx.organizationId),
        eq(contentBriefs.brandId, ctx.brandId),
      ),
    )
    .limit(1);
  if (!row) throw new NotFoundError("Content brief");
  return row;
}

// ── Review lifecycle ────────────────────────────────────────────────────────

export async function approveBrief(ctx: BrandContext, briefId: string): Promise<void> {
  requireCapability(ctx, "content:approve");
  const brief = await loadBrief(ctx, briefId);
  if (brief.reviewStatus === "approved") throw new ImmutableError("This brief");
  if (brief.reviewStatus === "rejected") {
    throw new AppError("conflict", "This brief was rejected. Regenerate a new version instead.");
  }

  await db
    .update(contentBriefs)
    .set({
      reviewStatus: "approved",
      approvedByUserId: ctx.userId,
      approvedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(contentBriefs.id, briefId));

  await recordAudit({
    organizationId: ctx.organizationId,
    brandId: ctx.brandId,
    actorUserId: ctx.userId,
    action: "brief.approve",
    entityType: "content_brief",
    entityId: briefId,
    metadata: { decision: "approved", version: brief.version },
  });
}

export async function rejectBrief(
  ctx: BrandContext,
  briefId: string,
  reason: string,
): Promise<void> {
  requireCapability(ctx, "content:approve");
  const brief = await loadBrief(ctx, briefId);
  if (brief.reviewStatus === "approved") throw new ImmutableError("This brief");

  await db
    .update(contentBriefs)
    .set({ reviewStatus: "rejected", updatedAt: new Date() })
    .where(eq(contentBriefs.id, briefId));

  await recordAudit({
    organizationId: ctx.organizationId,
    brandId: ctx.brandId,
    actorUserId: ctx.userId,
    // "brief.approve" doubles as this brief's review-decision bucket
    // (approve/reject/edit), the same pattern `segment.decision` and
    // `opportunity.review` use — `metadata.decision` carries which.
    action: "brief.approve",
    entityType: "content_brief",
    entityId: briefId,
    metadata: { decision: "rejected", reason: reason.slice(0, 2000) },
  });
}

/**
 * Body edits go through the same Zod schema the generator writes against
 * (§29's "validated by a Zod schema on write"), so a reviewer's edit can
 * never leave the brief in a shape the export and editor screens do not
 * expect.
 */
export const briefBodyUpdateSchema = briefSchema;

export async function updateBriefBody(
  ctx: BrandContext,
  briefId: string,
  body: z.infer<typeof briefBodyUpdateSchema>,
): Promise<void> {
  requireCapability(ctx, "content:generate");
  const brief = await loadBrief(ctx, briefId);
  if (brief.reviewStatus === "approved" || brief.reviewStatus === "rejected") {
    throw new ImmutableError(`This brief (${brief.reviewStatus})`);
  }

  const parsed = briefBodyUpdateSchema.safeParse(body);
  if (!parsed.success) {
    throw new AppError(
      "schema_validation",
      `Brief body failed validation: ${parsed.error.message}`,
    );
  }

  // §29's traceability rule holds at every write, not only at generation: an
  // edit that removes a citation or invents a new evidence/Profound id is
  // sanitized the same way a fresh generation would be, using the persona's
  // *current* available evidence — not merely the ids the brief happened to
  // start with — because evidence availability itself can change.
  const availableEvidenceIds = brief.personaVersionId
    ? new Set(
        (await loadFieldsWithEvidence(brief.personaVersionId)).flatMap((field) =>
          field.evidence
            .filter((e) => e.relation === "supports" && e.availability === "available")
            .map((e) => e.evidenceId),
        ),
      )
    : new Set<string>();
  const allowedProfoundPromptIds = new Set(brief.profoundPromptIds);

  const sanitized = sanitizeBriefBody(parsed.data, {
    evidenceIds: availableEvidenceIds,
    profoundPromptIds: allowedProfoundPromptIds,
  });

  if (!sanitized.writable) {
    throw new ValidationError(
      `This edit cannot be saved: ${sanitized.violations.map((v) => v.issue).join("; ")}`,
    );
  }

  const evidenceIds = [
    ...new Set([
      ...sanitized.body.constraints.flatMap((c) => c.evidence_ids),
      ...sanitized.body.objections.flatMap((c) => c.evidence_ids),
      ...sanitized.body.decision_criteria.flatMap((c) => c.evidence_ids),
      ...sanitized.body.recommended_outline.flatMap((s) => s.evidence_ids),
    ]),
  ];
  const profoundPromptIds = sanitized.body.relevant_profound_prompts.map(
    (p) => p.profound_prompt_id,
  );

  await db
    .update(contentBriefs)
    .set({
      workingTitle: sanitized.body.working_title,
      body: sanitized.body as unknown as Record<string, unknown>,
      evidenceIds,
      profoundPromptIds,
      updatedAt: new Date(),
    })
    .where(eq(contentBriefs.id, briefId));

  await recordAudit({
    organizationId: ctx.organizationId,
    brandId: ctx.brandId,
    actorUserId: ctx.userId,
    action: "brief.approve",
    entityType: "content_brief",
    entityId: briefId,
    metadata: { decision: "edited", version: brief.version },
  });
}

export function parseBriefBody(body: Record<string, unknown>): BriefOutput | null {
  const parsed = briefSchema.safeParse(body);
  return parsed.success ? parsed.data : null;
}
