import "server-only";
import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db/client";
import {
  personas,
  profoundPromptLinks,
  profoundResultBuckets,
  promptAnswerCoverageEstimates,
  promptPairs,
  prompts,
} from "@/db/schema";
import { getQueue } from "@/adapters/queue";
import { JOB_TYPES } from "@/jobs/registry";
import { requireCapability, type BrandContext } from "@/lib/auth/context";
import { hashExpectedElements } from "@/lib/answer-coverage";
import { NotFoundError, ValidationError } from "@/lib/errors";
import {
  aggregateMetrics,
  classifyResult,
  compareControl,
  type AggregatedMetrics,
  type ControlComparison,
  type ResultClassification,
  type SnapshotMetrics,
} from "@/lib/profound-results";
import { recordAudit } from "./audit";
import { listPromptLinks } from "./profound-links";

/**
 * Reads over `profound_result_buckets` (§25, redesigned 2026-08-10): retrieval
 * triggering, the persona performance panel, persona-vs-control comparison,
 * and single-prompt bucket inspection. The job that actually writes buckets is
 * `src/jobs/handlers/profound-results.ts`; this file only reads and enqueues.
 *
 * Two things follow from the redesign:
 *
 * - There is no vendor concept of a mention count, brand-mentioned flag or
 *   per-execution "run" — classification reads only real vendor fields
 *   (`visibilityScore`, and a competitor's `shareOfVoice` in the same bucket
 *   when competitor asset scope was requested), via `classifyResult`.
 * - "Missing expected answer elements" no longer comes from a substring match
 *   against a Profound raw answer (the vendor has none). It is read from
 *   `prompt_answer_coverage_estimates`, this product's own self-computed,
 *   `dataOrigin: "local"` estimate (see
 *   `src/jobs/handlers/estimate-answer-coverage.ts`). A prompt whose expected
 *   elements changed since its last estimate, or that has no estimate at all
 *   yet, honestly reports no missing elements here rather than serving a
 *   stale or fabricated one.
 */

const MAX_RANGE_DAYS = 92;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validateRange(startDate: string, endDate: string): void {
  if (!DATE_RE.test(startDate) || !DATE_RE.test(endDate)) {
    throw new ValidationError("Dates must be given as YYYY-MM-DD.");
  }
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    throw new ValidationError("Dates must be valid calendar dates.");
  }
  if (start.getTime() > end.getTime()) {
    throw new ValidationError("The start date must be on or before the end date.");
  }
  const days = Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000)) + 1;
  if (days > MAX_RANGE_DAYS) {
    throw new ValidationError(`Choose a range of ${MAX_RANGE_DAYS} days or fewer.`);
  }
}

function dateBounds(startDate: string, endDate: string) {
  return {
    start: new Date(`${startDate}T00:00:00Z`),
    end: new Date(`${endDate}T23:59:59.999Z`),
  };
}

type BucketRow = typeof profoundResultBuckets.$inferSelect;

function toMetrics(row: BucketRow): SnapshotMetrics {
  return {
    visibilityScore: row.visibilityScore,
    shareOfVoice: row.shareOfVoice,
    citationCount: row.citationCount,
    citationShare: row.citationShare,
    averagePosition: row.averagePosition,
  };
}

/**
 * The strongest sibling competitor-asset row's share of voice in the same
 * bucket as `row`, or `null` when no competitor row exists for that bucket.
 * Retrieval does not currently request competitor asset scope (see
 * `src/jobs/handlers/profound-results.ts`), so this resolves to `null` in
 * practice today — the lookup stays correct rather than hardcoded, so it
 * starts working the moment competitor asset scope is ever requested.
 */
