import { analyzeGap, estimateEffort, estimatePriority, type GapSignal } from "@/lib/content-gap";
import type { OpportunityGeneration, OpportunityOutput } from "@/prompts/schemas";

/**
 * Deterministic mock content-gap analysis.
 *
 * Every candidate's `gap_type` and `recommendation` come straight from
 * `analyzeGap` (src/lib/content-gap.ts) — the same function the live path's
 * output gets cross-checked against in `src/services/content-opportunities.ts`
 * — so the mock and the live adapter are graded by the identical rule, and
 * "not every gap becomes new_article" is true in mock mode by construction,
 * not by chance.
 *
 * Only prose (title, problem statement, rationale sentence, validation
 * method) is templated text; every fact in it is drawn from the candidate,
 * never invented.
 */

export type ContentGapMockCandidate = {
  promptId: string;
  profoundPromptId: string;
  promptText: string;
  topic: string;
  personaName: string;
  bucketIds: string[];
  competitors: string[];
  citationSources: string[];
  existingPageUrl: string | null;
  evidenceIds: string[];
  signal: GapSignal;
};

export type ContentGapMockContext = {
  brandName: string;
  candidates: ContentGapMockCandidate[];
};

export function generateOpportunities(context: ContentGapMockContext): OpportunityGeneration {
  const opportunities: OpportunityOutput[] = context.candidates
    .slice(0, 12)
    .map((candidate) => toOpportunity(context.brandName, candidate));

  return { opportunities };
}

function toOpportunity(brandName: string, candidate: ContentGapMockCandidate): OpportunityOutput {
  const analysis = analyzeGap(candidate.signal);
  const priority = estimatePriority(candidate.signal, analysis);
  const effort = estimateEffort(analysis.recommendation);

  return {
    title: buildTitle(candidate, analysis.recommendation),
    problem_statement: buildProblemStatement(brandName, candidate),
    performance_gap: buildPerformanceGap(brandName, candidate),
    gap_type: analysis.gapType,
    recommendation: analysis.recommendation,
    recommendation_rationale: analysis.rationale,
    relevant_profound_prompt_ids: [candidate.profoundPromptId],
    relevant_bucket_ids: candidate.bucketIds,
    competitors: candidate.competitors,
    citation_sources: candidate.citationSources,
    missing_answer_elements: candidate.signal.missingElements,
    existing_page_url: candidate.existingPageUrl,
    priority,
    estimated_effort: effort,
    evidence_ids: candidate.evidenceIds,
    validation_method: buildValidationMethod(analysis.recommendation),
  };
}

function buildTitle(candidate: ContentGapMockCandidate, recommendation: string): string {
  const action = RECOMMENDATION_VERB[recommendation] ?? "Review";
  return `${action}: ${candidate.topic}`.slice(0, 200);
}

const RECOMMENDATION_VERB: Record<string, string> = {
  new_article: "Publish a new article on",
  existing_article_update: "Update the existing page about",
  faq: "Add an FAQ entry on",
  comparison_page: "Publish a comparison page for",
  landing_page: "Build a decision-stage landing page for",
  product_page: "Expand the product page covering",
  documentation: "Add documentation on",
  case_study: "Publish a case study proving",
  homepage_update: "Update the homepage's framing of",
  structured_information_improvement: "Restructure existing content on",
  third_party_authority_or_pr: "Pursue third-party coverage on",
  no_content_action: "No action needed on",
  product_or_positioning_review: "Escalate for product/positioning review:",
};

function buildProblemStatement(brandName: string, candidate: ContentGapMockCandidate): string {
  const parts: string[] = [];
  if (candidate.signal.classification === "brand_absent") {
    parts.push(
      `${brandName} does not appear at all in the most recent AI answer for "${candidate.topic}".`,
    );
  } else if (candidate.signal.classification === "competitor_dominated") {
    parts.push(
      `${brandName} is mentioned for "${candidate.topic}" but a competitor holds a larger share of voice.`,
    );
  } else {
    parts.push(`${brandName}'s visibility for "${candidate.topic}" is currently normal.`);
  }
  if (candidate.signal.missingElements.length > 0) {
    parts.push(
      `The answer is missing: ${candidate.signal.missingElements.slice(0, 5).join("; ")}.`,
    );
  }
  if (candidate.signal.controlOutperforms === false) {
    parts.push("This persona prompt is not outperforming its generic control.");
  }
  return parts.join(" ").slice(0, 1500);
}

function buildPerformanceGap(brandName: string, candidate: ContentGapMockCandidate): string {
  const competitorNote =
    candidate.competitors.length > 0
      ? ` while ${candidate.competitors.slice(0, 3).join(", ")} appear in the same answers`
      : "";
  return `Prompt "${candidate.promptText.slice(0, 200)}" (Profound prompt ${candidate.profoundPromptId}): ${brandName} is classified "${candidate.signal.classification}"${competitorNote}, across bucket(s) ${candidate.bucketIds.slice(0, 5).join(", ") || "none recorded"}.`.slice(
    0,
    1500,
  );
}

function buildValidationMethod(recommendation: string): string {
  switch (recommendation) {
    case "no_content_action":
      return "Re-check this prompt's classification and missing elements after the next Profound retrieval; no content change is expected to move it.";
    case "product_or_positioning_review":
      return "Confirm with product/positioning stakeholders whether the underlying capability gap is real before any content is written; re-run this analysis after that review, not before.";
    default:
      return "After publishing, re-run Profound result retrieval for the linked prompt and confirm the brand appears, the missing elements are answered, and the persona prompt outperforms its generic control.";
  }
}
