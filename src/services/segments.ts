import "server-only";
import { and, count, desc, eq, inArray, ne, sql as raw } from "drizzle-orm";
import { z } from "zod";
import { db, type Executor } from "@/db/client";
import {
  dataSources,
  evidenceRecords,
  jobs,
  personas,
  segmentCandidateEvidence,
  segmentCandidates,
  users,
} from "@/db/schema";
import { getQueue } from "@/adapters/queue";
import { JOB_TYPES } from "@/jobs/registry";
import { requireCapability, type BrandContext } from "@/lib/auth/context";
import { evaluateConfidence, type ConfidenceEvidence } from "@/lib/confidence";
import { AppError, NotFoundError, ValidationError } from "@/lib/errors";
import { newId, slugify, ID_PREFIXES } from "@/lib/ids";
import { recordAudit } from "./audit";

/**
 * Candidate segmentation (§13).
 *
 * A run is versioned: generating again never overwrites the previous run's
 * candidates, so a reviewer can see how the segmentation changed as evidence
 * arrived. Confidence is always recomputed locally from the evidence links that
 * actually exist, never taken from the model's own numbers — see
 * `recomputeSegmentConfidence`.
 */

/** Generating segments from a handful of records produces noise, not insight. */
export const MIN_APPROVED_EVIDENCE_FOR_SEGMENTATION = 10;

export type SegmentRunSummary = {
  runId: string;
  generatedAt: Date;
  candidateCount: number;
  approvedCount: number;
  rejectedCount: number;
  mergedCount: number;
  dataOrigin: string;
  modelId: string | null;
  evidenceCutoff: Date | null;
  generatedByName: string | null;
};

export async function startSegmentation(
  ctx: BrandContext,
): Promise<{ runId: string; jobId: string; evidenceCount: number }> {
  requireCapability(ctx, "segment:generate");

  const [approved] = await db
    .select({ n: count() })
    .from(evidenceRecords)
    .where(
      and(
        eq(evidenceRecords.brandId, ctx.brandId),
        eq(evidenceRecords.reviewStatus, "approved"),
        eq(evidenceRecords.availability, "available"),
      ),
    );

  const evidenceCount = approved?.n ?? 0;
  if (evidenceCount < MIN_APPROVED_EVIDENCE_FOR_SEGMENTATION) {
    throw new ValidationError(
      `Segmentation needs at least ${MIN_APPROVED_EVIDENCE_FOR_SEGMENTATION} approved evidence records; this brand has ${evidenceCount}. Approve more evidence first.`,
    );
  }

  const runId = newId(ID_PREFIXES.segmentCandidate);
  const job = await getQueue().enqueue(
    JOB_TYPES.generateSegments,
    { brandId: ctx.brandId, runId, requestedByUserId: ctx.userId },
    {
      organizationId: ctx.organizationId,
      brandId: ctx.brandId,
      idempotencyKey: `segments:${runId}`,
    },
  );

  await recordAudit({
    organizationId: ctx.organizationId,
    brandId: ctx.brandId,
    actorUserId: ctx.userId,
    action: "segment.generate",
    entityType: "segment_run",
    entityId: runId,
    metadata: { evidenceCount, jobId: job.id },
  });

  return { runId, jobId: job.id, evidenceCount };
}

export async function listSegmentRuns(ctx: BrandContext): Promise<SegmentRunSummary[]> {
  const rows = await db
    .select({
      runId: segmentCandidates.runId,
      generatedAt: raw<Date>`min(${segmentCandidates.createdAt})`,
      candidateCount: count(),
      approvedCount: raw<number>`count(*) filter (where ${segmentCandidates.status} = 'approved')::int`,
      rejectedCount: raw<number>`count(*) filter (where ${segmentCandidates.status} = 'rejected')::int`,
      mergedCount: raw<number>`count(*) filter (where ${segmentCandidates.status} = 'merged')::int`,
      dataOrigin: raw<string>`min(${segmentCandidates.dataOrigin}::text)`,
      modelId: raw<string | null>`min(${segmentCandidates.modelId})`,
      evidenceCutoff: raw<Date | null>`max(${segmentCandidates.evidenceCutoff})`,
      generatedByName: raw<string | null>`min(${users.name})`,
    })
    .from(segmentCandidates)
    .leftJoin(users, eq(users.id, segmentCandidates.generatedByUserId))
    .where(
      and(
        eq(segmentCandidates.organizationId, ctx.organizationId),
        eq(segmentCandidates.brandId, ctx.brandId),
      ),
    )
    .groupBy(segmentCandidates.runId)
    .orderBy(desc(raw`min(${segmentCandidates.createdAt})`));

  return rows.map((row) => ({
    ...row,
    candidateCount: Number(row.candidateCount),
  }));
}

