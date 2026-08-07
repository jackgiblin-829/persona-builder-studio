import { describe, expect, it } from "vitest";
import {
  buildPromptPayload,
  newTopics,
  payloadHash,
  type DeploymentOptions,
} from "@/lib/profound-payload";

/**
 * Pure unit tests for the deployment payload builder (§21, §22, ADR-008).
 *
 * `buildPromptPayload` mostly delegates to `buildPromptMetadata`, which
 * already has its own exhaustive test suite in profound-tags.test.ts — so this
 * file spot-checks the one thing that module does not cover: the
 * `client_reference` wiring. `payloadHash` and `newTopics` are fully pure and
 * get their own coverage here.
 */

const OPTIONS: DeploymentOptions = {
  personaSlug: "security-led-deployment-buyer",
  personaVersion: 2,
  promptSetSlug: "security-led-deployment-buyer-prompts",
  promptSetVersion: 1,
  profoundPersonaId: null,
  language: "en",
  regions: ["us"],
  platforms: ["chatgpt", "perplexity"],
  analysisTypes: ["visibility", "citations"],
  asset: null,
};

describe("buildPromptPayload", () => {
  it("sets client_reference to the prompt id", () => {
    const payload = buildPromptPayload(
      {
        promptId: "pr_abc123",
        promptType: "persona",
        promptText: "Which platforms run inside our own VPC?",
        topic: "Deployment and hosting",
        intent: "risk_reduction",
        journeyStage: "evaluation",
      },
      OPTIONS,
    );

    expect(payload.client_reference).toBe("pr_abc123");
  });

  it("otherwise delegates to buildPromptMetadata's contract", () => {
    const payload = buildPromptPayload(
      {
        promptId: "pr_xyz789",
        promptType: "generic_control",
        promptText: "What are the best options in this category?",
        topic: "Evaluation and procurement",
        intent: "comparison",
        journeyStage: "consideration",
      },
      OPTIONS,
    );

    // Spot-checked, not re-derived: the exhaustive field-by-field contract
    // lives in profound-tags.test.ts.
    expect(payload.prompt_text).toBe("What are the best options in this category?");
    expect(payload.prompt_type).toBe("generic_control");
    expect(payload.tags.some((tag) => tag.startsWith("persona:"))).toBe(false);
  });

  it("carries a distinct client_reference per prompt even when everything else matches", () => {
    const shared = {
      promptType: "persona" as const,
      promptText: "Which platforms run inside our own VPC?",
      topic: "Deployment and hosting",
      intent: "risk_reduction",
      journeyStage: "evaluation",
    };
    const a = buildPromptPayload({ ...shared, promptId: "pr_a" }, OPTIONS);
    const b = buildPromptPayload({ ...shared, promptId: "pr_b" }, OPTIONS);

    expect(a.client_reference).toBe("pr_a");
    expect(b.client_reference).toBe("pr_b");
    // Everything else is identical, by construction.
    expect({ ...a, client_reference: undefined }).toEqual({ ...b, client_reference: undefined });
  });
});

describe("payloadHash", () => {
  const itemA = buildPromptPayload(
    {
      promptId: "pr_a",
      promptType: "persona",
      promptText: "Which platforms run inside our own VPC?",
      topic: "Deployment and hosting",
      intent: "risk_reduction",
      journeyStage: "evaluation",
    },
    OPTIONS,
  );
  const itemB = buildPromptPayload(
    {
      promptId: "pr_b",
      promptType: "generic_control",
      promptText: "What are the best options in this category?",
      topic: "Evaluation and procurement",
      intent: "comparison",
      journeyStage: "consideration",
    },
    OPTIONS,
  );
  const itemC = buildPromptPayload(
    {
      promptId: "pr_c",
      promptType: "persona",
      promptText: "How is pricing structured for a self-hosted deployment?",
      topic: "Pricing",
      intent: "evaluation",
      journeyStage: "evaluation",
    },
    OPTIONS,
  );

  it("is deterministic for the same set of items regardless of array order", () => {
    const forward = payloadHash([itemA, itemB, itemC]);
    const shuffled = payloadHash([itemC, itemA, itemB]);
    const reversed = payloadHash([itemC, itemB, itemA]);

    expect(forward).toBe(shuffled);
    expect(forward).toBe(reversed);
  });

  it("changes when a single field on one item changes by one character", () => {
    const base = payloadHash([itemA, itemB]);

    const tweakedA = {
      ...itemA,
      prompt_text: `${itemA.prompt_text}?`, // one extra character
    };
    const tweaked = payloadHash([tweakedA, itemB]);

    expect(tweaked).not.toBe(base);
  });

  it("changes when any other single field changes, not only prompt_text", () => {
    const base = payloadHash([itemA]);
    const tweaked = payloadHash([{ ...itemA, topic: `${itemA.topic}!` }]);
    expect(tweaked).not.toBe(base);
  });

  it("is stable for an unchanged set of items", () => {
    expect(payloadHash([itemA, itemB])).toBe(payloadHash([itemA, itemB]));
  });

  it("handles an empty item list", () => {
    expect(payloadHash([])).toBe(payloadHash([]));
  });
});

describe("newTopics", () => {
  it("returns only topics not already present, case-insensitively and trimmed", () => {
    const result = newTopics(
      [{ topic: "  Deployment and hosting  " }, { topic: "PRICING" }, { topic: "Compliance" }],
      ["Deployment and Hosting", "pricing"],
    );
    expect(result).toEqual(["Compliance"]);
  });

  it("deduplicates repeats within its own input", () => {
    const result = newTopics(
      [{ topic: "Compliance" }, { topic: "compliance" }, { topic: "  Compliance  " }],
      [],
    );
    expect(result).toEqual(["Compliance"]);
  });

  it("preserves first-seen order", () => {
    const result = newTopics(
      [{ topic: "Zebra topic" }, { topic: "Alpha topic" }, { topic: "Zebra topic" }],
      [],
    );
    expect(result).toEqual(["Zebra topic", "Alpha topic"]);
  });

  it("returns an empty array when everything already exists", () => {
    const result = newTopics([{ topic: "Pricing" }, { topic: "pricing" }], ["Pricing"]);
    expect(result).toEqual([]);
  });

  it("returns an empty array for empty input", () => {
    expect(newTopics([], ["Pricing"])).toEqual([]);
  });
});
