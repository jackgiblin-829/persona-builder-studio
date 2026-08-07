import { describe, expect, it } from "vitest";
import {
  aggregateMetrics,
  classifyResult,
  compareControl,
  detectMissingElements,
  mergeResultRows,
  type SnapshotMetrics,
} from "@/lib/profound-results";
import type {
  ProfoundAnswerRow,
  ProfoundCitationsRow,
  ProfoundSentimentRow,
  ProfoundVisibilityRow,
} from "@/adapters/profound/types";

/**
 * Pure unit tests for result normalization (§25): merging the four vendor
 * reports into one row, classification, missing-element detection, and the
 * control-comparison maths. Nothing here touches a database or an adapter.
 */

function visibilityRow(overrides: Partial<ProfoundVisibilityRow> = {}): ProfoundVisibilityRow {
  return {
    profoundPromptId: "pfp_1",
    runId: "run_20260101",
    runDate: "2026-01-01",
    modelId: "pfm_chatgpt",
    model: "ChatGPT",
    region: "us",
    asset: null,
    topic: "Pricing",
    profoundPersona: null,
    tags: [],
    visibilityScore: 0.6,
    shareOfVoice: 0.5,
    mentionCount: 3,
    executions: 40,
    averagePosition: 1.5,
    brandMentioned: true,
    mentions: [{ entity: "Rivergate Metrics", mentionCount: 2, share: 0.2 }],
    ...overrides,
  };
}

describe("mergeResultRows", () => {
  it("merges visibility, citations, sentiment and answers by (promptId, runId, modelId)", () => {
    const key = { profoundPromptId: "pfp_1", runId: "run_20260101", modelId: "pfm_chatgpt" };
    const citations: ProfoundCitationsRow[] = [
      {
        ...key,
        citationCount: 2,
        citationShare: 0.4,
        citations: [{ url: "x" }],
        searchQueries: ["q"],
      },
    ];
    const sentiment: ProfoundSentimentRow[] = [
      { ...key, sentimentThemes: [{ theme: "pricing", sentiment: "neutral" }] },
    ];
    const answers: ProfoundAnswerRow[] = [{ ...key, rawAnswer: "Northwind is a good fit." }];

    const merged = mergeResultRows([visibilityRow()], citations, sentiment, answers);

    expect(merged).toHaveLength(1);
    const [row] = merged;
    expect(row?.citationCount).toBe(2);
    expect(row?.sentimentThemes).toEqual([{ theme: "pricing", sentiment: "neutral" }]);
    expect(row?.rawAnswer).toBe("Northwind is a good fit.");
  });

  it("drops citations/sentiment/answers that have no matching visibility row", () => {
    const orphan = { profoundPromptId: "pfp_2", runId: "run_x", modelId: "pfm_chatgpt" };
    const merged = mergeResultRows(
      [visibilityRow()],
      [{ ...orphan, citationCount: 9, citationShare: null, citations: [], searchQueries: [] }],
      [],
      [],
    );

    expect(merged).toHaveLength(1);
    const [row] = merged;
    expect(row?.profoundPromptId).toBe("pfp_1");
    expect(row?.citationCount).toBe(0);
  });

  it("defaults citations/sentiment/answer fields when no row exists for a run", () => {
    const merged = mergeResultRows([visibilityRow()], [], [], []);
    expect(merged[0]).toMatchObject({
      citationCount: 0,
      citationShare: null,
      citations: [],
      searchQueries: [],
      sentimentThemes: [],
      rawAnswer: null,
    });
  });
});

describe("classifyResult", () => {
  it("classifies as brand_absent when the brand was not mentioned", () => {
    expect(
      classifyResult({ brandMentioned: false, mentionCount: 0, shareOfVoice: 0, mentions: [] }),
    ).toBe("brand_absent");
  });

  it("classifies as brand_absent when mentionCount is zero even if brandMentioned is stale-true", () => {
    expect(
      classifyResult({ brandMentioned: true, mentionCount: 0, shareOfVoice: 0, mentions: [] }),
    ).toBe("brand_absent");
  });

  it("classifies as competitor_dominated when a competitor's share exceeds the brand's own", () => {
    expect(
      classifyResult({
        brandMentioned: true,
        mentionCount: 2,
        shareOfVoice: 0.1,
        mentions: [{ entity: "Rivergate Metrics", share: 0.5 }],
      }),
    ).toBe("competitor_dominated");
  });

  it("classifies as normal when the brand leads its own share of voice", () => {
    expect(
      classifyResult({
        brandMentioned: true,
        mentionCount: 4,
        shareOfVoice: 0.6,
        mentions: [{ entity: "Rivergate Metrics", share: 0.2 }],
      }),
    ).toBe("normal");
  });

  it("does not classify as competitor_dominated when shareOfVoice is null (unknown, not zero)", () => {
    expect(
      classifyResult({
        brandMentioned: true,
        mentionCount: 1,
        shareOfVoice: null,
        mentions: [{ entity: "Rivergate Metrics", share: 0.9 }],
      }),
    ).toBe("normal");
  });
});

