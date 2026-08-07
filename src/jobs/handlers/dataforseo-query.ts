import "server-only";
import type { DataForSeoAdapter, DataForSeoResult } from "@/adapters/dataforseo/types";
import { AppError } from "@/lib/errors";
import { getOrFetchSearchDataset } from "@/services/search-intelligence";
import { JOB_TYPES, registerJob } from "../registry";
import { loadBrandContext } from "./ingest-source";

/**
 * Thin job wrapper over `getOrFetchSearchDataset` (ADR-012). One job run is
 * one cached DataForSEO operation for one brand; the payload names the
 * operation and supplies its params, and this handler is the only place that
 * knows which adapter method each operation name maps to.
 */
registerJob(JOB_TYPES.dataforseoQuery, async ({ job }) => {
  const brandId = String(job.payload.brandId ?? "");
  const operation = String(job.payload.operation ?? "");
  const params = (job.payload.params ?? {}) as Record<string, unknown>;

  if (!brandId || !operation) {
    throw new AppError("validation", "dataforseo_query requires brandId and operation");
  }

  const brand = await loadBrandContext(brandId);

  const result = await getOrFetchSearchDataset(
    { organizationId: brand.organizationId, brandId, jobId: job.id },
    operation,
    params,
    (adapter) => runOperation(adapter, operation, params),
  );

  return {
    status: "succeeded",
    result: { operation, cached: result.cached, dataOrigin: result.dataOrigin },
  };
});

async function runOperation(
  adapter: DataForSeoAdapter,
  operation: string,
  params: Record<string, unknown>,
): Promise<DataForSeoResult<unknown>> {
  switch (operation) {
    case "keywords_for_site":
      return adapter.getKeywordsForSite(params as Parameters<typeof adapter.getKeywordsForSite>[0]);
    case "ranked_keywords":
      return adapter.getRankedKeywords(params as Parameters<typeof adapter.getRankedKeywords>[0]);
    case "related_keywords":
      return adapter.getRelatedKeywords(params as Parameters<typeof adapter.getRelatedKeywords>[0]);
    case "keyword_suggestions":
      return adapter.getKeywordSuggestions(
        params as Parameters<typeof adapter.getKeywordSuggestions>[0],
      );
    case "keyword_metrics":
      return adapter.getKeywordMetrics(params as Parameters<typeof adapter.getKeywordMetrics>[0]);
    case "search_volume":
      return adapter.getSearchVolume(params as Parameters<typeof adapter.getSearchVolume>[0]);
    case "keyword_intent":
      return adapter.getKeywordIntent(params as Parameters<typeof adapter.getKeywordIntent>[0]);
    case "organic_serp":
      return adapter.getOrganicSerp(params as Parameters<typeof adapter.getOrganicSerp>[0]);
    case "domain_competitors":
      return adapter.getDomainCompetitors(
        params as Parameters<typeof adapter.getDomainCompetitors>[0],
      );
    case "reviews":
      return adapter.getReviews(params as Parameters<typeof adapter.getReviews>[0]);
    default:
      throw new AppError("validation", `Unknown DataForSEO operation "${operation}".`);
  }
}
