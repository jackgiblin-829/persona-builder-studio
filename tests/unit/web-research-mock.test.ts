import { describe, expect, it } from "vitest";
import { MockOpenAIAdapter } from "@/adapters/openai/mock";
import { generateWebResearchPlan } from "@/adapters/openai/mock/web-research-plan";
import { webResearchPlanSchema } from "@/prompts/schemas";

const MODELS = {
  economical: "mock-economical",
  reasoning: "mock-reasoning",
  embedding: "mock-embed",
};

describe("web research planning (mock)", () => {
  it("produces a schema-valid plan", () => {
    const plan = generateWebResearchPlan({
      brandName: "Northwind Analytics",
      brandDescription: "Self-hosted product analytics for regulated industries.",
      competitorNames: ["Cobalt Insights"],
    });
    expect(webResearchPlanSchema.safeParse(plan).success).toBe(true);
    expect(plan.queries.length).toBeGreaterThanOrEqual(1);
  });

  it("mentions the named competitor in at least one query", () => {
    const plan = generateWebResearchPlan({
      brandName: "Northwind Analytics",
      brandDescription: "Self-hosted product analytics for regulated industries.",
      competitorNames: ["Cobalt Insights"],
    });
    expect(plan.queries.some((q) => q.query.includes("Cobalt Insights"))).toBe(true);
  });
});

describe("MockOpenAIAdapter.webSearch", () => {
  it("is deterministic for the same query", async () => {
    const adapter = new MockOpenAIAdapter(MODELS);
    const a = await adapter.webSearch({
      query: "buyer sentiment for analytics tools",
      brandContext: "x",
    });
    const b = await adapter.webSearch({
      query: "buyer sentiment for analytics tools",
      brandContext: "y",
    });
    expect(a.findings).toBe(b.findings);
    expect(a.citations).toEqual(b.citations);
  });

  it("never returns a citation on a real-looking domain", async () => {
    const adapter = new MockOpenAIAdapter(MODELS);
    const result = await adapter.webSearch({ query: "market trends", brandContext: "x" });
    for (const citation of result.citations) {
      expect(citation.url).toContain("mock-source.example");
    }
  });

  it("returns mock data origin and zero cost", async () => {
    const adapter = new MockOpenAIAdapter(MODELS);
    const result = await adapter.webSearch({ query: "pricing models", brandContext: "x" });
    expect(result.dataOrigin).toBe("mock");
    expect(result.costCents).toBe(0);
    expect(result.findings.length).toBeGreaterThan(0);
  });
});
