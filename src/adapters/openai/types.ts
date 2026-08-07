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

export type WebResearchRequest = {
  /** A single, specific research question or topic. */
  query: string;
  /** Brand/competitor context so the search stays relevant. */
  brandContext: string;
  /** Passed through to the mock adapter so fixtures can be selected. */
  mockContext?: Record<string, unknown>;
};

export type WebResearchCitation = {
  url: string;
  title: string | null;
};

export type WebResearchResult = {
  /** Synthesized prose findings for this query, citation markers inline. */
  findings: string;
  citations: WebResearchCitation[];
  modelProvider: string;
  modelId: string;
  dataOrigin: "mock" | "live";
  tokensIn: number;
  tokensOut: number;
  costCents: number;
  raw?: Record<string, unknown>;
};

export interface OpenAIAdapter {
  readonly mode: "mock" | "live";
  generateStructured<T>(request: StructuredRequest<T>): Promise<StructuredResult<T>>;
  embed(request: EmbeddingRequest): Promise<EmbeddingResult>;
  /** Runs one web search and returns synthesized findings with citations. */
  webSearch(request: WebResearchRequest): Promise<WebResearchResult>;
}

export const EMBEDDING_DIMENSIONS = 1536;
