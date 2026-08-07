import "server-only";
import { z } from "zod";
import { VendorError, VendorNotConfiguredError } from "@/lib/errors";
import { isTransportRetryableStatus, sleep, transportRetryDelayMs } from "@/lib/vendor-retry";
import {
  assertTaskQueuedOrSucceeded,
  assertTaskSucceeded,
  dollarsToCents,
  domainCompetitorRawSchema,
  envelopeSchema,
  extractResultRows,
  keywordIdeaRawSchema,
  keywordIntentRawSchema,
  keywordMetricRawSchema,
  rankedKeywordRawSchema,
  reviewRawSchema,
  searchVolumeRawSchema,
  serpItemRawSchema,
  toDomainCompetitor,
  toKeywordIdea,
  toKeywordIntentRow,
  toKeywordMetric,
  toRankedKeyword,
  toReview,
  toSearchVolumeRow,
  toSerpItem,
} from "./normalize";
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
 * Live DataForSEO adapter.
 *
 * @unverified — written from the endpoint assumptions recorded in
 * docs/integrations.md, per ADR-011. No live call has been executed and
 * DataForSEO's current official documentation has not been checked in this
 * environment. Every path, request body and response field assumed here (and
 * in `./normalize`) is based on DataForSEO's publicly documented product
 * shape (DataForSEO Labs, Keywords Data, SERP and Business Data APIs) as of
 * prior knowledge, not a verified contract. Before enabling live mode:
 * re-read DataForSEO's current API documentation, correct the paths and
 * field names, record the documentation date in docs/integrations.md, and
 * run the adapter against a sandbox account.
 *
 * Two behaviours here are not negotiable regardless of what the documentation
 * turns out to say:
 *
 * 1. **A failed call throws** (ADR-009). There is no path from a live error
 *    to mock data.
 * 2. **DataForSEO LLM Responses / LLM Mentions / LLM Scraper are never
 *    called** (ADR-010). This adapter only reaches endpoints that return
 *    traditional search demand, SERP composition and keyword intent.
 *
 * Two request shapes exist because DataForSEO itself splits its products this
 * way: `getKeywordsForSite`, `getRankedKeywords`, `getRelatedKeywords`,
 * `getKeywordSuggestions`, `getKeywordMetrics`, `getSearchVolume`,
 * `getKeywordIntent` and `getDomainCompetitors` are assumed to be "live"
 * endpoints that return a result synchronously; `getOrganicSerp` and
 * `getReviews` are assumed to require the task-post/task-get pattern
 * DataForSEO uses for its SERP and Business Data products, so they queue a
 * task and poll for it (`runTaskBased`, below). Response parsing and
 * raw-to-normalized mapping live in `./normalize`, kept separate so that
 * logic — the part most likely to be wrong about DataForSEO's actual field
 * names — is unit-testable without mocking HTTP.
 */

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_TRANSPORT_RETRIES = 3;

/** DataForSEO's documented per-call keyword ceiling is much higher; this keeps
 * each request body small enough to retry cheaply without re-sending a huge
 * keyword list on a transient failure. */
const MAX_KEYWORDS_PER_BATCH = 200;

/** Caps how many keyword batches or task polls run at once against the vendor. */
const MAX_CONCURRENT_REQUESTS = 5;

/** How many times a queued/processing task is polled before giving up. */
const MAX_POLL_ATTEMPTS = 10;
const POLL_BASE_DELAY_MS = 2_000;
const POLL_MAX_DELAY_MS = 20_000;

export class LiveDataForSeoAdapter implements DataForSeoAdapter {
  readonly mode = "live" as const;

  private readonly authHeader: string;

  constructor(
    login: string,
    password: string,
    private readonly options: { baseUrl?: string; timeoutMs?: number } = {},
  ) {
    if (!login || !password) throw new VendorNotConfiguredError("dataforseo", "construct");
    this.authHeader = `Basic ${Buffer.from(`${login}:${password}`, "utf8").toString("base64")}`;
  }

