import "server-only";
import { z } from "zod";
import { VendorError, VendorNotConfiguredError } from "@/lib/errors";
import { isTransportRetryableStatus, sleep, transportRetryDelayMs } from "@/lib/vendor-retry";
import {
  sparktoroAffinityRowSchema,
  sparktoroAudienceSizeSchema,
  type CreateAudienceReportRequest,
  type CreateAudienceReportResult,
  type GetSectionRequest,
  type GetSectionResult,
  type SparktoroAdapter,
  type SparktoroResult,
} from "./types";

/**
 * Live SparkToro adapter.
 *
 * @unverified — written from the endpoint assumptions in docs/integrations.md
 * (ADR-011). SparkToro's public audience-research API is recent (per the
 * research report cited in docs/integrations.md) and has not been
 * re-verified against current official documentation in this environment.
 * Before enabling live mode: re-read SparkToro's current API documentation,
 * correct the paths and field names below, record the documentation date in
 * docs/integrations.md, and run this adapter against a sandbox account.
 *
 * A failed call throws (ADR-009) — there is no path from a live error to
 * mock data. Credit exhaustion and rate limiting are distinguished because
 * they call for different handling upstream: a rate limit is worth retrying
 * after a backoff, a credit exhaustion is not (retrying spends nothing new
 * and will only fail again until the account is topped up).
 */

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TRANSPORT_RETRIES = 3;

/** How many times a `processing` section is polled before giving up. */
const MAX_POLL_ATTEMPTS = 8;
const POLL_BASE_DELAY_MS = 3_000;
const POLL_MAX_DELAY_MS = 30_000;

const createReportResponseSchema = z.object({
  id: z.string(),
  status: z.enum(["queued", "processing", "ready"]).optional().default("processing"),
});

const sectionResponseSchema = z.object({
  status: z.enum(["ready", "processing"]),
  data: z
    .object({
      rows: z.array(sparktoroAffinityRowSchema).optional().default([]),
      audience_size: sparktoroAudienceSizeSchema.optional().nullable(),
    })
    .optional()
    .default({ rows: [] }),
  credits_used: z.number().optional().default(0),
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
      "/v1/audiences",
      { description: request.description, location: request.location ?? null },
      "createAudienceReport",
    );
    const parsed = parse(createReportResponseSchema, body, "createAudienceReport");
    const data: CreateAudienceReportResult = { reportId: parsed.id, status: parsed.status };
    return { data, dataOrigin: "live", creditsUsed: 0, raw: body as Record<string, unknown> };
  }

  async getSection(request: GetSectionRequest): Promise<SparktoroResult<GetSectionResult>> {
    const path = `/v1/audiences/${encodeURIComponent(request.reportId)}/sections/${request.section}`;

    for (let attempt = 1; attempt <= MAX_POLL_ATTEMPTS; attempt++) {
      const body = await this.request("GET", path, undefined, "getSection");
      const parsed = parse(sectionResponseSchema, body, "getSection");

      if (parsed.status === "ready") {
        const data: GetSectionResult = {
          status: "ready",
          section: request.section,
          rows: parsed.data.rows,
          audienceSize: parsed.data.audience_size ?? null,
        };
        return {
          data,
          dataOrigin: "live",
          creditsUsed: parsed.credits_used,
          raw: body as Record<string, unknown>,
        };
      }

      if (attempt < MAX_POLL_ATTEMPTS) {
        await sleep(Math.min(POLL_BASE_DELAY_MS * attempt, POLL_MAX_DELAY_MS));
      }
    }

    // Give up rather than poll forever; the job handler's own retry/backoff
    // (via a retryable error) picks this back up on the next attempt.
    throw new VendorError(
      "sparktoro",
      "getSection",
      `Section "${request.section}" for report ${request.reportId} was still processing after ${MAX_POLL_ATTEMPTS} poll attempts.`,
      { code: "vendor_timeout", retryable: true, details: { reportId: request.reportId } },
    );
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
