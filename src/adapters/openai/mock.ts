import "server-only";
import { z } from "zod";
import { AppError } from "@/lib/errors";
import {
  EMBEDDING_DIMENSIONS,
  type EmbeddingRequest,
  type EmbeddingResult,
  type OpenAIAdapter,
  type StructuredRequest,
  type StructuredResult,
  type WebResearchRequest,
  type WebResearchResult,
} from "./types";
import { mockEmbed } from "./embedding";
import { generateWebResearch } from "@fixtures/openai/web-research";

/**
 * Deterministic mock OpenAI adapter.
 *
 * Every generator is a pure function of the request's `mockContext`. No clock,
 * no randomness, no network — the same input always produces the same output,
 * which is what makes the seeded workflow and the test suite reproducible.
 *
 * Results are still validated against the same Zod schema the live adapter
 * uses, so a generator that drifts from the schema fails loudly here rather
 * than only in production.
 */

export type MockGenerator = (context: Record<string, unknown>) => unknown;

const generators = new Map<string, MockGenerator>();

export function registerMockGenerator(templateId: string, generator: MockGenerator): void {
  generators.set(templateId, generator);
}

export function hasMockGenerator(templateId: string): boolean {
  return generators.has(templateId);
}

export class MockOpenAIAdapter implements OpenAIAdapter {
  readonly mode = "mock" as const;

  constructor(
    private readonly models: {
      economical: string;
      reasoning: string;
      embedding: string;
    },
  ) {}

  async generateStructured<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>> {
    const started = Date.now();
    const generator = generators.get(request.templateId);
    if (!generator) {
      // Better to fail loudly than to return a plausible empty object that
      // looks like "the model found nothing".
      throw new AppError(
        "internal",
        `No mock generator registered for template "${request.templateId}". Register one in src/adapters/openai/mock/index.ts.`,
      );
    }

    const raw = generator(request.mockContext ?? {});
    const parsed = request.schema.safeParse(raw);
    if (!parsed.success) {
      throw new AppError(
        "schema_validation",
        `Mock generator for "${request.templateId}" produced output that fails its own schema: ${formatIssues(parsed.error)}`,
      );
    }

    const promptChars = request.system.length + request.user.length;
    const outputChars = JSON.stringify(parsed.data).length;

    return {
      data: parsed.data,
      modelProvider: "mock",
      modelId: `mock:${request.modelTier === "reasoning" ? this.models.reasoning : this.models.economical}`,
      dataOrigin: "mock",
      // Rough char/4 estimate so the usage screen shows realistic magnitudes,
      // clearly attributed to mock mode.
      tokensIn: Math.ceil(promptChars / 4),
      tokensOut: Math.ceil(outputChars / 4),
      costCents: 0,
      attempts: 1,
      durationMs: Date.now() - started,
    };
  }

  async embed(request: EmbeddingRequest): Promise<EmbeddingResult> {
    const embeddings = request.texts.map((text) => mockEmbed(text, EMBEDDING_DIMENSIONS));
    return {
      embeddings,
      modelId: `mock:${request.model ?? this.models.embedding}`,
      dimensions: EMBEDDING_DIMENSIONS,
      dataOrigin: "mock",
      tokensIn: request.texts.reduce((sum, text) => sum + Math.ceil(text.length / 4), 0),
      costCents: 0,
    };
  }

  async webSearch(request: WebResearchRequest): Promise<WebResearchResult> {
    const { findings, citations } = generateWebResearch(request.query);
    return {
      findings,
      citations,
      modelProvider: "mock",
      modelId: `mock:${this.models.reasoning}`,
      dataOrigin: "mock",
      tokensIn: Math.ceil((request.query.length + request.brandContext.length) / 4),
      tokensOut: Math.ceil(findings.length / 4),
      costCents: 0,
    };
  }
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 5)
    .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
    .join("; ");
}