  async getKeywordsForSite(
    request: KeywordsForSiteRequest,
  ): Promise<DataForSeoResult<KeywordsForSiteResult>> {
    const { rows, costCents, raw } = await this.postLive(
      "/v3/dataforseo_labs/google/keywords_for_site/live",
      [
        {
          target: request.target,
          location_code: request.locationCode ?? DEFAULT_LOCATION_CODE,
          language_code: request.languageCode ?? DEFAULT_LANGUAGE_CODE,
          limit: request.limit ?? 50,
        },
      ],
      "getKeywordsForSite",
    );
    const keywords = rows.map((row) =>
      toKeywordIdea(parse(keywordIdeaRawSchema, row, "getKeywordsForSite")),
    );
    return envelope({ target: request.target, keywords }, keywords.length, costCents, null, raw);
  }

  async getRankedKeywords(
    request: RankedKeywordsRequest,
  ): Promise<DataForSeoResult<RankedKeywordsResult>> {
    const { rows, costCents, raw } = await this.postLive(
      "/v3/dataforseo_labs/google/ranked_keywords/live",
      [
        {
          target: request.target,
          location_code: request.locationCode ?? DEFAULT_LOCATION_CODE,
          language_code: request.languageCode ?? DEFAULT_LANGUAGE_CODE,
          limit: request.limit ?? 50,
        },
      ],
      "getRankedKeywords",
    );
    // Rows missing a live SERP position aren't ranked keywords — dropped here
    // rather than defaulted, since `position` is contractually 1-based.
    const keywords = rows
      .map((row) => parse(rankedKeywordRawSchema, row, "getRankedKeywords"))
      .filter((row) => row.ranked_serp_element?.serp_item?.rank_absolute != null)
      .map(toRankedKeyword);
    return envelope({ target: request.target, keywords }, keywords.length, costCents, null, raw);
  }

  async getRelatedKeywords(
    request: RelatedKeywordsRequest,
  ): Promise<DataForSeoResult<RelatedKeywordsResult>> {
    const { rows, costCents, raw } = await this.postLive(
      "/v3/dataforseo_labs/google/related_keywords/live",
      [
        {
          keyword: request.keyword,
          location_code: request.locationCode ?? DEFAULT_LOCATION_CODE,
          language_code: request.languageCode ?? DEFAULT_LANGUAGE_CODE,
          depth: request.depth ?? 1,
          limit: request.limit ?? 20,
        },
      ],
      "getRelatedKeywords",
    );
    const keywords = rows.map((row) =>
      toKeywordIdea(parse(keywordIdeaRawSchema, row, "getRelatedKeywords")),
    );
    return envelope(
      { seedKeyword: request.keyword, keywords },
      keywords.length,
      costCents,
      null,
      raw,
    );
  }

  async getKeywordSuggestions(
    request: KeywordSuggestionsRequest,
  ): Promise<DataForSeoResult<KeywordSuggestionsResult>> {
    const { rows, costCents, raw } = await this.postLive(
      "/v3/dataforseo_labs/google/keyword_suggestions/live",
      [
        {
          keyword: request.keyword,
          location_code: request.locationCode ?? DEFAULT_LOCATION_CODE,
          language_code: request.languageCode ?? DEFAULT_LANGUAGE_CODE,
          limit: request.limit ?? 20,
        },
      ],
      "getKeywordSuggestions",
    );
    const keywords = rows.map((row) =>
      toKeywordIdea(parse(keywordIdeaRawSchema, row, "getKeywordSuggestions")),
    );
    return envelope(
      { seedKeyword: request.keyword, keywords },
      keywords.length,
      costCents,
      null,
      raw,
    );
  }

  async getKeywordMetrics(
    request: KeywordMetricsRequest,
  ): Promise<DataForSeoResult<KeywordMetricsResult>> {
    const { rows, costCents, raw } = await this.postLiveBatched(
      "/v3/dataforseo_labs/google/keyword_overview/live",
      request.keywords,
      (batch) => ({
        keywords: batch,
        location_code: request.locationCode ?? DEFAULT_LOCATION_CODE,
        language_code: request.languageCode ?? DEFAULT_LANGUAGE_CODE,
      }),
      "getKeywordMetrics",
    );
    const metrics = rows.map((row) =>
      toKeywordMetric(parse(keywordMetricRawSchema, row, "getKeywordMetrics")),
    );
    return envelope({ metrics }, metrics.length, costCents, null, raw);
  }

