import { z } from "zod";

/**
 * The DataForSEO boundary (ADR-010, ADR-011).
 *
 * Traditional search intelligence only — search demand, SERP composition and
 * keyword intent. DataForSEO also sells LLM Responses / LLM Mentions / LLM
 * Scraper products; those are deliberately not implemented here (ADR-010).
 * Profound is this product's only AI-search execution and visibility layer.
 *
 * Every operation returns a `DataForSeoResult<T>`, where `data` is exactly
 * the shape persisted to `search_datasets.normalized` — there is no second
 * mapping step between what the adapter returns and what gets stored. The
 * caller (a job handler, per the pattern in `src/jobs/handlers/*`) is
 * responsible for writing the `search_datasets` row and for calling
 * `recordVendorUsage` with `itemCount` / `costCents` from the result, exactly
 * as `extract-evidence.ts` does with `StructuredResult.costCents` — the
 * adapter itself has no organization/brand/job context to record against.
 */

// ── Shared request/result shapes ────────────────────────────────────────────

/** DataForSEO numeric location code, e.g. 2840 for the United States. */
export const DEFAULT_LOCATION_CODE = 2840;
export const DEFAULT_LANGUAGE_CODE = "en";

export type DataForSeoLocale = {
  locationCode?: number;
  languageCode?: string;
};

/**
 * Every operation's envelope. `vendorTaskId` is non-null only for operations
 * that go through the task-post/task-get pattern (`getOrganicSerp`,
 * `getReviews`); the immediate "live" endpoints never queue a task. `raw` is
 * the vendor payload retained verbatim (secrets never appear in it) so a
 * normalization bug stays debuggable after the fact.
 */
export type DataForSeoResult<T> = {
  data: T;
  dataOrigin: "mock" | "live";
  itemCount: number;
  costCents: number;
  vendorTaskId: string | null;
  raw: Record<string, unknown>;
};

/** Internal lifecycle of a task-post/task-get operation. */
export type DataForSeoTaskStatus = "queued" | "processing" | "ready" | "error";

// ── Keyword ideas (getKeywordsForSite, getRelatedKeywords, getKeywordSuggestions) ──

export const keywordIdeaSchema = z.object({
  keyword: z.string(),
  searchVolume: z.number().int().nullable(),
  cpc: z.number().nullable(),
  /** 0..1, DataForSEO's normalized paid-competition score. */
  competition: z.number().min(0).max(1).nullable(),
  /** 0..100, an organic-difficulty estimate. */
  difficulty: z.number().min(0).max(100).nullable(),
});
export type KeywordIdea = z.infer<typeof keywordIdeaSchema>;

export type KeywordsForSiteRequest = DataForSeoLocale & {
  /** A domain or root URL, e.g. "northwind-analytics.example". */
  target: string;
  limit?: number;
};
export const keywordsForSiteResultSchema = z.object({
  target: z.string(),
  keywords: z.array(keywordIdeaSchema),
});
export type KeywordsForSiteResult = z.infer<typeof keywordsForSiteResultSchema>;

export type RelatedKeywordsRequest = DataForSeoLocale & {
  keyword: string;
  /** SERP-graph traversal depth DataForSEO exposes, 0..4. */
  depth?: number;
  limit?: number;
};
export const relatedKeywordsResultSchema = z.object({
  seedKeyword: z.string(),
  keywords: z.array(keywordIdeaSchema),
});
export type RelatedKeywordsResult = z.infer<typeof relatedKeywordsResultSchema>;

export type KeywordSuggestionsRequest = DataForSeoLocale & {
  keyword: string;
  limit?: number;
};
export const keywordSuggestionsResultSchema = z.object({
  seedKeyword: z.string(),
  keywords: z.array(keywordIdeaSchema),
});
export type KeywordSuggestionsResult = z.infer<typeof keywordSuggestionsResultSchema>;

// ── Ranked keywords (getRankedKeywords) ─────────────────────────────────────

export const rankedKeywordSchema = keywordIdeaSchema.extend({
  /** Current organic SERP position, 1-based. */
  position: z.number().int().min(1),
  url: z.string().nullable(),
  estimatedTraffic: z.number().int().nullable(),
});
export type RankedKeyword = z.infer<typeof rankedKeywordSchema>;

