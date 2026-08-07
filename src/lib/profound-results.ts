/**
 * Result normalization and analysis (§25), pure and clock-free like
 * `src/lib/confidence.ts` and `src/lib/profound-payload.ts` — every function
 * here takes the data it needs as arguments and is unit-testable without a
 * database or a vendor call.
 *
 * Two things are deliberately computed here rather than trusted from Profound:
 *
 * - **Classification** (`classifyResult`) reads the merged snapshot, not a
 *   single vendor call. "Brand-absent" and "competitor-dominated" are the
 *   application's judgment about what a run means, built from the columns the
 *   vendor returned — Profound has no such field itself.
 * - **Missing expected elements** (`detectMissingElements`) is a naive
 *   normalized substring match against the raw answer. It will under-count on
 *   paraphrase and over-count on formatting — that is an accepted limitation
 *   of not running a second model call just to grade the first one's answer.
 */

import type {
  ProfoundAnswerRow,
  ProfoundCitationsRow,
  ProfoundSentimentRow,
  ProfoundVisibilityRow,
} from "@/adapters/profound/types";

export type MergedResultRow = {
  profoundPromptId: string;
  runId: string;
  runDate: string;
  modelId: string;
  model: string | null;
  region: string | null;
  asset: string | null;
  topic: string | null;
  profoundPersona: string | null;
  tags: string[];
  visibilityScore: number | null;
  shareOfVoice: number | null;
  mentionCount: number;
  executions: number;
  averagePosition: number | null;
  brandMentioned: boolean;
  mentions: { entity: string; mentionCount: number; share: number }[];
  citationCount: number;
  citationShare: number | null;
  citations: Record<string, unknown>[];
  searchQueries: string[];
  sentimentThemes: Record<string, unknown>[];
  rawAnswer: string | null;
};

/**
 * Merges the four independent reporting calls into one row per
 * `(profoundPromptId, runId, modelId)` — the exact grain of the
 * `profound_result_snapshots` unique index. A visibility row is the anchor:
 * without one, there is no run to attach citations, sentiment or an answer to,
 * so keys that only appear in those three are dropped rather than guessed at.
 */
export function mergeResultRows(
  visibility: ProfoundVisibilityRow[],
  citations: ProfoundCitationsRow[],
  sentiment: ProfoundSentimentRow[],
  answers: ProfoundAnswerRow[],
): MergedResultRow[] {
  const citationsByKey = new Map(citations.map((row) => [rowKey(row), row]));
  const sentimentByKey = new Map(sentiment.map((row) => [rowKey(row), row]));
  const answersByKey = new Map(answers.map((row) => [rowKey(row), row]));

  return visibility.map((row) => {
    const key = rowKey(row);
    const citation = citationsByKey.get(key);
    const sentimentRow = sentimentByKey.get(key);
    const answer = answersByKey.get(key);

    return {
      profoundPromptId: row.profoundPromptId,
      runId: row.runId,
      runDate: row.runDate,
      modelId: row.modelId,
      model: row.model,
      region: row.region,
      asset: row.asset,
      topic: row.topic,
      profoundPersona: row.profoundPersona,
      tags: row.tags,
      visibilityScore: row.visibilityScore,
      shareOfVoice: row.shareOfVoice,
      mentionCount: row.mentionCount,
      executions: row.executions,
      averagePosition: row.averagePosition,
      brandMentioned: row.brandMentioned,
      mentions: row.mentions,
      citationCount: citation?.citationCount ?? 0,
      citationShare: citation?.citationShare ?? null,
      citations: citation?.citations ?? [],
      searchQueries: citation?.searchQueries ?? [],
      sentimentThemes: sentimentRow?.sentimentThemes ?? [],
      rawAnswer: answer?.rawAnswer ?? null,
    };
  });
}

function rowKey(row: { profoundPromptId: string; runId: string; modelId: string }): string {
  return `${row.profoundPromptId}::${row.runId}::${row.modelId}`;
}

export type ResultClassification = "brand_absent" | "competitor_dominated" | "normal";

export type ClassifiableResult = {
  brandMentioned: boolean;
  mentionCount: number;
  shareOfVoice: number | null;
  mentions: { entity: string; share: number }[];
};

/**
 * `brand_absent` wins over `competitor_dominated` — a brand that never showed
 * up did not lose a competition, it was never in one.
 */
export function classifyResult(row: ClassifiableResult): ResultClassification {
  if (!row.brandMentioned || row.mentionCount === 0) return "brand_absent";
  const maxCompetitorShare = row.mentions.reduce((max, m) => Math.max(max, m.share), 0);
  if (row.shareOfVoice != null && maxCompetitorShare > row.shareOfVoice)
    return "competitor_dominated";
  return "normal";
}

function normalizeText(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/** Which of a prompt's expected answer elements are absent from the raw answer text. */
export function detectMissingElements(
  expectedAnswerElements: string[],
  row: { rawAnswer: string | null },
): string[] {
  const haystack = normalizeText(row.rawAnswer ?? "");
  return expectedAnswerElements.filter((element) => !haystack.includes(normalizeText(element)));
}

export type SnapshotMetrics = {
  visibilityScore: number | null;
  shareOfVoice: number | null;
  mentionCount: number | null;
  executions: number | null;
  citationCount: number | null;
  citationShare: number | null;
  averagePosition: number | null;
};

export type AggregatedMetrics = {
  visibilityScore: number | null;
  shareOfVoice: number | null;
  mentionCount: number;
  executions: number;
  citationCount: number;
  citationShare: number | null;
  averagePosition: number | null;
  runCount: number;
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
    mentionCount: sum(rows.map((r) => r.mentionCount)),
    executions: sum(rows.map((r) => r.executions)),
    citationCount: sum(rows.map((r) => r.citationCount)),
    citationShare: mean(rows.map((r) => r.citationShare)),
    averagePosition: mean(rows.map((r) => r.averagePosition)),
    runCount: rows.length,
  };
}

export type ControlComparison = {
  persona: AggregatedMetrics;
  control: AggregatedMetrics;
  deltas: {
    visibilityScore: number | null;
    shareOfVoice: number | null;
    mentionCount: number;
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
 * then diff. Pure — the caller decides which snapshot rows fall in range.
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
      mentionCount: persona.mentionCount - control.mentionCount,
      citationCount: persona.citationCount - control.citationCount,
    },
    personaOutperforms: (persona.shareOfVoice ?? 0) > (control.shareOfVoice ?? 0),
    liftPercent,
  };
}
