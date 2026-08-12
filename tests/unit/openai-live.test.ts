import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { LiveOpenAIAdapter } from "@/adapters/openai/live";
import { toStrictJsonSchema } from "@/prompts/json-schema";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("live OpenAI transport resilience", () => {
  it("retries a network failure before failing the generation workflow", async () => {
    vi.useFakeTimers();
    const outputSchema = z.object({ ok: z.boolean() });
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("temporary connection reset"))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            model: "gpt-4.1-mini",
            output_text: JSON.stringify({ ok: true }),
            usage: { input_tokens: 5, output_tokens: 3 },
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new LiveOpenAIAdapter(
      "test-key",
      {
        economical: "gpt-4.1-mini",
        reasoning: "gpt-4.1",
        embedding: "text-embedding-3-small",
      },
      { baseUrl: "https://openai.invalid" },
    );

    const pending = adapter.generateStructured({
      templateId: "test",
      templateVersion: "1",
      schemaVersion: "1",
      system: "Return the result.",
      user: "Test input",
      schema: outputSchema,
      schemaName: "TransportRetry",
      jsonSchema: toStrictJsonSchema(outputSchema, "TransportRetry"),
      modelTier: "economical",
    });
    await vi.advanceTimersByTimeAsync(2_000);

    await expect(pending).resolves.toMatchObject({ data: { ok: true }, attempts: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
