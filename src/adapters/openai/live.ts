import "server-only";
import { z } from "zod";
import { VendorError, VendorNotConfiguredError } from "@/lib/errors";
import {
  EMBEDDING_DIMENSIONS,
  type EmbeddingRequest,
  type EmbeddingResult,
  type OpenAIAdapter,
  type StructuredRequest,
  type StructuredResult,
} from "./types";

/**
 * Live OpenAI adapter.
 *
 * @unverified — written from the endpoint assumptions recorded in
 * docs/integrations.md. No live call has been executed and the current official
 * documentation has not been checked in this environment. Verify the Responses
 * API request shape and the structured-output format field, record the
 * documentation date in docs/integrations.md, and run the contract test against
 * a sandbox key before enabling live mode in production.
 *
 * Never falls back to mock data on failure (ADR-009).
 */

const DEFAULT_TIMEOUT_MS = 120_000;

/** Indicative per-million-token prices in cents, used for cost estimates only. */
const PRICE_TABLE: Record<string, { inputCentsPerMTok: number; outputCentsPerMTok: number }> = {
  "gpt-4.1": { inputCentsPerMTok: 200, outputCentsPerMTok: 800 },
  "gpt-4.1-mini": { inputCentsPerMTok: 40, outputCentsPerMTok: 160 },
  "text-embedding-3-small": { inputCentsPerMTok: 2, outputCentsPerMTok: 0 },
};

export class LiveOpenAIAdapter implements OpenAIAdapter {
  readonly mode = "live" as const;

  constructor(
    private readonly apiKey: string,
    private readonly models: { economical: string; reasoning: string; embedding: string },
    private readonly options: { baseUrl?: string; timeoutMs?: number } = {},
  ) {
    if (!apiKey) throw new VendorNotConfiguredError("openai", "construct");
  }

  private modelFor(tier: StructuredRequest<unknown>["modelTier"]): string {
    return tier === "reasoning" ? this.models.reasoning : this.models.economical;
  }

  async generateStructured<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const started = Date.now();
    const modelId = this.modelFor(request.modelTier);
    const maxRetries = request.maxRetries ?? 2;

    let lastSchemaError: string | null = null;

    for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
      const userContent = lastSchemaError
        ? `${request.user}\n\nYour previous response failed schema validation:\n${lastSchemaError}\nReturn corrected JSON that satisfies the schema exactly.`
        : request.user;

      const body = {
        model: modelId,
        input: [
          { role: "system", content: request.system },
          { role: "user", content: userContent },
        ],
        text: {
          format: {
            type: "json_schema",
            name: request.schemaName,
            schema: request.jsonSchema,
            strict: true,
          },
        },
      };

      const response = await this.request("/v1/responses", body, "generateStructured");
      const payload = responseEnvelope.safeParse(response);
      if (!payload.success) {
        throw new VendorError(
          "openai",
          "generateStructured",
          "Unrecognised response shape from the Responses API.",
          {
            retryable: false,
          },
        );
      }

      const text = extractOutputText(payload.data);
      if (text === null) {
        throw new VendorError(
          "openai",
          "generateStructured",
          "Response contained no output text.",
          {
            retryable: true,
          },
        );
      }

      let candidate: unknown;
      try {
        candidate = JSON.parse(text);
      } catch {
        lastSchemaError = "Response was not valid JSON.";
        continue;
      }

      const parsed = request.schema.safeParse(candidate);
      if (parsed.success) {
        const usage = payload.data.usage;
        const tokensIn = usage?.input_tokens ?? 0;
        const tokensOut = usage?.output_tokens ?? 0;
        return {
          data: parsed.data,
          modelProvider: "openai",
          modelId: payload.data.model ?? modelId,
          dataOrigin: "live",
          tokensIn,
          tokensOut,
          costCents: estimateCost(modelId, tokensIn, tokensOut),
          attempts: attempt,
          durationMs: Date.now() - started,
          raw: response as Record<string, unknown>,
        };
      }

