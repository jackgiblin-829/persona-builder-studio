/**
 * Result normalization and analysis (§25), pure and clock-free like
 * `src/lib/confidence.ts` and `src/lib/profound-payload.ts` — every function
 * here takes the data it needs as arguments and is unit-testable without a
 * database or a vendor call.
 *
 * Redesigned 2026-08-10 around the real bucket-shaped v2 reporting API (see
 * `src/adapters/profound/live.ts`). Two things follow from that:
 *
 * - **Classification** (`classifyResult`) now reads only real vendor fields —
 *   `visibilityScore` for brand-absence, and a competitor's `shareOfVoice` in
 *   the same bucket (when competitor asset scope was requested) for
 *   competitor visibility. There is no vendor concept of a mention count or a
 *   brand-mentioned flag, so neither is read or fabricated. When competitor
 *   scope wasn't requested, the competitor signal is `null` — not measured,
 *   never guessed.
 * - **Missing expected elements** used to be a substring match against
 *   Profound's raw answer text. Profound has no raw-answer endpoint at all,
 *   so that capability moved to a separate, self-computed feature — see
 *   `src/jobs/handlers/estimate-answer-coverage.ts` — and is not part of this
 *   file anymore.
 * - Sentiment is not merged onto visibility/citations rows: the real
 *   `/v2/reports/sentiment` endpoint has a different request shape (requires
 *   an `asset` param, allows `group_by` dimensions like `tag`/`theme`/`claim`/
 *   `run`/`competitor` that visibility/citations don't have), so it is
 *   surfaced as its own independently-queried bucket set.
 */

import type { ProfoundCitationsRow, ProfoundVisibilityRow } from "@/adapters/profound/types";

export type MergedResultRow = {
  profoundPromptId: string;
  bucketDate: string;
  modelId: string;
  model: string | null;
  topicId: string | null;
  topic: string | null;
  regionId: string | null;
  region: string | null;
  personaId: string | null;
  profoundPersona: string | null;
  asset: string;
  assetOwned: boolean | null;
  rank: number | null;
  visibilityScore: number | null;
  shareOfVoice: number | null;
  averagePosition: number | null;
  citationCount: number;
  citationShare: number | null;
  citationDomains: string[];
  citations: Record<string, unknown>[];
};

/** The real API's natural grouping key — matches `profound_result_buckets`'s unique index (minus tenant/asset). */
function bucketKey(row: {
  profoundPromptId: string | null;
  bucketDate: string;
  modelId: string;
  topicId: string | null;
  regionId: string | null;
  personaId: string | null;
}): string {
  return [
    row.profoundPromptId ?? "",
    row.bucketDate,
    row.modelId,
    row.topicId ?? "",
    row.regionId ?? "",
    row.personaId ?? "",
  ].join("::");
}

/**
 * The real `/v2/reports/citations` endpoint rejects any `group_by` wider than
 * one dimension (or topic+model), optionally plus date — verified live
 * 2026-08-10 (a request grouped by prompt+date+model+topic+region+persona
 * 422s with "Unsupported group_by combination"). So citations can only be
 * requested grouped by `prompt` + `date`, never per-model/topic/region/
 * persona simultaneously. This coarser key is what citations can actually be
 * matched on — not a design choice, a real API constraint.
 */
function promptDateKey(row: { profoundPromptId: string | null; bucketDate: string }): string {
  return `${row.profoundPromptId ?? ""}::${row.bucketDate}`;
}

/**
 * Merges visibility with citations onto the owned asset's bucket row.
 * Citations are matched by (prompt, date) only — see `promptDateKey` — so the
 * same citation set is attached to every model's bucket for that prompt/date;
 * that's what the real API can actually attribute, not a per-model citation
 * count. Citations are also category-scoped, not asset-scoped — a cited
 * domain isn't reported as "citing asset X" — so this attaches the full
 * citation set observed for a bucket to the owned asset's row only.
 * Competitor rows carry no citation data, not because competitors receive
 * none, but because this product only displays citation detail in the
 * context of its own tracked prompts.
 */
export function mergeVisibilityCitations(
  visibility: ProfoundVisibilityRow[],
  citations: ProfoundCitationsRow[],
): MergedResultRow[] {
  const citationsByKey = new Map<string, ProfoundCitationsRow[]>();
  for (const row of citations) {
    if (!row.profoundPromptId) continue;
    const key = promptDateKey(row);
    const list = citationsByKey.get(key) ?? [];
    list.push(row);
    citationsByKey.set(key, list);
  }

  return visibility
    .filter(
      (row): row is ProfoundVisibilityRow & { profoundPromptId: string } =>
        row.profoundPromptId != null,
    )
    .map((row) => {
      const matching = row.assetOwned ? (citationsByKey.get(promptDateKey(row)) ?? []) : [];
      const citationCount = matching.reduce((total, c) => total + c.count, 0);
      const citationShare =
        matching.length > 0
          ? matching.reduce((total, c) => total + (c.citationShare ?? 0), 0) / matching.length
          : null;

      return {
        profoundPromptId: row.profoundPromptId,
        bucketDate: row.bucketDate,
        modelId: row.modelId,
        model: row.model,
        topicId: row.topicId,
        topic: row.topic,
        regionId: row.regionId,
        region: row.region,
        personaId: row.personaId,
        profoundPersona: row.profoundPersona,
        asset: row.asset,
        assetOwned: row.assetOwned,
        rank: row.rank,
        visibilityScore: row.visibilityScore,
        shareOfVoice: row.shareOfVoice,
        averagePosition: row.averagePosition,
        citationCount,
        citationShare,
        citationDomains: matching.map((c) => c.domain),
        citations: matching.map((c) => ({
          domain: c.domain,
          count: c.count,
          citationShare: c.citationShare,
          rank: c.rank,
        })),
      };
    });
}

