import { describe, expect, it } from "vitest";
import {
  assertTaskQueuedOrSucceeded,
  assertTaskSucceeded,
  dollarsToCents,
  extractResultRows,
  isPendingStatus,
  isSuccessStatus,
  toDomainCompetitor,
  toKeywordIdea,
  toKeywordIntentRow,
  toKeywordMetric,
  toRankedKeyword,
  toReview,
  toSearchVolumeRow,
  toSerpItem,
} from "@/adapters/dataforseo/normalize";
import { VendorError } from "@/lib/errors";

/**
 * Pure unit tests for the raw-vendor-shape → normalized-type mapping
 * (§ ADR-011: the live adapter is `@unverified`, so this mapping layer is
 * exactly where a wrong field-name assumption would surface first). None of
 * this touches HTTP; `dataforseo-live.test.ts` covers the network wiring
 * around it with a mocked `fetch`.
 */

describe("status-code bands", () => {
  it("treats 20000..20099 as success", () => {
    expect(isSuccessStatus(20000)).toBe(true);
    expect(isSuccessStatus(20099)).toBe(true);
    expect(isSuccessStatus(20100)).toBe(false);
    expect(isSuccessStatus(19999)).toBe(false);
  });

  it("treats 20100..20199 as pending", () => {
    expect(isPendingStatus(20100)).toBe(true);
    expect(isPendingStatus(20199)).toBe(true);
    expect(isPendingStatus(20099)).toBe(false);
    expect(isPendingStatus(20200)).toBe(false);
  });
});

