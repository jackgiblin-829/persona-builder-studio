/**
 * Synthetic Profound result history (§25).
 *
 * Like `fixtures/profound/account.ts`, this models a vendor's history rather
 * than returning a canned answer: one run per UTC calendar day, per prompt,
 * per model, generated deterministically from `(profoundPromptId, modelId,
 * date)` so retrieving the same window twice produces byte-identical rows —
 * that determinism is what makes snapshot idempotency testable rather than
 * merely asserted.
 *
 * Three outcomes are manufactured on purpose, keyed off the prompt id alone so
 * they are stable across every date and model for that prompt:
 *
 * - Roughly one prompt in seven is **chronically brand-absent** — the brand
 *   never appears, though competitors do. A real "nobody mentions us for this
 *   question" prompt looks exactly like this over any date range.
 * - Roughly one prompt in five (of the rest) is **competitor-dominated** — the
 *   brand is mentioned, but a named competitor holds a larger share of voice.
 * - Every other prompt is unremarkable: the brand is mentioned and leads.
 *
 * The raw answer text is generic synthetic prose, not text engineered to
 * satisfy any particular prompt's `expected_answer_elements`. That is
 * deliberate: a mock vendor has no way to know what a real model would say, so
 * pretending its answers cover a persona's expected elements would be more
 * misleading than an honest "most elements are reported missing against mock
 * data" (see docs/progress.md, Milestone 6, Known limitations).
 */

import { createHash } from "node:crypto";

export type SyntheticMention = {
  entity: string;
  mentionCount: number;
  share: number;
};

export type SyntheticRun = {
  profoundPromptId: string;
  modelId: string;
  date: string;
  runId: string;
  visibilityScore: number;
  shareOfVoice: number;
  mentionCount: number;
  executions: number;
  averagePosition: number | null;
  brandMentioned: boolean;
  mentions: SyntheticMention[];
  citationCount: number;
  citationShare: number | null;
  citations: { url: string; title: string; domain: string }[];
  searchQueries: string[];
  sentimentThemes: {
    theme: string;
    sentiment: "positive" | "neutral" | "negative";
    quote: string;
  }[];
  rawAnswer: string;
};

const COMPETITORS = ["Rivergate Metrics", "Beacon Insights", "Ledgerline Analytics"];
const SENTIMENT_THEMES: { theme: string; sentiment: "positive" | "neutral" | "negative" }[] = [
  { theme: "ease of deployment", sentiment: "positive" },
  { theme: "pricing transparency", sentiment: "neutral" },
  { theme: "onboarding complexity", sentiment: "negative" },
  { theme: "data residency", sentiment: "positive" },
];
const SEARCH_QUERY_POOL = [
  "best product analytics platform",
  "product analytics pricing comparison",
  "self-hosted analytics vendor",
  "data governance tooling for analytics",
];

function hashHex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** A stable float in [0, 1) from a slice of a hex digest. */
function fraction(hex: string, start: number, len = 8): number {
  return parseInt(hex.slice(start, start + len), 16) / 0xffffffff;
}

