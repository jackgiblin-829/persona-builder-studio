import { z } from "zod";
import { DryRunUnsupportedError, VendorError, VendorNotConfiguredError } from "@/lib/errors";
import { isTransportRetryableStatus, sleep, transportRetryDelayMs } from "@/lib/vendor-retry";
import type {
  ProfoundAccountCitationsRow,
  ProfoundAccountReportQuery,
  ProfoundAccountSentimentRow,
  ProfoundAccountVisibilityRow,
  ProfoundAdapter,
  ProfoundAsset,
  ProfoundCategory,
  ProfoundCitationsRow,
  ProfoundCreateItemResult,
  ProfoundCreateRequest,
  ProfoundCreateResponse,
  ProfoundExistingPrompt,
  ProfoundItemOutcome,
  ProfoundModel,
  ProfoundOrganization,
  ProfoundPersona,
  ProfoundRegion,
  ProfoundResultQuery,
  ProfoundSentimentRow,
  ProfoundTag,
  ProfoundTopic,
  ProfoundVisibilityRow,
} from "./types";

/**
 * Live Profound adapter.
 *
 * Verified 2026-08-10 against https://docs.tryprofound.com (auth, and the
 * `/v1/org/*` taxonomy endpoints: models, categories, regions, domains,
 * category topics, category tags). See docs/integrations.md for the
 * verification date and sources.
 *
 * @unverified — everything else is still a guess and known, in some cases, to
 * be WRONG rather than merely unconfirmed:
 * - `getOrganizations` and `getPromptAnswers`: no matching endpoint exists in
 *   the current docs at all. These throw rather than call a made-up path.
 * - `getOrganizationPersonas`/`getCategoryPersonas`: the real endpoint is
 *   `GET /v1/org/personas` (org-scoped only, no category filter) and returns
 *   a rich `PersonaProfile` (behavior/employment/demographics), not the flat
 *   `{id, name, description, categoryId}` this file's `ProfoundPersona` type
 *   assumes. Left unchanged pending a type redesign — do not trust this path.
 * - `createPrompts`: the real response has no per-item status/outcome or
 *   client-reference echo — it returns aggregate counts and a flat list of
 *   created prompt objects. This file's idempotency/outcome-tracking model
 *   (`normalizeOutcome`, per-item `client_reference` matching) cannot be
 *   satisfied by the real API and needs a redesign, not a path fix. Moot in
 *   practice per ADR-013 (deployment is export-only; nothing in `src/` calls
 *   this) but left as a known, documented limitation rather than silently
 *   assumed correct.
 *
 * `queryVisibility`/`queryCitations`/`querySentiment` and the account
 * variants were rewritten 2026-08-10 against the real, verified
 * `POST /v2/reports/{visibility,citations,sentiment}` endpoints — see
 * docs/integrations.md for sources. These are category-scoped, bucketed by
 * whatever `group_by` dimensions are requested (never a per-execution "run"),
 * and every returned field is a direct read of a real vendor field — nothing
 * here is a `run_id`, `mention_count`, `executions`, `brand_mentioned`, or
 * raw answer text, because none of those exist in the real API.
 *
 * Two behaviours here are not negotiable regardless of what the documentation
 * turns out to say:
 *
 * 1. **A failed call throws** (ADR-009). There is no path from a live error to
 *    mock data, because a deployment that quietly wrote nothing while reporting
 *    success is the worst outcome this product can produce.
 * 2. **An unhonoured dry run stops the deployment.** If the response does not
 *    confirm that it validated rather than wrote, this throws
 *    `DryRunUnsupportedError` rather than assuming the flag was respected.
 */

const DEFAULT_TIMEOUT_MS = 60_000;
const PAGE_LIMIT = 200;
/** A category with more prompts than this is a configuration problem, not a page. */
const MAX_PAGES = 50;
/** Documented max `limit` for `/v2/reports/*` endpoints (docs.tryprofound.com). */
const REPORT_PAGE_LIMIT = 50;

export class LiveProfoundAdapter implements ProfoundAdapter {
  readonly mode = "live" as const;

  constructor(
    private readonly apiKey: string,
    private readonly options: { baseUrl?: string; timeoutMs?: number } = {},
  ) {
    if (!apiKey) throw new VendorNotConfiguredError("profound", "construct");
  }