export type SegmentWithEvidence = typeof segmentCandidates.$inferSelect & {
  supportingCount: number;
  contradictingCount: number;
  unavailableCount: number;
  personaId: string | null;
  personaName: string | null;
};

export async function listSegments(
  ctx: BrandContext,
  runId?: string,
): Promise<{ runId: string | null; segments: SegmentWithEvidence[] }> {
  const resolvedRunId = runId ?? (await latestRunId(ctx));
  if (!resolvedRunId) return { runId: null, segments: [] };

  const rows = await db
    .select({
      segment: segmentCandidates,
      personaId: personas.id,
      personaName: personas.name,
      supportingCount: raw<number>`(select count(*)::int from segment_candidate_evidence sce where sce.segment_candidate_id = ${segmentCandidates.id} and sce.relation = 'supports')`,
      contradictingCount: raw<number>`(select count(*)::int from segment_candidate_evidence sce where sce.segment_candidate_id = ${segmentCandidates.id} and sce.relation = 'contradicts')`,
      unavailableCount: raw<number>`(select count(*)::int from segment_candidate_evidence sce join evidence_records er on er.id = sce.evidence_id where sce.segment_candidate_id = ${segmentCandidates.id} and er.availability = 'source_deleted')`,
    })
    .from(segmentCandidates)
    .leftJoin(personas, eq(personas.segmentCandidateId, segmentCandidates.id))
    .where(
      and(
        eq(segmentCandidates.organizationId, ctx.organizationId),
        eq(segmentCandidates.brandId, ctx.brandId),
        eq(segmentCandidates.runId, resolvedRunId),
      ),
    )
    .orderBy(desc(segmentCandidates.confidence), segmentCandidates.slug);

  return {
    runId: resolvedRunId,
    segments: rows.map((row) => ({
      ...row.segment,
      supportingCount: row.supportingCount,
      contradictingCount: row.contradictingCount,
      unavailableCount: row.unavailableCount,
      personaId: row.personaId,
      personaName: row.personaName,
    })),
  };
}

export async function latestRunId(ctx: BrandContext): Promise<string | null> {
  const [row] = await db
    .select({ runId: segmentCandidates.runId })
    .from(segmentCandidates)
    .where(
      and(
        eq(segmentCandidates.organizationId, ctx.organizationId),
        eq(segmentCandidates.brandId, ctx.brandId),
      ),
    )
    .orderBy(desc(segmentCandidates.createdAt))
    .limit(1);
  return row?.runId ?? null;
}

export type SegmentEvidenceRow = {
  id: string;
  relation: "supports" | "contradicts";
  normalizedClaim: string;
  redactedText: string;
  category: string;
  provenance: string;
  journeyStage: string;
  sourceLabel: string;
  sourceLocation: string;
  sourceType: string;
  availability: string;
  observedAt: Date | null;
  qualityScore: number;
};

export async function getSegment(
  ctx: BrandContext,
  segmentId: string,
): Promise<{ segment: typeof segmentCandidates.$inferSelect; evidence: SegmentEvidenceRow[] }> {
  const [segment] = await db
    .select()
    .from(segmentCandidates)
    .where(
      and(
        eq(segmentCandidates.id, segmentId),
        eq(segmentCandidates.organizationId, ctx.organizationId),
        eq(segmentCandidates.brandId, ctx.brandId),
      ),
    )
    .limit(1);

  if (!segment) throw new NotFoundError("Candidate segment");

  const evidence = await db
    .select({
      id: evidenceRecords.id,
      relation: segmentCandidateEvidence.relation,
      normalizedClaim: evidenceRecords.normalizedClaim,
      redactedText: evidenceRecords.redactedText,
      category: evidenceRecords.category,
      provenance: evidenceRecords.provenance,
      journeyStage: evidenceRecords.journeyStage,
      sourceLabel: dataSources.label,
      sourceLocation: evidenceRecords.sourceLocation,
      sourceType: evidenceRecords.sourceType,
      availability: evidenceRecords.availability,
      observedAt: evidenceRecords.observedAt,
      qualityScore: evidenceRecords.qualityScore,
    })
    .from(segmentCandidateEvidence)
    .innerJoin(evidenceRecords, eq(evidenceRecords.id, segmentCandidateEvidence.evidenceId))
    .innerJoin(dataSources, eq(dataSources.id, evidenceRecords.dataSourceId))
    .where(eq(segmentCandidateEvidence.segmentCandidateId, segmentId))
    .orderBy(segmentCandidateEvidence.relation, desc(evidenceRecords.qualityScore));

  return { segment, evidence };
}

