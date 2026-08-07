/**
 * Synthetic account-level AI-visibility reporting, distinct from the
 * per-prompt result history in `fixtures/profound/results.ts`.
 *
 * This models what Profound's own reporting endpoints return when scoped to
 * a whole category rather than a specific list of prompts this product
 * deployed — "how is this brand doing on this topic across the account,"
 * independent of whether this product ever generated a prompt for it. One
 * row per topic per UTC day, aggregated across models, generated
 * deterministically from `(topic, date)` so the same window always produces
 * the same digest.
 */

import { createHash } from "node:crypto";

function hashHex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function fraction(hex: string, start: number, len = 8): number {
  return parseInt(hex.slice(start, start + len), 16) / 0xffffffff;
}

export type AccountVisibilityRow = {
  topic: string;
  date: string;
  visibilityScore: number;
  shareOfVoice: number;
  mentionCount: number;
};

export type AccountCitationsRow = {
  topic: string;
  date: string;
  citationCount: number;
  citationShare: number | null;
  topDomains: string[];
};

export type AccountSentimentRow = {
  topic: string;
  date: string;
  sentimentThemes: { theme: string; sentiment: "positive" | "neutral" | "negative" }[];
};

const SENTIMENT_THEME_POOL: readonly string[] = [
  "deployment flexibility",
  "pricing transparency",
  "ease of onboarding",
  "data governance",
  "customer support responsiveness",
  "integration breadth",
];

const CITATION_DOMAIN_POOL: readonly string[] = [
  "g2.com",
  "capterra.com",
  "reddit.com",
  "techcrunch.com",
  "producthunt.com",
];

export function generateAccountVisibility(topic: string, date: string): AccountVisibilityRow {
  const hex = hashHex(`account_visibility:${topic}:${date}`);
  return {
    topic,
    date,
    visibilityScore: round3(0.1 + fraction(hex, 0) * 0.7),
    shareOfVoice: round3(0.05 + fraction(hex, 8) * 0.5),
    mentionCount: 5 + Math.round(fraction(hex, 16) * 45),
  };
}

export function generateAccountCitations(topic: string, date: string): AccountCitationsRow {
  const hex = hashHex(`account_citations:${topic}:${date}`);
  const citationCount = Math.round(fraction(hex, 0) * 20);
  const domainCount = 1 + Math.floor(fraction(hex, 8) * 3);
  const topDomains = Array.from({ length: domainCount }, (_, i) => {
    const index = parseInt(hex.slice(16 + i * 2, 18 + i * 2), 16) % CITATION_DOMAIN_POOL.length;
    return CITATION_DOMAIN_POOL[index]!;
  });
  return {
    topic,
    date,
    citationCount,
    citationShare: citationCount > 0 ? round3(fraction(hex, 24) * 0.6) : null,
    topDomains: [...new Set(topDomains)],
  };
}

export function generateAccountSentiment(topic: string, date: string): AccountSentimentRow {
  const hex = hashHex(`account_sentiment:${topic}:${date}`);
  const themeCount = 1 + Math.floor(fraction(hex, 0) * 3);
  const sentiments: AccountSentimentRow["sentimentThemes"][number]["sentiment"][] = [
    "positive",
    "neutral",
    "negative",
  ];
  const sentimentThemes = Array.from({ length: themeCount }, (_, i) => {
    const themeIndex = parseInt(hex.slice(8 + i * 2, 10 + i * 2), 16) % SENTIMENT_THEME_POOL.length;
    const sentimentIndex = parseInt(hex.slice(20 + i * 2, 22 + i * 2), 16) % sentiments.length;
    return { theme: SENTIMENT_THEME_POOL[themeIndex]!, sentiment: sentiments[sentimentIndex]! };
  });
  return { topic, date, sentimentThemes };
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}