  async getOrganizations(): Promise<ProfoundOrganization[]> {
    // No documented endpoint lists organizations directly — the org is
    // implicit in the API key, and surfaces only as a nested {id, name} on
    // category/domain/persona responses. Guessing a path here would silently
    // fail or return the wrong data, so this is an explicit unsupported call.
    throw new VendorError(
      "profound",
      "getOrganizations",
      "Profound has no documented endpoint for listing organizations. The organization is implicit in the API key.",
      { retryable: false },
    );
  }

  async getCategories(): Promise<ProfoundCategory[]> {
    const body = await this.get("/v1/org/categories", "getCategories");
    return parse(listOf(categorySchema), body, "getCategories").map((row) => ({
      id: row.id,
      name: row.name,
      // The real API has no brand/domain concept on a category.
      brandName: null,
      domain: null,
    }));
  }

  async getRegions(): Promise<ProfoundRegion[]> {
    const body = await this.get("/v1/org/regions", "getRegions");
    return parse(listOf(namedResourceSchema), body, "getRegions").map((row) => ({
      code: row.id,
      name: row.name,
    }));
  }

  async getModels(): Promise<ProfoundModel[]> {
    const body = await this.get("/v1/org/models", "getModels");
    return parse(listOf(namedResourceSchema), body, "getModels").map((row) => ({
      id: row.id,
      name: row.name,
      // The real API has no separate platform slug; id doubles as the closest
      // available identifier (e.g. "chatgpt", "perplexity").
      platform: row.id,
    }));
  }

  async getAssets(): Promise<ProfoundAsset[]> {
    const body = await this.get("/v1/org/domains", "getAssets");
    return parse(listOf(domainSchema), body, "getAssets").map((row) => ({
      id: row.id,
      name: row.name,
      // `name` on a domain resource is the domain string itself.
      domain: row.name,
    }));
  }

  async getCategoryTopics(categoryId: string): Promise<ProfoundTopic[]> {
    const body = await this.get(
      `/v1/org/categories/${encodeURIComponent(categoryId)}/topics`,
      "getCategoryTopics",
    );
    return parse(listOf(topicSchema), body, "getCategoryTopics").map((row) => ({
      id: row.id,
      name: row.name,
      categoryId,
    }));
  }

  async getCategoryTags(categoryId: string): Promise<ProfoundTag[]> {
    const body = await this.get(
      `/v1/org/categories/${encodeURIComponent(categoryId)}/tags`,
      "getCategoryTags",
    );
    return parse(listOf(namedResourceSchema), body, "getCategoryTags").map((row) => ({
      name: row.name,
      // The real API reports no per-tag prompt count.
      promptCount: 0,
    }));
  }

  async getOrganizationPersonas(_organizationId: string): Promise<ProfoundPersona[]> {
    // @unverified — the real endpoint (`GET /v1/org/personas`) is org-scoped
    // and returns a rich PersonaProfile (behavior/employment/demographics),
    // not this type's flat {id, name, description, categoryId}. Needs a type
    // redesign before this can call the real endpoint correctly.
    throw new VendorError(
      "profound",
      "getOrganizationPersonas",
      "Profound's persona response shape does not match this product's ProfoundPersona type yet — needs a mapping redesign before going live.",
      { retryable: false },
    );
  }

  async getCategoryPersonas(_categoryId: string): Promise<ProfoundPersona[]> {
    // @unverified — see getOrganizationPersonas. The real endpoint also has
    // no category filter; it would need to be built from `/v1/org/personas`
    // filtered client-side by the category nested in each row.
    throw new VendorError(
      "profound",
      "getCategoryPersonas",
      "Profound's persona response shape does not match this product's ProfoundPersona type yet — needs a mapping redesign before going live.",
      { retryable: false },
    );
  }

