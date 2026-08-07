import { describe, expect, it } from "vitest";
import { MockDataForSeoAdapter } from "@/adapters/dataforseo/mock";

/**
 * The mock DataForSEO adapter (ADR-009: mock is explicit, deterministic
 * state — never a fallback). Every case here asserts determinism (the same
 * input produces byte-identical output across separate adapter instances and
 * separate calls) or a plausibility property a downstream content-gap
 * analyzer depends on: search volumes that vary by keyword, SERP results
 * that reference a stable competitor-domain pool, and rankings confined to a
 * sane range.
 */

const TARGET = "northwind-analytics.example";

describe("MockDataForSeoAdapter determinism", () => {
  it("returns identical getKeywordsForSite output across separate instances", async () => {
    const a = await new MockDataForSeoAdapter().getKeywordsForSite({ target: TARGET });
    const b = await new MockDataForSeoAdapter().getKeywordsForSite({ target: TARGET });
    expect(a.data).toEqual(b.data);
    expect(a.itemCount).toBe(b.itemCount);
  });

  it("returns identical getRankedKeywords output across separate instances", async () => {
    const a = await new MockDataForSeoAdapter().getRankedKeywords({ target: TARGET });
    const b = await new MockDataForSeoAdapter().getRankedKeywords({ target: TARGET });
    expect(a.data).toEqual(b.data);
  });

  it("returns identical getOrganicSerp output, including the vendor task id, across calls", async () => {
    const adapter = new MockDataForSeoAdapter();
    const a = await adapter.getOrganicSerp({ keyword: "product analytics platform" });
    const b = await adapter.getOrganicSerp({ keyword: "product analytics platform" });
    expect(a.data).toEqual(b.data);
    expect(a.vendorTaskId).toBe(b.vendorTaskId);
    expect(a.vendorTaskId).not.toBeNull();
  });

  it("returns identical getReviews output, including the vendor task id, across calls", async () => {
    const adapter = new MockDataForSeoAdapter();
    const a = await adapter.getReviews({ query: "Northwind Analytics" });
    const b = await adapter.getReviews({ query: "Northwind Analytics" });
    expect(a.data).toEqual(b.data);
    expect(a.vendorTaskId).toBe(b.vendorTaskId);
  });

  it("produces different output for different targets", async () => {
    const adapter = new MockDataForSeoAdapter();
    const a = await adapter.getKeywordsForSite({ target: "northwind-analytics.example" });
    const b = await adapter.getKeywordsForSite({ target: "some-other-domain.example" });
    expect(a.data).not.toEqual(b.data);
  });

  it("always reports dataOrigin 'live' as false — mock mode is 'mock', never mixed with live", async () => {
    const adapter = new MockDataForSeoAdapter();
    expect(adapter.mode).toBe("mock");
    const result = await adapter.getKeywordsForSite({ target: TARGET });
    expect(result.dataOrigin).toBe("mock");
    expect(result.costCents).toBe(0);
  });
});

describe("MockDataForSeoAdapter plausibility", () => {
  it("varies search volume by keyword rather than returning a flat number", async () => {
    const adapter = new MockDataForSeoAdapter();
    const result = await adapter.getSearchVolume({
      keywords: [
        "product analytics platform",
        "cohort analysis software",
        "session replay software",
      ],
    });
    const volumes = new Set(result.data.volumes.map((v) => v.searchVolume));
    expect(volumes.size).toBeGreaterThan(1);
    for (const row of result.data.volumes) {
      expect(row.monthlySearches).toHaveLength(12);
    }
  });

  it("keeps getRankedKeywords positions within 1..100 and sorted ascending", async () => {
    const adapter = new MockDataForSeoAdapter();
    const result = await adapter.getRankedKeywords({ target: TARGET, limit: 50 });
    const positions = result.data.keywords.map((k) => k.position);
    for (const position of positions) {
      expect(position).toBeGreaterThanOrEqual(1);
      expect(position).toBeLessThanOrEqual(100);
    }
    expect(positions).toEqual([...positions].sort((a, b) => a - b));
  });

  it("returns SERP items whose domains come from the shared competitor pool", async () => {
    const adapter = new MockDataForSeoAdapter();
    const result = await adapter.getOrganicSerp({
      keyword: "product analytics platform",
      depth: 20,
    });
    expect(result.data.items).toHaveLength(20);
    for (const item of result.data.items) {
      expect(item.domain).toMatch(/\.example$/);
      expect(item.rank).toBeGreaterThanOrEqual(1);
    }
  });

  it("excludes the queried target from its own getDomainCompetitors result", async () => {
    const adapter = new MockDataForSeoAdapter();
    // Use a domain that is itself in the competitor pool to exercise the exclusion.
    const result = await adapter.getDomainCompetitors({ target: "rivergate-metrics.example" });
    expect(result.data.competitors.every((c) => c.domain !== "rivergate-metrics.example")).toBe(
      true,
    );
  });

  it("classifies commercial-modifier keywords as commercial or transactional intent", async () => {
    const adapter = new MockDataForSeoAdapter();
    const result = await adapter.getKeywordIntent({
      keywords: ["best product analytics platform", "product analytics pricing"],
    });
    for (const row of result.data.intents) {
      expect(["commercial", "transactional"]).toContain(row.intent);
      expect(row.probability).toBeGreaterThanOrEqual(0.55);
      expect(row.probability).toBeLessThanOrEqual(0.95);
    }
  });

  it("returns reviews with ratings in 1..5 and a deterministic subset with owner responses", async () => {
    const adapter = new MockDataForSeoAdapter();
    const result = await adapter.getReviews({ query: "Northwind Analytics", depth: 30 });
    expect(result.data.reviews).toHaveLength(30);
    for (const review of result.data.reviews) {
      expect(review.rating).toBeGreaterThanOrEqual(1);
      expect(review.rating).toBeLessThanOrEqual(5);
    }
    // Not every review has an owner response, and not none — otherwise the
    // "hasOwnerResponse" branch in the generator would be dead code.
    const withResponse = result.data.reviews.filter((r) => r.ownerResponseText !== null);
    expect(withResponse.length).toBeGreaterThan(0);
    expect(withResponse.length).toBeLessThan(30);
  });

  it("deduplicates repeated keywords in bulk metric requests", async () => {
    const adapter = new MockDataForSeoAdapter();
    const result = await adapter.getKeywordMetrics({
      keywords: ["product analytics pricing", "product analytics pricing"],
    });
    expect(result.data.metrics).toHaveLength(1);
    expect(result.itemCount).toBe(1);
  });
});
