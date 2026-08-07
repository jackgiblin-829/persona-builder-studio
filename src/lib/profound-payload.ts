/**
 * The Profound deployment payload (§21, §22).
 *
 * Pure: no database, no clock, no adapter. Everything the deployment path
 * decides about *what to send* is decided here, so it can be asserted on
 * directly rather than inferred from a vendor response.
 *
 * The important property is that the payload is a **deterministic function of
 * the prompt set, the mapping and the deployment options**. That is what makes
 * the dry-run gate meaningful: the hash of what was previewed can be compared
 * against the hash of what is about to be written, and any drift between the
 * two invalidates the approval instead of silently deploying something else.
 * A payload builder that reached for a clock, a random id or a database read
 * could not offer that guarantee.
 */

import { stableHash } from "./crypto";
import { buildPromptMetadata, type ProfoundPromptMetadata } from "./profound-tags";

export type DeploymentPrompt = {
  /** This product's prompt id. Travels as `client_reference`. */
  promptId: string;
  promptType: "persona" | "generic_control";
  promptText: string;
  topic: string;
  intent: string;
  journeyStage: string;
};

export type DeploymentOptions = {
  personaSlug: string;
  personaVersion: number;
  promptSetSlug: string;
  promptSetVersion: number;
  /** Null when the §20 tag fallback is in force. */
  profoundPersonaId: string | null;
  language: string;
  regions: string[];
  platforms: string[];
  analysisTypes: string[];
  asset: string | null;
};

export type BuiltPromptPayload = ProfoundPromptMetadata & {
  client_reference: string;
};

export function buildPromptPayload(
  prompt: DeploymentPrompt,
  options: DeploymentOptions,
): BuiltPromptPayload {
  const metadata = buildPromptMetadata({
    promptText: prompt.promptText,
    topic: prompt.topic,
    personaSlug: options.personaSlug,
    personaVersion: options.personaVersion,
    promptSetSlug: options.promptSetSlug,
    promptSetVersion: options.promptSetVersion,
    intent: prompt.intent,
    journeyStage: prompt.journeyStage,
    promptType: prompt.promptType,
    languages: [options.language],
    regions: options.regions,
    platforms: options.platforms,
    analysisTypes: options.analysisTypes,
    asset: options.asset,
    profoundPersonaId: options.profoundPersonaId,
  });

  return { client_reference: prompt.promptId, ...metadata };
}

/**
 * The hash the dry-run gate compares (ADR-008).
 *
 * Computed over the *ordered* item payloads rather than the whole request, so a
 * failed-only retry — which sends a strict subset of items whose payloads are
 * byte-identical to the ones already validated — can be checked against what
 * was previewed instead of being forced through a second preview of the same
 * text. Order is normalised by client reference so two builds of the same set
 * agree regardless of how the rows came back from the database.
 */
export function payloadHash(items: BuiltPromptPayload[]): string {
  const ordered = [...items].sort((a, b) => a.client_reference.localeCompare(b.client_reference));
  return stableHash(ordered);
}

/**
 * Topics that do not yet exist in the target category.
 *
 * Not an error — Profound creates a topic on demand and a new persona
 * legitimately introduces new topics. It is surfaced in the preview because a
 * *typo* also looks exactly like this, and the difference is only visible to
 * someone who knows the account.
 */
export function newTopics(items: { topic: string }[], existingTopicNames: string[]): string[] {
  const existing = new Set(existingTopicNames.map((name) => name.trim().toLowerCase()));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    const key = item.topic.trim().toLowerCase();
    if (existing.has(key) || seen.has(key)) continue;
    seen.add(key);
    out.push(item.topic);
  }
  return out;
}