      lastSchemaError = parsed.error.issues
        .slice(0, 8)
        .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
        .join("; ");
    }

    throw new VendorError(
      "openai",
      "generateStructured",
      `Model output failed schema validation after ${maxRetries + 1} attempts: ${lastSchemaError}`,
      { code: "schema_validation" as never, retryable: false },
    );
  }

  async embed(request: EmbeddingRequest): Promise<EmbeddingResult> {
    const model = request.model ?? this.models.embedding;
    const response = await this.request(
      "/v1/embeddings",
      { model, input: request.texts, dimensions: EMBEDDING_DIMENSIONS },
      "embed",
    );

    const parsed = embeddingEnvelope.safeParse(response);
    if (!parsed.success) {
      throw new VendorError(
        "openai",
        "embed",
        "Unrecognised response shape from the embeddings API.",
        {
          retryable: false,
        },
      );
    }

    const ordered = [...parsed.data.data].sort((a, b) => a.index - b.index);
    if (ordered.length !== request.texts.length) {
      throw new VendorError(
        "openai",
        "embed",
        `Expected ${request.texts.length} embeddings, received ${ordered.length}.`,
        { retryable: true },
      );
    }

    const tokensIn = parsed.data.usage?.prompt_tokens ?? 0;
    return {
      embeddings: ordered.map((item) => item.embedding),
      modelId: parsed.data.model ?? model,
      dimensions: ordered[0]?.embedding.length ?? EMBEDDING_DIMENSIONS,
      dataOrigin: "live",
      tokensIn,
      costCents: estimateCost(model, tokensIn, 0),
    };
  }

  private async request(
    path: string,
    body: unknown,
    operation: string,
    attempt = 1,
  ): Promise<unknown> {
    const baseUrl = this.options.baseUrl ?? "https://api.openai.com";
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      this.options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );

    try {
      const response = await fetch(`${baseUrl}${path}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (response.status === 429 || response.status >= 500) {
        // Retry transient conditions with backoff; never degrade to mock.
        if (attempt <= 3) {
          const retryAfter = Number(response.headers.get("retry-after"));
          const delayMs =
            Number.isFinite(retryAfter) && retryAfter > 0
              ? retryAfter * 1000
              : Math.min(2 ** attempt * 1000, 20_000);
          await sleep(delayMs);
          return this.request(path, body, operation, attempt + 1);
        }
        throw new VendorError(
          "openai",
          operation,
          `OpenAI returned ${response.status} after retries.`,
          {
            code: response.status === 429 ? "vendor_rate_limited" : "vendor_unavailable",
            httpStatus: response.status,
            retryable: true,
          },
        );
      }

      if (!response.ok) {
        // The body may echo request content; only the status and code are kept.
        const detail = await safeErrorCode(response);
        throw new VendorError(
          "openai",
          operation,
          `OpenAI returned ${response.status}${detail ? ` (${detail})` : ""}.`,
          {
            httpStatus: response.status,
            retryable: false,
          },
        );
      }

      return response.json();
    } catch (error) {
      if (error instanceof VendorError) throw error;
      if (error instanceof Error && error.name === "AbortError") {
        throw new VendorError("openai", operation, "OpenAI request timed out.", {
          code: "vendor_timeout",
          retryable: true,
          cause: error,
        });
      }
      throw new VendorError("openai", operation, "OpenAI request failed.", {
        code: "vendor_unavailable",
        retryable: true,
        cause: error,
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

const responseEnvelope = z.object({
  model: z.string().optional(),
  output_text: z.string().optional(),
  output: z
    .array(
      z.object({
        type: z.string().optional(),
        content: z
          .array(z.object({ type: z.string().optional(), text: z.string().optional() }))
          .optional(),
      }),
    )
    .optional(),
  usage: z
    .object({ input_tokens: z.number().optional(), output_tokens: z.number().optional() })
    .optional(),
});

function extractOutputText(payload: z.infer<typeof responseEnvelope>): string | null {
  if (payload.output_text) return payload.output_text;
  for (const item of payload.output ?? []) {
    for (const content of item.content ?? []) {
      if (content.text) return content.text;
    }
  }
  return null;
}

const embeddingEnvelope = z.object({
  model: z.string().optional(),
  data: z.array(z.object({ index: z.number(), embedding: z.array(z.number()) })),
  usage: z.object({ prompt_tokens: z.number().optional() }).optional(),
});

function estimateCost(modelId: string, tokensIn: number, tokensOut: number): number {
  const price = PRICE_TABLE[modelId];
  if (!price) return 0;
  return (
    (tokensIn / 1_000_000) * price.inputCentsPerMTok +
    (tokensOut / 1_000_000) * price.outputCentsPerMTok
  );
}

/** Reads only the vendor error code, never the echoed request body. */
async function safeErrorCode(response: Response): Promise<string | null> {
  try {
    const body = (await response.json()) as { error?: { code?: string; type?: string } };
    return body.error?.code ?? body.error?.type ?? null;
  } catch {
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