/**
 * Recomputes a candidate's confidence, source distribution and coverage from
 * the evidence links that currently exist.
 *
 * The model's own confidence numbers are advisory. These are computed by the
 * application from records the reviewer can open, which is why the row is
 * stamped `data_origin: local` for this part of its state and why merging,
 * splitting or deleting a source changes the score.
 */
export async function recomputeSegmentConfidence(
  segmentId: string,
  options: { tx?: Executor; referenceDate?: Date } = {},
): Promise<{ confidence: number }> {
  const executor = options.tx ?? db;

  const [segment] = await executor
    .select({
      id: segmentCandidates.id,
      brandId: segmentCandidates.brandId,
      evidenceCutoff: segmentCandidates.evidenceCutoff,
    })
    .from(segmentCandidates)
    .where(eq(segmentCandidates.id, segmentId))
    .limit(1);
  if (!segment) throw new NotFoundError("Candidate segment");

  const links = await executor
    .select({
      relation: segmentCandidateEvidence.relation,
      evidenceId: evidenceRecords.id,
      sourceId: evidenceRecords.dataSourceId,
      sourceLabel: dataSources.label,
      sourceType: evidenceRecords.sourceType,
      provenance: evidenceRecords.provenance,
      qualityScore: evidenceRecords.qualityScore,
      observedAt: evidenceRecords.observedAt,
      uncertaintyNote: evidenceRecords.uncertaintyNote,
      availability: evidenceRecords.availability,
    })
    .from(segmentCandidateEvidence)
    .innerJoin(evidenceRecords, eq(evidenceRecords.id, segmentCandidateEvidence.evidenceId))
    .innerJoin(dataSources, eq(dataSources.id, evidenceRecords.dataSourceId))
    .where(eq(segmentCandidateEvidence.segmentCandidateId, segmentId));

  // A deleted source's records stop contributing to the score but are kept as
  // links so the history stays auditable.
  const available = links.filter((link) => link.availability === "available");
  const supporting = available.filter((link) => link.relation === "supports");
  const contradicting = available.filter((link) => link.relation === "contradicts");

  const [scope] = await executor
    .select({
      sources: raw<number>`count(distinct ${evidenceRecords.dataSourceId})::int`,
      records: raw<number>`count(*)::int`,
    })
    .from(evidenceRecords)
    .where(
      and(
        eq(evidenceRecords.brandId, segment.brandId),
        eq(evidenceRecords.reviewStatus, "approved"),
        eq(evidenceRecords.availability, "available"),
      ),
    );

  const result = evaluateConfidence({
    supporting: supporting.map(toConfidenceEvidence),
    contradicting: contradicting.map(toConfidenceEvidence),
    scopeSourceCount: scope?.sources ?? 0,
    referenceDate: options.referenceDate ?? segment.evidenceCutoff ?? new Date(0),
  });

  const distribution: Record<string, number> = {};
  for (const link of supporting) {
    distribution[link.sourceLabel] = (distribution[link.sourceLabel] ?? 0) + 1;
  }

  const coverage = (scope?.records ?? 0) === 0 ? 0 : supporting.length / (scope?.records ?? 1);

  await executor
    .update(segmentCandidates)
    .set({
      confidence: result.score,
      confidenceComponents: result.components,
      confidenceExplanation: result.explanation,
      sourceDistribution: distribution,
      evidenceCoverage: Math.round(coverage * 1000) / 1000,
      updatedAt: new Date(),
    })
    .where(eq(segmentCandidates.id, segmentId));

  return { confidence: result.score };
}

function toConfidenceEvidence(link: {
  evidenceId: string;
  sourceId: string;
  sourceType: string;
  provenance: string;
  qualityScore: number;
  observedAt: Date | null;
  uncertaintyNote: string | null;
}): ConfidenceEvidence {
  return {
    id: link.evidenceId,
    sourceId: link.sourceId,
    sourceType: link.sourceType,
    provenance: link.provenance,
    qualityScore: link.qualityScore,
    observedAt: link.observedAt,
    hedged: link.uncertaintyNote !== null,
  };
}