  async getSearchVolume(
    request: SearchVolumeRequest,
  ): Promise<DataForSeoResult<SearchVolumeResult>> {
    const { rows, costCents, raw } = await this.postLiveBatched(
      "/v3/keywords_data/google_ads/search_volume/live",
      request.keywords,
      (batch) => ({
        keywords: batch,
        location_code: request.locationCode ?? DEFAULT_LOCATION_CODE,
        language_code: request.languageCode ?? DEFAULT_LANGUAGE_CODE,
      }),
      "getSearchVolume",
    );
    const volumes = rows.map((row) =>
      toSearchVolumeRow(parse(searchVolumeRawSchema, row, "getSearchVolume")),
    );
    return envelope({ volumes }, volumes.length, costCents, null, raw);
  }

  async getKeywordIntent(
    request: KeywordIntentRequest,
  ): Promise<DataForSeoResult<KeywordIntentResult>> {
    const { rows, costCents, raw } = await this.postLiveBatched(
      "/v3/dataforseo_labs/google/search_intent/live",
      request.keywords,
      (batch) => ({
        keywords: batch,
        location_code: request.locationCode ?? DEFAULT_LOCATION_CODE,
        language_code: request.languageCode ?? DEFAULT_LANGUAGE_CODE,
      }),
      "getKeywordIntent",
    );
    const intents = rows.map((row) =>
      toKeywordIntentRow(parse(keywordIntentRawSchema, row, "getKeywordIntent")),
    );
    return envelope({ intents }, intents.length, costCents, null, raw);
  }

  async getOrganicSerp(request: OrganicSerpRequest): Promise<DataForSeoResult<OrganicSerpResult>> {
    const locationCode = request.locationCode ?? DEFAULT_LOCATION_CODE;
    const languageCode = request.languageCode ?? DEFAULT_LANGUAGE_CODE;
    const device = request.device ?? "desktop";

    const { taskId, rows, costCents, raw } = await this.runTaskBased(
      "/v3/serp/google/organic/task_post",
      (id) => `/v3/serp/google/organic/task_get/advanced/${encodeURIComponent(id)}`,
      {
        keyword: request.keyword,
        location_code: locationCode,
        language_code: languageCode,
        device,
        depth: request.depth ?? 10,
      },
      "getOrganicSerp",
    );

    const items = rows
      .filter((row) => (row as { type?: unknown }).type !== undefined)
      .map((row) => toSerpItem(parse(serpItemRawSchema, row, "getOrganicSerp")));
    const totalsRow = rows.find((row) => "se_results_count" in row) as
      { se_results_count?: number | null } | undefined;

    const data: OrganicSerpResult = {
      keyword: request.keyword,
      locationCode,
      languageCode,
      device,
      items,
      totalResultsCount: totalsRow?.se_results_count ?? null,
    };
    return envelope(data, items.length, costCents, taskId, raw);
  }

  async getDomainCompetitors(
    request: DomainCompetitorsRequest,
  ): Promise<DataForSeoResult<DomainCompetitorsResult>> {
    const { rows, costCents, raw } = await this.postLive(
      "/v3/dataforseo_labs/google/competitors_domain/live",
      [
        {
          target: request.target,
          location_code: request.locationCode ?? DEFAULT_LOCATION_CODE,
          language_code: request.languageCode ?? DEFAULT_LANGUAGE_CODE,
          limit: request.limit ?? 20,
        },
      ],
      "getDomainCompetitors",
    );
    const competitors = rows.map((row) =>
      toDomainCompetitor(parse(domainCompetitorRawSchema, row, "getDomainCompetitors")),
    );
    return envelope(
      { target: request.target, competitors },
      competitors.length,
      costCents,
      null,
      raw,
    );
  }

