import { describe, expect, it } from "vitest";
import {
  contentTokens,
  dedupeExact,
  DUPLICATE_THRESHOLDS,
  findDuplicate,
  lexicalSimilarity,
  normalizePromptText,
  promptHash,
} from "@/lib/prompt-dedupe";
import { mockEmbed } from "@/adapters/openai/embedding";

describe("normalizePromptText", () => {
  it("collapses case, punctuation and whitespace", () => {
    expect(normalizePromptText("  Which   Platforms,  really?  ")).toBe("which platforms really");
  });

  it("strips politeness wrappers that carry no information need", () => {
    const bare = normalizePromptText("what are the best self-hosted analytics tools?");
    expect(
      normalizePromptText("Can you please tell me what are the best self-hosted analytics tools?"),
    ).toBe(bare);
    expect(
      normalizePromptText("Hi, I'd like to know what are the best self-hosted analytics tools"),
    ).toBe(bare);
  });

  it("strips nested wrappers", () => {
    expect(normalizePromptText("Hey, could you please tell me how pricing works?")).toBe(
      "how pricing works",
    );
  });

  it("normalises smart quotes and accents", () => {
    expect(normalizePromptText("What’s the naïve approach?")).toBe("whats the naive approach");
  });

  it("preserves word order, so a reversed comparison stays a different question", () => {
    // "SOC 2 vs ISO 27001" and its reverse are genuinely different queries to an
    // AI search engine; an order-insensitive normalizer would merge them.
    expect(normalizePromptText("SOC 2 vs ISO 27001")).not.toBe(
      normalizePromptText("ISO 27001 vs SOC 2"),
    );
  });

  it("keeps hyphenated terms intact", () => {
    expect(normalizePromptText("self-hosted product analytics")).toBe(
      "self-hosted product analytics",
    );
  });
});

describe("promptHash", () => {
  it("is stable for the same normalized text", () => {
    expect(promptHash("What are the best tools?")).toBe(promptHash("what   are the BEST tools"));
  });

  it("differs for different questions", () => {
    expect(promptHash("What are the best tools?")).not.toBe(
      promptHash("What are the worst tools?"),
    );
  });

  it("is a 64-character hex digest", () => {
    expect(promptHash("anything")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("treats a politeness-only difference as the same prompt", () => {
    expect(promptHash("Please tell me how pricing works")).toBe(promptHash("How pricing works"));
  });
});

describe("contentTokens and lexicalSimilarity", () => {
  it("drops stopwords and keeps the words that decide the question", () => {
    expect(contentTokens("What are the best analytics tools for us?")).toEqual([
      "analytics",
      "tools",
    ]);
  });

  it("scores identical content words at 1", () => {
    expect(lexicalSimilarity("the best analytics tools", "analytics tools, the best")).toBe(1);
  });

  it("scores unrelated questions near zero", () => {
    expect(lexicalSimilarity("how is pricing structured", "which vendors support HIPAA")).toBe(0);
  });

  it("returns 0 when either side has no content words", () => {
    expect(lexicalSimilarity("what is it", "which vendors support HIPAA")).toBe(0);
  });
});

describe("findDuplicate", () => {
  const candidate = (id: string, text: string, embed = false) => ({
    promptId: id,
    promptText: text,
    normalizedHash: promptHash(text),
    embedding: embed ? mockEmbed(text) : null,
  });

  it("reports an exact match ahead of everything else", () => {
    const found = findDuplicate(
      { promptText: "Please tell me what the best analytics tools are" },
      [
        candidate("pr_near", "What are the best analytics platforms"),
        candidate("pr_exact", "What the best analytics tools are"),
      ],
    );
    expect(found).toMatchObject({ promptId: "pr_exact", kind: "exact", score: 1 });
  });

  it("reports a lexical overlap when the wording barely changes", () => {
    const found = findDuplicate({ promptText: "which analytics tools support HIPAA compliance" }, [
      candidate("pr_1", "analytics tools that support HIPAA compliance"),
    ]);
    expect(found?.kind).toBe("lexical");
    expect(found?.score).toBeGreaterThanOrEqual(DUPLICATE_THRESHOLDS.lexical);
  });

  it("reports a semantic match when embeddings are close enough", () => {
    const text = "which analytics platforms run inside our own VPC";
    const found = findDuplicate({ promptText: text, embedding: mockEmbed(text) }, [
      candidate("pr_1", `${text} today`, true),
    ]);
    expect(found).not.toBeNull();
    expect(["semantic", "lexical"]).toContain(found?.kind);
  });

  it("returns null when nothing is close", () => {
    expect(
      findDuplicate({ promptText: "how is pricing structured for small teams" }, [
        candidate("pr_1", "which vendors hold a SOC 2 Type II attestation"),
      ]),
    ).toBeNull();
  });

  it("never reports a prompt as a duplicate of itself", () => {
    const text = "which analytics tools support HIPAA";
    expect(
      findDuplicate({ promptId: "pr_self", promptText: text }, [candidate("pr_self", text)]),
    ).toBeNull();
  });

  it("carries the label of the set the duplicate lives in", () => {
    const found = findDuplicate({ promptText: "what are the best analytics tools" }, [
      {
        ...candidate("pr_other", "what are the best analytics tools"),
        promptSetLabel: "Adoption owner v2",
      },
    ]);
    expect(found?.promptSetLabel).toBe("Adoption owner v2");
  });

  it("honours a caller-supplied threshold", () => {
    // A pair that overlaps substantially without being identical: a permissive
    // threshold flags it, a strict one does not. The thresholds are exported so
    // a live-embedding deployment can retune them without touching the logic.
    const candidates = [candidate("pr_1", "which analytics tools support HIPAA audits")];
    const subject = { promptText: "which analytics tools support HIPAA compliance" };

    expect(lexicalSimilarity(subject.promptText, candidates[0]!.promptText)).toBeLessThan(1);
    expect(findDuplicate(subject, candidates, { embedding: 0.99, lexical: 0.5 })).not.toBeNull();
    expect(findDuplicate(subject, candidates, { embedding: 0.99, lexical: 0.95 })).toBeNull();
  });
});

describe("dedupeExact", () => {
  it("drops exact repeats and attaches the hash to what it keeps", () => {
    const { kept, dropped } = dedupeExact([
      { promptText: "What are the best analytics tools?" },
      { promptText: "please tell me what are the best analytics tools" },
      { promptText: "How is pricing structured?" },
    ]);

    expect(kept).toHaveLength(2);
    expect(dropped).toHaveLength(1);
    expect(kept[0]?.normalizedHash).toBe(promptHash("What are the best analytics tools?"));
  });

  it("keeps near-duplicates, because only a reviewer can judge those", () => {
    const { kept, dropped } = dedupeExact([
      { promptText: "which analytics tools support HIPAA compliance" },
      { promptText: "analytics tools that support HIPAA compliance" },
    ]);
    expect(kept).toHaveLength(2);
    expect(dropped).toHaveLength(0);
  });

  it("handles an empty batch", () => {
    expect(dedupeExact([])).toEqual({ kept: [], dropped: [] });
  });
});
