import { describe, expect, it } from "vitest";
import {
  aggregateMetrics,
  classifyResult,
  compareControl,
  competitorShareOfVoiceFor,
  mergeVisibilityCitations,
  type SnapshotMetrics,
} from "@/lib/profound-results";
import type { ProfoundCitationsRow, ProfoundVisibilityRow } from "@/adapters/profound/types";

/**
 * Pure unit tests for result normalization (§25, redesigned 2026-08-10 around
 * the real bucket-shaped v2 reporting API): merging visibility with
 * citations, competitor share-of-voice lookup, classification, and the
 * control-comparison maths. Nothing here touches a database or an adapter.
 */

function visibilityRow(overrides: Partial<ProfoundVisibilityRow> = {}): ProfoundVisibilityRow {
  return {
    profoundPromptId: "pfp_1",
    bucketDate: "2026-01-01",
    modelId: "pfm_chatgpt",
    model: "ChatGPT",
    topicId: "top_pricing",
    topic: "Pricing",
    regionId: "reg_us",
    region: "United States",
    personaId: "per_1",
    profoundPersona: "Compliance-conscious buyer",
    asset: "northwind-analytics.example",
    assetOwned: true,
    rank: 1,
    visibilityScore: 0.6,
    shareOfVoice: 0.5,
    averagePosition: 1.5,
    ...overrides,
  };
}

function citationRow(overrides: Partial<ProfoundCitationsRow> = {}): ProfoundCitationsRow {
  return {
    profoundPromptId: "pfp_1",
    bucketDate: "2026-01-01",
    domain: "northwind-analytics.example",
    count: 2,
    citationShare: 0.4,
    rank: 1,
    ...overrides,
  };
}

describe("mergeVisibilityCitations", () => {
  it("attaches matching citations onto the owned asset's bucket row", () => {
    const merged = mergeVisibilityCitations([visibilityRow()], [citationRow()]);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.citationCount).toBe(2);
    expect(merged[0]?.citationShare).toBeCloseTo(0.4);
    expect(merged[0]?.citationDomains).toEqual(["northwind-analytics.example"]);
    expect(merged[0]?.citations).toEqual([
      { domain: "northwind-analytics.example", count: 2, citationShare: 0.4, rank: 1 },
    ]);
  });

  it("sums counts and averages shares across multiple matching citation rows", () => {
    const merged = mergeVisibilityCitations(
      [visibilityRow()],
      [
        citationRow({ domain: "a.example", count: 3, citationShare: 0.6 }),
        citationRow({ domain: "b.example", count: 1, citationShare: 0.2 }),
      ],
    );

    expect(merged[0]?.citationCount).toBe(4);
    expect(merged[0]?.citationShare).toBeCloseTo(0.4);
    expect(merged[0]?.citationDomains).toEqual(["a.example", "b.example"]);
  });

  it("defaults citation fields when no citation row matches the bucket", () => {
    const merged = mergeVisibilityCitations([visibilityRow()], []);
    expect(merged[0]).toMatchObject({
      citationCount: 0,
      citationShare: null,
      citationDomains: [],
      citations: [],
    });
  });

  it("never attaches citations to a competitor (non-owned) asset row", () => {
    const merged = mergeVisibilityCitations(
      [visibilityRow({ asset: "rivergate-metrics.example", assetOwned: false })],
      [citationRow()],
    );
    expect(merged[0]?.citationCount).toBe(0);
    expect(merged[0]?.citations).toEqual([]);
  });

  it("drops a citation row from a different (prompt, date) than the visibility row — the real API's only citation-matching grain", () => {
    const merged = mergeVisibilityCitations(
      [visibilityRow()],
      [citationRow({ bucketDate: "2026-01-02" })],
    );
    expect(merged[0]?.citationCount).toBe(0);
  });

  it("attaches the same (prompt, date) citation set to every model's bucket for that prompt, since citations aren't model-scoped in the real API", () => {
    const merged = mergeVisibilityCitations(
      [visibilityRow({ modelId: "pfm_chatgpt" }), visibilityRow({ modelId: "pfm_perplexity" })],
      [citationRow()],
    );
    expect(merged[0]?.citationCount).toBe(2);
    expect(merged[1]?.citationCount).toBe(2);
  });

  it("filters out visibility rows with a null profoundPromptId", () => {
    const merged = mergeVisibilityCitations([visibilityRow({ profoundPromptId: null })], []);
    expect(merged).toHaveLength(0);
  });
});

describe("competitorShareOfVoiceFor", () => {
  const key = {
    profoundPromptId: "pfp_1",
    bucketDate: "2026-01-01",
    modelId: "pfm_chatgpt",
    topicId: "top_pricing",
    regionId: "reg_us",
    personaId: "per_1",
  };

  it("returns null when no competitor asset rows exist in the same bucket", () => {
    expect(competitorShareOfVoiceFor(key, [visibilityRow()])).toBeNull();
  });

  it("returns the strongest competitor's share of voice in the same bucket", () => {
    const rows = [
      visibilityRow(),
      visibilityRow({ asset: "rivergate-metrics.example", assetOwned: false, shareOfVoice: 0.3 }),
      visibilityRow({ asset: "beacon-insights.example", assetOwned: false, shareOfVoice: 0.55 }),
    ];
    expect(competitorShareOfVoiceFor(key, rows)).toBeCloseTo(0.55);
  });

  it("ignores competitor rows from a different bucket", () => {
    const rows = [
      visibilityRow(),
      visibilityRow({
        asset: "rivergate-metrics.example",
        assetOwned: false,
        modelId: "pfm_perplexity",
        shareOfVoice: 0.9,
      }),
    ];
    expect(competitorShareOfVoiceFor(key, rows)).toBeNull();
  });
});

