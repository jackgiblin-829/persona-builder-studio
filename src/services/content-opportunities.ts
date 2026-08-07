import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import {
  contentOpportunities,
  personaVersions,
  personas,
  promptSetVersions,
  users,
} from "@/db/schema";
import { getQueue } from "@/adapters/queue";
import { JOB_TYPES } from "@/jobs/registry";
import { requireCapability, type BrandContext } from "@/lib/auth/context";
import { ImmutableError, NotFoundError, ValidationError } from "@/lib/errors";
import { RECOMMENDATION_TYPES } from "@/prompts/schemas";

type ReviewStatus =
  "draft" | "pending_review" | "approved" | "rejected" | "needs_review" | "superseded";
type RecommendationType = (typeof RECOMMENDATION_TYPES)[number];
type Priority = "p1" | "p2" | "p3";
import { recordAudit } from "./audit";

/**
 * Content opportunities (§27, §28).
 *
 * Generation happens in `src/jobs/handlers/generate-opportunities.ts`; this
 * module is the review surface — list, detail, approve, reject, edit — plus
 * the trigger that enqueues generation. An opportunity is not versioned the
 * way a persona is: it is a reviewable recommendation about a point-in-time
 * gap, not an identity with a lineage, so editing it in place (while still
 * `pending_review`) is the correct model rather than a new-version chain.
 */

export async function startOpportunityGeneration(
  ctx: BrandContext,
  input: { personaVersionId: string; promptSetVersionId: string },
): Promise<{ jobId: string }> {
  requireCapability(ctx, "content:generate");

  const [personaVersion] = await db
    .select({ status: personaVersions.status, personaId: personaVersions.personaId })
    .from(personaVersions)
    .where(
      and(
        eq(personaVersions.id, input.personaVersionId),
        eq(personaVersions.organizationId, ctx.organizationId),
        eq(personaVersions.brandId, ctx.brandId),
      ),
    )
    .limit(1);
  if (!personaVersion) throw new NotFoundError("Persona version");
  if (personaVersion.status !== "approved") {
    throw new ValidationError("Content-gap analysis requires an approved persona version.");
  }

  const [promptSetVersion] = await db
    .select({ status: promptSetVersions.status })
    .from(promptSetVersions)
    .where(
      and(
        eq(promptSetVersions.id, input.promptSetVersionId),
        eq(promptSetVersions.organizationId, ctx.organizationId),
        eq(promptSetVersions.brandId, ctx.brandId),
      ),
    )
    .limit(1);
  if (!promptSetVersion) throw new NotFoundError("Prompt-set version");
  if (promptSetVersion.status !== "approved") {
    throw new ValidationError("Content-gap analysis requires an approved prompt-set version.");
  }

  const job = await getQueue().enqueue(
    JOB_TYPES.generateOpportunities,
    {
      brandId: ctx.brandId,
      personaVersionId: input.personaVersionId,
      promptSetVersionId: input.promptSetVersionId,
      requestedByUserId: ctx.userId,
    },
    { organizationId: ctx.organizationId, brandId: ctx.brandId },
  );

  await recordAudit({
    organizationId: ctx.organizationId,
    brandId: ctx.brandId,
    actorUserId: ctx.userId,
    action: "opportunity.generate",
    entityType: "persona_version",
    entityId: input.personaVersionId,
    metadata: { jobId: job.id, promptSetVersionId: input.promptSetVersionId },
  });

  return { jobId: job.id };
}

// ── Reads ───────────────────────────────────────────────────────────────────

export type OpportunityFilters = {
  reviewStatus?: ReviewStatus;
  recommendation?: RecommendationType;
  priority?: Priority;
  personaVersionId?: string;
  /** Scopes to exactly one opportunity — used by the detail page's per-item export links. */
  id?: string;
};

export type OpportunityListRow = typeof contentOpportunities.$inferSelect & {
  personaName: string | null;
};

export async function listOpportunities(
  ctx: BrandContext,
  filters: OpportunityFilters = {},
): Promise<OpportunityListRow[]> {
  const conditions = [
    eq(contentOpportunities.organizationId, ctx.organizationId),
    eq(contentOpportunities.brandId, ctx.brandId),
  ];
  if (filters.reviewStatus) {
    conditions.push(eq(contentOpportunities.reviewStatus, filters.reviewStatus));
  }
  if (filters.recommendation) {
    conditions.push(eq(contentOpportunities.recommendation, filters.recommendation));
  }
  if (filters.priority) {
    conditions.push(eq(contentOpportunities.priority, filters.priority));
  }
  if (filters.personaVersionId) {
    conditions.push(eq(contentOpportunities.personaVersionId, filters.personaVersionId));
  }
  if (filters.id) {
    conditions.push(eq(contentOpportunities.id, filters.id));
  }

  const rows = await db
    .select({ opportunity: contentOpportunities, personaName: personas.name })
    .from(contentOpportunities)
    .leftJoin(personas, eq(personas.id, contentOpportunities.personaId))
    .where(and(...conditions))
    .orderBy(desc(contentOpportunities.createdAt));

  return rows.map((row) => ({ ...row.opportunity, personaName: row.personaName }));
}

