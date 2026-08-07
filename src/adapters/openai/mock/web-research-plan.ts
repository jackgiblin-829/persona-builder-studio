import type { WebResearchPlan } from "@/prompts/schemas";

/**
 * Deterministic mock research planner.
 *
 * A fixed set of angle templates, parameterized by the brand's own name,
 * description and competitor list — no clock, no randomness. Real query
 * planning would weigh what the brand's existing segments/prompts already
 * cover; the mock does not need to, since its only job is to produce a
 * plausible, schema-valid plan for the seeded demo and the test suite.
 */

export type WebResearchPlanMockContext = {
  brandName: string;
  brandDescription: string;
  competitorNames: string[];
};

export function generateWebResearchPlan(context: WebResearchPlanMockContext): WebResearchPlan {
  const competitor = context.competitorNames[0] ?? "the leading incumbent";

  const queries = [
    {
      query: `What do buyers say they want most from products like ${context.brandName}?`,
      rationale:
        "Surfaces buying criteria from review sites and forums, not just the brand's own claims.",
    },
    {
      query: `What are the most common complaints about ${competitor} in reviews and forums?`,
      rationale: "A competitor's known weaknesses point to unmet needs a persona would care about.",
    },
    {
      query: `What industry trends are analysts citing for this category in the past year?`,
      rationale:
        "Analyst coverage surfaces category-level shifts a single brand's data would miss.",
    },
    {
      query: `How do buyers typically evaluate and compare vendors in this category?`,
      rationale:
        "External commentary on evaluation criteria, independent of any one vendor's framing.",
    },
  ];

  return { queries };
}
