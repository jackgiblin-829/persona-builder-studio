import { describe, expect, it } from "vitest";
import {
  coverageOverlap,
  detectExtractability,
  evaluateStatementCoverage,
  isVagueCta,
  tokenize,
} from "@/lib/page-audit";

/**
 * §30's text heuristics, tested directly and without a database: whether a
 * page covers a persona requirement, whether a passage is structured for
 * extraction, and whether a CTA is specific enough to count as a real next
 * step.
 */

describe("tokenize / coverageOverlap", () => {
  it("ignores case, punctuation and stopwords", () => {
    const tokens = tokenize("The Data Cannot Leave Our VPC — that's non-negotiable.");
    expect(tokens.has("data")).toBe(true);
    expect(tokens.has("vpc")).toBe(true);
    expect(tokens.has("the")).toBe(false);
    expect(tokens.has("our")).toBe(false);
  });

  it("scores full overlap as 1 and no overlap as 0", () => {
    const a = tokenize("private cloud deployment");
    expect(coverageOverlap(a, a)).toBeCloseTo(1, 6);
    expect(coverageOverlap(a, tokenize("completely unrelated topic entirely"))).toBe(0);
  });

  it("returns 0 for an empty needle rather than dividing by zero", () => {
    expect(coverageOverlap(new Set(), tokenize("anything"))).toBe(0);
  });
});

describe("evaluateStatementCoverage", () => {
  const items = [
    { id: "c1", statement: "Customer data cannot leave our approved cloud environment" },
    { id: "c2", statement: "We require a SOC 2 Type II report before procurement will engage" },
  ];

  it("marks a statement covered when the page substantially repeats its wording", () => {
    const page =
      "Our platform supports private cloud deployment, so customer data never has to leave your approved cloud environment.";
    const [c1] = evaluateStatementCoverage(page, items);
    expect(c1?.covered).toBe(true);
  });

  it("marks a statement uncovered when the page never addresses it", () => {
    const page = "Our platform has a clean dashboard and helpful onboarding emails.";
    const [, c2] = evaluateStatementCoverage(page, items);
    expect(c2?.covered).toBe(false);
  });

  it("respects a stricter threshold", () => {
    const page = "We mention cloud once but nothing else about data residency.";
    const lenient = evaluateStatementCoverage(page, items, 0.05)[0];
    const strict = evaluateStatementCoverage(page, items, 0.9)[0];
    expect((lenient?.score ?? 0) >= (strict?.score ?? 0)).toBe(true);
  });
});

describe("detectExtractability", () => {
  it("treats unstructured prose with no direct answer as not extractable", () => {
    const prose =
      "Our platform brings together many capabilities in one place so your organization can move fast without compromising on control.";
    expect(detectExtractability(prose).extractable).toBe(false);
  });

  it("treats a page with headings and a list as extractable", () => {
    const structured = `# Deployment options

- Private cloud
- Self-hosted
- Managed SaaS`;
    const result = detectExtractability(structured);
    expect(result.hasHeadings).toBe(true);
    expect(result.hasList).toBe(true);
    expect(result.extractable).toBe(true);
  });

  it("detects a direct-answer sentence and a list as two extractability signals", () => {
    const page = `Private cloud deployment is a single-tenant deployment inside your own cloud account.

- Includes SOC 2 Type II
- Includes architecture review`;
    const result = detectExtractability(page);
    expect(result.hasDirectAnswer).toBe(true);
    expect(result.hasList).toBe(true);
    expect(result.extractable).toBe(true);
  });

  it("detects embedded JSON-LD as a structured-data signal", () => {
    const page = `Some marketing copy.
<script type="application/ld+json">{"@type":"Organization"}</script>`;
    expect(detectExtractability(page).hasStructuredData).toBe(true);
  });
});

describe("isVagueCta", () => {
  it("flags generic calls to action", () => {
    for (const phrase of ["Learn more", "Get Started", "Contact us", "Click here"]) {
      expect(isVagueCta(phrase)).toBe(true);
    }
  });

  it("does not flag a specific call to action", () => {
    expect(isVagueCta("See pricing for teams under 50")).toBe(false);
    expect(isVagueCta("Book a technical demo")).toBe(false);
  });
});
