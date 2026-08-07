/**
 * Pure, deterministic generators behind the DataForSEO mock.
 *
 * Every function here is `(inputs) => output` with no clock and no
 * `Math.random()` — a SHA-256 digest of the inputs stands in for randomness,
 * the same technique `fixtures/profound/results.ts` uses for its synthetic
 * run history. The same target domain or keyword always produces the same
 * mock metrics, SERP, or reviews, which is what makes the mock adapter's
 * determinism testable rather than merely asserted.
 */

import { createHash } from "node:crypto";
import type {
  DomainCompetitor,
  KeywordIdea,
  KeywordIntentRow,
  KeywordIntentType,
  KeywordMetric,
  MonthlySearch,
  RankedKeyword,
  Review,
  SearchVolumeRow,
  SerpItem,
  SerpItemType,
} from "@/adapters/dataforseo/types";
import {
  COMPETITOR_DOMAIN_POOL,
  MODIFIER_POOL,
  REVIEW_ANCHOR_DATE,
  REVIEW_TEXT_TEMPLATES,
  REVIEWER_NAME_POOL,
  SEED_KEYWORD_POOL,
} from "./pools";

export function hashHex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** A stable float in [0, 1) from a slice of a hex digest. */
export function fraction(hex: string, start: number, len = 8): number {
  return parseInt(hex.slice(start, start + len), 16) / 0xffffffff;
}