/** Every UTC calendar day from `startDate` to `endDate`, inclusive, capped defensively. */
export function eachDateInRange(startDate: string, endDate: string, maxDays = 366): string[] {
  const start = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T00:00:00Z`);
  const dates: string[] = [];
  for (
    let cursor = start;
    cursor.getTime() <= end.getTime() && dates.length < maxDays;
    cursor = new Date(cursor.getTime() + 24 * 60 * 60 * 1000)
  ) {
    dates.push(cursor.toISOString().slice(0, 10));
  }
  return dates;
}

type PromptProfile = {
  brandAbsent: boolean;
  competitorDominated: boolean;
};

/** Stable per-prompt, independent of date and model. */
function profileFor(profoundPromptId: string): PromptProfile {
  const hex = hashHex(profoundPromptId);
  const brandAbsent = parseInt(hex.slice(0, 2), 16) % 7 === 0;
  const competitorDominated = !brandAbsent && parseInt(hex.slice(2, 4), 16) % 5 === 0;
  return { brandAbsent, competitorDominated };
}

export function generateRun(profoundPromptId: string, modelId: string, date: string): SyntheticRun {
  const profile = profileFor(profoundPromptId);
  const hex = hashHex(`${profoundPromptId}:${modelId}:${date}`);
  const runId = `run_${date.replace(/-/g, "")}_${modelId}`;

  const executions = 20 + Math.round(fraction(hex, 0) * 180);
  const competitorIndex = parseInt(hex.slice(8, 10), 16) % COMPETITORS.length;
  // Always in bounds: competitorIndex is a modulo of the array's own length.
  const competitorEntity = COMPETITORS[competitorIndex]!;

  let shareOfVoice: number;
  let brandMentioned: boolean;
  let mentionCount: number;
  let averagePosition: number | null;
  let mentions: SyntheticMention[];

  if (profile.brandAbsent) {
    shareOfVoice = 0;
    brandMentioned = false;
    mentionCount = 0;
    averagePosition = null;
    mentions = [
      {
        entity: competitorEntity,
        mentionCount: 3 + Math.round(fraction(hex, 16) * 5),
        share: 0.6 + fraction(hex, 24) * 0.3,
      },
    ];
  } else if (profile.competitorDominated) {
    shareOfVoice = 0.05 + fraction(hex, 12) * 0.1;
    brandMentioned = true;
    mentionCount = 1 + Math.round(fraction(hex, 16) * 2);
    averagePosition = 3 + fraction(hex, 20) * 3;
    mentions = [
      {
        entity: competitorEntity,
        mentionCount: 4 + Math.round(fraction(hex, 24) * 4),
        share: 0.4 + fraction(hex, 28) * 0.3,
      },
    ];
  } else {
    shareOfVoice = 0.35 + fraction(hex, 12) * 0.5;
    brandMentioned = true;
    mentionCount = 2 + Math.round(fraction(hex, 16) * 6);
    averagePosition = 1 + fraction(hex, 20) * 2.5;
    mentions = [
      {
        entity: competitorEntity,
        mentionCount: 1 + Math.round(fraction(hex, 24) * 3),
        share: fraction(hex, 28) * (shareOfVoice * 0.7),
      },
    ];
  }

  const visibilityScore = brandMentioned ? Math.min(1, shareOfVoice + fraction(hex, 4) * 0.15) : 0;

  const citationCount = brandMentioned ? Math.round(fraction(hex, 32) * 4) : 0;
  const citationShare = brandMentioned ? Math.min(1, shareOfVoice + fraction(hex, 36) * 0.1) : 0;
  const citations = Array.from({ length: citationCount }, (_, index) => ({
    url: `https://northwind-analytics.example/resources/${date}-${index}`,
    title: `Northwind Analytics — resource ${index + 1}`,
    domain: "northwind-analytics.example",
  }));

  const searchQueryIndex = parseInt(hex.slice(40, 42), 16) % SEARCH_QUERY_POOL.length;
  const searchQueries = [SEARCH_QUERY_POOL[searchQueryIndex]!];

  const themeIndex = parseInt(hex.slice(42, 44), 16) % SENTIMENT_THEMES.length;
  const theme = SENTIMENT_THEMES[themeIndex]!;
  const sentimentThemes = [
    {
      ...theme,
      quote: brandMentioned
        ? `Northwind came up in the context of ${theme.theme}.`
        : `No mention of Northwind surfaced in this answer.`,
    },
  ];

  const rawAnswer = brandMentioned
    ? `Several vendors are commonly recommended for this question, including Northwind Analytics and ${competitorEntity}. Northwind Analytics is frequently noted for ${theme.theme}.`
    : `Several vendors are commonly recommended for this question, most often ${competitorEntity} and other established analytics platforms.`;

  return {
    profoundPromptId,
    modelId,
    date,
    runId,
    visibilityScore,
    shareOfVoice,
    mentionCount,
    executions,
    averagePosition,
    brandMentioned,
    mentions,
    citationCount,
    citationShare,
    citations,
    searchQueries,
    sentimentThemes,
    rawAnswer,
  };
}
