import "server-only";
import { and, desc, eq, gte, inArray, lte } from "drizzle-orm";
import { db } from "@/db/client";
import {
  personas,
  profoundPromptLinks,
  profoundResultSnapshots,
  promptPairs,
  prompts,
} from "@/db/schema";
import { getQueue } from "@/adapters/queue";
import { JOB_TYPES } from "@/jobs/registry";
import { requireCapability, type BrandContext } from "@/lib/auth/context";
import { NotFoundError, ValidationError } from "@/lib/errors";
import {
  aggregateMetrics,
  classifyResult,
  compareControl,
  detectMissingElements,
  type AggregatedMetrics,
  type ControlComparison,
  type ResultClassification,
  type SnapshotMetrics,
} from "@/lib/profound-results";
import { recordAudit } from "./audit";
import { listPromptLinks } from "./profound-links";

/**
 * Reads over `profound_result_snapshots` (§25): retrieval triggering, the
 * persona performance panel, persona-vs-control comparison, and single-prompt
 * raw-answer inspection. The job that actually writes snapshots is
 * `src/jobs/handlers/profound-results.ts`; this file only reads and enqueues.
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

type SnapshotRow = typeof profoundResultSnapshots.$inferSelect;

function toMetrics(row: SnapshotRow): SnapshotMetrics {
  return {
    visibilityScore: row.visibilityScore,
    shareOfVoice: row.shareOfVoice,
    mentionCount: row.mentionCount,
    executions: row.executions,
    citationCount: row.citationCount,
    citationShare: row.citationShare,
    averagePosition: row.averagePosition,
  };
}

function asMentions(value: Record<string, unknown>[]): { entity: string; share: number }[] {
  return value.map((row) => ({
    entity: typeof row.entity === "string" ? row.entity : "",
    share: typeof row.share === "number" ? row.share : 0,
  }));
}

function classifySnapshot(row: SnapshotRow): ResultClassification {
  return classifyResult({
    brandMentioned: row.brandMentioned ?? false,
    mentionCount: row.mentionCount ?? 0,
    shareOfVoice: row.shareOfVoice,
    mentions: asMentions(row.mentions),
  });
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
  /** From the most recent run in range — "how does this look right now". */
  classification: ResultClassification;
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
  competitorDominatedCount: number;
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
    eq(profoundResultSnapshots.organizationId, ctx.organizationId),
    eq(profoundResultSnapshots.brandId, ctx.brandId),
    gte(profoundResultSnapshots.runDate, start),
    lte(profoundResultSnapshots.runDate, end),
  ];
  if (filters.modelId) conditions.push(eq(profoundResultSnapshots.modelId, filters.modelId));
  if (filters.region) conditions.push(eq(profoundResultSnapshots.region, filters.region));
  if (filters.personaVersionId) {
    conditions.push(eq(prompts.personaVersionId, filters.personaVersionId));
  }

  const rows = await db
    .select({
      snapshot: profoundResultSnapshots,
      promptId: prompts.id,
      promptType: prompts.promptType,
      promptText: prompts.promptText,
      topic: prompts.topic,
      expectedAnswerElements: prompts.expectedAnswerElements,
      personaId: personas.id,
      personaName: personas.name,
    })
    .from(profoundResultSnapshots)
    .innerJoin(prompts, eq(prompts.id, profoundResultSnapshots.promptId))
    .innerJoin(personas, eq(personas.id, prompts.personaId))
    .where(and(...conditions))
    .orderBy(desc(profoundResultSnapshots.runDate));

  type PromptBucket = {
    promptType: "persona" | "generic_control";
    promptText: string;
    topic: string;
    expectedAnswerElements: string[];
    personaId: string;
    personaName: string;
    profoundPromptId: string;
    snapshots: SnapshotRow[];
  };

  const byPrompt = new Map<string, PromptBucket>();
  for (const row of rows) {
    let bucket = byPrompt.get(row.promptId);
    if (!bucket) {
      bucket = {
        promptType: row.promptType,
        promptText: row.promptText,
        topic: row.topic,
        expectedAnswerElements: row.expectedAnswerElements,
        personaId: row.personaId,
        personaName: row.personaName,
        profoundPromptId: row.snapshot.profoundPromptId,
        snapshots: [],
      };
      byPrompt.set(row.promptId, bucket);
    }
    bucket.snapshots.push(row.snapshot);
  }

  const promptRows: PromptPerformanceRow[] = [];
  for (const [promptId, bucket] of byPrompt) {
    // Never empty: a bucket only exists because at least one row was pushed
    // into it above.
    const latest = [...bucket.snapshots].sort(
      (a, b) => b.runDate.getTime() - a.runDate.getTime(),
    )[0]!;

    promptRows.push({
      promptId,
      promptType: bucket.promptType,
      promptText: bucket.promptText,
      topic: bucket.topic,
      personaId: bucket.personaId,
      personaName: bucket.personaName,
      profoundPromptId: bucket.profoundPromptId,
      classification: classifySnapshot(latest),
      missingElements: detectMissingElements(bucket.expectedAnswerElements, {
        rawAnswer: latest.rawAnswer,
      }),
      metrics: aggregateMetrics(bucket.snapshots.map(toMetrics)),
    });
  }

  const personaGroups = new Map<string, PersonaPerformanceGroup>();
  for (const [, bucket] of byPrompt) {
    let group = personaGroups.get(bucket.personaId);
    if (!group) {
      group = {
        personaId: bucket.personaId,
        personaName: bucket.personaName,
        metrics: aggregateMetrics([]),
        prompts: [],
      };
      personaGroups.set(bucket.personaId, group);
    }
  }
  for (const row of promptRows) {
    personaGroups.get(row.personaId)?.prompts.push(row);
  }
  for (const [personaId, group] of personaGroups) {
    const personaSnapshots = [...byPrompt.entries()]
      .filter(([, bucket]) => bucket.personaId === personaId)
      .flatMap(([, bucket]) => bucket.snapshots);
    group.metrics = aggregateMetrics(personaSnapshots.map(toMetrics));
  }

  return {
    overall: aggregateMetrics(rows.map((row) => toMetrics(row.snapshot))),
    brandAbsentCount: promptRows.filter((row) => row.classification === "brand_absent").length,
    competitorDominatedCount: promptRows.filter(
      (row) => row.classification === "competitor_dominated",
    ).length,
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

  const [promptRows, snapshots] = await Promise.all([
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
      .from(profoundResultSnapshots)
      .where(
        and(
          eq(profoundResultSnapshots.organizationId, ctx.organizationId),
          eq(profoundResultSnapshots.brandId, ctx.brandId),
          inArray(profoundResultSnapshots.promptId, promptIds),
          gte(profoundResultSnapshots.runDate, start),
          lte(profoundResultSnapshots.runDate, end),
        ),
      ),
  ]);

  const promptTextById = new Map(promptRows.map((row) => [row.id, row.promptText]));

  const metricsByPromptId = new Map<string, SnapshotMetrics[]>();
  for (const snapshot of snapshots) {
    if (!snapshot.promptId) continue;
    const list = metricsByPromptId.get(snapshot.promptId) ?? [];
    list.push(toMetrics(snapshot));
    metricsByPromptId.set(snapshot.promptId, list);
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

// ── Raw-answer inspection ────────────────────────────────────────────────────

export type PromptResultRun = SnapshotRow & {
  classification: ResultClassification;
  missingElements: string[];
};

export async function getPromptResultDetail(
  ctx: BrandContext,
  promptId: string,
  input: { startDate: string; endDate: string },
): Promise<{
  prompt: { id: string; text: string; topic: string; expectedAnswerElements: string[] };
  profoundPromptId: string | null;
  profoundCategoryId: string | null;
  runs: PromptResultRun[];
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

  const snapshots = await db
    .select()
    .from(profoundResultSnapshots)
    .where(
      and(
        eq(profoundResultSnapshots.organizationId, ctx.organizationId),
        eq(profoundResultSnapshots.promptId, promptId),
        gte(profoundResultSnapshots.runDate, start),
        lte(profoundResultSnapshots.runDate, end),
      ),
    )
    .orderBy(desc(profoundResultSnapshots.runDate));

  return {
    prompt: {
      id: prompt.id,
      text: prompt.promptText,
      topic: prompt.topic,
      expectedAnswerElements: prompt.expectedAnswerElements,
    },
    profoundPromptId: link?.profoundPromptId ?? null,
    profoundCategoryId: link?.profoundCategoryId ?? null,
    runs: snapshots.map((snapshot) => ({
      ...snapshot,
      classification: classifySnapshot(snapshot),
      missingElements: detectMissingElements(prompt.expectedAnswerElements, {
        rawAnswer: snapshot.rawAnswer,
      }),
    })),
  };
}