export type OpportunityDetail = OpportunityListRow & {
  generatedByName: string | null;
};

export async function getOpportunityDetail(
  ctx: BrandContext,
  opportunityId: string,
): Promise<OpportunityDetail> {
  const opportunity = await loadOpportunity(ctx, opportunityId);

  const [persona, generatedBy] = await Promise.all([
    opportunity.personaId
      ? db
          .select({ name: personas.name })
          .from(personas)
          .where(eq(personas.id, opportunity.personaId))
          .limit(1)
      : Promise.resolve([]),
    opportunity.generatedByUserId
      ? db
          .select({ name: users.name })
          .from(users)
          .where(eq(users.id, opportunity.generatedByUserId))
          .limit(1)
      : Promise.resolve([]),
  ]);

  return {
    ...opportunity,
    personaName: persona[0]?.name ?? null,
    generatedByName: generatedBy[0]?.name ?? null,
  };
}

async function loadOpportunity(
  ctx: BrandContext,
  opportunityId: string,
): Promise<typeof contentOpportunities.$inferSelect> {
  const [row] = await db
    .select()
    .from(contentOpportunities)
    .where(
      and(
        eq(contentOpportunities.id, opportunityId),
        eq(contentOpportunities.organizationId, ctx.organizationId),
        eq(contentOpportunities.brandId, ctx.brandId),
      ),
    )
    .limit(1);
  if (!row) throw new NotFoundError("Content opportunity");
  return row;
}

// ── Review lifecycle ────────────────────────────────────────────────────────

function assertMutable(opportunity: typeof contentOpportunities.$inferSelect): void {
  if (opportunity.reviewStatus === "approved" || opportunity.reviewStatus === "rejected") {
    throw new ImmutableError(`This opportunity (${opportunity.reviewStatus})`);
  }
}

export async function approveOpportunity(ctx: BrandContext, opportunityId: string): Promise<void> {
  requireCapability(ctx, "content:approve");
  const opportunity = await loadOpportunity(ctx, opportunityId);
  assertMutable(opportunity);

  await db
    .update(contentOpportunities)
    .set({ reviewStatus: "approved", updatedAt: new Date() })
    .where(eq(contentOpportunities.id, opportunityId));

  await recordAudit({
    organizationId: ctx.organizationId,
    brandId: ctx.brandId,
    actorUserId: ctx.userId,
    action: "opportunity.review",
    entityType: "content_opportunity",
    entityId: opportunityId,
    metadata: { decision: "approved", recommendation: opportunity.recommendation },
  });
}

export async function rejectOpportunity(
  ctx: BrandContext,
  opportunityId: string,
  reason: string,
): Promise<void> {
  requireCapability(ctx, "content:approve");
  const opportunity = await loadOpportunity(ctx, opportunityId);
  assertMutable(opportunity);

  await db
    .update(contentOpportunities)
    .set({ reviewStatus: "rejected", updatedAt: new Date() })
    .where(eq(contentOpportunities.id, opportunityId));

  await recordAudit({
    organizationId: ctx.organizationId,
    brandId: ctx.brandId,
    actorUserId: ctx.userId,
    action: "opportunity.review",
    entityType: "content_opportunity",
    entityId: opportunityId,
    metadata: { decision: "rejected", reason: reason.slice(0, 2000) },
  });
}

export const opportunityUpdateSchema = z.object({
  title: z.string().trim().min(5).max(200),
  problemStatement: z.string().trim().min(10).max(1500),
  recommendation: z.enum(RECOMMENDATION_TYPES),
  priority: z.enum(["p1", "p2", "p3"]),
  estimatedEffort: z.enum(["small", "medium", "large"]),
  validationMethod: z.string().trim().min(5).max(600),
});

export async function updateOpportunity(
  ctx: BrandContext,
  opportunityId: string,
  input: z.infer<typeof opportunityUpdateSchema>,
): Promise<void> {
  requireCapability(ctx, "content:generate");
  const opportunity = await loadOpportunity(ctx, opportunityId);
  assertMutable(opportunity);

  await db
    .update(contentOpportunities)
    .set({
      title: input.title,
      problemStatement: input.problemStatement,
      recommendation: input.recommendation,
      priority: input.priority,
      estimatedEffort: input.estimatedEffort,
      validationMethod: input.validationMethod,
      updatedAt: new Date(),
    })
    .where(eq(contentOpportunities.id, opportunityId));

  await recordAudit({
    organizationId: ctx.organizationId,
    brandId: ctx.brandId,
    actorUserId: ctx.userId,
    action: "opportunity.review",
    entityType: "content_opportunity",
    entityId: opportunityId,
    metadata: { decision: "edited", recommendation: input.recommendation },
  });
}

export async function ensureOpportunityAccess(
  ctx: BrandContext,
  opportunityId: string,
): Promise<typeof contentOpportunities.$inferSelect> {
  return loadOpportunity(ctx, opportunityId);
}