function competitorShareOfVoiceForBucket(row: BucketRow, allRows: BucketRow[]): number | null {
  const competitorRows = allRows.filter(
    (r) =>
      r.assetOwned === false &&
      r.profoundPromptId === row.profoundPromptId &&
      r.bucketDate.getTime() === row.bucketDate.getTime() &&
      r.modelId === row.modelId &&
      r.topicId === row.topicId &&
      r.regionId === row.regionId &&
      r.personaId === row.personaId,
  );
  if (competitorRows.length === 0) return null;
  return competitorRows.reduce((max, r) => Math.max(max, r.shareOfVoice ?? 0), 0);
}

function classifyBucket(
  row: BucketRow,
  allRows: BucketRow[],
): { classification: ResultClassification; competitorVisible: boolean | null } {
  return classifyResult({
    visibilityScore: row.visibilityScore,
    shareOfVoice: row.shareOfVoice,
    competitorShareOfVoice: competitorShareOfVoiceForBucket(row, allRows),
  });
}

type CoverageEstimateRow = typeof promptAnswerCoverageEstimates.$inferSelect;

/**
 * Loads only the coverage estimate that matches each prompt's *current*
 * expected-answer-elements hash — an estimate computed before the prompt was
 * last edited is never surfaced as current, and a prompt with no matching
 * estimate yet is simply absent from the returned map (never a stale or
 * fabricated stand-in).
 */
async function loadCurrentCoverageEstimates(
  promptRows: { id: string; expectedAnswerElements: string[] }[],
): Promise<Map<string, CoverageEstimateRow>> {
  if (promptRows.length === 0) return new Map();
  const rows = await db
    .select()
    .from(promptAnswerCoverageEstimates)
    .where(
      inArray(
        promptAnswerCoverageEstimates.promptId,
        promptRows.map((p) => p.id),
      ),
    );
  const byKey = new Map(rows.map((r) => [`${r.promptId}::${r.expectedElementsHash}`, r]));
  const current = new Map<string, CoverageEstimateRow>();
  for (const prompt of promptRows) {
    const hash = hashExpectedElements(prompt.expectedAnswerElements);
    const estimate = byKey.get(`${prompt.id}::${hash}`);
    if (estimate) current.set(prompt.id, estimate);
  }
  return current;
}

// ── Retrieval trigger ────────────────────────────────────────────────────────

export async function startResultRetrieval(
  ctx: BrandContext,
  input: { startDate: string; endDate: string },
): Promise<{ jobId: string; prompts: number }> {
  requireCapability(ctx, "profound:retrieve_results");
  validateRange(input.startDate, input.endDate);

  // Retrieval only ever covers prompts actually linked in Profound — this
  // product never asks the vendor about a prompt it never sent it.
  const links = await listPromptLinks(ctx);
  if (links.length === 0) {
    throw new ValidationError(
      "No prompts have been deployed to Profound for this brand yet. Deploy a prompt set before retrieving results.",
    );
  }

  const queued = await getQueue().enqueue(
    JOB_TYPES.profoundResults,
    {
      organizationId: ctx.organizationId,
      brandId: ctx.brandId,
      startDate: input.startDate,
      endDate: input.endDate,
    },
    { organizationId: ctx.organizationId, brandId: ctx.brandId },
  );

  await recordAudit({
    organizationId: ctx.organizationId,
    brandId: ctx.brandId,
    actorUserId: ctx.userId,
    action: "profound.results_retrieve",
    entityType: "brand",
    entityId: ctx.brandId,
    metadata: {
      jobId: queued.id,
      startDate: input.startDate,
      endDate: input.endDate,
      linkedPrompts: links.length,
    },
  });

  return { jobId: queued.id, prompts: links.length };
}

// ── Performance panel ────────────────────────────────────────────────────────

export type PerformanceFilters = {
  startDate: string;
  endDate: string;
  modelId?: string;
  region?: string;
  personaVersionId?: string;
};

export type PromptPerformanceRow = {
  promptId: string;
  promptType: "persona" | "generic_control";
  promptText: string;
  topic: string;
  personaId: string;
  personaName: string;
  profoundPromptId: string;
  /** From the most recent bucket in range — "how does this look right now". */
  classification: ResultClassification;
  /** Null when competitor asset scope wasn't part of this bucket's retrieval — not measured, never "no competitor visible". */
  competitorVisible: boolean | null;
  /** From this product's own self-computed estimate (`dataOrigin: "local"`), not from Profound. Empty when no current estimate exists yet. */
  missingElements: string[];
  metrics: AggregatedMetrics;
};