  async getReviews(request: ReviewsRequest): Promise<DataForSeoResult<ReviewsResult>> {
    const { taskId, rows, costCents, raw } = await this.runTaskBased(
      "/v3/business_data/google/reviews/task_post",
      (id) => `/v3/business_data/google/reviews/task_get/${encodeURIComponent(id)}`,
      {
        keyword: request.query,
        location_code: request.locationCode ?? DEFAULT_LOCATION_CODE,
        language_code: request.languageCode ?? DEFAULT_LANGUAGE_CODE,
        depth: request.depth ?? 10,
      },
      "getReviews",
    );
    const reviews = rows.map((row) => toReview(parse(reviewRawSchema, row, "getReviews")));
    return envelope({ query: request.query, reviews }, reviews.length, costCents, taskId, raw);
  }

  // ── Batching and task orchestration ────────────────────────────────────────

  /** A single immediate ("live") request with no batching. */
  private async postLive(
    path: string,
    tasks: Record<string, unknown>[],
    operation: string,
  ): Promise<{ rows: Record<string, unknown>[]; costCents: number; raw: Record<string, unknown> }> {
    const body = await this.request("POST", path, tasks, operation);
    const parsed = parse(envelopeSchema, body, operation);
    const task = parsed.tasks[0];
    if (!task) {
      throw new VendorError("dataforseo", operation, "DataForSEO returned no task.", {
        retryable: false,
      });
    }
    assertTaskSucceeded(task, operation);
    return {
      rows: extractResultRows(task.result),
      costCents: dollarsToCents(task.cost ?? parsed.cost ?? 0),
      raw: body as Record<string, unknown>,
    };
  }

  /**
   * Splits a keyword list into vendor-sized batches and runs them with a
   * bounded concurrency (`MAX_CONCURRENT_REQUESTS`) — the concurrency limit
   * the product spec requires, applied where this adapter actually needs to
   * make more than one request per call: bulk keyword-metric lookups.
   */
  private async postLiveBatched(
    path: string,
    keywords: string[],
    buildTaskBody: (batch: string[]) => Record<string, unknown>,
    operation: string,
  ): Promise<{ rows: Record<string, unknown>[]; costCents: number; raw: Record<string, unknown> }> {
    const batches = chunk(keywords, MAX_KEYWORDS_PER_BATCH);
    const results = await mapWithConcurrency(batches, MAX_CONCURRENT_REQUESTS, (batch) =>
      this.postLive(path, [buildTaskBody(batch)], operation),
    );
    return {
      rows: results.flatMap((r) => r.rows),
      costCents: results.reduce((sum, r) => sum + r.costCents, 0),
      raw: { batches: results.map((r) => r.raw) },
    };
  }

  /**
   * Task-post/task-get pattern: queue the task, then poll `task_get` with
   * backoff until it reports ready. A task that never reports ready within
   * `MAX_POLL_ATTEMPTS` throws a retryable `vendor_timeout` — distinct from a
   * rate limit, which is handled at the transport layer in `request()` and
   * never reaches this loop as a normal iteration.
   */
  private async runTaskBased(
    postPath: string,
    getPath: (taskId: string) => string,
    taskBody: Record<string, unknown>,
    operation: string,
  ): Promise<{
    taskId: string;
    rows: Record<string, unknown>[];
    costCents: number;
    raw: Record<string, unknown>;
  }> {
    const postBody = await this.request("POST", postPath, [taskBody], operation, false);
    const posted = parse(envelopeSchema, postBody, operation);
    const postedTask = posted.tasks[0];
    if (!postedTask) {
      throw new VendorError("dataforseo", operation, "DataForSEO returned no task id.", {
        retryable: false,
      });
    }
    assertTaskQueuedOrSucceeded(postedTask, operation);
    const taskId = postedTask.id;
    let costCents = dollarsToCents(postedTask.cost ?? posted.cost ?? 0);

    // The task may already carry a result if the vendor resolved it inline;
    // otherwise poll task_get until it is ready.
    if (postedTask.result) {
      return {
        taskId,
        rows: extractResultRows(postedTask.result),
        costCents,
        raw: postBody as Record<string, unknown>,
      };
    }

    for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt++) {
      await sleep(Math.min(POLL_BASE_DELAY_MS * attempt, POLL_MAX_DELAY_MS));

      const getBody = await this.request("GET", getPath(taskId), undefined, operation);
      const polled = parse(envelopeSchema, getBody, operation);
      const polledTask = polled.tasks[0];
      if (!polledTask) {
        throw new VendorError("dataforseo", operation, "DataForSEO returned no task.", {
          retryable: false,
        });
      }
      assertTaskQueuedOrSucceeded(polledTask, operation);
      costCents += dollarsToCents(polledTask.cost ?? polled.cost ?? 0);

      if (polledTask.result) {
        return {
          taskId,
          rows: extractResultRows(polledTask.result),
          costCents,
          raw: getBody as Record<string, unknown>,
        };
      }
      // status_code 20000 with a null result means "queued/processing" for a
      // task-based endpoint — not an error, just not ready yet. Keep polling.
    }

