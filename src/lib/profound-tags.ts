/**
 * Profound prompt metadata and the recommended tag scheme (§21).
 *
 * This module is the boundary between what this product knows and what Profound
 * can hold. Profound stores prompt text, topic, language, regions, platforms,
 * tags, persona, analysis types, prompt type and asset. It has no field for an
 * evidence id, an information need or a confidence component — so those stay
 * here, in the local database, and are never crammed into a tag to make them fit.
 * Forcing internal structure into a vendor's free-text field produces data that
 * is unusable on both sides.
 *
 * Tags are the one place where the two systems must agree, because a tag is how
 * a result row gets attributed back to a persona. Every tag is therefore
 * deterministic, slug-based and derived from values that survive a rename:
 * `persona:<slug>` uses the persona's stable slug, never its display name.
 *
 * Pure: no database, no clock, no adapter. The Profound adapter in milestone 5
 * consumes what this builds; nothing here calls Profound.
 */

import { slugify } from "./ids";

export type PromptTagInput = {
  personaSlug: string;
  personaVersion: number;
  promptSetSlug: string;
  promptSetVersion: number;
  intent: string;
  journeyStage: string;
  promptType: "persona" | "generic_control";
};

/**
 * The §21 recommended tag scheme, in a fixed order.
 *
 * Order is stable so a tag list can be compared between a dry run and a
 * deployment without a set difference, and so an exported CSV diffs cleanly.
 */
export function buildPromptTags(input: PromptTagInput): string[] {
  const tags = [
    `persona:${slugify(input.personaSlug)}`,
    `persona-version:${input.personaVersion}`,
    `intent:${slugify(input.intent)}`,
    `stage:${slugify(input.journeyStage)}`,
    `prompt-set:${slugify(input.promptSetSlug)}`,
    `prompt-set-version:${input.promptSetVersion}`,
    `prompt-type:${input.promptType === "generic_control" ? "generic-control" : "persona"}`,
    "source:persona-evidence-studio",
  ];

  // A duplicate tag is not an error worth failing on, but it is noise in the
  // vendor's UI. De-duplicate while preserving the documented order.
  return [...new Set(tags)];
}

/**
 * The generic control's persona tag.
 *
 * A control is deliberately *not* tagged `persona:<slug>` as if it belonged to
 * the persona — the whole point of a control is that it is the question asked
 * without the persona's framing. It carries `control-for:<slug>` instead, so a
 * result query can pair the two without the control's visibility being counted
 * as the persona's.
 */
export function buildControlTags(input: PromptTagInput): string[] {
  const tags = buildPromptTags({ ...input, promptType: "generic_control" }).filter(
    (tag) => !tag.startsWith("persona:"),
  );
  return [`control-for:${slugify(input.personaSlug)}`, ...tags];
}

export type ProfoundPromptMetadata = {
  prompt_text: string;
  topic: string;
  language: string;
  regions: string[];
  platforms: string[];
  tags: string[];
  /** Null until a Profound persona is mapped in milestone 5 (§20 tag fallback). */
  persona_id: string | null;
  persona_tag_fallback: string;
  analysis_types: string[];
  prompt_type: "persona" | "generic_control";
  asset: string | null;
};

export type MetadataInput = PromptTagInput & {
  promptText: string;
  topic: string;
  /** Brand-level defaults; a brand with none configured falls back below. */
  languages: string[];
  regions: string[];
  platforms?: string[];
  analysisTypes?: string[];
  asset?: string | null;
  profoundPersonaId?: string | null;
};

/**
 * Defaults used when the brand has not configured a value.
 *
 * These are *previews*, not commitments: milestone 5 replaces them with the
 * live configuration read back from Profound (§19) before anything is deployed.
 * They exist so the metadata preview in the prompt editor shows a realistic,
 * complete payload rather than a form full of blanks.
 */
export const METADATA_DEFAULTS = {
  language: "en",
  regions: ["us"],
  platforms: ["chatgpt", "perplexity", "google-ai-overviews"],
  analysisTypes: ["visibility", "citations"],
} as const;

export function buildPromptMetadata(input: MetadataInput): ProfoundPromptMetadata {
  const tags =
    input.promptType === "generic_control" ? buildControlTags(input) : buildPromptTags(input);

  return {
    prompt_text: input.promptText,
    topic: input.topic,
    language: input.languages[0] ?? METADATA_DEFAULTS.language,
    regions: input.regions.length > 0 ? input.regions : [...METADATA_DEFAULTS.regions],
    platforms: input.platforms ?? [...METADATA_DEFAULTS.platforms],
    tags,
    persona_id: input.profoundPersonaId ?? null,
    persona_tag_fallback: `persona:${slugify(input.personaSlug)}`,
    analysis_types: input.analysisTypes ?? [...METADATA_DEFAULTS.analysisTypes],
    prompt_type: input.promptType,
    asset: input.asset ?? null,
  };
}

/**
 * Fields this product holds that Profound has no home for.
 *
 * Rendered in the metadata preview so the boundary is visible to the user
 * rather than implied: these travel no further than this database, and the way
 * back to them from a Profound result row is the tag set above.
 */
export const LOCAL_ONLY_FIELDS = [
  "Evidence ids behind the prompt",
  "Information need",
  "Constraints, decision criteria and vocabulary used",
  "Expected answer elements",
  "Inclusion rationale",
  "Confidence and its components",
  "Tracking priority",
  "Persona field links",
] as const;