  async listPrompts(categoryId: string): Promise<ProfoundExistingPrompt[]> {
    const out: ProfoundExistingPrompt[] = [];
    let cursor: string | null = null;

    for (let page = 0; page < MAX_PAGES; page++) {
      const query = new URLSearchParams({ limit: String(PAGE_LIMIT) });
      if (cursor) query.set("cursor", cursor);

      const body = await this.get(
        `/v1/org/categories/${encodeURIComponent(categoryId)}/prompts?${query.toString()}`,
        "listPrompts",
      );
      const page_ = parse(promptPageSchema, body, "listPrompts");

      for (const row of page_.data) {
        out.push({
          id: row.id,
          text: row.prompt,
          topic: row.topic?.name ?? null,
          tags: (row.tags ?? []).map((tag) => tag.name),
          personaId: row.personas?.[0]?.id ?? null,
          regions: (row.regions ?? []).map((region) => region.name),
          platforms: (row.platforms ?? []).map((platform) => platform.name),
          status: row.status,
        });
      }

      cursor = page_.info.next_cursor ?? null;
      if (!cursor) return out;
    }

    throw new VendorError(
      "profound",
      "listPrompts",
      `Prompt listing did not terminate after ${MAX_PAGES} pages.`,
      { retryable: false },
    );
  }

  async createPrompts(request: ProfoundCreateRequest): Promise<ProfoundCreateResponse> {
    const body = await this.post(
      `/v1/org/categories/${encodeURIComponent(request.categoryId)}/prompts`,
      {
        dry_run: request.dryRun,
        prompts: request.prompts,
      },
      "createPrompts",
      request.dryRun,
    );

    const parsed = parse(createResponseSchema, body, "createPrompts");

    // The gate. If we asked for a validation and the response does not say it
    // validated, we cannot tell whether prompts were written — so we stop and
    // say so, rather than guessing and possibly deploying twice.
    if (request.dryRun && parsed.dry_run !== true) {
      throw new DryRunUnsupportedError(
        "Profound did not confirm the request was a dry run. Deployment stopped: the response cannot be trusted to mean nothing was created.",
      );
    }

    const items: ProfoundCreateItemResult[] = (parsed.results ?? []).map((row) => ({
      clientReference: row.client_reference,
      outcome: normalizeOutcome(row.status, request.dryRun),
      profoundPromptId: row.prompt_id ?? null,
      ...(row.error_code ? { errorCode: row.error_code } : {}),
      ...(row.error_message ? { errorMessage: row.error_message } : {}),
      ...(typeof row.retryable === "boolean" ? { retryable: row.retryable } : {}),
    }));

    const returned = new Set(items.map((item) => item.clientReference));
    const missing = request.prompts.filter((p) => !returned.has(p.client_reference));
    if (missing.length > 0) {
      // A silent omission is indistinguishable from a silent success. Treat it
      // as a retryable per-item failure so the receipt records it as unknown
      // rather than as created.
      for (const prompt of missing) {
        items.push({
          clientReference: prompt.client_reference,
          outcome: "failed",
          profoundPromptId: null,
          errorCode: "missing_from_response",
          errorMessage: "Profound returned no result for this prompt.",
          retryable: true,
        });
      }
    }

    return { dryRun: request.dryRun, items, raw: body as Record<string, unknown> };
  }

  // ── Reporting (§25) ────────────────────────────────────────────────────────
  //
  // All three calls are category-scoped, not prompt-list-scoped, but the real
  // API's generic `filter` tree accepts `{field: "prompt", op: "in", value:
  // [...]}` — verified live 2026-08-10, confirmed server-applied (echoed back
  // in the response's `info.filter`). Without it, a category with hundreds of
  // prompts (common — verified against a real 917-prompt category) would
  // require paginating the *entire* category's results before filtering
  // client-side down to the handful this product tracks, which does not
  // terminate within any sane page cap. The client-side filter below stays as
  // a defensive backstop, not the primary scoping mechanism. Every field
  // mapped below is a direct read of a real vendor field.