/** A stable non-negative integer, `< modulus`, from a slice of a hex digest. */
function pick(hex: string, start: number, modulus: number, len = 8): number {
  return parseInt(hex.slice(start, start + len), 16) % modulus;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/** A DataForSEO-shaped task id: hex groups, no dashes-as-UUID promise. */
export function mockTaskId(seed: string): string {
  const hex = hashHex(`task:${seed}`);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

// ── Keyword metrics ──────────────────────────────────────────────────────────

function keywordIdeaFromHash(keyword: string, hex: string): KeywordIdea {
  // Log-scaled so most keywords land in the hundreds/low-thousands with an
  // occasional head term in the tens of thousands — a shape that looks like
  // real search-volume data rather than a flat random distribution.
  const searchVolume = Math.round(10 * 1200 ** fraction(hex, 0));
  const cpc = round2(0.1 + fraction(hex, 8) * 24.9);
  const competition = round2(fraction(hex, 16));
  const difficulty = Math.round(fraction(hex, 24) * 100);
  return { keyword, searchVolume, cpc, competition, difficulty };
}

export function generateKeywordsForSite(target: string, limit = 50): KeywordIdea[] {
  return SEED_KEYWORD_POOL.map((keyword) => ({
    keyword,
    hex: hashHex(`kfs:${target}:${keyword}`),
  }))
    .filter(({ hex }) => fraction(hex, 32) < 0.7) // ~70% of the vocabulary is "relevant"
    .map(({ keyword, hex }) => keywordIdeaFromHash(keyword, hex))
    .slice(0, limit);
}

/** CTR curve for organic position, used to derive an estimated-traffic figure. */
function ctrForPosition(position: number): number {
  if (position <= 1) return 0.28;
  if (position <= 3) return 0.12;
  if (position <= 5) return 0.06;
  if (position <= 10) return 0.02;
  return 0.005;
}

function slugForKeyword(keyword: string): string {
  return keyword
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function generateRankedKeywords(target: string, limit = 50): RankedKeyword[] {
  const rows = SEED_KEYWORD_POOL.map((keyword) => ({
    keyword,
    hex: hashHex(`ranked:${target}:${keyword}`),
  }))
    .filter(({ hex }) => fraction(hex, 32) < 0.4) // narrower: only ~40% actually rank
    .map(({ keyword, hex }) => {
      const idea = keywordIdeaFromHash(keyword, hex);
      const position = 1 + pick(hex, 40, 100);
      const url = `https://${target}/${slugForKeyword(keyword)}`;
      const estimatedTraffic = idea.searchVolume
        ? Math.round(idea.searchVolume * ctrForPosition(position))
        : null;
      return { ...idea, position, url, estimatedTraffic };
    });
  return rows.sort((a, b) => a.position - b.position).slice(0, limit);
}

export function generateRelatedKeywords(seedKeyword: string, limit = 20): KeywordIdea[] {
  return MODIFIER_POOL.map((modifier) => {
    const phrase = `${modifier} ${seedKeyword}`;
    return keywordIdeaFromHash(phrase, hashHex(`related:${seedKeyword}:${modifier}`));
  }).slice(0, limit);
}

export function generateKeywordSuggestions(seedKeyword: string, limit = 20): KeywordIdea[] {
  return SEED_KEYWORD_POOL.filter((term) => term !== seedKeyword)
    .map((term) => {
      const phrase = `${seedKeyword} ${term}`;
      return keywordIdeaFromHash(phrase, hashHex(`suggestion:${seedKeyword}:${term}`));
    })
    .filter((idea) => fraction(hashHex(`suggestion-keep:${idea.keyword}`), 0) < 0.5)
    .slice(0, limit);
}

export function generateKeywordMetric(keyword: string): KeywordMetric {
  const hex = hashHex(`metric:${keyword}`);
  const idea = keywordIdeaFromHash(keyword, hex);
  const competitionLevel: KeywordMetric["competitionLevel"] =
    idea.competition === null
      ? null
      : idea.competition < 0.34
        ? "low"
        : idea.competition < 0.67
          ? "medium"
          : "high";
  return {
    keyword,
    searchVolume: idea.searchVolume,
    cpc: idea.cpc,
    competition: idea.competition,
    competitionLevel,
    difficulty: idea.difficulty,
  };
}

export function generateSearchVolumeRow(keyword: string): SearchVolumeRow {
  const hex = hashHex(`volume:${keyword}`);
  const idea = keywordIdeaFromHash(keyword, hex);
  const monthlySearches: MonthlySearch[] = [];
  const anchor = new Date(REVIEW_ANCHOR_DATE);
  for (let i = 11; i >= 0; i--) {
    const monthDate = new Date(anchor);
    monthDate.setUTCMonth(monthDate.getUTCMonth() - i);
    const seasonality = 0.7 + fraction(hex, (i % 6) * 4, 4) * 0.6;
    monthlySearches.push({
      year: monthDate.getUTCFullYear(),
      month: monthDate.getUTCMonth() + 1,
      searchVolume: idea.searchVolume === null ? null : Math.round(idea.searchVolume * seasonality),
    });
  }
  return {
    keyword,
    searchVolume: idea.searchVolume,
    cpc: idea.cpc,
    competition: idea.competition,
    monthlySearches,
  };
}

const INTENT_TYPES: readonly KeywordIntentType[] = [
  "informational",
  "navigational",
  "commercial",
  "transactional",
];

export function generateKeywordIntent(keyword: string): KeywordIntentRow {
  const hex = hashHex(`intent:${keyword}`);
  // Commercial modifiers push a keyword toward commercial/transactional intent,
  // which is what a real classifier would do too.
  const commercialSignal = /\b(pricing|vs|alternative|best|top|buy|review)\b/i.test(keyword);
  const bucket = commercialSignal ? 2 + pick(hex, 0, 2, 4) : pick(hex, 0, 4, 4);
  const intent = INTENT_TYPES[bucket] ?? "informational";
  const probability = round2(0.55 + fraction(hex, 8) * 0.4);
  return { keyword, intent, probability };
}

// ── Organic SERP ─────────────────────────────────────────────────────────────

const SERP_TITLE_TEMPLATES: readonly ((domain: string, keyword: string) => string)[] = [
  (domain, keyword) => `${titleCase(keyword)} — ${domain}`,
  (domain, keyword) => `The Complete Guide to ${titleCase(keyword)} | ${domain}`,
  (domain, keyword) => `${titleCase(keyword)}: What to Know in 2026`,
  (domain, keyword) => `${domain} | ${titleCase(keyword)}`,
];

function titleCase(text: string): string {
  return text.replace(/\b\w/g, (c) => c.toUpperCase());
}

export function generateOrganicSerp(
  keyword: string,
  depth = 10,
): { items: SerpItem[]; totalResultsCount: number } {
  const items: SerpItem[] = [];
  for (let rank = 1; rank <= depth; rank++) {
    const hex = hashHex(`serp:${keyword}:${rank}`);
    const domain = COMPETITOR_DOMAIN_POOL[pick(hex, 0, COMPETITOR_DOMAIN_POOL.length)]!;
    const titleFn = SERP_TITLE_TEMPLATES[pick(hex, 8, SERP_TITLE_TEMPLATES.length)]!;
    const path = slugForKeyword(keyword);

    let type: SerpItemType = "organic";
    if (rank === 1 && fraction(hex, 16) < 0.25) type = "featured_snippet";
    else if (rank === 4 && fraction(hex, 16) < 0.15) type = "people_also_ask";

    items.push({
      rank,
      type,
      url: `https://${domain}/resources/${path}`,
      domain,
      title: titleFn(domain, keyword),
      description: `Learn about ${keyword} and how ${domain} approaches it, including pricing, setup and comparisons.`,
    });
  }
  const totalResultsCount = 8_000 + pick(hashHex(`serp-total:${keyword}`), 0, 400_000);
  return { items, totalResultsCount };
}

// ── Domain competitors ───────────────────────────────────────────────────────

export function generateDomainCompetitors(target: string, limit = 8): DomainCompetitor[] {
  const rows = COMPETITOR_DOMAIN_POOL.filter((domain) => domain !== target)
    .map((domain) => {
      const hex = hashHex(`competitor:${target}:${domain}`);
      const commonKeywords = 5 + pick(hex, 0, 300);
      const competitorRelevance = round2(fraction(hex, 8));
      const avgPosition = round2(3 + fraction(hex, 16) * 40);
      const estimatedTraffic = 100 + pick(hex, 24, 50_000);
      return { domain, commonKeywords, competitorRelevance, avgPosition, estimatedTraffic };
    })
    .sort((a, b) => b.commonKeywords - a.commonKeywords);
  return rows.slice(0, limit);
}

// ── Reviews ──────────────────────────────────────────────────────────────────

export function generateReviews(query: string, depth = 10): Review[] {
  const reviews: Review[] = [];
  const anchor = new Date(REVIEW_ANCHOR_DATE).getTime();
  for (let i = 0; i < depth; i++) {
    const hex = hashHex(`review:${query}:${i}`);
    const rating = 1 + pick(hex, 0, 5);
    const authorName = REVIEWER_NAME_POOL[pick(hex, 8, REVIEWER_NAME_POOL.length)]!;
    const templateFn = REVIEW_TEXT_TEMPLATES[pick(hex, 16, REVIEW_TEXT_TEMPLATES.length)]!;
    const daysAgo = pick(hex, 24, 720);
    const publishedAt = new Date(anchor - daysAgo * 24 * 60 * 60 * 1000).toISOString();
    const hasOwnerResponse = fraction(hex, 32) < 0.3;

    reviews.push({
      reviewId: `dfr_${hex.slice(0, 16)}`,
      authorName,
      rating,
      text: templateFn(query),
      publishedAt,
      ownerResponseText: hasOwnerResponse ? `Thanks for the feedback, ${authorName}!` : null,
    });
  }
  return reviews;
}