// ── Decisions ───────────────────────────────────────────────────────────────

async function loadSegmentForWrite(ctx: BrandContext, segmentId: string) {
  const [segment] = await db
    .select()
    .from(segmentCandidates)
    .where(
      and(
        eq(segmentCandidates.id, segmentId),
        eq(segmentCandidates.organizationId, ctx.organizationId),
        eq(segmentCandidates.brandId, ctx.brandId),
      ),
    )
    .limit(1);
  if (!segment) throw new NotFoundError("Candidate segment");
  return segment;
}

export async function decideSegment(
  ctx: BrandContext,
  segmentId: string,
  decision: "approved" | "rejected" | "candidate",
): Promise<void> {
  requireCapability(ctx, "segment:generate");
  const segment = await loadSegmentForWrite(ctx, segmentId);

  if (segment.status === "merged") {
    throw new AppError(
      "conflict",
      "This candidate was merged into another and can no longer be approved or rejected on its own.",
    );
  }

  await db
    .update(segmentCandidates)
    .set({ status: decision, updatedAt: new Date() })
    .where(eq(segmentCandidates.id, segmentId));

  await recordAudit({
    organizationId: ctx.organizationId,
    brandId: ctx.brandId,
    actorUserId: ctx.userId,
    action: "segment.decision",
    entityType: "segment_candidate",
    entityId: segmentId,
    metadata: { decision, slug: segment.slug },
  });
}

export const segmentEditSchema = z.object({
  label: z.string().trim().min(3).max(120),
  definition: z.string().trim().min(20).max(1200),
  whyItChangesPrompts: z.string().trim().min(20).max(1200),
  distinguishingVariables: z.array(z.string().trim().min(1).max(160)).max(10),
});

export async function editSegment(
  ctx: BrandContext,
  segmentId: string,
  input: z.infer<typeof segmentEditSchema>,
): Promise<void> {
  requireCapability(ctx, "segment:generate");
  await loadSegmentForWrite(ctx, segmentId);

  await db
    .update(segmentCandidates)
    .set({
      label: input.label,
      definition: input.definition,
      whyItChangesPrompts: input.whyItChangesPrompts,
      distinguishingVariables: input.distinguishingVariables,
      updatedAt: new Date(),
    })
    .where(eq(segmentCandidates.id, segmentId));

  await recordAudit({
    organizationId: ctx.organizationId,
    brandId: ctx.brandId,
    actorUserId: ctx.userId,
    action: "segment.decision",
    entityType: "segment_candidate",
    entityId: segmentId,
    metadata: { edited: true, label: input.label },
  });
}

/**
 * Merges candidates into a target.
 *
 * Evidence links are unioned onto the target and the sources are marked
 * `merged` with `merged_into_id` set — nothing is deleted, so the run still
 * shows what the model originally proposed. The target's confidence is
 * recomputed from its new, larger evidence set.
 */