  async queryVisibility(query: ProfoundResultQuery): Promise<ProfoundVisibilityRow[]> {
    const rows = await this.paginatedReportsPost(
      "/v2/reports/visibility",
      {
        category_id: query.categoryId,
        start_date: query.startDate,
        end_date: query.endDate,
        group_by: ["date", "model", "topic", "region", "persona", "prompt"],
        scope: query.competitorAssets && query.competitorAssets.length > 0 ? "all" : "owned",
        filter: { field: "prompt", op: "in", value: query.profoundPromptIds },
      },
      visibilityRowSchema,
      "queryVisibility",
    );

    const promptIds = new Set(query.profoundPromptIds);
    return rows
      .filter((row) => row.prompt?.id && promptIds.has(row.prompt.id))
      .map((row) => ({
        profoundPromptId: row.prompt?.id ?? null,
        bucketDate: row.date ?? query.startDate,
        modelId: row.model?.id ?? "",
        model: row.model?.name ?? null,
        topicId: row.topic?.id ?? null,
        topic: row.topic?.name ?? null,
        regionId: row.region?.id ?? null,
        region: row.region?.name ?? null,
        personaId: row.persona?.id ?? null,
        profoundPersona: row.persona?.name ?? null,
        asset: row.asset?.name ?? "",
        assetOwned: row.asset?.owned ?? null,
        rank: row.rank ?? null,
        visibilityScore: row.visibility_score ?? null,
        shareOfVoice: row.share_of_voice ?? null,
        averagePosition: row.average_position ?? null,
      }));
  }

  async queryCitations(query: ProfoundResultQuery): Promise<ProfoundCitationsRow[]> {
    // Citations' group_by is far more restrictive than visibility's: the real
    // API only accepts one dimension (or topic+model), optionally plus date —
    // verified live 2026-08-10 (a wider request 422s with "Unsupported
    // group_by combination"). "prompt" is the one dimension this product
    // needs for per-prompt attribution, so model/topic/region/persona are not
    // available simultaneously here — they stay null on the mapped row.
    const rows = await this.paginatedReportsPost(
      "/v2/reports/citations",
      {
        category_id: query.categoryId,
        start_date: query.startDate,
        end_date: query.endDate,
        entity: "domain",
        group_by: ["prompt", "date"],
        filter: { field: "prompt", op: "in", value: query.profoundPromptIds },
      },
      citationsRowSchema,
      "queryCitations",
    );

    const promptIds = new Set(query.profoundPromptIds);
    return rows
      .filter((row) => row.prompt?.id && promptIds.has(row.prompt.id) && row.domain)
      .map((row) => ({
        profoundPromptId: row.prompt?.id ?? null,
        bucketDate: row.date ?? query.startDate,
        domain: row.domain as string,
        count: row.count ?? 0,
        citationShare: row.citation_share ?? null,
        rank: row.rank ?? null,
      }));
  }

  async querySentiment(query: ProfoundResultQuery): Promise<ProfoundSentimentRow[]> {
    if (!query.asset) {
      throw new VendorError(
        "profound",
        "querySentiment",
        "Sentiment reporting requires an asset (brand name) to analyze.",
        { retryable: false },
      );
    }
    // Sentiment's group_by is capped at 2 dimensions (docs.tryprofound.com),
    // so a single call cannot also break out by model/topic/region — this
    // trades per-model sentiment granularity for prompt-level attribution.
    const rows = await this.paginatedReportsPost(
      "/v2/reports/sentiment",
      {
        category_id: query.categoryId,
        asset: query.asset,
        start_date: query.startDate,
        end_date: query.endDate,
        group_by: ["date", "prompt"],
        filter: { field: "prompt", op: "in", value: query.profoundPromptIds },
      },
      sentimentRowSchema,
      "querySentiment",
    );

    const promptIds = new Set(query.profoundPromptIds);
    return rows
      .filter((row) => row.prompt?.id && promptIds.has(row.prompt.id))
      .map((row) => ({
        profoundPromptId: row.prompt?.id ?? null,
        asset: query.asset as string,
        bucketDate: row.date ?? null,
        modelId: row.model?.id ?? null,
        model: row.model?.name ?? null,
        topicId: row.topic?.id ?? null,
        topic: row.topic?.name ?? null,
        regionId: row.region?.id ?? null,
        region: row.region?.name ?? null,
        personaId: row.persona?.id ?? null,
        profoundPersona: row.persona?.name ?? null,
        tag: row.tag?.name ?? null,
        theme: row.theme?.name ?? null,
        claim: row.claim?.name ?? null,
        profoundRun: row.run?.name ?? null,
        competitor: row.competitor?.name ?? null,
        positiveSentiment: row.positive_sentiment ?? null,
        negativeSentiment: row.negative_sentiment ?? null,
        occurrence: row.occurrence ?? null,
        citedWebsites: row.cited_websites ?? [],
        rank: row.rank ?? null,
      }));
  }