/**
 * The strongest competitor's share of voice within the same bucket as `row`,
 * or `null` if no competitor rows exist for that bucket — either because
 * competitor asset scope wasn't requested for this query, or because none
 * were returned. Never conflated with "no competitor visibility" (`0`).
 */
export function competitorShareOfVoiceFor(
  row: {
    profoundPromptId: string | null;
    bucketDate: string;
    modelId: string;
    topicId: string | null;
    regionId: string | null;
    personaId: string | null;
  },
  allVisibilityRows: ProfoundVisibilityRow[],
): number | null {
  const key = bucketKey(row);
  const competitorRows = allVisibilityRows.filter(
    (r) => !r.assetOwned && bucketKey(r) === key,
  );
  if (competitorRows.length === 0) return null;
  return competitorRows.reduce((max, r) => Math.max(max, r.shareOfVoice ?? 0), 0);
}

export type ResultClassification = "brand_absent" | "normal";

export type ClassifiedResult = {
  classification: ResultClassification;
  /** Null when competitor asset scope wasn't requested for this bucket — not measured, not "no competitor visible". */
  competitorVisible: boolean | null;
};

export type ClassifiableResult = {
  visibilityScore: number | null;
  shareOfVoice: number | null;
  competitorShareOfVoice: number | null;
};

/** Near-zero, not just exactly zero — the real API can report a tiny nonzero score that still reads as absence. */
const BRAND_ABSENT_VISIBILITY_THRESHOLD = 0.02;

/**
 * Classification is computed by this product from real vendor fields, never
 * taken from a single vendor call — Profound has no "brand_absent" field
 * itself. `competitorVisible` is `null`, not `false`, whenever competitor
 * scope wasn't part of the query that produced `row`.
 */
export function classifyResult(row: ClassifiableResult): ClassifiedResult {
  const classification: ResultClassification =
    row.visibilityScore == null || row.visibilityScore <= BRAND_ABSENT_VISIBILITY_THRESHOLD
      ? "brand_absent"
      : "normal";

  const competitorVisible =
    row.competitorShareOfVoice == null
      ? null
      : (row.shareOfVoice ?? 0) < row.competitorShareOfVoice;

  return { classification, competitorVisible };
}

export type SnapshotMetrics = {
  visibilityScore: number | null;
  shareOfVoice: number | null;
  citationCount: number | null;
  citationShare: number | null;
  averagePosition: number | null;
};

export type AggregatedMetrics = {
  visibilityScore: number | null;
  shareOfVoice: number | null;
  citationCount: number;
  citationShare: number | null;
  averagePosition: number | null;
  bucketCount: number;
};

function mean(values: (number | null | undefined)[]): number | null {
  const present = values.filter((v): v is number => v != null);
  if (present.length === 0) return null;
  return present.reduce((sum, v) => sum + v, 0) / present.length;
}

function sum(values: (number | null | undefined)[]): number {
  return values.reduce((total: number, v) => total + (v ?? 0), 0);
}

export function aggregateMetrics(rows: SnapshotMetrics[]): AggregatedMetrics {
  return {
    visibilityScore: mean(rows.map((r) => r.visibilityScore)),
    shareOfVoice: mean(rows.map((r) => r.shareOfVoice)),
    citationCount: sum(rows.map((r) => r.citationCount)),
    citationShare: mean(rows.map((r) => r.citationShare)),
    averagePosition: mean(rows.map((r) => r.averagePosition)),
    bucketCount: rows.length,
  };
}

export type ControlComparison = {
  persona: AggregatedMetrics;
  control: AggregatedMetrics;
  deltas: {
    visibilityScore: number | null;
    shareOfVoice: number | null;
    citationCount: number;
  };
  /** Compares share of voice; a control with zero presence never "wins". */
  personaOutperforms: boolean;
  /** Percent lift in share of voice over the control, or null if the control had none to lift from. */
  liftPercent: number | null;
};

function numericDelta(a: number | null, b: number | null): number | null {
  return a != null && b != null ? a - b : null;
}

/**
 * The control-comparison maths §25 requires: aggregate each side of a
 * persona/generic-control prompt pair independently over the same window,
 * then diff. Pure — the caller decides which bucket rows fall in range.
 */
export function compareControl(
  personaRows: SnapshotMetrics[],
  controlRows: SnapshotMetrics[],
): ControlComparison {
  const persona = aggregateMetrics(personaRows);
  const control = aggregateMetrics(controlRows);

  const liftPercent =
    control.shareOfVoice != null && control.shareOfVoice > 0 && persona.shareOfVoice != null
      ? ((persona.shareOfVoice - control.shareOfVoice) / control.shareOfVoice) * 100
      : null;

  return {
    persona,
    control,
    deltas: {
      visibilityScore: numericDelta(persona.visibilityScore, control.visibilityScore),
      shareOfVoice: numericDelta(persona.shareOfVoice, control.shareOfVoice),
      citationCount: persona.citationCount - control.citationCount,
    },
    personaOutperforms: (persona.shareOfVoice ?? 0) > (control.shareOfVoice ?? 0),
    liftPercent,
  };
}