describe("detectMissingElements", () => {
  it("reports elements absent from the raw answer", () => {
    const missing = detectMissingElements(["self-hosted deployment", "SOC 2 report", "pricing"], {
      rawAnswer: "Northwind supports self-hosted deployment and publishes a SOC 2 report.",
    });
    expect(missing).toEqual(["pricing"]);
  });

  it("matches case- and whitespace-insensitively", () => {
    const missing = detectMissingElements(["Data Residency"], {
      rawAnswer: "Their   data residency   options are strong.",
    });
    expect(missing).toEqual([]);
  });

  it("reports every element missing when there is no answer text", () => {
    const missing = detectMissingElements(["pricing", "deployment"], { rawAnswer: null });
    expect(missing).toEqual(["pricing", "deployment"]);
  });

  it("reports nothing missing when there are no expected elements", () => {
    expect(detectMissingElements([], { rawAnswer: "anything" })).toEqual([]);
  });
});

describe("aggregateMetrics", () => {
  it("means the rate-like fields and sums the count-like fields", () => {
    const rows: SnapshotMetrics[] = [
      {
        visibilityScore: 0.4,
        shareOfVoice: 0.3,
        mentionCount: 2,
        executions: 10,
        citationCount: 1,
        citationShare: 0.2,
        averagePosition: 2,
      },
      {
        visibilityScore: 0.6,
        shareOfVoice: 0.5,
        mentionCount: 4,
        executions: 20,
        citationCount: 3,
        citationShare: 0.4,
        averagePosition: 4,
      },
    ];

    const result = aggregateMetrics(rows);

    expect(result.visibilityScore).toBeCloseTo(0.5);
    expect(result.shareOfVoice).toBeCloseTo(0.4);
    expect(result.mentionCount).toBe(6);
    expect(result.executions).toBe(30);
    expect(result.citationCount).toBe(4);
    expect(result.citationShare).toBeCloseTo(0.3);
    expect(result.averagePosition).toBe(3);
    expect(result.runCount).toBe(2);
  });

  it("returns nulls for rate-like fields and zeros for counts on an empty set", () => {
    const result = aggregateMetrics([]);
    expect(result.visibilityScore).toBeNull();
    expect(result.shareOfVoice).toBeNull();
    expect(result.averagePosition).toBeNull();
    expect(result.mentionCount).toBe(0);
    expect(result.executions).toBe(0);
    expect(result.citationCount).toBe(0);
    expect(result.runCount).toBe(0);
  });

  it("ignores nulls when averaging rather than treating them as zero", () => {
    const rows: SnapshotMetrics[] = [
      {
        visibilityScore: 0.8,
        shareOfVoice: null,
        mentionCount: 1,
        executions: 5,
        citationCount: 0,
        citationShare: null,
        averagePosition: null,
      },
      {
        visibilityScore: null,
        shareOfVoice: null,
        mentionCount: 0,
        executions: 5,
        citationCount: 0,
        citationShare: null,
        averagePosition: null,
      },
    ];
    const result = aggregateMetrics(rows);
    // If null were treated as zero this would be 0.4, not 0.8.
    expect(result.visibilityScore).toBe(0.8);
    expect(result.shareOfVoice).toBeNull();
  });
});

describe("compareControl", () => {
  const persona: SnapshotMetrics[] = [
    {
      visibilityScore: 0.7,
      shareOfVoice: 0.6,
      mentionCount: 5,
      executions: 10,
      citationCount: 3,
      citationShare: 0.5,
      averagePosition: 1.2,
    },
  ];
  const control: SnapshotMetrics[] = [
    {
      visibilityScore: 0.3,
      shareOfVoice: 0.2,
      mentionCount: 2,
      executions: 10,
      citationCount: 1,
      citationShare: 0.1,
      averagePosition: 3.4,
    },
  ];

  it("computes deltas as persona minus control", () => {
    const comparison = compareControl(persona, control);
    expect(comparison.deltas.shareOfVoice).toBeCloseTo(0.4);
    expect(comparison.deltas.visibilityScore).toBeCloseTo(0.4);
    expect(comparison.deltas.mentionCount).toBe(3);
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
      {
        visibilityScore: 0,
        shareOfVoice: 0,
        mentionCount: 0,
        executions: 5,
        citationCount: 0,
        citationShare: null,
        averagePosition: null,
      },
    ];
    expect(compareControl(persona, zeroControl).liftPercent).toBeNull();
  });

  it("does not claim the persona outperforms an empty control", () => {
    const comparison = compareControl(persona, []);
    expect(comparison.control.shareOfVoice).toBeNull();
    expect(comparison.personaOutperforms).toBe(true);
  });
});