  // ── Account-level reporting ─────────────────────────────────────────────
  //
  // Same real endpoints as above, grouped by (date, topic) only and without
  // the prompt-id filter — this is the brand's whole tracked category, not
  // this product's own deployed prompts, used as an evidence source (§ account
  // evidence pull) rather than for tracking specific prompts.

  async queryAccountVisibility(
    query: ProfoundAccountReportQuery,
  ): Promise<ProfoundAccountVisibilityRow[]> {
    const rows = await this.paginatedReportsPost(
      "/v2/reports/visibility",
      {
        category_id: query.categoryId,
        start_date: query.startDate,
        end_date: query.endDate,
        group_by: ["date", "topic"],
        scope: "owned",
      },
      visibilityRowSchema,
      "queryAccountVisibility",
    );
    return rows
      .filter((row) => row.topic?.name && row.date)
      .map((row) => ({
        topic: row.topic?.name as string,
        date: row.date as string,
        visibilityScore: row.visibility_score ?? 0,
        shareOfVoice: row.share_of_voice ?? 0,
      }));
  }

  async queryAccountCitations(
    query: ProfoundAccountReportQuery,
  ): Promise<ProfoundAccountCitationsRow[]> {
    const rows = await this.paginatedReportsPost(
      "/v2/reports/citations",
      {
        category_id: query.categoryId,
        start_date: query.startDate,
        end_date: query.endDate,
        entity: "domain",
        group_by: ["date", "topic"],
      },
      citationsRowSchema,
      "queryAccountCitations",
    );

    // The API returns one row per (topic, date, domain); aggregate to one row
    // per (topic, date) since that's this account-evidence signal's grain.
    const byKey = new Map<string, ProfoundAccountCitationsRow>();
    for (const row of rows) {
      if (!row.topic?.name || !row.date) continue;
      const key = `${row.topic.name}::${row.date}`;
      const existing = byKey.get(key) ?? {
        topic: row.topic.name,
        date: row.date,
        citationCount: 0,
        citationShare: null,
        topDomains: [],
      };
      existing.citationCount += row.count ?? 0;
      if (row.domain && !existing.topDomains.includes(row.domain)) {
        existing.topDomains.push(row.domain);
      }
      byKey.set(key, existing);
    }
    return [...byKey.values()];
  }

  async queryAccountSentiment(
    query: ProfoundAccountReportQuery,
  ): Promise<ProfoundAccountSentimentRow[]> {
    if (!query.asset) {
      throw new VendorError(
        "profound",
        "queryAccountSentiment",
        "Sentiment reporting requires an asset (brand name) to analyze.",
        { retryable: false },
      );
    }
    const rows = await this.paginatedReportsPost(
      "/v2/reports/sentiment",
      {
        category_id: query.categoryId,
        asset: query.asset,
        start_date: query.startDate,
        end_date: query.endDate,
        group_by: ["date", "topic"],
      },
      sentimentRowSchema,
      "queryAccountSentiment",
    );
    return rows
      .filter((row) => row.topic?.name && row.date)
      .map((row) => ({
        topic: row.topic?.name as string,
        date: row.date as string,
        positiveSentiment: row.positive_sentiment ?? null,
        negativeSentiment: row.negative_sentiment ?? null,
      }));
  }

  /** Pages a `/v2/reports/*` POST endpoint via `info.next_cursor` until exhausted. */
  private async paginatedReportsPost<T extends z.ZodTypeAny>(
    path: string,
    baseBody: Record<string, unknown>,
    rowSchema: T,
    operation: string,
  ): Promise<z.infer<T>[]> {
    const out: z.infer<T>[] = [];
    let cursor: string | null = null;

    for (let page = 0; page < MAX_PAGES; page++) {
      const body = await this.post(
        path,
        { ...baseBody, limit: REPORT_PAGE_LIMIT, ...(cursor ? { cursor } : {}) },
        operation,
        false,
      );
      const parsed = parse(reportEnvelopeSchema(rowSchema), body, operation);
      out.push(...parsed.data);
      cursor = parsed.info.next_cursor ?? null;
      if (!cursor) return out;
    }

    throw new VendorError(
      "profound",
      operation,
      `Report pagination did not terminate after ${MAX_PAGES} pages.`,
      { retryable: false },
    );
  }