export async function mergeSegments(
  ctx: BrandContext,
  targetId: string,
  sourceIds: string[],
): Promise<{ merged: number; confidence: number }> {
  requireCapability(ctx, "segment:generate");

  const ids = sourceIds.filter((id) => id !== targetId);
  if (ids.length === 0) {
    throw new ValidationError("Choose at least one other candidate to merge into the target.");
  }

  const target = await loadSegmentForWrite(ctx, targetId);
  const sources = await db
    .select()
    .from(segmentCandidates)
    .where(
      and(
        eq(segmentCandidates.organizationId, ctx.organizationId),
        eq(segmentCandidates.brandId, ctx.brandId),
        eq(segmentCandidates.runId, target.runId),
        inArray(segmentCandidates.id, ids),
      ),
    );

  if (sources.length !== ids.length) {
    throw new ValidationError("All merged candidates must belong to the same segmentation run.");
  }
  if (sources.some((source) => source.status === "merged")) {
    throw new ValidationError("One of the selected candidates has already been merged.");
  }

  await db.transaction(async (tx) => {
    for (const source of sources) {
      const links = await tx
        .select()
        .from(segmentCandidateEvidence)
        .where(eq(segmentCandidateEvidence.segmentCandidateId, source.id));

      for (const link of links) {
        await tx
          .insert(segmentCandidateEvidence)
          .values({
            id: newId(ID_PREFIXES.segmentCandidate),
            organizationId: ctx.organizationId,
            segmentCandidateId: targetId,
            evidenceId: link.evidenceId,
            relation: link.relation,
          })
          .onConflictDoNothing();
      }

      await tx
        .update(segmentCandidates)
        .set({ status: "merged", mergedIntoId: targetId, updatedAt: new Date() })
        .where(eq(segmentCandidates.id, source.id));
    }

    // A record cannot both support and contradict the merged segment; when the
    // two candidates disagreed, the contradiction is the honest reading.
    await tx.execute(raw`
      DELETE FROM segment_candidate_evidence AS keep
      WHERE keep.segment_candidate_id = ${targetId}
        AND keep.relation = 'supports'
        AND EXISTS (
          SELECT 1 FROM segment_candidate_evidence AS other
          WHERE other.segment_candidate_id = ${targetId}
            AND other.evidence_id = keep.evidence_id
            AND other.relation = 'contradicts'
        )
    `);

    const merged = sources.map((source) => source.label);
    await tx
      .update(segmentCandidates)
      .set({
        mergeSplitRecommendation: `Merged from: ${merged.join("; ")}. Confidence recomputed from the combined evidence.`,
        updatedAt: new Date(),
      })
      .where(eq(segmentCandidates.id, targetId));
  });

  const { confidence } = await recomputeSegmentConfidence(targetId);

  await recordAudit({
    organizationId: ctx.organizationId,
    brandId: ctx.brandId,
    actorUserId: ctx.userId,
    action: "segment.decision",
    entityType: "segment_candidate",
    entityId: targetId,
    metadata: { merged: sources.map((s) => s.id), confidence },
  });

  return { merged: sources.length, confidence };
}

export const segmentSplitSchema = z.object({
  labelA: z.string().trim().min(3).max(120),
  labelB: z.string().trim().min(3).max(120),
  /** Supporting evidence moved to the second part; everything else stays in the first. */
  evidenceIdsForB: z.array(z.string().min(1)).min(1),
});

/**
 * Splits a candidate into two new candidates in the same run.
 *
 * The reviewer assigns the evidence explicitly rather than the application
 * guessing a partition, because a wrong guess would silently change what each
 * new segment claims. The parent is marked `split` and kept.
 */
export async function splitSegment(
  ctx: BrandContext,
  segmentId: string,
  input: z.infer<typeof segmentSplitSchema>,
): Promise<{ ids: string[] }> {
  requireCapability(ctx, "segment:generate");
  const parent = await loadSegmentForWrite(ctx, segmentId);
  if (parent.status === "merged" || parent.status === "split") {
    throw new ValidationError("This candidate has already been merged or split.");
  }

  const links = await db
    .select()
    .from(segmentCandidateEvidence)
    .where(eq(segmentCandidateEvidence.segmentCandidateId, segmentId));

  const supporting = links.filter((link) => link.relation === "supports");
  const forB = new Set(input.evidenceIdsForB);
  const bLinks = supporting.filter((link) => forB.has(link.evidenceId));
  const aLinks = supporting.filter((link) => !forB.has(link.evidenceId));

  if (bLinks.length === 0 || aLinks.length === 0) {
    throw new ValidationError(
      "A split needs supporting evidence on both sides. Leave at least one record in each part.",
    );
  }

  const contradicting = links.filter((link) => link.relation === "contradicts");
  const created: string[] = [];

  await db.transaction(async (tx) => {
    const existing = await tx
      .select({ slug: segmentCandidates.slug })
      .from(segmentCandidates)
      .where(eq(segmentCandidates.runId, parent.runId));
    const taken = new Set(existing.map((row) => row.slug));

    for (const [label, partLinks] of [
      [input.labelA, aLinks] as const,
      [input.labelB, bLinks] as const,
    ]) {
      const id = newId(ID_PREFIXES.segmentCandidate);
      created.push(id);

      await tx.insert(segmentCandidates).values({
        id,
        organizationId: ctx.organizationId,
        brandId: ctx.brandId,
        runId: parent.runId,
        label,
        slug: uniqueSlug(slugify(label), taken),
        definition: `${parent.definition}\n\nSplit from "${parent.label}" by a reviewer, narrowed to the evidence assigned to this part.`,
        distinguishingVariables: parent.distinguishingVariables,
        whyItChangesPrompts: parent.whyItChangesPrompts,
        coverageGaps: [
          ...parent.coverageGaps,
          "Created by a reviewer split: the definition and distinguishing variables are inherited from the parent and should be narrowed before a persona is generated.",
        ],
        overlaps: [],
        mergeSplitRecommendation: `Split from "${parent.label}" (${parent.slug}).`,
        status: "candidate",
        modelProvider: parent.modelProvider,
        modelId: parent.modelId,
        promptTemplateVersion: parent.promptTemplateVersion,
        schemaVersion: parent.schemaVersion,
        dataOrigin: parent.dataOrigin,
        evidenceCutoff: parent.evidenceCutoff,
        generatedByUserId: ctx.userId,
      });

      for (const link of [...partLinks, ...contradicting]) {
        await tx.insert(segmentCandidateEvidence).values({
          id: newId(ID_PREFIXES.segmentCandidate),
          organizationId: ctx.organizationId,
          segmentCandidateId: id,
          evidenceId: link.evidenceId,
          relation: link.relation,
        });
      }
    }

    await tx
      .update(segmentCandidates)
      .set({ status: "split", updatedAt: new Date() })
      .where(eq(segmentCandidates.id, segmentId));
  });

  for (const id of created) await recomputeSegmentConfidence(id);

  await recordAudit({
    organizationId: ctx.organizationId,
    brandId: ctx.brandId,
    actorUserId: ctx.userId,
    action: "segment.decision",
    entityType: "segment_candidate",
    entityId: segmentId,
    metadata: { split: created, labels: [input.labelA, input.labelB] },
  });

  return { ids: created };
}

