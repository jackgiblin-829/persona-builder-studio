import { createHash } from "node:crypto";
import { z } from "zod";
import { VendorError } from "@/lib/errors";
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
} from "./types";

/**
 * Pure normalization: the vendor's assumed raw (snake_case) response shapes,
 * and the functions that turn them into this adapter's normalized types.
 *
 * Split out of `live.ts` so this logic — which is where an `@unverified`
 * assumption about DataForSEO's actual field names is most likely to be
 * wrong — is unit-testable without mocking HTTP at all. `live.ts` only wires
 * these functions to the network: request, retry, poll, throw.
 */

// ── Task/envelope contracts ──────────────────────────────────────────────────

export const taskSchema = z.object({
  id: z.string(),
  status_code: z.number(),
  status_message: z.string().nullish(),
  cost: z.number().nullish(),
  result_count: z.number().nullish(),
  result: z.array(z.record(z.string(), z.unknown())).nullish(),
});
export type DataForSeoTask = z.infer<typeof taskSchema>;

export const envelopeSchema = z.object({
  status_code: z.number(),
  status_message: z.string().nullish(),
  cost: z.number().nullish(),
  tasks: z.array(taskSchema),
});
export type DataForSeoEnvelope = z.infer<typeof envelopeSchema>;

/** Success band per DataForSEO's documented status-code convention (20000-20100). */
export function isSuccessStatus(code: number): boolean {
  return code >= 20000 && code < 20100;
}

/** "Still queued/processing" band a task-based endpoint uses before it is ready. */
export function isPendingStatus(code: number): boolean {
  return code >= 20100 && code < 20200;
}

export function assertTaskSucceeded(task: DataForSeoTask, operation: string): void {
  if (isSuccessStatus(task.status_code)) return;
  throw new VendorError(
    "dataforseo",
    operation,
    `DataForSEO task failed: ${task.status_message ?? `status ${task.status_code}`}.`,
    {
      code: task.status_code === 40029 ? "vendor_rate_limited" : "vendor_error",
      retryable: task.status_code === 40029,
      details: { statusCode: task.status_code },
    },
  );
}

/** For task-post/task-get: queued/processing is not an error, only a genuine failure is. */
export function assertTaskQueuedOrSucceeded(task: DataForSeoTask, operation: string): void {
  if (isSuccessStatus(task.status_code) || isPendingStatus(task.status_code)) return;
  throw new VendorError(
    "dataforseo",
    operation,
    `DataForSEO task failed: ${task.status_message ?? `status ${task.status_code}`}.`,
    {
      code: task.status_code === 40029 ? "vendor_rate_limited" : "vendor_error",
      retryable: task.status_code === 40029,
      details: { statusCode: task.status_code },
    },
  );
}

/**
 * DataForSEO Labs endpoints wrap their rows in `result[0].items`; Keywords
 * Data endpoints return the rows directly in `result`. Both are accepted so
 * this one extractor covers every operation in `live.ts`.
 */
export function extractResultRows(
  result: Record<string, unknown>[] | null | undefined,
): Record<string, unknown>[] {
  if (!result) return [];
  if (result.length === 1) {
    const only = result[0];
    if (only && Array.isArray((only as { items?: unknown }).items)) {
      return (only as { items: Record<string, unknown>[] }).items;
    }
  }
  return result;
}

export function dollarsToCents(dollars: number): number {
  return Math.round(dollars * 100);
}

// ── Raw row schemas + mappers ────────────────────────────────────────────────

export const keywordIdeaRawSchema = z.object({
  keyword: z.string(),
  keyword_info: z
    .object({
      search_volume: z.number().nullish(),
      cpc: z.number().nullish(),
      competition: z.number().nullish(),
    })
    .nullish(),
  keyword_difficulty: z.number().nullish(),
});
export function toKeywordIdea(row: z.infer<typeof keywordIdeaRawSchema>): KeywordIdea {
  return {
    keyword: row.keyword,
    searchVolume: row.keyword_info?.search_volume ?? null,
    cpc: row.keyword_info?.cpc ?? null,
    competition: row.keyword_info?.competition ?? null,
    difficulty: row.keyword_difficulty ?? null,
  };
}

export const rankedKeywordRawSchema = keywordIdeaRawSchema.extend({
  ranked_serp_element: z
    .object({
      serp_item: z
        .object({
          rank_absolute: z.number().nullish(),
          url: z.string().nullish(),
          etv: z.number().nullish(),
        })
        .nullish(),
    })
    .nullish(),
});
export function toRankedKeyword(row: z.infer<typeof rankedKeywordRawSchema>): RankedKeyword {
  const idea = toKeywordIdea(row);
  const serpItem = row.ranked_serp_element?.serp_item;
  return {
    ...idea,
    position: serpItem?.rank_absolute ?? 0,
    url: serpItem?.url ?? null,
    estimatedTraffic: serpItem?.etv ?? null,
  };
}

