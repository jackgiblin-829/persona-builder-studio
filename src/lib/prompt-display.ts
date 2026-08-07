import type { prompts } from "@/db/schema";
import { PROMPT_INTENTS } from "@/prompts/schemas";

/**
 * The view contract for a prompt, plus its display vocabulary.
 *
 * Components must not import from `@/services/*` — that boundary is enforced by
 * lint, and it is what keeps data access out of the render tree. These shapes
 * and labels are shared by both sides, so they live here rather than being
 * duplicated or having the boundary relaxed to accommodate them.
 */

export const PROMPT_INTENT_LABELS: Record<string, string> = {
  problem_discovery: "Problem discovery",
  education: "Education",
  solution_exploration: "Solution exploration",
  comparison: "Comparison",
  evaluation: "Evaluation",
  risk_reduction: "Risk reduction",
  purchase: "Purchase",
  implementation: "Implementation",
  optimization: "Optimization",
  troubleshooting: "Troubleshooting",
};

export const INTENT_ORDER = [...PROMPT_INTENTS];

export const STAGE_ORDER = [
  "unaware",
  "problem_discovery",
  "education",
  "solution_exploration",
  "consideration",
  "evaluation",
  "purchase",
  "implementation",
  "optimization",
  "troubleshooting",
  "retention",
  "unknown",
] as const;

export type PromptEvidenceRow = {
  evidenceId: string;
  normalizedClaim: string;
  redactedText: string;
  category: string;
  provenance: string;
  journeyStage: string;
  sourceLabel: string;
  sourceLocation: string;
  speaker: string | null;
  observedAt: Date | null;
  unavailable: boolean;
  availability: string;
};

export type PromptRow = typeof prompts.$inferSelect & {
  evidence: PromptEvidenceRow[];
  /** §18 persona-field drawer: which persona claims this prompt tests. */
  personaFieldStatements: { id: string; fieldType: string; statement: string }[];
  control: { id: string; promptText: string; reviewStatus: string } | null;
  pairedTo: { id: string; promptText: string } | null;
};

/** The Profound payload preview stored on every prompt. */
export type PromptMetadataView = {
  tags?: string[];
  language?: string;
  regions?: string[];
  platforms?: string[];
  analysis_types?: string[];
  persona_id?: string | null;
  persona_tag_fallback?: string;
  prompt_type?: string;
};