describe("assertTaskSucceeded", () => {
  it("does not throw for a success status", () => {
    expect(() =>
      assertTaskSucceeded({ id: "t1", status_code: 20000, result: null }, "op"),
    ).not.toThrow();
  });

  it("throws a non-retryable VendorError for a generic failure status", () => {
    expect(() =>
      assertTaskSucceeded(
        { id: "t1", status_code: 40400, status_message: "Not Found.", result: null },
        "getRankedKeywords",
      ),
    ).toThrow(VendorError);
    try {
      assertTaskSucceeded(
        { id: "t1", status_code: 40400, status_message: "Not Found.", result: null },
        "getRankedKeywords",
      );
    } catch (error) {
      expect(error).toBeInstanceOf(VendorError);
      expect((error as VendorError).retryable).toBe(false);
      expect((error as VendorError).vendor).toBe("dataforseo");
      expect((error as VendorError).operation).toBe("getRankedKeywords");
    }
  });

  it("throws a retryable vendor_rate_limited error for status 40029", () => {
    try {
      assertTaskSucceeded({ id: "t1", status_code: 40029, result: null }, "getSearchVolume");
      throw new Error("expected assertTaskSucceeded to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(VendorError);
      expect((error as VendorError).code).toBe("vendor_rate_limited");
      expect((error as VendorError).retryable).toBe(true);
    }
  });

  it("rejects a pending status for a 'live' endpoint — pending is only valid for task-get", () => {
    expect(() =>
      assertTaskSucceeded({ id: "t1", status_code: 20100, result: null }, "getKeywordMetrics"),
    ).toThrow(VendorError);
  });
});

describe("assertTaskQueuedOrSucceeded", () => {
  it("does not throw for a pending status", () => {
    expect(() =>
      assertTaskQueuedOrSucceeded({ id: "t1", status_code: 20100, result: null }, "getOrganicSerp"),
    ).not.toThrow();
  });

  it("does not throw for a success status", () => {
    expect(() =>
      assertTaskQueuedOrSucceeded({ id: "t1", status_code: 20000, result: [{}] }, "getOrganicSerp"),
    ).not.toThrow();
  });

  it("throws for a genuine failure status", () => {
    expect(() =>
      assertTaskQueuedOrSucceeded(
        { id: "t1", status_code: 40501, status_message: "Invalid Field.", result: null },
        "getReviews",
      ),
    ).toThrow(VendorError);
  });
});

describe("extractResultRows", () => {
  it("returns an empty array for a null or undefined result", () => {
    expect(extractResultRows(null)).toEqual([]);
    expect(extractResultRows(undefined)).toEqual([]);
  });

  it("unwraps a single wrapper object's `items` array (DataForSEO Labs shape)", () => {
    const rows = [{ items: [{ keyword: "a" }, { keyword: "b" }] }];
    expect(extractResultRows(rows)).toEqual([{ keyword: "a" }, { keyword: "b" }]);
  });

  it("returns the array directly when it is not a single items-wrapper (Keywords Data shape)", () => {
    const rows = [{ keyword: "a" }, { keyword: "b" }];
    expect(extractResultRows(rows)).toEqual(rows);
  });

  it("returns a lone non-wrapper row as a one-element array, not unwrapped", () => {
    const rows = [{ keyword: "a" }];
    expect(extractResultRows(rows)).toEqual([{ keyword: "a" }]);
  });
});

describe("dollarsToCents", () => {
  it("rounds to the nearest cent", () => {
    expect(dollarsToCents(0.001)).toBe(0);
    expect(dollarsToCents(1.01)).toBe(101);
    expect(dollarsToCents(2.5)).toBe(250);
  });
});

describe("toKeywordIdea", () => {
  it("maps a fully populated row", () => {
    const idea = toKeywordIdea({
      keyword: "product analytics platform",
      keyword_info: { search_volume: 1200, cpc: 4.5, competition: 0.62 },
      keyword_difficulty: 55,
    });
    expect(idea).toEqual({
      keyword: "product analytics platform",
      searchVolume: 1200,
      cpc: 4.5,
      competition: 0.62,
      difficulty: 55,
    });
  });

  it("defaults every metric to null when keyword_info is absent", () => {
    const idea = toKeywordIdea({ keyword: "product analytics platform" });
    expect(idea).toEqual({
      keyword: "product analytics platform",
      searchVolume: null,
      cpc: null,
      competition: null,
      difficulty: null,
    });
  });
});

describe("toRankedKeyword", () => {
  it("maps position, url and estimated traffic from the nested serp_item", () => {
    const ranked = toRankedKeyword({
      keyword: "product analytics pricing",
      keyword_info: { search_volume: 800, cpc: 3, competition: 0.4 },
      keyword_difficulty: 30,
      ranked_serp_element: {
        serp_item: { rank_absolute: 4, url: "https://example.com/pricing", etv: 96 },
      },
    });
    expect(ranked.position).toBe(4);
    expect(ranked.url).toBe("https://example.com/pricing");
    expect(ranked.estimatedTraffic).toBe(96);
    expect(ranked.searchVolume).toBe(800);
  });

  it("defaults position to 0 and url/traffic to null when the SERP element is missing", () => {
    const ranked = toRankedKeyword({ keyword: "product analytics pricing" });
    expect(ranked.position).toBe(0);
    expect(ranked.url).toBeNull();
    expect(ranked.estimatedTraffic).toBeNull();
  });
});

describe("toKeywordMetric", () => {
  it("lowercases the vendor's uppercase competition level", () => {
    const metric = toKeywordMetric({
      keyword: "cohort analysis software",
      keyword_info: { competition_level: "HIGH" },
    });
    expect(metric.competitionLevel).toBe("high");
  });

  it("leaves competitionLevel null when the vendor omits it", () => {
    const metric = toKeywordMetric({ keyword: "cohort analysis software" });
    expect(metric.competitionLevel).toBeNull();
  });
});

describe("toSearchVolumeRow", () => {
  it("maps monthly_searches to camelCase rows in order", () => {
    const row = toSearchVolumeRow({
      keyword: "session replay software",
      search_volume: 500,
      monthly_searches: [
        { year: 2026, month: 1, search_volume: 480 },
        { year: 2026, month: 2, search_volume: 520 },
      ],
    });
    expect(row.monthlySearches).toEqual([
      { year: 2026, month: 1, searchVolume: 480 },
      { year: 2026, month: 2, searchVolume: 520 },
    ]);
  });

  it("returns an empty monthlySearches array when the vendor omits it", () => {
    const row = toSearchVolumeRow({ keyword: "session replay software" });
    expect(row.monthlySearches).toEqual([]);
  });
});

describe("toKeywordIntentRow", () => {
  it("maps the nested label and probability", () => {
    const row = toKeywordIntentRow({
      keyword: "best product analytics platform",
      keyword_intent: { label: "commercial", probability: 0.83 },
    });
    expect(row.intent).toBe("commercial");
    expect(row.probability).toBe(0.83);
  });

  it("defaults to informational/0 when the vendor omits keyword_intent", () => {
    const row = toKeywordIntentRow({ keyword: "best product analytics platform" });
    expect(row.intent).toBe("informational");
    expect(row.probability).toBe(0);
  });
});

describe("toSerpItem", () => {
  it("maps a recognised SERP item type", () => {
    const item = toSerpItem({
      rank_absolute: 1,
      type: "featured_snippet",
      url: "https://example.com",
      domain: "example.com",
      title: "Example",
      description: "A description.",
    });
    expect(item.type).toBe("featured_snippet");
  });

  it("falls back to 'organic' for an unrecognised vendor type rather than throwing", () => {
    const item = toSerpItem({ rank_absolute: 5, type: "knowledge_graph" });
    expect(item.type).toBe("organic");
  });
});

describe("toDomainCompetitor", () => {
  it("prefers intersections for commonKeywords, falling back to metrics.organic.count", () => {
    const withIntersections = toDomainCompetitor({
      domain: "rivergate-metrics.example",
      intersections: 42,
      metrics: { organic: { count: 10 } },
    });
    expect(withIntersections.commonKeywords).toBe(42);

    const withoutIntersections = toDomainCompetitor({
      domain: "rivergate-metrics.example",
      metrics: { organic: { count: 10 } },
    });
    expect(withoutIntersections.commonKeywords).toBe(10);
  });

  it("defaults commonKeywords to 0 when neither source is present", () => {
    const competitor = toDomainCompetitor({ domain: "rivergate-metrics.example" });
    expect(competitor.commonKeywords).toBe(0);
  });
});

describe("toReview", () => {
  it("maps a fully populated row", () => {
    const review = toReview({
      review_id: "abc123",
      reviewer_name: "J. Alvarez",
      rating: { value: 4 },
      review_text: "Solid tool.",
      timestamp: "2026-01-15T00:00:00.000Z",
      owner_response: "Thanks!",
    });
    expect(review).toEqual({
      reviewId: "abc123",
      authorName: "J. Alvarez",
      rating: 4,
      text: "Solid tool.",
      publishedAt: "2026-01-15T00:00:00.000Z",
      ownerResponseText: "Thanks!",
    });
  });

  it("derives a stable fallback id when the vendor omits review_id", () => {
    const row = { reviewer_name: "M. Chen", review_text: "Fine." };
    const a = toReview(row);
    const b = toReview({ ...row });
    expect(a.reviewId).toBe(b.reviewId);
    expect(a.reviewId).toMatch(/^unidentified_/);
  });
});