describe("classifyResult", () => {
  it("classifies as brand_absent when visibilityScore is null", () => {
    const result = classifyResult({
      visibilityScore: null,
      shareOfVoice: null,
      competitorShareOfVoice: null,
    });
    expect(result.classification).toBe("brand_absent");
    expect(result.competitorVisible).toBeNull();
  });

  it("classifies as brand_absent when visibilityScore is at or below the near-zero threshold", () => {
    const result = classifyResult({
      visibilityScore: 0.01,
      shareOfVoice: 0,
      competitorShareOfVoice: null,
    });
    expect(result.classification).toBe("brand_absent");
  });

  it("classifies as normal when visibilityScore is meaningfully above zero", () => {
    const result = classifyResult({
      visibilityScore: 0.6,
      shareOfVoice: 0.5,
      competitorShareOfVoice: null,
    });
    expect(result.classification).toBe("normal");
  });

  it("leaves competitorVisible null when competitor scope was not measured", () => {
    const result = classifyResult({
      visibilityScore: 0.6,
      shareOfVoice: 0.5,
      competitorShareOfVoice: null,
    });
    expect(result.competitorVisible).toBeNull();
  });

  it("sets competitorVisible true when a competitor's share exceeds the brand's own", () => {
    const result = classifyResult({
      visibilityScore: 0.4,
      shareOfVoice: 0.2,
      competitorShareOfVoice: 0.5,
    });
    expect(result.competitorVisible).toBe(true);
  });

  it("sets competitorVisible false when the brand leads its own share of voice", () => {
    const result = classifyResult({
      visibilityScore: 0.6,
      shareOfVoice: 0.6,
      competitorShareOfVoice: 0.2,
    });
    expect(result.competitorVisible).toBe(false);
  });
});

describe("aggregateMetrics", () => {
  it("means the rate-like fields and sums citation counts", () => {
    const rows: SnapshotMetrics[] = [
      { visibilityScore: 0.4, shareOfVoice: 0.3, citationCount: 1, citationShare: 0.2, averagePosition: 2 },
      { visibilityScore: 0.6, shareOfVoice: 0.5, citationCount: 3, citationShare: 0.4, averagePosition: 4 },
    ];

    const result = aggregateMetrics(rows);

    expect(result.visibilityScore).toBeCloseTo(0.5);
    expect(result.shareOfVoice).toBeCloseTo(0.4);
    expect(result.citationCount).toBe(4);
    expect(result.citationShare).toBeCloseTo(0.3);
    expect(result.averagePosition).toBe(3);
    expect(result.bucketCount).toBe(2);
  });

  it("returns nulls for rate-like fields and zero counts on an empty set", () => {
    const result = aggregateMetrics([]);
    expect(result.visibilityScore).toBeNull();
    expect(result.shareOfVoice).toBeNull();
    expect(result.averagePosition).toBeNull();
    expect(result.citationCount).toBe(0);
    expect(result.bucketCount).toBe(0);
  });

  it("ignores nulls when averaging rather than treating them as zero", () => {
    const rows: SnapshotMetrics[] = [
      { visibilityScore: 0.8, shareOfVoice: null, citationCount: 0, citationShare: null, averagePosition: null },
      { visibilityScore: null, shareOfVoice: null, citationCount: 0, citationShare: null, averagePosition: null },
    ];
    const result = aggregateMetrics(rows);
    // If null were treated as zero this would be 0.4, not 0.8.
    expect(result.visibilityScore).toBe(0.8);
    expect(result.shareOfVoice).toBeNull();
  });
});

describe("compareControl", () => {
  const persona: SnapshotMetrics[] = [
    { visibilityScore: 0.7, shareOfVoice: 0.6, citationCount: 3, citationShare: 0.5, averagePosition: 1.2 },
  ];
  const control: SnapshotMetrics[] = [
    { visibilityScore: 0.3, shareOfVoice: 0.2, citationCount: 1, citationShare: 0.1, averagePosition: 3.4 },
  ];

  it("computes deltas as persona minus control", () => {
    const comparison = compareControl(persona, control);
    expect(comparison.deltas.shareOfVoice).toBeCloseTo(0.4);
    expect(comparison.deltas.visibilityScore).toBeCloseTo(0.4);
    expect(comparison.deltas.citationCount).toBe(2);
  });

  it("flags personaOutperforms when the persona's share of voice is higher", () => {
    expect(compareControl(persona, control).personaOutperforms).toBe(true);
    expect(compareControl(control, persona).personaOutperforms).toBe(false);
  });

  it("computes lift percent relative to the control's own share of voice", () => {
    // (0.6 - 0.2) / 0.2 * 100 = 200%
    expect(compareControl(persona, control).liftPercent).toBeCloseTo(200);
  });

  it("returns a null lift when the control had no share of voice to lift from", () => {
    const zeroControl: SnapshotMetrics[] = [
      { visibilityScore: 0, shareOfVoice: 0, citationCount: 0, citationShare: null, averagePosition: null },
    ];
    expect(compareControl(persona, zeroControl).liftPercent).toBeNull();
  });

  it("does not claim the persona outperforms an empty control", () => {
    const comparison = compareControl(persona, []);
    expect(comparison.control.shareOfVoice).toBeNull();
    expect(comparison.personaOutperforms).toBe(true);
  });
});