export const keywordMetricRawSchema = z.object({
  keyword: z.string(),
  keyword_info: z
    .object({
      search_volume: z.number().nullish(),
      cpc: z.number().nullish(),
      competition: z.number().nullish(),
      competition_level: z.enum(["LOW", "MEDIUM", "HIGH"]).nullish(),
    })
    .nullish(),
  keyword_properties: z.object({ keyword_difficulty: z.number().nullish() }).nullish(),
});
export function toKeywordMetric(row: z.infer<typeof keywordMetricRawSchema>): KeywordMetric {
  return {
    keyword: row.keyword,
    searchVolume: row.keyword_info?.search_volume ?? null,
    cpc: row.keyword_info?.cpc ?? null,
    competition: row.keyword_info?.competition ?? null,
    competitionLevel: (row.keyword_info?.competition_level?.toLowerCase() ?? null) as
      "low" | "medium" | "high" | null,
    difficulty: row.keyword_properties?.keyword_difficulty ?? null,
  };
}

export const searchVolumeRawSchema = z.object({
  keyword: z.string(),
  search_volume: z.number().nullish(),
  cpc: z.number().nullish(),
  competition: z.number().nullish(),
  monthly_searches: z
    .array(
      z.object({
        year: z.number(),
        month: z.number(),
        search_volume: z.number().nullish(),
      }),
    )
    .nullish(),
});
export function toSearchVolumeRow(row: z.infer<typeof searchVolumeRawSchema>): SearchVolumeRow {
  const monthlySearches: MonthlySearch[] = (row.monthly_searches ?? []).map((m) => ({
    year: m.year,
    month: m.month,
    searchVolume: m.search_volume ?? null,
  }));
  return {
    keyword: row.keyword,
    searchVolume: row.search_volume ?? null,
    cpc: row.cpc ?? null,
    competition: row.competition ?? null,
    monthlySearches,
  };
}

export const keywordIntentRawSchema = z.object({
  keyword: z.string(),
  keyword_intent: z
    .object({
      label: z.enum(["informational", "navigational", "commercial", "transactional"]),
      probability: z.number(),
    })
    .nullish(),
});
export function toKeywordIntentRow(row: z.infer<typeof keywordIntentRawSchema>): KeywordIntentRow {
  const label: KeywordIntentType = row.keyword_intent?.label ?? "informational";
  return {
    keyword: row.keyword,
    intent: label,
    probability: row.keyword_intent?.probability ?? 0,
  };
}

export const serpItemRawSchema = z.object({
  rank_absolute: z.number(),
  type: z.string(),
  url: z.string().nullish(),
  domain: z.string().nullish(),
  title: z.string().nullish(),
  description: z.string().nullish(),
});
const SERP_TYPE_MAP: Record<string, SerpItemType> = {
  organic: "organic",
  featured_snippet: "featured_snippet",
  people_also_ask: "people_also_ask",
  local_pack: "local_pack",
  video: "video",
  images: "image_pack",
};
export function toSerpItem(row: z.infer<typeof serpItemRawSchema>): SerpItem {
  return {
    rank: row.rank_absolute,
    type: SERP_TYPE_MAP[row.type] ?? "organic",
    url: row.url ?? null,
    domain: row.domain ?? null,
    title: row.title ?? null,
    description: row.description ?? null,
  };
}

export const domainCompetitorRawSchema = z.object({
  domain: z.string(),
  intersections: z.number().nullish(),
  avg_position: z.number().nullish(),
  metrics: z
    .object({
      organic: z
        .object({
          etv: z.number().nullish(),
          count: z.number().nullish(),
        })
        .nullish(),
    })
    .nullish(),
  competitor_metrics: z.object({ relevance: z.number().nullish() }).nullish(),
});
export function toDomainCompetitor(
  row: z.infer<typeof domainCompetitorRawSchema>,
): DomainCompetitor {
  return {
    domain: row.domain,
    commonKeywords: row.intersections ?? row.metrics?.organic?.count ?? 0,
    competitorRelevance: row.competitor_metrics?.relevance ?? null,
    avgPosition: row.avg_position ?? null,
    estimatedTraffic: row.metrics?.organic?.etv ?? null,
  };
}

export const reviewRawSchema = z.object({
  review_id: z.string().nullish(),
  reviewer_name: z.string().nullish(),
  rating: z.object({ value: z.number().nullish() }).nullish(),
  review_text: z.string().nullish(),
  timestamp: z.string().nullish(),
  owner_response: z.string().nullish(),
});
export function toReview(row: z.infer<typeof reviewRawSchema>): Review {
  return {
    reviewId: row.review_id ?? `unidentified_${hashFallbackId(row)}`,
    authorName: row.reviewer_name ?? null,
    rating: row.rating?.value ?? null,
    text: row.review_text ?? null,
    publishedAt: row.timestamp ?? null,
    ownerResponseText: row.owner_response ?? null,
  };
}

/** A stable fallback id when the vendor omits `review_id`, derived from the row itself. */
export function hashFallbackId(row: unknown): string {
  return createHash("sha256").update(JSON.stringify(row)).digest("hex").slice(0, 16);
}