function uniqueSlug(base: string, taken: Set<string>): string {
  let slug = base;
  let suffix = 2;
  while (taken.has(slug)) {
    slug = `${base}-${suffix++}`.slice(0, 80);
  }
  taken.add(slug);
  return slug;
}

/**
 * How much of the brand's approved evidence a run actually accounts for.
 *
 * Reported rather than hidden: §13 requires that evidence is not forced into a
 * segment, so a run that leaves records unassigned is behaving correctly and the
 * screen should say so.
 */
export async function getRunCoverage(
  ctx: BrandContext,
  runId: string,
): Promise<{ approved: number; assigned: number; unassigned: number }> {
  const [approvedRow] = await db
    .select({ n: count() })
    .from(evidenceRecords)
    .where(
      and(
        eq(evidenceRecords.brandId, ctx.brandId),
        eq(evidenceRecords.reviewStatus, "approved"),
        eq(evidenceRecords.availability, "available"),
      ),
    );

  const [assignedRow] = await db
    .select({ n: raw<number>`count(distinct ${segmentCandidateEvidence.evidenceId})::int` })
    .from(segmentCandidateEvidence)
    .innerJoin(
      segmentCandidates,
      eq(segmentCandidates.id, segmentCandidateEvidence.segmentCandidateId),
    )
    .where(
      and(
        eq(segmentCandidates.runId, runId),
        eq(segmentCandidates.brandId, ctx.brandId),
        eq(segmentCandidateEvidence.relation, "supports"),
      ),
    );

  const approved = approvedRow?.n ?? 0;
  const assigned = assignedRow?.n ?? 0;
  return { approved, assigned, unassigned: Math.max(0, approved - assigned) };
}

/** Candidates a persona can be generated from, for the persona-list screen. */
export async function listApprovedSegments(ctx: BrandContext) {
  return db
    .select({
      id: segmentCandidates.id,
      label: segmentCandidates.label,
      slug: segmentCandidates.slug,
      confidence: segmentCandidates.confidence,
      personaId: personas.id,
    })
    .from(segmentCandidates)
    .leftJoin(personas, eq(personas.segmentCandidateId, segmentCandidates.id))
    .where(
      and(
        eq(segmentCandidates.organizationId, ctx.organizationId),
        eq(segmentCandidates.brandId, ctx.brandId),
        eq(segmentCandidates.status, "approved"),
      ),
    )
    .orderBy(desc(segmentCandidates.confidence));
}

/** Running segmentation jobs, so the screen can say work is in flight. */
export async function activeSegmentationJobs(ctx: BrandContext) {
  return db
    .select({
      id: jobs.id,
      status: jobs.status,
      lastError: jobs.lastError,
      createdAt: jobs.createdAt,
      attempts: jobs.attempts,
    })
    .from(jobs)
    .where(
      and(
        eq(jobs.brandId, ctx.brandId),
        inArray(jobs.type, [JOB_TYPES.generateSegments, JOB_TYPES.generatePersona]),
        ne(jobs.status, "succeeded"),
      ),
    )
    .orderBy(desc(jobs.createdAt))
    .limit(5);
}