export type RankedKeywordsRequest = DataForSeoLocale & {
  target: string;
  limit?: number;
};
export const rankedKeywordsResultSchema = z.object({
  target: z.string(),
  keywords: z.array(rankedKeywordSchema),
});
export type RankedKeywordsResult = z.infer<typeof rankedKeywordsResultSchema>;

// ── Keyword metrics (getKeywordMetrics, getSearchVolume) ────────────────────

export const keywordMetricSchema = z.object({
  keyword: z.string(),
  searchVolume: z.number().int().nullable(),
  cpc: z.number().nullable(),
  competition: z.number().min(0).max(1).nullable(),
  competitionLevel: z.enum(["low", "medium", "high"]).nullable(),
  /** 0..100, DataForSEO Labs' composite keyword-difficulty score. */
  difficulty: z.number().min(0).max(100).nullable(),
});
export type KeywordMetric = z.infer<typeof keywordMetricSchema>;

export type KeywordMetricsRequest = DataForSeoLocale & {
  keywords: string[];
};
export const keywordMetricsResultSchema = z.object({
  metrics: z.array(keywordMetricSchema),
});
export type KeywordMetricsResult = z.infer<typeof keywordMetricsResultSchema>;

export const monthlySearchSchema = z.object({
  year: z.number().int(),
  month: z.number().int().min(1).max(12),
  searchVolume: z.number().int().nullable(),
});
export type MonthlySearch = z.infer<typeof monthlySearchSchema>;

export const searchVolumeRowSchema = z.object({
  keyword: z.string(),
  searchVolume: z.number().int().nullable(),
  cpc: z.number().nullable(),
  competition: z.number().min(0).max(1).nullable(),
  monthlySearches: z.array(monthlySearchSchema),
});
export type SearchVolumeRow = z.infer<typeof searchVolumeRowSchema>;

export type SearchVolumeRequest = DataForSeoLocale & {
  keywords: string[];
};
export const searchVolumeResultSchema = z.object({
  volumes: z.array(searchVolumeRowSchema),
});
export type SearchVolumeResult = z.infer<typeof searchVolumeResultSchema>;

// ── Keyword intent (getKeywordIntent) ───────────────────────────────────────

export const keywordIntentTypeSchema = z.enum([
  "informational",
  "navigational",
  "commercial",
  "transactional",
]);
export type KeywordIntentType = z.infer<typeof keywordIntentTypeSchema>;

export const keywordIntentRowSchema = z.object({
  keyword: z.string(),
  intent: keywordIntentTypeSchema,
  probability: z.number().min(0).max(1),
});
export type KeywordIntentRow = z.infer<typeof keywordIntentRowSchema>;

export type KeywordIntentRequest = DataForSeoLocale & {
  keywords: string[];
};
export const keywordIntentResultSchema = z.object({
  intents: z.array(keywordIntentRowSchema),
});
export type KeywordIntentResult = z.infer<typeof keywordIntentResultSchema>;

// ── Organic SERP (getOrganicSerp) ───────────────────────────────────────────

export const serpItemTypeSchema = z.enum([
  "organic",
  "featured_snippet",
  "people_also_ask",
  "local_pack",
  "video",
  "image_pack",
]);
export type SerpItemType = z.infer<typeof serpItemTypeSchema>;

export const serpItemSchema = z.object({
  rank: z.number().int().min(1),
  type: serpItemTypeSchema,
  url: z.string().nullable(),
  domain: z.string().nullable(),
  title: z.string().nullable(),
  description: z.string().nullable(),
});
export type SerpItem = z.infer<typeof serpItemSchema>;

export type OrganicSerpRequest = DataForSeoLocale & {
  keyword: string;
  device?: "desktop" | "mobile";
  /** Number of SERP results requested, e.g. 10..100. */
  depth?: number;
};
export const organicSerpResultSchema = z.object({
  keyword: z.string(),
  locationCode: z.number().int(),
  languageCode: z.string(),
  device: z.enum(["desktop", "mobile"]),
  items: z.array(serpItemSchema),
  totalResultsCount: z.number().int().nullable(),
});
export type OrganicSerpResult = z.infer<typeof organicSerpResultSchema>;