  // ── HTTP ──────────────────────────────────────────────────────────────────

  private get(path: string, operation: string): Promise<unknown> {
    return this.request("GET", path, undefined, operation, false);
  }

  private post(
    path: string,
    body: unknown,
    operation: string,
    isDryRun: boolean,
  ): Promise<unknown> {
    return this.request("POST", path, body, operation, isDryRun);
  }

  private async request(
    method: "GET" | "POST",
    path: string,
    body: unknown,
    operation: string,
    isDryRun: boolean,
    attempt = 1,
  ): Promise<unknown> {
    const baseUrl = this.options.baseUrl ?? "https://api.tryprofound.com";
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );

    try {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          "X-API-Key": this.apiKey,
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      });

      if (isTransportRetryableStatus(response.status)) {
        // A create is not retried at the transport level even when the status
        // looks transient: the request may have been applied before the error,
        // and a blind retry would create the same prompts twice. Per-item retry
        // happens above, guarded by the idempotency index (ADR-007).
        if (method === "GET" && attempt <= 3) {
          await sleep(transportRetryDelayMs(response, attempt));
          return this.request(method, path, body, operation, isDryRun, attempt + 1);
        }
        throw new VendorError("profound", operation, `Profound returned ${response.status}.`, {
          code: response.status === 429 ? "vendor_rate_limited" : "vendor_unavailable",
          httpStatus: response.status,
          retryable: true,
        });
      }

      if (!response.ok) {
        const detail = await safeErrorCode(response);

        // A rejected dry-run parameter is the documented "cannot preview" case
        // and must stop the deployment rather than degrade into a live write.
        if (isDryRun && response.status === 400 && mentionsDryRun(detail)) {
          throw new DryRunUnsupportedError();
        }

        throw new VendorError(
          "profound",
          operation,
          `Profound returned ${response.status}${detail ? ` (${detail})` : ""}.`,
          { httpStatus: response.status, retryable: false },
        );
      }

      return response.json();
    } catch (error) {
      if (error instanceof VendorError || error instanceof DryRunUnsupportedError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new VendorError("profound", operation, "Profound request timed out.", {
          code: "vendor_timeout",
          retryable: true,
          cause: error,
        });
      }
      throw new VendorError("profound", operation, "Profound request failed.", {
        code: "vendor_unavailable",
        retryable: true,
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

// ── Response contracts ──────────────────────────────────────────────────────

/** `{id, name}` — Profound's generic named-reference shape (models, regions, tags, ...). */
const namedResourceSchema = z.object({ id: z.string(), name: z.string() });
const categorySchema = z.object({
  id: z.string(),
  name: z.string(),
  internal_name: z.string().nullish(),
});
const domainSchema = z.object({ id: z.string(), name: z.string() });
const topicSchema = z.object({ id: z.string(), name: z.string() });

const existingPromptSchema = z.object({
  id: z.string(),
  prompt: z.string(),
  topic: namedResourceSchema.nullish(),
  tags: z.array(namedResourceSchema).nullish(),
  regions: z.array(namedResourceSchema).nullish(),
  platforms: z.array(namedResourceSchema).nullish(),
  personas: z.array(namedResourceSchema).nullish(),
  status: z.string(),
});

const promptPageSchema = z.object({
  info: z.object({
    total_rows: z.number().nullish(),
    limit: z.number().nullish(),
    next_cursor: z.string().nullish(),
  }),
  data: z.array(existingPromptSchema),
});

/** `{id, name}` reference on a v2 report row (model/topic/region/prompt/persona/tag/theme/claim/run/competitor). */
const reportDimensionSchema = z
  .object({ id: z.string().nullish(), name: z.string().nullish() })
  .nullish();

/** `{info: {..., next_cursor}, data: [...]}` — the envelope every `/v2/reports/*` endpoint shares. */
function reportEnvelopeSchema<T extends z.ZodTypeAny>(rowSchema: T) {
  return z.object({
    info: z.object({ next_cursor: z.string().nullish() }).passthrough(),
    data: z.array(rowSchema),
  });
}

const visibilityRowSchema = z.object({
  asset: z.object({ name: z.string().nullish(), owned: z.boolean().nullish() }).nullish(),
  rank: z.number().nullish(),
  date: z.string().nullish(),
  model: reportDimensionSchema,
  topic: reportDimensionSchema,
  region: reportDimensionSchema,
  prompt: reportDimensionSchema,
  persona: reportDimensionSchema,
  visibility_score: z.number().nullish(),
  share_of_voice: z.number().nullish(),
  average_position: z.number().nullish(),
});

const citationsRowSchema = z.object({
  domain: z.string().nullish(),
  page: z.string().nullish(),
  rank: z.number().nullish(),
  date: z.string().nullish(),
  model: reportDimensionSchema,
  topic: reportDimensionSchema,
  region: reportDimensionSchema,
  persona: reportDimensionSchema,
  prompt: reportDimensionSchema,
  count: z.number().nullish(),
  citation_share: z.number().nullish(),
  first_cited_at: z.string().nullish(),
});

const sentimentRowSchema = z.object({
  date: z.string().nullish(),
  model: reportDimensionSchema,
  topic: reportDimensionSchema,
  region: reportDimensionSchema,
  prompt: reportDimensionSchema,
  persona: reportDimensionSchema,
  tag: reportDimensionSchema,
  theme: reportDimensionSchema,
  claim: reportDimensionSchema,
  run: reportDimensionSchema,
  competitor: reportDimensionSchema,
  positive_sentiment: z.number().nullish(),
  negative_sentiment: z.number().nullish(),
  occurrence: z.number().nullish(),
  cited_websites: z.array(z.string()).nullish(),
  rank: z.number().nullish(),
});

const createResponseSchema = z.object({
  dry_run: z.boolean().nullish(),
  results: z
    .array(
      z.object({
        client_reference: z.string(),
        status: z.string(),
        prompt_id: z.string().nullish(),
        error_code: z.string().nullish(),
        error_message: z.string().nullish(),
        retryable: z.boolean().nullish(),
      }),
    )
    .nullish(),
});

/** Accepts either a bare array or `{ data: [...] }`, which vendors mix freely. */
function listOf<T extends z.ZodTypeAny>(item: T) {
  return z.union([z.array(item), z.object({ data: z.array(item) })]).transform((value) => {
    return Array.isArray(value) ? value : value.data;
  });
}

function parse<T extends z.ZodTypeAny>(schema: T, body: unknown, operation: string): z.infer<T> {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new VendorError(
      "profound",
      operation,
      `Unrecognised response shape from Profound (${operation}).`,
      {
        retryable: false,
        // The issue paths describe our expectations, not the vendor's payload,
        // so they carry no customer data.
        details: { issues: result.error.issues.slice(0, 5).map((i) => i.path.join(".")) },
      },
    );
  }
  return result.data;
}

/**
 * Maps the vendor's status vocabulary onto ours.
 *
 * Anything unrecognised becomes `failed`, never `created`. Guessing in the
 * optimistic direction would record a Profound prompt id we do not have.
 */
function normalizeOutcome(status: string, isDryRun: boolean): ProfoundItemOutcome {
  const value = status.toLowerCase();
  if (value === "duplicate" || value === "already_exists") return "duplicate";
  if (value === "created" || value === "ok" || value === "success") {
    return isDryRun ? "validated" : "created";
  }
  if (value === "validated" || value === "valid" || value === "would_create") return "validated";
  return "failed";
}

function mentionsDryRun(detail: string | null): boolean {
  return detail !== null && /dry[_\s-]?run/i.test(detail);
}

/** Reads only the vendor error code, never the echoed request body. */
async function safeErrorCode(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as {
      error?: { code?: string; type?: string; message?: string };
      code?: string;
      message?: string;
    };
    return body.error?.code ?? body.error?.type ?? body.code ?? body.error?.message ?? null;
  } catch {
    return null;
  }
}
