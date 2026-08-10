import type { AnswerCoverageEstimateOutput } from "@/prompts/schemas";

/**
 * Deterministic mock answer-coverage estimator.
 *
 * A prompt's expected elements are split covered/missing by a stable hash of
 * the element text itself (no clock, no randomness), weighted toward
 * "covered" when real evidence (citation domains) was supplied — the same
 * "more evidence, more confidence" shape the live model is asked to follow,
 * without needing an actual model call.
 */

export type AnswerCoverageMockContext = {
  expectedAnswerElements: string[];
  citationDomains: string[];
  topic: string;
};

export function generateAnswerCoverageEstimate(
  context: AnswerCoverageMockContext,
): AnswerCoverageEstimateOutput {
  const hasEvidence = context.citationDomains.length > 0;
  const covered: string[] = [];
  const missing: string[] = [];

  for (const element of context.expectedAnswerElements) {
    // Deterministic per-element split: roughly two in three elements are
    // "covered" when real citation evidence exists, one in three otherwise.
    const bucket = stableBucket(element) % 3;
    const isCovered = hasEvidence ? bucket !== 0 : bucket === 0;
    (isCovered ? covered : missing).push(element);
  }

  const confidence = hasEvidence ? 0.65 : 0.25;
  const rationale = hasEvidence
    ? `Based on ${context.citationDomains.length} cited domain(s) observed for "${context.topic}", a well-informed answer likely covers most expected elements already.`
    : `No Profound retrieval evidence exists yet for "${context.topic}", so this estimate leans toward "missing" rather than assuming coverage.`;

  return { covered, missing, confidence, rationale };
}

function stableBucket(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return hash;
}
