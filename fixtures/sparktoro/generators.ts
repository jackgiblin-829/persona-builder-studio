/**
 * Pure, deterministic generators behind the SparkToro mock.
 *
 * Every function is `(inputs) => output` with no clock and no
 * `Math.random()` — a SHA-256 digest of the audience description (and, for
 * per-row variation, the pool member) stands in for randomness, the same
 * technique `fixtures/dataforseo/generators.ts` uses. The same description
 * always produces the same mock report.
 */

import { createHash } from "node:crypto";
import type {
  SparktoroAffinityRow,
  SparktoroAudienceSize,
  SparktoroSection,
} from "@/adapters/sparktoro/types";
import {
  APP_AND_AI_TOOL_POOL,
  BIO_KEYWORD_POOL,
  DEMOGRAPHIC_LABEL_POOL,
  KEYWORD_POOL,
  NETWORK_POOL,
  PODCAST_POOL,
  PRESS_POOL,
  PROMPT_TOPIC_POOL,
  SOCIAL_ACCOUNT_POOL,
  SUBREDDIT_POOL,
  WEBSITE_POOL,
  YOUTUBE_CHANNEL_POOL,
} from "./pools";

function hashHex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function fraction(hex: string, start: number, len = 8): number {
  return parseInt(hex.slice(start, start + len), 16) / 0xffffffff;
}

/** A stable SparkToro-shaped report id: no dashes, so it reads as a vendor id. */
export function mockReportId(seed: string): string {
  return `sr_${hashHex(`sparktoro:${seed}`).slice(0, 20)}`;
}

const SECTION_POOLS: Partial<Record<SparktoroSection, readonly string[]>> = {
  demographics: DEMOGRAPHIC_LABEL_POOL,
  bio_keywords: BIO_KEYWORD_POOL,
  websites: WEBSITE_POOL,
  social_accounts: SOCIAL_ACCOUNT_POOL,
  networks: NETWORK_POOL,
  youtube: YOUTUBE_CHANNEL_POOL,
  podcasts: PODCAST_POOL,
  reddit: SUBREDDIT_POOL,
  press: PRESS_POOL,
  apps_and_ai_tools: APP_AND_AI_TOOL_POOL,
  keywords: KEYWORD_POOL,
  prompt_topics: PROMPT_TOPIC_POOL,
};

/**
 * Deterministically selects and scores 4-8 rows from a section's pool for a
 * given audience description. `audience_size` has no pool — see
 * `generateAudienceSize` — so it is never passed here.
 */
export function generateAffinityRows(
  description: string,
  section: SparktoroSection,
): SparktoroAffinityRow[] {
  const pool = SECTION_POOLS[section];
  if (!pool) return [];

  const scored = pool.map((label, index) => {
    const hex = hashHex(`${description}:${section}:${label}:${index}`);
    return { label, hex, sortKey: fraction(hex, 0) };
  });
  scored.sort((a, b) => b.sortKey - a.sortKey);

  const count = 4 + Math.floor(fraction(hashHex(`${description}:${section}:count`), 0) * 5); // 4-8
  return scored.slice(0, Math.min(count, scored.length)).map((row, rank) => {
    const affinityScore = round1(1.2 + fraction(row.hex, 8) * 6.8 - rank * 0.15); // ~1.2x-8x
    const percentage = round1(5 + fraction(row.hex, 16) * 45); // 5%-50%
    const isUrlish = section === "websites" || section === "apps_and_ai_tools";
    return {
      label: row.label,
      affinityScore: Math.max(1.0, affinityScore),
      percentage,
      url: isUrlish ? `https://${row.label.replace(/^@/, "").toLowerCase()}` : null,
    };
  });
}

export function generateAudienceSize(description: string): SparktoroAudienceSize {
  const hex = hashHex(`${description}:audience_size`);
  const estimatedSize = 5_000 + Math.floor(fraction(hex, 0) * 495_000); // 5k-500k
  const confidenceRoll = fraction(hex, 8);
  const confidence = confidenceRoll > 0.66 ? "high" : confidenceRoll > 0.33 ? "medium" : "low";
  return { estimatedSize, confidence };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