// ── Domain competitors (getDomainCompetitors) ───────────────────────────────

export const domainCompetitorSchema = z.object({
  domain: z.string(),
  /** Count of keywords this domain and the target both rank for. */
  commonKeywords: z.number().int(),
  /** 0..1, DataForSEO Labs' relevance score for the competitor relationship. */
  competitorRelevance: z.number().min(0).max(1).nullable(),
  avgPosition: z.number().nullable(),
  estimatedTraffic: z.number().int().nullable(),
});
export type DomainCompetitor = z.infer<typeof domainCompetitorSchema>;

export type DomainCompetitorsRequest = DataForSeoLocale & {
  target: string;
  limit?: number;
};
export const domainCompetitorsResultSchema = z.object({
  target: z.string(),
  competitors: z.array(domainCompetitorSchema),
});
export type DomainCompetitorsResult = z.infer<typeof domainCompetitorsResultSchema>;

// ── Reviews (getReviews) ─────────────────────────────────────────────────────

export const reviewSchema = z.object({
  reviewId: z.string(),
  authorName: z.string().nullable(),
  rating: z.number().min(1).max(5).nullable(),
  text: z.string().nullable(),
  /** ISO 8601 date-time. */
  publishedAt: z.string().nullable(),
  ownerResponseText: z.string().nullable(),
});
export type Review = z.infer<typeof reviewSchema>;

export type ReviewsRequest = DataForSeoLocale & {
  /** The business name or query DataForSEO resolves to a place. */
  query: string;
  depth?: number;
};
export const reviewsResultSchema = z.object({
  query: z.string(),
  reviews: z.array(reviewSchema),
});
export type ReviewsResult = z.infer<typeof reviewsResultSchema>;

// ── Adapter interface ───────────────────────────────────────────────────────

export interface DataForSeoAdapter {
  readonly mode: "mock" | "live";

  /** Keywords DataForSEO considers relevant to the target's existing content. */
  getKeywordsForSite(
    request: KeywordsForSiteRequest,
  ): Promise<DataForSeoResult<KeywordsForSiteResult>>;

  /** Keywords the target currently ranks in an organic SERP for. */
  getRankedKeywords(
    request: RankedKeywordsRequest,
  ): Promise<DataForSeoResult<RankedKeywordsResult>>;

  /** Keywords found via the SERP-similarity graph around a seed keyword. */
  getRelatedKeywords(
    request: RelatedKeywordsRequest,
  ): Promise<DataForSeoResult<RelatedKeywordsResult>>;

  /** Full-text-match keyword ideas around a seed keyword. */
  getKeywordSuggestions(
    request: KeywordSuggestionsRequest,
  ): Promise<DataForSeoResult<KeywordSuggestionsResult>>;

  /** Bulk keyword-difficulty-inclusive metrics for an explicit keyword list. */
  getKeywordMetrics(
    request: KeywordMetricsRequest,
  ): Promise<DataForSeoResult<KeywordMetricsResult>>;

  /** Bulk Google Ads search volume, CPC and 12-month trend for a keyword list. */
  getSearchVolume(request: SearchVolumeRequest): Promise<DataForSeoResult<SearchVolumeResult>>;

  /** Informational / navigational / commercial / transactional classification. */
  getKeywordIntent(request: KeywordIntentRequest): Promise<DataForSeoResult<KeywordIntentResult>>;

  /** A live organic SERP for one keyword. Task-post/task-get (§ live.ts). */
  getOrganicSerp(request: OrganicSerpRequest): Promise<DataForSeoResult<OrganicSerpResult>>;

  /** Domains that share the most organic keyword overlap with the target. */
  getDomainCompetitors(
    request: DomainCompetitorsRequest,
  ): Promise<DataForSeoResult<DomainCompetitorsResult>>;

  /** Business reviews for a place query. Task-post/task-get (§ live.ts). */
  getReviews(request: ReviewsRequest): Promise<DataForSeoResult<ReviewsResult>>;
}
