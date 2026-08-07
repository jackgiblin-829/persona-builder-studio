import "server-only";
import {
  generateDomainCompetitors,
  generateKeywordIntent,
  generateKeywordMetric,
  generateKeywordSuggestions,
  generateKeywordsForSite,
  generateOrganicSerp,
  generateRankedKeywords,
  generateRelatedKeywords,
  generateReviews,
  generateSearchVolumeRow,
  mockTaskId,
} from "@fixtures/dataforseo/generators";
import {
  DEFAULT_LANGUAGE_CODE,
  DEFAULT_LOCATION_CODE,
  type DataForSeoAdapter,
  type DataForSeoResult,
  type DomainCompetitorsRequest,
  type DomainCompetitorsResult,
  type KeywordIntentRequest,
  type KeywordIntentResult,
  type KeywordMetricsRequest,
  type KeywordMetricsResult,
  type KeywordSuggestionsRequest,
  type KeywordSuggestionsResult,
  type KeywordsForSiteRequest,
  type KeywordsForSiteResult,
  type OrganicSerpRequest,
  type OrganicSerpResult,
  type RankedKeywordsRequest,
  type RankedKeywordsResult,
  type RelatedKeywordsRequest,
  type RelatedKeywordsResult,
  type ReviewsRequest,
  type ReviewsResult,
  type SearchVolumeRequest,
  type SearchVolumeResult,
} from "./types";

/**
 * Deterministic mock DataForSEO adapter.
 *
 * Every method is a pure function of its request, routed through the hashed
 * generators in `fixtures/dataforseo/generators.ts` — no clock, no
 * randomness, no network. Unlike the Profound mock, there is no single fixed
 * "account": DataForSEO can be asked about any domain or keyword a brand
 * supplies, so the mock derives plausible, stable data from the input itself
 * rather than from a canned account fixture. `costCents` is always `0` in
 * mock mode, matching the OpenAI and Profound mocks.
 */
export class MockDataForSeoAdapter implements DataForSeoAdapter {
  readonly mode = "mock" as const;

  async getKeywordsForSite(
    request: KeywordsForSiteRequest,
  ): Promise<DataForSeoResult<KeywordsForSiteResult>> {
    const keywords = generateKeywordsForSite(request.target, request.limit);
    return envelope({ target: request.target, keywords }, keywords.length, null);
  }

  async getRankedKeywords(
    request: RankedKeywordsRequest,
  ): Promise<DataForSeoResult<RankedKeywordsResult>> {
    const keywords = generateRankedKeywords(request.target, request.limit);
    return envelope({ target: request.target, keywords }, keywords.length, null);
  }

  async getRelatedKeywords(
    request: RelatedKeywordsRequest,
  ): Promise<DataForSeoResult<RelatedKeywordsResult>> {
    const keywords = generateRelatedKeywords(request.keyword, request.limit);
    return envelope({ seedKeyword: request.keyword, keywords }, keywords.length, null);
  }

  async getKeywordSuggestions(
    request: KeywordSuggestionsRequest,
  ): Promise<DataForSeoResult<KeywordSuggestionsResult>> {
    const keywords = generateKeywordSuggestions(request.keyword, request.limit);
    return envelope({ seedKeyword: request.keyword, keywords }, keywords.length, null);
  }

  async getKeywordMetrics(
    request: KeywordMetricsRequest,
  ): Promise<DataForSeoResult<KeywordMetricsResult>> {
    const metrics = dedupeKeywords(request.keywords).map(generateKeywordMetric);
    return envelope({ metrics }, metrics.length, null);
  }

  async getSearchVolume(
    request: SearchVolumeRequest,
  ): Promise<DataForSeoResult<SearchVolumeResult>> {
    const volumes = dedupeKeywords(request.keywords).map(generateSearchVolumeRow);
    return envelope({ volumes }, volumes.length, null);
  }

  async getKeywordIntent(
    request: KeywordIntentRequest,
  ): Promise<DataForSeoResult<KeywordIntentResult>> {
    const intents = dedupeKeywords(request.keywords).map(generateKeywordIntent);
    return envelope({ intents }, intents.length, null);
  }

  async getOrganicSerp(request: OrganicSerpRequest): Promise<DataForSeoResult<OrganicSerpResult>> {
    const depth = request.depth ?? 10;
    const { items, totalResultsCount } = generateOrganicSerp(request.keyword, depth);
    const data: OrganicSerpResult = {
      keyword: request.keyword,
      locationCode: request.locationCode ?? DEFAULT_LOCATION_CODE,
      languageCode: request.languageCode ?? DEFAULT_LANGUAGE_CODE,
      device: request.device ?? "desktop",
      items,
      totalResultsCount,
    };
    return envelope(data, items.length, mockTaskId(`serp:${request.keyword}:${depth}`));
  }

  async getDomainCompetitors(
    request: DomainCompetitorsRequest,
  ): Promise<DataForSeoResult<DomainCompetitorsResult>> {
    const competitors = generateDomainCompetitors(request.target, request.limit);
    return envelope({ target: request.target, competitors }, competitors.length, null);
  }

  async getReviews(request: ReviewsRequest): Promise<DataForSeoResult<ReviewsResult>> {
    const depth = request.depth ?? 10;
    const reviews = generateReviews(request.query, depth);
    return envelope(
      { query: request.query, reviews },
      reviews.length,
      mockTaskId(`reviews:${request.query}:${depth}`),
    );
  }
}

function dedupeKeywords(keywords: string[]): string[] {
  return [...new Set(keywords)];
}

function envelope<T>(data: T, itemCount: number, vendorTaskId: string | null): DataForSeoResult<T> {
  return {
    data,
    dataOrigin: "mock",
    itemCount,
    costCents: 0,
    vendorTaskId,
    raw: { mock: true, data },
  };
}
