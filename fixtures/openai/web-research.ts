/**
 * Deterministic mock for `OpenAIAdapter.webSearch` (deep research).
 *
 * Unlike the schema-validated generators in `src/adapters/openai/mock/`,
 * this has no structured output to satisfy — just prose findings and a
 * citation list. The citation URLs are deliberately `mock-source.example`,
 * never a real domain, so mock findings are never mistaken for a genuine
 * citation (ADR-011's "mock is explicit, never an approximation" rule).
 */

import { createHash } from "node:crypto";

function hashHex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function fraction(hex: string, start: number, len = 8): number {
  return parseInt(hex.slice(start, start + len), 16) / 0xffffffff;
}

const FINDING_TEMPLATES: readonly string[] = [
  "Industry coverage suggests buyers evaluating this space weigh deployment flexibility and data residency heavily before price. Several analyst roundups from the past year name self-hosted or private-cloud options as a differentiator, particularly for regulated industries.",
  "Community discussion (forums, Reddit threads, and comparison sites) repeatedly raises onboarding friction as the top complaint about incumbents, alongside pricing that scales unpredictably with usage.",
  "Recent press coverage highlights a shift toward usage-based pricing models and a growing expectation that vendors publish SOC 2 or ISO 27001 certifications up front rather than on request.",
  "Analyst commentary points to consolidation in this category, with buyers increasingly favoring platforms that combine several previously separate tools rather than assembling a stack themselves.",
  "Review-site aggregate sentiment is generally positive on core functionality but consistently critical of support responsiveness and the clarity of documentation for advanced use cases.",
  "Public case studies and customer testimonials most often cite time-to-value and integration breadth as the deciding factors in a purchase, more than any single feature.",
];

export type MockWebResearchResult = {
  findings: string;
  citations: { url: string; title: string | null }[];
};

/** Deterministic per `(query)` — the same research question always returns the same findings. */
export function generateWebResearch(query: string): MockWebResearchResult {
  const hex = hashHex(`web_research:${query}`);
  const templateIndex = Math.floor(fraction(hex, 0) * FINDING_TEMPLATES.length);
  const findings = FINDING_TEMPLATES[templateIndex % FINDING_TEMPLATES.length]!;

  const citationCount = 2 + Math.floor(fraction(hex, 8) * 3); // 2-4
  const citations = Array.from({ length: citationCount }, (_, i) => {
    const slug = hex.slice(16 + i * 4, 20 + i * 4);
    return {
      url: `https://mock-source.example/articles/${slug}`,
      title: `Mock source ${i + 1} on "${query.slice(0, 40)}"`,
    };
  });

  return { findings, citations };
}