export type PersonaPerformanceGroup = {
  personaId: string;
  personaName: string;
  metrics: AggregatedMetrics;
  prompts: PromptPerformanceRow[];
};

export type PerformancePanel = {
  overall: AggregatedMetrics;
  brandAbsentCount: number;
  /** Count where a competitor was actually measured as more visible — never includes "not measured" prompts. */
  competitorVisibleCount: number;
  missingElementsCount: number;
  personas: PersonaPerformanceGroup[];
};

export async function getPerformancePanel(
  ctx: BrandContext,
  filters: PerformanceFilters,
): Promise<PerformancePanel> {
  validateRange(filters.startDate, filters.endDate);
  const { start, end } = dateBounds(filters.startDate, filters.endDate);

  const conditions = [
    eq(profoundResultBuckets.organizationId, ctx.organizationId),
    eq(profoundResultBuckets.brandId, ctx.brandId),
    gte(profoundResultBuckets.bucketDate, start),
    lte(profoundResultBuckets.bucketDate, end),
  ];
  if (filters.modelId) conditions.push(eq(profoundResultBuckets.modelId, filters.modelId));
  if (filters.region) conditions.push(eq(profoundResultBuckets.region, filters.region));
  if (filters.personaVersionId) {
    conditions.push(eq(prompts.personaVersionId, filters.personaVersionId));
  }

  const rows = await db
    .select({
      bucket: profoundResultBuckets,
      promptId: prompts.id,
      promptType: prompts.promptType,
      promptText: prompts.promptText,
      topic: prompts.topic,
      expectedAnswerElements: prompts.expectedAnswerElements,
      personaId: personas.id,
      personaName: personas.name,
    })
    .from(profoundResultBuckets)
    .innerJoin(prompts, eq(prompts.id, profoundResultBuckets.promptId))
    .innerJoin(personas, eq(personas.id, prompts.personaId))
    .where(and(...conditions))
    .orderBy(desc(profoundResultBuckets.bucketDate));

  type PromptBucketGroup = {
    promptType: "persona" | "generic_control";
    promptText: string;
    topic: string;
    expectedAnswerElements: string[];
    personaId: string;
    personaName: string;
    profoundPromptId: string;
    buckets: BucketRow[];
  };

  const byPrompt = new Map<string, PromptBucketGroup>();
  const allBucketRows: BucketRow[] = [];
  for (const row of rows) {
    allBucketRows.push(row.bucket);
    let group = byPrompt.get(row.promptId);
    if (!group) {
      group = {
        promptType: row.promptType,
        promptText: row.promptText,
        topic: row.topic,
        expectedAnswerElements: row.expectedAnswerElements,
        personaId: row.personaId,
        personaName: row.personaName,
        profoundPromptId: row.bucket.profoundPromptId,
        buckets: [],
      };
      byPrompt.set(row.promptId, group);
    }
    group.buckets.push(row.bucket);
  }

  const estimateByPromptId = await loadCurrentCoverageEstimates(
    [...byPrompt.entries()].map(([promptId, group]) => ({
      id: promptId,
      expectedAnswerElements: group.expectedAnswerElements,
    })),
  );

  const promptRows: PromptPerformanceRow[] = [];
  for (const [promptId, group] of byPrompt) {
    // Never empty: a group only exists because at least one row was pushed
    // into it above.
    const latest = [...group.buckets].sort(
      (a, b) => b.bucketDate.getTime() - a.bucketDate.getTime(),
    )[0]!;
    const classified = classifyBucket(latest, allBucketRows);

    promptRows.push({
      promptId,
      promptType: group.promptType,
      promptText: group.promptText,
      topic: group.topic,
      personaId: group.personaId,
      personaName: group.personaName,
      profoundPromptId: group.profoundPromptId,
      classification: classified.classification,
      competitorVisible: classified.competitorVisible,
      missingElements: estimateByPromptId.get(promptId)?.missing ?? [],
      metrics: aggregateMetrics(group.buckets.map(toMetrics)),
    });
  }

  const personaGroups = new Map<string, PersonaPerformanceGroup>();
  for (const [, group] of byPrompt) {
    let personaGroup = personaGroups.get(group.personaId);
    if (!personaGroup) {
      personaGroup = {
        personaId: group.personaId,
        personaName: group.personaName,
        metrics: aggregateMetrics([]),
        prompts: [],
      };
      personaGroups.set(group.personaId, personaGroup);
    }
  }
  for (const row of promptRows) {
    personaGroups.get(row.personaId)?.prompts.push(row);
  }
  for (const [personaId, personaGroup] of personaGroups) {
    const personaBuckets = [...byPrompt.entries()]
      .filter(([, group]) => group.personaId === personaId)
      .flatMap(([, group]) => group.buckets);
    personaGroup.metrics = aggregateMetrics(personaBuckets.map(toMetrics));
  }

  return {
    overall: aggregateMetrics(rows.map((row) => toMetrics(row.bucket))),
    brandAbsentCount: promptRows.filter((row) => row.classification === "brand_absent").length,
    competitorVisibleCount: promptRows.filter((row) => row.competitorVisible === true).length,
    missingElementsCount: promptRows.filter((row) => row.missingElements.length > 0).length,
    personas: [...personaGroups.values()].sort((a, b) =>
      a.personaName.localeCompare(b.personaName),
    ),
  };
}

