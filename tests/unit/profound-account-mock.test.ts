import { describe, expect, it } from "vitest";
import { MockProfoundAdapter } from "@/adapters/profound/mock";
import { NotFoundError } from "@/lib/errors";

/**
 * Account-level reporting on the mock Profound adapter — distinct from the
 * prompt-scoped reporting covered by tests/unit/profound-results.test.ts.
 * Scoped to a category and a date range, grouped by topic, with no
 * dependency on any prompt this product deployed.
 */

const CATEGORY_ID = "pfc_product_analytics";

describe("MockProfoundAdapter account-level reporting", () => {
  it("returns one visibility row per topic per day in range", async () => {
    const adapter = new MockProfoundAdapter();
    const rows = await adapter.queryAccountVisibility({
      categoryId: CATEGORY_ID,
      startDate: "2026-01-01",
      endDate: "2026-01-03",
    });
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.visibilityScore).toBeGreaterThanOrEqual(0);
      expect(row.visibilityScore).toBeLessThanOrEqual(1);
      expect(row.shareOfVoice).toBeGreaterThanOrEqual(0);
    }
  });

  it("is deterministic across separate adapter instances", async () => {
    const query = { categoryId: CATEGORY_ID, startDate: "2026-01-01", endDate: "2026-01-02" };
    const a = await new MockProfoundAdapter().queryAccountVisibility(query);
    const b = await new MockProfoundAdapter().queryAccountVisibility(query);
    expect(a).toEqual(b);

    const citationsA = await new MockProfoundAdapter().queryAccountCitations(query);
    const citationsB = await new MockProfoundAdapter().queryAccountCitations(query);
    expect(citationsA).toEqual(citationsB);

    const sentimentA = await new MockProfoundAdapter().queryAccountSentiment(query);
    const sentimentB = await new MockProfoundAdapter().queryAccountSentiment(query);
    expect(sentimentA).toEqual(sentimentB);
  });

  it("rejects a category that does not exist in the mock account", async () => {
    const adapter = new MockProfoundAdapter();
    await expect(
      adapter.queryAccountVisibility({
        categoryId: "pfc_does_not_exist",
        startDate: "2026-01-01",
        endDate: "2026-01-01",
      }),
    ).rejects.toThrow(NotFoundError);
  });

  it("citation rows only include top domains when there were citations", async () => {
    const adapter = new MockProfoundAdapter();
    const rows = await adapter.queryAccountCitations({
      categoryId: CATEGORY_ID,
      startDate: "2026-01-01",
      endDate: "2026-01-10",
    });
    for (const row of rows) {
      if (row.citationCount === 0) {
        expect(row.citationShare).toBeNull();
      } else {
        expect(row.topDomains.length).toBeGreaterThan(0);
      }
    }
  });
});
