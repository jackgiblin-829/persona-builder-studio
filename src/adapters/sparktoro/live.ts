import "server-only";
import { z } from "zod";
import { VendorError, VendorNotConfiguredError } from "@/lib/errors";
import { isTransportRetryableStatus, sleep, transportRetryDelayMs } from "@/lib/vendor-retry";
import {
  sparktoroWebsiteRowSchema,
  VERIFIED_SPARKTORO_SECTIONS,
  type CreateAudienceReportRequest,
  type CreateAudienceReportResult,
  type GetSectionRequest,
  type GetSectionResult,
  type SparktoroAdapter,
  type SparktoroResult,
  type SparktoroSectionRow,
} from "./types";

/**
 * Live SparkToro adapter.
 *
 * Verified 2026-08-10 against https://sparktoro.com/api/docs: base URL
 * (`https://api.sparktoro.com`), `Authorization: Bearer` auth, and
 * `createAudienceReport` (`POST /v3/describe/create`) are all confirmed
 * correct or now fixed to match. See docs/integrations.md for the
 * verification date and sources.
 *
 * `getSection` is only implemented for `VERIFIED_SPARKTORO_SECTIONS`
 * (`demographics`, `websites` as of 2026-08-10) — those two real shapes were
 * checked against https://sparktoro.com/api/docs and are parsed per-section
 * below (`demographics`: generic `{name, value}` buckets; `websites`:
 * `{id, domain, affinity, category, visits, moz_da, moz_links, hidden_gem,
 * meta_description}`). Every other section in `SPARKTORO_SECTIONS` has its
 * own, likely different, real shape that has not been checked — `getSection`
 * throws for those rather than guess a mapping the docs don't confirm.
 * `/v3/tam` in particular is known to return a single object
 * (`estimated_population`, etc.), not a row array, so it must never be routed
 * through this row-array return type even once verified — it needs its own
 * method/type.
 *
 * A failed call throws (ADR-009) — there is no path from a live error to
 * mock data. Credit exhaustion and rate limiting are distinguished because
 * they call for different handling upstream: a rate limit is worth retrying
 * after a backoff, a credit exhaustion is not (retrying spends nothing new
 * and will only fail again until the account is topped up).
 */

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TRANSPORT_RETRIES = 3;

const createReportResponseSchema = z.object({
  report_id: z.string(),
  status: z.enum(["queued", "processing", "ready"]).optional().default("processing"),
  message: z.string().nullish(),
});

const sectionMetaSchema = z.object({
  credits_charged: z.number().nullish(),
  credits_remaining: z.number().nullish(),
  credits_expires_at: z.string().nullish(),
  low_balance: z.boolean().nullish(),
});

/** `{data: [...], meta: {...}}` — the envelope a flat-row section (e.g. `websites`) uses. */
function sectionEnvelopeSchema<T extends z.ZodTypeAny>(rowSchema: T) {
  return z.object({ data: z.array(rowSchema), meta: sectionMetaSchema });
}

/**
 * `/v3/demographics`'s real shape: `{data: {category: [{name,value}]}, meta}`
 * — a dict of category to buckets, not a flat array. Verified 2026-08-10.
 */
const demographicsEnvelopeSchema = z.object({
  data: z.record(z.string(), z.array(z.object({ name: z.string(), value: z.number() }))),
  meta: sectionMetaSchema,
});

export class LiveSparktoroAdapter implements SparktoroAdapter {
  readonly mode = "live" as const;

  constructor(
    private readonly apiKey: string,
    private readonly options: { baseUrl?: string; timeoutMs?: number } = {},
  ) {
    if (!apiKey) throw new VendorNotConfiguredError("sparktoro", "construct");
  }

  async createAudienceReport(
    request: CreateAudienceReportRequest,
  ): Promise<SparktoroResult<CreateAudienceReportResult>> {
    const body = await this.request(
      "POST",
      "/v3/describe/create",
      { prompt: request.description, location: request.location ?? undefined },
      "createAudienceReport",
    );
    const parsed = parse(createReportResponseSchema, body, "createAudienceReport");
    const data: CreateAudienceReportResult = { reportId: parsed.report_id, status: parsed.status };
    return { data, dataOrigin: "live", creditsUsed: 0, raw: body as Record<string, unknown> };
  }