// ── Persona vs generic-control comparison ───────────────────────────────────

export type ControlComparisonRow = ControlComparison & {
  personaPromptId: string;
  personaPromptText: string;
  controlPromptId: string;
  controlPromptText: string;
};

export async function getControlComparison(
  ctx: BrandContext,
  input: { promptSetVersionId: string; startDate: string; endDate: string },
): Promise<{ pairs: ControlComparisonRow[] }> {
  validateRange(input.startDate, input.endDate);
  const { start, end } = dateBounds(input.startDate, input.endDate);

  const pairs = await db
    .select({
      personaPromptId: promptPairs.personaPromptId,
      controlPromptId: promptPairs.controlPromptId,
    })
    .from(promptPairs)
    .where(
      and(
        eq(promptPairs.promptSetVersionId, input.promptSetVersionId),
        eq(promptPairs.organizationId, ctx.organizationId),
      ),
    );

  if (pairs.length === 0) return { pairs: [] };

  const promptIds = pairs.flatMap((pair) => [pair.personaPromptId, pair.controlPromptId]);

  const [promptRows, buckets] = await Promise.all([
    db
      .select({ id: prompts.id, promptText: prompts.promptText })
      .from(prompts)
      .where(
        and(
          inArray(prompts.id, promptIds),
          eq(prompts.organizationId, ctx.organizationId),
          eq(prompts.brandId, ctx.brandId),
        ),
      ),
    db
      .select()
      .from(profoundResultBuckets)
      .where(
        and(
          eq(profoundResultBuckets.organizationId, ctx.organizationId),
          eq(profoundResultBuckets.brandId, ctx.brandId),
          inArray(profoundResultBuckets.promptId, promptIds),
          gte(profoundResultBuckets.bucketDate, start),
          lte(profoundResultBuckets.bucketDate, end),
        ),
      ),
  ]);

  const promptTextById = new Map(promptRows.map((row) => [row.id, row.promptText]));

  const metricsByPromptId = new Map<string, SnapshotMetrics[]>();
  for (const bucket of buckets) {
    if (!bucket.promptId) continue;
    const list = metricsByPromptId.get(bucket.promptId) ?? [];
    list.push(toMetrics(bucket));
    metricsByPromptId.set(bucket.promptId, list);
  }

  return {
    pairs: pairs.map((pair) => ({
      personaPromptId: pair.personaPromptId,
      personaPromptText: promptTextById.get(pair.personaPromptId) ?? "",
      controlPromptId: pair.controlPromptId,
      controlPromptText: promptTextById.get(pair.controlPromptId) ?? "",
      ...compareControl(
        metricsByPromptId.get(pair.personaPromptId) ?? [],
        metricsByPromptId.get(pair.controlPromptId) ?? [],
      ),
    })),
  };
}

