import type { z } from "zod";

export type ModelTier = "economical" | "reasoning";

export type StructuredRequest<T> = {
  /** Registry id of the prompt template, e.g. "evidence_extraction". */
  templateId: string;
  templateVersion: string;
  schemaVersion: string;
  system: string;
  user: string;
  /** Zod schema the response must satisfy. Also drives the JSON Schema sent. */
  schema: z.ZodType<T>;
  schemaName: string;
  jsonSchema: Record<string, unknown>;
  modelTier: ModelTier;
  maxRetries?: number;
  /** Enables the Responses API built-in web-search tool for source-backed research. */
  webSearch?: boolean;
  /** Passed through to mock adapters so fixtures can be selected. */
  mockKey?: string;
  mockContext?: Record<string, unknown>;
};

export type StructuredResult<T> = {
  data: T;
  modelProvider: string;
  modelId: string;
  dataOrigin: "mock" | "live";
  tokensIn: number;
  tokensOut: number;
  costCents: number;
  attempts: number;
  durationMs: number;
  /** Raw provider payload, retained for debugging. Secrets never appear here. */
  raw?: Record<string, unknown>;
};

export type EmbeddingRequest = {
  texts: string[];
  /** Optional override; otherwise the configured embedding model is used. */
  model?: string;
};

export type EmbeddingResult = {
  embeddings: number[][];
  modelId: string;
  dimensions: number;
  dataOrigin: "mock" | "live";
  tokensIn: number;
  costCents: number;
};

export interface OpenAIAdapter {
  readonly mode: "mock" | "live";
  generateStructured<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>>;
  embed(request: EmbeddingRequest): Promise<EmbeddingResult>;
}

export const EMBEDDING_DIMENSIONS = 1536;