  async getSection(request: GetSectionRequest): Promise<SparktoroResult<GetSectionResult>> {
    if (!VERIFIED_SPARKTORO_SECTIONS.includes(request.section as (typeof VERIFIED_SPARKTORO_SECTIONS)[number])) {
      // Matches ADR-009: a failed live call must never coerce into fabricated
      // data. This section's real shape has not been checked against current
      // docs, so guessing a mapping here would risk exactly that.
      throw new VendorError(
        "sparktoro",
        "getSection",
        `SparkToro's "${request.section}" section has not been verified against current API docs — refusing to guess a response mapping.`,
        { retryable: false, details: { reportId: request.reportId, section: request.section } },
      );
    }

    const path = `/v3/${request.section}?report_id=${encodeURIComponent(request.reportId)}`;
    const body = await this.request("GET", path, undefined, "getSection");

    let rows: SparktoroSectionRow[];
    let creditsCharged: number | null | undefined;

    if (request.section === "demographics") {
      const parsed = parse(demographicsEnvelopeSchema, body, "getSection");
      rows = Object.entries(parsed.data).flatMap(([category, buckets]) =>
        buckets.map((bucket) => ({ category, name: bucket.name, value: bucket.value })),
      );
      creditsCharged = parsed.meta.credits_charged;
    } else {
      const parsed = parse(sectionEnvelopeSchema(sparktoroWebsiteRowSchema), body, "getSection");
      rows = parsed.data;
      creditsCharged = parsed.meta.credits_charged;
    }

    const data: GetSectionResult = {
      status: "ready",
      section: request.section,
      rows,
      audienceSize: null,
    };
    return {
      data,
      dataOrigin: "live",
      creditsUsed: creditsCharged ?? 0,
      raw: body as Record<string, unknown>,
    };
  }

  // ── HTTP ──────────────────────────────────────────────────────────────────

  private async request(
    method: "GET" | "POST",
    path: string,
    body: unknown,
    operation: string,
    attempt = 1,
  ): Promise<unknown> {
    const baseUrl = this.options.baseUrl ?? "https://api.sparktoro.com";
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );

    try {
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          Accept: "application/json",
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: controller.signal,
      });

      if (response.status === 402) {
        // Credit exhaustion is never retried — retrying spends no new
        // credits and will only fail the same way again.
        throw new VendorError("sparktoro", operation, "SparkToro account is out of credits.", {
          code: "vendor_credit_exhausted",
          httpStatus: response.status,
          retryable: false,
        });
      }

      if (isTransportRetryableStatus(response.status)) {
        if (attempt <= MAX_TRANSPORT_RETRIES) {
          await sleep(transportRetryDelayMs(response, attempt));
          return this.request(method, path, body, operation, attempt + 1);
        }
        throw new VendorError(
          "sparktoro",
          operation,
          `SparkToro returned ${response.status} after retries.`,
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
          "sparktoro",
          operation,
          `SparkToro returned ${response.status}${detail ? ` (${detail})` : ""}.`,
          { httpStatus: response.status, retryable: false },
        );
      }

      return response.json();
    } catch (error) {
      if (error instanceof VendorError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new VendorError("sparktoro", operation, "SparkToro request timed out.", {
          code: "vendor_timeout",
          retryable: true,
          cause: error,
        });
      }
      throw new VendorError("sparktoro", operation, "SparkToro request failed.", {
        code: "vendor_unavailable",
        retryable: true,
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

function parse<T extends z.ZodTypeAny>(schema: T, body: unknown, operation: string): z.infer<T> {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new VendorError(
      "sparktoro",
      operation,
      `Unrecognised response shape from SparkToro (${operation}).`,
      {
        retryable: false,
        details: { issues: result.error.issues.slice(0, 5).map((i) => i.path.join(".")) },
      },
    );
  }
  return result.data;
}

async function safeErrorDetail(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as { message?: string; error?: string };
    return body.message ?? body.error ?? null;
  } catch {
    return null;
  }
}
