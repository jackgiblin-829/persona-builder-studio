import "server-only";
import { env } from "@/lib/env";
import { VendorNotConfiguredError } from "@/lib/errors";
import { resolveIntegration } from "@/services/integrations";
import { LiveOpenAIAdapter } from "./live";
import { MockOpenAIAdapter } from "./mock";
import "./mock/index";
import type { OpenAIAdapter } from "./types";

export type { OpenAIAdapter, StructuredRequest, StructuredResult, EmbeddingResult } from "./types";
export { EMBEDDING_DIMENSIONS } from "./types";
export { cosineSimilarity, mockEmbed } from "./embedding";

const MODELS = {
  economical: env.OPENAI_MODEL_ECONOMICAL,
  reasoning: env.OPENAI_MODEL_REASONING,
  embedding: env.OPENAI_MODEL_EMBEDDING,
};

/**
 * Resolves the adapter once, before the call (ADR-009). Mode is decided by
 * configuration, never by whether a request succeeded — a live adapter that
 * fails throws rather than degrading to mock data.
 */
export async function getOpenAIAdapter(
  organizationId: string,
): Promise<{ adapter: OpenAIAdapter; mode: "live" | "mock" }> {
  const resolved = await resolveIntegration(organizationId, "openai");

  if (resolved.mode === "live") {
    if (resolved.missingFields.length > 0) {
      throw new VendorNotConfiguredError("openai", "getAdapter");
    }
    return {
      adapter: new LiveOpenAIAdapter(resolved.credentials.apiKey!, MODELS),
      mode: "live",
    };
  }

  return { adapter: new MockOpenAIAdapter(MODELS), mode: "mock" };
}