    throw new VendorError(
      "dataforseo",
      operation,
      `DataForSEO task ${taskId} did not complete after ${MAX_POLL_ATTEMPTS} poll attempts.`,
      { code: "vendor_timeout", retryable: true, details: { taskId } },
    );
  }

  // ── HTTP ──────────────────────────────────────────────────────────────────

  private async request(
    method: "GET" | "POST",
    path: string,
    body: unknown,
    operation: string,
    /**
     * False only for a POST that creates a billable task (`runTaskBased`'s
     * initial call): the task may already have been created server-side
     * before a transient error reached us, so a blind retry would resubmit
     * (and re-bill) it. Every other call — GET, and the stateless "live"
     * POST queries — is safe to retry regardless of method.
     */
    retryable = true,
    attempt = 1,
  ): Promise<unknown> {
    const baseUrl = this.options.baseUrl ?? "https://api.dataforseo.com";
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );

    try {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          Authorization: this.authHeader,
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      });

      if (isTransportRetryableStatus(response.status)) {
        if (retryable && attempt <= MAX_TRANSPORT_RETRIES) {
          await sleep(transportRetryDelayMs(response, attempt));
          return this.request(method, path, body, operation, retryable, attempt + 1);
        }
        throw new VendorError(
          "dataforseo",
          operation,
          `DataForSEO returned ${response.status}${retryable ? " after retries" : ""}.`,
          {
            code: response.status === 429 ? "vendor_rate_limited" : "vendor_unavailable",
            httpStatus: response.status,
            retryable: true,
          },
        );
      }

      if (!response.ok) {
        const detail = await safeErrorDetail(response);
        throw new VendorError(
          "dataforseo",
          operation,
          `DataForSEO returned ${response.status}${detail ? ` (${detail})` : ""}.`,
          { httpStatus: response.status, retryable: false },
        );
      }

      return response.json();
    } catch (error) {
      if (error instanceof VendorError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new VendorError("dataforseo", operation, "DataForSEO request timed out.", {
          code: "vendor_timeout",
          retryable: true,
          cause: error,
        });
      }
      throw new VendorError("dataforseo", operation, "DataForSEO request failed.", {
        code: "vendor_unavailable",
        retryable: true,
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────

function envelope<T>(
  data: T,
  itemCount: number,
  costCents: number,
  vendorTaskId: string | null,
  raw: Record<string, unknown>,
): DataForSeoResult<T> {
  return { data, dataOrigin: "live", itemCount, costCents, vendorTaskId, raw };
}

function parse<T extends z.ZodTypeAny>(schema: T, body: unknown, operation: string): z.infer<T> {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new VendorError(
      "dataforseo",
      operation,
      `Unrecognised response shape from DataForSEO (${operation}).`,
      {
        retryable: false,
        details: { issues: result.error.issues.slice(0, 5).map((i) => i.path.join(".")) },
      },
    );
  }
  return result.data;
}

function chunk<T>(items: T[], size: number): T[][] {
  if (items.length === 0) return [[]];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** Runs `fn` over `items` with at most `limit` in flight at once. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    for (;;) {
      const index = cursor++;
      if (index >= items.length) return;
      results[index] = await fn(items[index]!, index);
    }
  }
  const workerCount = Math.max(1, Math.min(limit, items.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  return results;
}

/** Reads only the vendor's status message, never the echoed request body. */
async function safeErrorDetail(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as { status_message?: string; message?: string };
    return body.status_message ?? body.message ?? null;
  } catch {
    return null;
  }
}