// ── Single-prompt bucket inspection ─────────────────────────────────────────

export type PromptResultBucket = BucketRow & {
  classification: ResultClassification;
  competitorVisible: boolean | null;
};

export type PromptAnswerCoverageEstimateDetail = {
  covered: string[];
  missing: string[];
  confidence: number;
  rationale: string;
  modelId: string | null;
  createdAt: Date;
};

export async function getPromptResultDetail(
  ctx: BrandContext,
  promptId: string,
  input: { startDate: string; endDate: string },
): Promise<{
  prompt: { id: string; text: string; topic: string; expectedAnswerElements: string[] };
  profoundPromptId: string | null;
  profoundCategoryId: string | null;
  /** This product's own self-computed estimate for the prompt's *current* expected elements, or null if none exists yet — never a stale one. */
  answerCoverageEstimate: PromptAnswerCoverageEstimateDetail | null;
  buckets: PromptResultBucket[];
}> {
  validateRange(input.startDate, input.endDate);
  const { start, end } = dateBounds(input.startDate, input.endDate);

  const [prompt] = await db
    .select()
    .from(prompts)
    .where(
      and(
        eq(prompts.id, promptId),
        eq(prompts.organizationId, ctx.organizationId),
        eq(prompts.brandId, ctx.brandId),
      ),
    )
    .limit(1);
  if (!prompt) throw new NotFoundError("Prompt");

  const [link] = await db
    .select()
    .from(profoundPromptLinks)
    .where(
      and(
        eq(profoundPromptLinks.promptId, promptId),
        eq(profoundPromptLinks.organizationId, ctx.organizationId),
      ),
    )
    .orderBy(desc(profoundPromptLinks.createdAt))
    .limit(1);

  const buckets = await db
    .select()
    .from(profoundResultBuckets)
    .where(
      and(
        eq(profoundResultBuckets.organizationId, ctx.organizationId),
        eq(profoundResultBuckets.promptId, promptId),
        gte(profoundResultBuckets.bucketDate, start),
        lte(profoundResultBuckets.bucketDate, end),
      ),
    )
    .orderBy(desc(profoundResultBuckets.bucketDate));

  const expectedElementsHash = hashExpectedElements(prompt.expectedAnswerElements);
  const [estimate] = await db
    .select()
    .from(promptAnswerCoverageEstimates)
    .where(
      and(
        eq(promptAnswerCoverageEstimates.promptId, promptId),
        eq(promptAnswerCoverageEstimates.expectedElementsHash, expectedElementsHash),
      ),
    )
    .limit(1);

  return {
    prompt: {
      id: prompt.id,
      text: prompt.promptText,
      topic: prompt.topic,
      expectedAnswerElements: prompt.expectedAnswerElements,
    },
    profoundPromptId: link?.profoundPromptId ?? null,
    profoundCategoryId: link?.profoundCategoryId ?? null,
    answerCoverageEstimate: estimate
      ? {
          covered: estimate.covered,
          missing: estimate.missing,
          confidence: estimate.confidence,
          rationale: estimate.rationale,
          modelId: estimate.modelId,
          createdAt: estimate.createdAt,
        }
      : null,
    buckets: buckets.map((bucket) => {
      const classified = classifyBucket(bucket, buckets);
      return {
        ...bucket,
        classification: classified.classification,
        competitorVisible: classified.competitorVisible,
      };
    }),
  };
}
