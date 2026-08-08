import { describe, expect, it } from "vitest";
import {
  buildControlTags,
  buildPromptMetadata,
  buildPromptTags,
  LOCAL_ONLY_FIELDS,
  METADATA_DEFAULTS,
} from "@/lib/profound-tags";

const BASE = {
  personaSlug: "security-led-deployment-buyer",
  personaVersion: 2,
  promptSetSlug: "security-led-deployment-buyer-prompts",
  promptSetVersion: 1,
  intent: "risk_reduction",
  journeyStage: "evaluation",
  promptType: "persona" as const,
};

describe("buildPromptTags", () => {
  it("emits the §21 recommended scheme in a stable order", () => {
    expect(buildPromptTags(BASE)).toEqual([
      "persona:security-led-deployment-buyer",
      "persona-version:2",
      "intent:risk-reduction",
      "stage:evaluation",
      "prompt-set:security-led-deployment-buyer-prompts",
      "prompt-set-version:1",
      "prompt-type:persona",
      "source:persona-builder-studio",
    ]);
  });

  it("slugifies intent and stage so a tag is never a snake_case enum", () => {
    const tags = buildPromptTags({ ...BASE, intent: "problem_discovery", journeyStage: "unknown" });
    expect(tags).toContain("intent:problem-discovery");
    expect(tags).toContain("stage:unknown");
  });

  it("slugifies a persona slug that arrives unslugified, so a rename cannot break a tag", () => {
    const tags = buildPromptTags({ ...BASE, personaSlug: "Security Led Buyer!" });
    expect(tags[0]).toBe("persona:security-led-buyer");
  });

  it("is deterministic", () => {
    expect(buildPromptTags(BASE)).toEqual(buildPromptTags(BASE));
  });

  it("produces no duplicate tags", () => {
    const tags = buildPromptTags(BASE);
    expect(new Set(tags).size).toBe(tags.length);
  });
});

describe("buildControlTags", () => {
  it("never claims the persona tag, so a control's visibility is not counted as the persona's", () => {
    const tags = buildControlTags(BASE);
    expect(tags.some((tag) => tag.startsWith("persona:"))).toBe(false);
    expect(tags[0]).toBe("control-for:security-led-deployment-buyer");
  });

  it("still carries the prompt-type and source tags", () => {
    const tags = buildControlTags(BASE);
    expect(tags).toContain("prompt-type:generic-control");
    expect(tags).toContain("source:persona-builder-studio");
  });

  it("keeps the persona-version tag so a control pairs to the right persona revision", () => {
    expect(buildControlTags(BASE)).toContain("persona-version:2");
  });
});

describe("buildPromptMetadata", () => {
  const input = {
    ...BASE,
    promptText: "Which platforms run inside our own VPC?",
    topic: "Data residency",
    languages: ["en", "de"],
    regions: ["us", "uk"],
  };

  it("maps every field §21 requires", () => {
    const metadata = buildPromptMetadata(input);
    expect(metadata).toMatchObject({
      prompt_text: "Which platforms run inside our own VPC?",
      topic: "Data residency",
      language: "en",
      regions: ["us", "uk"],
      prompt_type: "persona",
      asset: null,
    });
    expect(metadata.tags).toContain("persona:security-led-deployment-buyer");
  });

  it("falls back to defaults when the brand has configured nothing", () => {
    const metadata = buildPromptMetadata({ ...input, languages: [], regions: [] });
    expect(metadata.language).toBe(METADATA_DEFAULTS.language);
    expect(metadata.regions).toEqual([...METADATA_DEFAULTS.regions]);
    expect(metadata.platforms).toEqual([...METADATA_DEFAULTS.platforms]);
  });

  it("leaves the Profound persona unmapped and records the deterministic tag fallback (§20)", () => {
    const metadata = buildPromptMetadata(input);
    expect(metadata.persona_id).toBeNull();
    expect(metadata.persona_tag_fallback).toBe("persona:security-led-deployment-buyer");
  });

  it("uses a mapped Profound persona when one is supplied", () => {
    const metadata = buildPromptMetadata({ ...input, profoundPersonaId: "pfd_123" });
    expect(metadata.persona_id).toBe("pfd_123");
    // The fallback stays recorded so a mapping that is later invalidated has
    // something to fall back to.
    expect(metadata.persona_tag_fallback).toBe("persona:security-led-deployment-buyer");
  });

  it("uses control tags for a control prompt", () => {
    const metadata = buildPromptMetadata({ ...input, promptType: "generic_control" });
    expect(metadata.prompt_type).toBe("generic_control");
    expect(metadata.tags.some((tag) => tag.startsWith("persona:"))).toBe(false);
  });

  it("does not smuggle internal fields into the vendor payload", () => {
    // Checked on the keys, not the serialised blob: a substring scan of the
    // full payload could false-positive on unrelated text inside a tag value.
    expect(Object.keys(buildPromptMetadata(input)).sort()).toEqual([
      "analysis_types",
      "asset",
      "language",
      "persona_id",
      "persona_tag_fallback",
      "platforms",
      "prompt_text",
      "prompt_type",
      "regions",
      "tags",
      "topic",
    ]);
  });

  it("names the fields that stay local, so the boundary is visible", () => {
    expect(LOCAL_ONLY_FIELDS.length).toBeGreaterThan(0);
    expect(LOCAL_ONLY_FIELDS.join(" ")).toMatch(/Evidence ids/);
  });
});
