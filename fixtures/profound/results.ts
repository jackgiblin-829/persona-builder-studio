/**
 * Synthetic Profound result history (§25).
 *
 * Redesigned 2026-08-10 to match the real bucket-shaped v2 reporting API
 * (see `src/adapters/profound/live.ts`) instead of the invented per-execution
 * "run" model this file used to generate. One bucket per UTC calendar day,
 * per prompt, per model, per asset, generated deterministically from
 * `(profoundPromptId, modelId, date, asset)` so retrieving the same window
 * twice produces byte-identical rows — that determinism is what makes bucket
 * idempotency testable rather than merely asserted. Every field here has a
 * direct analog in the real API; there is no mention count, brand-mentioned
 * flag, or raw answer text (see `estimate-answer-coverage.ts` for that
 * capability's honest, self-computed replacement).
 *
 * One outcome is still manufactured on purpose, keyed off the prompt id alone
 * so it is stable across every date and model for that prompt: roughly one
 * prompt in seven is **chronically brand-absent** (visibility near zero,
 * competitors visible instead); the rest are unremarkable, with the owned
 * asset leading.
 */

import { createHash } from "node:crypto";

export type SyntheticVisibilityBucket = {
  profoundPromptId: string;
  modelId: string;
  date: string;
  asset: string;
  assetOwned: boolean;
  visibilityScore: number;
  shareOfVoice: number;
  averagePosition: number | null;
  rank: number | null;
};

export type SyntheticCitationBucket = {
  profoundPromptId: string;
  date: string;
  domain: string;
  count: number;
  citationShare: number | null;
  rank: number;
};

export type SyntheticSentimentBucket = {
  profoundPromptId: string;
  date: string;
  positiveSentiment: number | null;
  negativeSentiment: number | null;
  occurrence: number | null;
};

const OWNED_DOMAIN = "northwind-analytics.example";
const COMPETITOR_DOMAINS = ["rivergate-metrics.example", "beacon-insights.example"];

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

/** Stable per-prompt, independent of date and model. */
function isBrandAbsent(profoundPromptId: string): boolean {
  return parseInt(hashHex(profoundPromptId).slice(0, 2), 16) % 7 === 0;
}

/**
 * The owned asset's visibility bucket for one (prompt, model, date). When
 * `competitorAssets` is non-empty, one complementary bucket per competitor is
 * also returned — a real competitor-visibility signal for `classifyResult`'s
 * `competitor_visible` classification (see `src/lib/profound-results.ts`).
 */
export function generateVisibilityBuckets(
  profoundPromptId: string,
  modelId: string,
  date: string,
  ownedAsset: string,
  competitorAssets: string[] = [],
): SyntheticVisibilityBucket[] {
  const brandAbsent = isBrandAbsent(profoundPromptId);
  const hex = hashHex(`${profoundPromptId}:${modelId}:${date}`);

  const ownShareOfVoice = brandAbsent ? 0 : 0.35 + fraction(hex, 12) * 0.5;
  const ownVisibility = brandAbsent ? 0 : Math.min(1, ownShareOfVoice + fraction(hex, 4) * 0.15);
  const ownRank = brandAbsent ? null : 1 + Math.floor(fraction(hex, 20) * 3);
  const ownAveragePosition = brandAbsent ? null : 1 + fraction(hex, 20) * 2.5;

  const buckets: SyntheticVisibilityBucket[] = [
    {
      profoundPromptId,
      modelId,
      date,
      asset: ownedAsset,
      assetOwned: true,
      visibilityScore: ownVisibility,
      shareOfVoice: ownShareOfVoice,
      averagePosition: ownAveragePosition,
      rank: ownRank,
    },
  ];

  for (const [index, competitor] of competitorAssets.entries()) {
    const competitorHex = hashHex(`${profoundPromptId}:${modelId}:${date}:${competitor}`);
    // Competitors collectively fill whatever share the owned asset doesn't
    // hold; a brand-absent prompt leaves the most room for them.
    const remaining = 1 - ownShareOfVoice;
    const share = Math.max(0, (remaining / (competitorAssets.length + 1)) * (1 + fraction(competitorHex, 8) * 0.6));
    buckets.push({
      profoundPromptId,
      modelId,
      date,
      asset: competitor,
      assetOwned: false,
      visibilityScore: Math.min(1, share + fraction(competitorHex, 16) * 0.1),
      shareOfVoice: share,
      averagePosition: 1 + fraction(competitorHex, 20) * 3,
      rank: brandAbsent ? 1 + index : 2 + index,
    });
  }

  return buckets;
}

/**
 * The real `/v2/reports/citations` endpoint cannot be grouped by model
 * alongside prompt+date (verified live 2026-08-10 — see
 * `src/lib/profound-results.ts`'s `promptDateKey` comment), so citations are
 * a (prompt, date) concept, never (prompt, model, date). This generator
 * matches that real constraint rather than inventing per-model detail.
 */
export function generateCitationBuckets(
  profoundPromptId: string,
  date: string,
): SyntheticCitationBucket[] {
  const brandAbsent = isBrandAbsent(profoundPromptId);
  const hex = hashHex(`${profoundPromptId}:${date}:citations`);
  if (brandAbsent) return [];

  const count = Math.round(fraction(hex, 32) * 4);
  if (count === 0) return [];

  const citationShare = Math.min(1, 0.3 + fraction(hex, 36) * 0.5);
  return [
    {
      profoundPromptId,
      date,
      domain: OWNED_DOMAIN,
      count,
      citationShare,
      rank: 1,
    },
  ];
}

export function generateSentimentBucket(
  profoundPromptId: string,
  date: string,
): SyntheticSentimentBucket {
  const brandAbsent = isBrandAbsent(profoundPromptId);
  const hex = hashHex(`${profoundPromptId}:${date}:sentiment`);

  if (brandAbsent) {
    return { profoundPromptId, date, positiveSentiment: null, negativeSentiment: null, occurrence: 0 };
  }

  const positiveSentiment = Math.round(fraction(hex, 0) * 60 + 20);
  const negativeSentiment = Math.round(fraction(hex, 8) * (100 - positiveSentiment));
  const occurrence = 1 + Math.round(fraction(hex, 16) * 5);
  return { profoundPromptId, date, positiveSentiment, negativeSentiment, occurrence };
}

export { OWNED_DOMAIN, COMPETITOR_DOMAINS };
