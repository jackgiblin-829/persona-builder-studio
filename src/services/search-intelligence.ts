import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { searchDatasets } from "@/db/schema";
import { getDataForSeoAdapter } from "@/adapters/dataforseo";
import type { DataForSeoAdapter, DataForSeoResult } from "@/adapters/dataforseo/types";
import { stableHash } from "@/lib/crypto";
import { newId, ID_PREFIXES } from "@/lib/ids";
import { withVendorUsage } from "./usage";

/**
 * DataForSEO caching layer (ADR-012, ADR-007's idempotency-by-unique-index
 * pattern applied to search data).
 *
 * `search_datasets` has a unique index on `(brandId, requestHash)`. Every
 * caller — content-gap analysis, page audits, the `dataforseo_query` job
 * handler — goes through `getOrFetchSearchDataset` rather than calling
 * `getDataForSeoAdapter` directly, so repeated generations for the same brand
 * and the same operation/params never re-spend DataForSEO credits: a cache hit
 * returns the stored `normalized` payload and never touches the adapter or
 * `vendor_usage` at all.
 *
 * The hash covers the operation name and the request params, stably ordered
 * (`stableHash`), so `{ target: "a" }` and `{ target: "a", limit: undefined }`
 * hash identically and a param order change never busts the cache.
 */

export type SearchIntelligenceContext = {
  organizationId: string;
  brandId: string;
  jobId?: string | null;
};

function computeHash(operation: string, params: Record<string, unknown>): string {
  return stableHash({ operation, params });
}

/**
 * Fetches one DataForSEO operation, caching by `(brandId, operation, params)`.
 * `fetcher` receives the resolved adapter and must call exactly one adapter
 * method — that call is what gets cached and what `vendor_usage` records.
 */
export async function getOrFetchSearchDataset<T>(
  ctx: SearchIntelligenceContext,
  operation: string,
  params: Record<string, unknown>,
  fetcher: (adapter: DataForSeoAdapter) => Promise<DataForSeoResult<T>>,
): Promise<{
  data: T;
  dataOrigin: "mock" | "live" | "local";
  cached: boolean;
  datasetId: string;
}> {
  const requestHash = computeHash(operation, params);

  const [existing] = await db
    .select()
    .from(searchDatasets)
    .where(
      and(eq(searchDatasets.brandId, ctx.brandId), eq(searchDatasets.requestHash, requestHash)),
    )
    .limit(1);

  if (existing && existing.status === "succeeded") {
    return {
      data: existing.normalized as unknown as T,
      dataOrigin: existing.dataOrigin,
      cached: true,
      datasetId: existing.id,
    };
  }

  const { adapter, mode } = await getDataForSeoAdapter(ctx.organizationId);

  try {
    const result = await withVendorUsage(
      {
        organizationId: ctx.organizationId,
        brandId: ctx.brandId,
        vendor: "dataforseo",
        operation,
        mode,
        jobId: ctx.jobId,
        requestHash,
      },
      () => fetcher(adapter),
      (fetchResult) => ({ costCents: fetchResult.costCents }),
    );

    const [row] = await db
      .insert(searchDatasets)
      .values({
        id: existing?.id ?? newId(ID_PREFIXES.searchDataset),
        organizationId: ctx.organizationId,
        brandId: ctx.brandId,
        vendor: "dataforseo",
        operation,
        requestParams: params,
        requestHash,
        status: "succeeded",
        vendorTaskId: result.vendorTaskId,
        normalized: result.data as unknown as Record<string, unknown>,
        rawResponse: result.raw,
        itemCount: result.itemCount,
        costCents: result.costCents,
        dataOrigin: result.dataOrigin,
        errorMessage: null,
        fetchedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [searchDatasets.brandId, searchDatasets.requestHash],
        set: {
          status: "succeeded",
          vendorTaskId: result.vendorTaskId,
          normalized: result.data as unknown as Record<string, unknown>,
          rawResponse: result.raw,
          itemCount: result.itemCount,
          costCents: result.costCents,
          dataOrigin: result.dataOrigin,
          errorMessage: null,
          fetchedAt: new Date(),
          updatedAt: new Date(),
        },
      })
      .returning();

    return { data: result.data, dataOrigin: result.dataOrigin, cached: false, datasetId: row!.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    await db
      .insert(searchDatasets)
      .values({
        id: existing?.id ?? newId(ID_PREFIXES.searchDataset),
        organizationId: ctx.organizationId,
        brandId: ctx.brandId,
        vendor: "dataforseo",
        operation,
        requestParams: params,
        requestHash,
        status: "failed",
        dataOrigin: mode,
        errorMessage: message,
      })
      .onConflictDoUpdate({
        target: [searchDatasets.brandId, searchDatasets.requestHash],
        set: { status: "failed", dataOrigin: mode, errorMessage: message, updatedAt: new Date() },
      });

    throw error;
  }
}

/**
 * Convenience wrapper for the shape content-gap analysis and page audits
 * actually need: search volume and organic SERP composition for a brand's
 * primary domain and a short keyword list drawn from persona vocabulary and
 * prompt topics. Both calls are independently cached.
 */
export async function getBrandSearchIntelligence(
  ctx: SearchIntelligenceContext,
  input: { domain: string; keywords: string[] },
): Promise<{
  searchVolume: Awaited<ReturnType<DataForSeoAdapter["getSearchVolume"]>>["data"];
  domainCompetitors: Awaited<ReturnType<DataForSeoAdapter["getDomainCompetitors"]>>["data"];
  dataOrigin: "mock" | "live" | "local";
}> {
  const keywords = [
    ...new Set(input.keywords.map((k) => k.trim().toLowerCase()).filter(Boolean)),
  ].slice(0, 20);

  const [volume, competitors] = await Promise.all([
    getOrFetchSearchDataset(ctx, "search_volume", { keywords }, (adapter) =>
      adapter.getSearchVolume({ keywords }),
    ),
    getOrFetchSearchDataset(ctx, "domain_competitors", { target: input.domain }, (adapter) =>
      adapter.getDomainCompetitors({ target: input.domain, limit: 10 }),
    ),
  ]);

  return {
    searchVolume: volume.data,
    domainCompetitors: competitors.data,
    dataOrigin: volume.cached ? volume.dataOrigin : competitors.dataOrigin,
  };
}
