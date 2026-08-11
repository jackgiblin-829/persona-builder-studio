import "server-only";
import { z } from "zod";
import { VendorError, VendorNotConfiguredError } from "@/lib/errors";
import { sleep } from "@/lib/vendor-retry";
import type {
  CreateAudienceReportRequest,
  CreditBalance,
  GetSectionRequest,
  SparktoroAdapter,
  SparktoroResult,
  SparktoroSection,
} from "./types";

const ENDPOINTS: Record<SparktoroSection, string> = {
  demographics: "/v3/demographics",
  bios: "/v3/bios",
  websites: "/v3/websites",
  social_accounts: "/v3/social",
  networks: "/v3/networks",
  youtube: "/v3/youtube",
  podcasts: "/v3/podcasts",
  reddit: "/v3/reddit",
  press: "/v3/press",
  apps_and_ai_tools: "/v3/apps/ai",
  brands: "/v3/brands",
  keywords: "/v3/keywords",
  prompt_topics: "/v3/prompts",
  market_size: "/v3/tam",
};

const WARM_SECTIONS = new Set<SparktoroSection>(["reddit", "brands", "prompt_topics"]);
const MAX_WARM_ATTEMPTS = 12;

const creditsSchema = z.object({
  credits_remaining: z.number(),
  credits_expires_at: z.string().nullable(),
  is_trial: z.boolean(),
  low_balance: z.boolean(),
  rate_limit_per_min: z.number(),
});
const reportSchema = z.object({
  report_id: z.string(),
  status: z.literal("ready"),
  message: z.string().optional(),
});

type HttpResult = { status: number; body: unknown; retryAfterSeconds: number | null };

export class LiveSparktoroAdapter implements SparktoroAdapter {
  readonly mode = "live" as const;

  constructor(
    private readonly apiKey: string,
    private readonly options: { baseUrl?: string; timeoutMs?: number } = {},
  ) {
    if (!apiKey) throw new VendorNotConfiguredError("sparktoro", "construct");
  }

  async getCreditBalance(): Promise<SparktoroResult<CreditBalance>> {
    const result = await this.request("GET", "/v3/account/credits", undefined, "getCreditBalance");
    const parsed = creditsSchema.safeParse(result.body);
    if (!parsed.success) throw this.shapeError("getCreditBalance", parsed.error);
    const data = {
      creditsRemaining: parsed.data.credits_remaining,
      creditsExpiresAt: parsed.data.credits_expires_at,
      isTrial: parsed.data.is_trial,
      lowBalance: parsed.data.low_balance,
      rateLimitPerMinute: parsed.data.rate_limit_per_min,
    };
    return {
      data,
      dataOrigin: "live",
      creditsUsed: 0,
      raw: result.body as Record<string, unknown>,
    };
  }

  async createAudienceReport(request: CreateAudienceReportRequest) {
    const result = await this.request(
      "POST",
      "/v3/describe/create",
      { prompt: request.description, location: request.location },
      "createAudienceReport",
    );
    const parsed = reportSchema.safeParse(result.body);
    if (!parsed.success) throw this.shapeError("createAudienceReport", parsed.error);
    return {
      data: { reportId: parsed.data.report_id, status: parsed.data.status },
      dataOrigin: "live" as const,
      creditsUsed: 10,
      raw: result.body as Record<string, unknown>,
    };
  }

  async getSection(request: GetSectionRequest) {
    const path = `${ENDPOINTS[request.section]}?report_id=${encodeURIComponent(request.reportId)}`;
    let result: HttpResult | null = null;
    let attempt = 0;
    while (attempt < (WARM_SECTIONS.has(request.section) ? MAX_WARM_ATTEMPTS : 1)) {
      attempt++;
      result = await this.request("GET", path, undefined, `getSection:${request.section}`, true);
      if (result.status !== 202) break;
      const delaySeconds = result.retryAfterSeconds ?? 5;
      await sleep(Math.min(Math.max(delaySeconds, 0), 30) * 1000);
    }
    if (!result || result.status === 202) {
      throw new VendorError(
        "sparktoro",
        "getSection",
        `${request.section} was still preparing after ${attempt} attempts.`,
        {
          code: "vendor_timeout",
          retryable: true,
        },
      );
    }
    const envelope = z
      .object({
        data: z.unknown(),
        meta: z.object({ credits_charged: z.number().nullish() }).passthrough(),
      })
      .passthrough()
      .safeParse(result.body);
    if (!envelope.success) throw this.shapeError(`getSection:${request.section}`, envelope.error);
    const normalized = normalizeSection(request.section, envelope.data.data);
    return {
      data: { status: "ready" as const, section: request.section, normalized },
      dataOrigin: "live" as const,
      creditsUsed: envelope.data.meta.credits_charged ?? 0,
      raw: result.body as Record<string, unknown>,
      attempts: attempt,
    };
  }

  private async request(
    method: "GET" | "POST",
    path: string,
    body: unknown,
    operation: string,
    accept202 = false,
    transportAttempt = 1,
  ): Promise<HttpResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs ?? 120_000);
    try {
      const response = await fetch(
        `${this.options.baseUrl ?? "https://api.sparktoro.com"}${path}`,
        {
          method,
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
            Accept: "application/json",
            ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
          signal: controller.signal,
        },
      );
      const responseBody = await safeJson(response);
      const retryAfterSeconds = parseRetryAfter(response.headers.get("retry-after"));
      if (response.status === 202 && accept202)
        return { status: 202, body: responseBody, retryAfterSeconds };
      if (response.status === 402) {
        const detail = responseBody as { credits_required?: number; credits_remaining?: number };
        throw new VendorError(
          "sparktoro",
          operation,
          "SparkToro has insufficient credits for this request.",
          {
            code: "vendor_credit_exhausted",
            httpStatus: 402,
            retryable: false,
            details: detail,
          },
        );
      }
      if ((response.status === 429 || response.status >= 500) && transportAttempt <= 3) {
        await sleep((retryAfterSeconds ?? Math.min(2 ** transportAttempt, 20)) * 1000);
        return this.request(method, path, body, operation, accept202, transportAttempt + 1);
      }
      if (!response.ok) {
        const detail = responseBody as { message?: string };
        throw new VendorError(
          "sparktoro",
          operation,
          detail.message ?? `SparkToro returned ${response.status}.`,
          {
            code: response.status === 429 ? "vendor_rate_limited" : "vendor_unavailable",
            httpStatus: response.status,
            retryable: response.status === 429 || response.status >= 500,
          },
        );
      }
      return { status: response.status, body: responseBody, retryAfterSeconds };
    } catch (error) {
      if (error instanceof VendorError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new VendorError("sparktoro", operation, "SparkToro request timed out.", {
          code: "vendor_timeout",
          retryable: true,
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

  private shapeError(operation: string, error: z.ZodError) {
    return new VendorError(
      "sparktoro",
      operation,
      "SparkToro returned an unrecognized response shape.",
      {
        retryable: false,
        details: { issues: error.issues.slice(0, 5).map((issue) => issue.path.join(".")) },
      },
    );
  }
}

export function normalizeSection(
  section: SparktoroSection,
  data: unknown,
): Record<string, unknown> {
  if (section === "demographics" && data && typeof data === "object" && !Array.isArray(data)) {
    return { distributions: data as Record<string, unknown> };
  }
  if (section === "market_size" && data && typeof data === "object" && !Array.isArray(data)) {
    return data as Record<string, unknown>;
  }
  return { items: Array.isArray(data) ? data : data == null ? [] : [data] };
}

function parseRetryAfter(value: string | null) {
  if (!value) return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

async function safeJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}
