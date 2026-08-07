import { describe, expect, it } from "vitest";
import {
  CONFIDENCE_COMPONENT_KEYS,
  DEFAULT_CONFIDENCE_WEIGHTS,
  evaluateConfidence,
  RECENCY_HALF_LIFE_DAYS,
  rollUpConfidence,
  SOURCE_WEIGHTS,
  sourceWeightFor,
  type ConfidenceEvidence,
} from "@/lib/confidence";

const REFERENCE = new Date("2026-08-01T00:00:00Z");

function evidence(overrides: Partial<ConfidenceEvidence> = {}): ConfidenceEvidence {
  return {
    id: "ev_1",
    sourceId: "src_1",
    sourceType: "interview",
    provenance: "observed",
    qualityScore: 1,
    observedAt: REFERENCE,
    hedged: false,
    ...overrides,
  };
}

/** n records, each from its own source, all perfect on every other axis. */
function perfect(n: number): ConfidenceEvidence[] {
  return Array.from({ length: n }, (_, i) => evidence({ id: `ev_${i}`, sourceId: `src_${i}` }));
}

describe("source weights (§15)", () => {
  it("uses the specified starting weights for each source class", () => {
    expect(sourceWeightFor("interview")).toBe(1.0);
    expect(sourceWeightFor("sales_transcript")).toBe(1.0);
    expect(sourceWeightFor("search_console")).toBe(0.9);
    expect(sourceWeightFor("onsite_search")).toBe(0.9);
    expect(sourceWeightFor("review")).toBe(0.8);
    expect(sourceWeightFor("community")).toBe(0.8);
    expect(sourceWeightFor("sparktoro")).toBe(0.7);
    expect(sourceWeightFor("dataforseo")).toBe(0.65);
    expect(sourceWeightFor("brand_page")).toBe(0.4);
  });

  it("weights a brand assertion at brand-page strength whatever the source type", () => {
    // Brand copy quoted inside an interview is still the brand talking.
    expect(sourceWeightFor("interview", "brand_assertion")).toBe(SOURCE_WEIGHTS.brand_page);
  });

  it("falls back to the neutral weight for an unknown source type", () => {
    expect(sourceWeightFor("some_future_vendor")).toBe(SOURCE_WEIGHTS.other);
  });
});

describe("the eight components", () => {
  it("returns every component key, always", () => {
    const result = evaluateConfidence({
      supporting: perfect(1),
      contradicting: [],
      scopeSourceCount: 1,
      referenceDate: REFERENCE,
    });
    for (const key of CONFIDENCE_COMPONENT_KEYS) {
      expect(result.components[key]).toBeTypeOf("number");
    }
    expect(Object.keys(result.components)).toHaveLength(8);
  });

  it("scores cross-source agreement at zero for a single source", () => {
    const result = evaluateConfidence({
      supporting: [evidence(), evidence({ id: "ev_2" })],
      contradicting: [],
      scopeSourceCount: 3,
      referenceDate: REFERENCE,
    });
    expect(result.components.cross_source_agreement).toBe(0);
    expect(result.explanation).toContain("only one source");
  });

  it("reaches full cross-source agreement at three distinct sources", () => {
    expect(
      evaluateConfidence({
        supporting: perfect(2),
        contradicting: [],
        scopeSourceCount: 3,
        referenceDate: REFERENCE,
      }).components.cross_source_agreement,
    ).toBe(0.5);

    expect(
      evaluateConfidence({
        supporting: perfect(3),
        contradicting: [],
        scopeSourceCount: 3,
        referenceDate: REFERENCE,
      }).components.cross_source_agreement,
    ).toBe(1);
  });

  it("saturates evidence quantity rather than rewarding volume linearly", () => {
    const at = (n: number) =>
      evaluateConfidence({
        supporting: perfect(n),
        contradicting: [],
        scopeSourceCount: n,
        referenceDate: REFERENCE,
      }).components.evidence_quantity;

    const first = at(2) - at(1);
    const later = at(20) - at(19);
    expect(later).toBeLessThan(first);
    expect(at(50)).toBeLessThanOrEqual(1);
  });

  it("averages source weights into first-party strength", () => {
    const result = evaluateConfidence({
      supporting: [
        evidence({ sourceType: "interview", sourceId: "a" }),
        evidence({ sourceType: "brand_page", sourceId: "b", id: "ev_2" }),
      ],
      contradicting: [],
      scopeSourceCount: 2,
      referenceDate: REFERENCE,
    });
    expect(result.components.first_party_strength).toBeCloseTo(0.7, 5);
  });

  it("halves the recency contribution at exactly one half-life", () => {
    const oneHalfLifeAgo = new Date(REFERENCE.getTime() - RECENCY_HALF_LIFE_DAYS * 86_400_000);
    const result = evaluateConfidence({
      supporting: [evidence({ observedAt: oneHalfLifeAgo })],
      contradicting: [],
      scopeSourceCount: 1,
      referenceDate: REFERENCE,
    });
    expect(result.components.recency).toBeCloseTo(0.5, 3);
  });

  it("treats an unknown observation date as 0.5, not as stale", () => {
    const unknown = evaluateConfidence({
      supporting: [evidence({ observedAt: null })],
      contradicting: [],
      scopeSourceCount: 1,
      referenceDate: REFERENCE,
    });
    const ancient = evaluateConfidence({
      supporting: [evidence({ observedAt: new Date("2010-01-01T00:00:00Z") })],
      contradicting: [],
      scopeSourceCount: 1,
      referenceDate: REFERENCE,
    });
    expect(unknown.components.recency).toBe(0.5);
    expect(ancient.components.recency).toBeLessThan(0.05);
  });

  it("measures segment coverage as the share of the scope's sources reached", () => {
    const result = evaluateConfidence({
      supporting: perfect(2),
      contradicting: [],
      scopeSourceCount: 8,
      referenceDate: REFERENCE,
    });
    expect(result.components.segment_coverage).toBe(0.25);
  });

  it("credits external support from search data and externally supported provenance", () => {
    const fromSourceType = evaluateConfidence({
      supporting: [
        evidence({ sourceType: "search_console", sourceId: "a" }),
        evidence({ sourceType: "onsite_search", sourceId: "b", id: "ev_2" }),
      ],
      contradicting: [],
      scopeSourceCount: 2,
      referenceDate: REFERENCE,
    });
    expect(fromSourceType.components.external_support).toBe(1);

    const fromProvenance = evaluateConfidence({
      supporting: [evidence({ provenance: "externally_supported" })],
      contradicting: [],
      scopeSourceCount: 1,
      referenceDate: REFERENCE,
    });
    expect(fromProvenance.components.external_support).toBe(0.5);
  });

  it("penalises contradictions, capped so one disagreement cannot zero a claim", () => {
    const scoreWith = (n: number) =>
      evaluateConfidence({
        supporting: perfect(5),
        contradicting: Array.from({ length: n }, (_, i) =>
          evidence({ id: `bad_${i}`, sourceId: `bad_src_${i}` }),
        ),
        scopeSourceCount: 5,
        referenceDate: REFERENCE,
      });

    expect(scoreWith(0).components.contradiction_penalty).toBe(0);
    expect(scoreWith(1).components.contradiction_penalty).toBeCloseTo(0.12, 5);
    expect(scoreWith(20).components.contradiction_penalty).toBe(0.4);
    expect(scoreWith(3).score).toBeLessThan(scoreWith(0).score);
    expect(scoreWith(1).explanation).toContain("contradicting");
  });
});

describe("the formula", () => {
  it("sums to exactly the specified weighted formula", () => {
    const input = {
      supporting: [
        evidence({ sourceType: "interview", sourceId: "a", qualityScore: 0.8 }),
        evidence({ sourceType: "review", sourceId: "b", id: "ev_2", qualityScore: 0.6 }),
      ],
      contradicting: [evidence({ id: "bad", sourceId: "c" })],
      scopeSourceCount: 4,
      referenceDate: REFERENCE,
    };
    const result = evaluateConfidence(input);
    const c = result.components;
    const w = DEFAULT_CONFIDENCE_WEIGHTS;

    const expected =
      w.first_party_strength * c.first_party_strength +
      w.cross_source_agreement * c.cross_source_agreement +
      w.evidence_quantity * c.evidence_quantity +
      w.evidence_specificity * c.evidence_specificity +
      w.recency * c.recency +
      w.segment_coverage * c.segment_coverage +
      w.external_support * c.external_support -
      c.contradiction_penalty;

    expect(result.score).toBeCloseTo(expected, 2);
  });

  it("reaches 1.0 only when every component is maxed", () => {
    const result = evaluateConfidence({
      supporting: Array.from({ length: 8 }, (_, i) =>
        evidence({
          id: `ev_${i}`,
          sourceId: `src_${i}`,
          sourceType: i < 6 ? "interview" : "search_console",
          qualityScore: 1,
        }),
      ),
      contradicting: [],
      scopeSourceCount: 8,
      referenceDate: REFERENCE,
    });
    expect(result.score).toBeGreaterThan(0.95);
    expect(result.score).toBeLessThanOrEqual(1);
  });

  it("never returns a score outside 0–1", () => {
    const huge = evaluateConfidence({
      supporting: perfect(200),
      contradicting: perfect(200),
      scopeSourceCount: 200,
      referenceDate: REFERENCE,
    });
    expect(huge.score).toBeGreaterThanOrEqual(0);
    expect(huge.score).toBeLessThanOrEqual(1);
  });

  it("honours overridden weights", () => {
    const input = {
      supporting: [evidence({ sourceType: "brand_page" })],
      contradicting: [],
      scopeSourceCount: 1,
      referenceDate: REFERENCE,
    };
    const standard = evaluateConfidence(input);
    const firstPartyOnly = evaluateConfidence({
      ...input,
      weights: {
        first_party_strength: 1,
        cross_source_agreement: 0,
        evidence_quantity: 0,
        evidence_specificity: 0,
        recency: 0,
        segment_coverage: 0,
        external_support: 0,
      },
    });
    expect(firstPartyOnly.score).toBeCloseTo(0.4, 3);
    expect(firstPartyOnly.score).not.toBeCloseTo(standard.score, 3);
  });
});

describe("unsupported claims", () => {
  it("scores zero with all components zero when nothing supports the claim", () => {
    const result = evaluateConfidence({
      supporting: [],
      contradicting: [],
      scopeSourceCount: 5,
      referenceDate: REFERENCE,
    });
    expect(result.score).toBe(0);
    for (const key of CONFIDENCE_COMPONENT_KEYS) expect(result.components[key]).toBe(0);
  });

  it("scores zero when explicitly marked insufficient, even with evidence attached", () => {
    const result = evaluateConfidence({
      supporting: perfect(5),
      contradicting: [],
      scopeSourceCount: 5,
      insufficientEvidence: true,
      referenceDate: REFERENCE,
    });
    expect(result.score).toBe(0);
    expect(result.explanation).toContain("insufficient evidence");
  });

  it("still surfaces the contradiction penalty on an unsupported claim", () => {
    const result = evaluateConfidence({
      supporting: [],
      contradicting: perfect(2),
      scopeSourceCount: 5,
      referenceDate: REFERENCE,
    });
    expect(result.score).toBe(0);
    expect(result.components.contradiction_penalty).toBeCloseTo(0.24, 5);
  });
});

describe("roll-up to a version score", () => {
  it("returns zero for no fields and for all-insufficient fields", () => {
    expect(rollUpConfidence([])).toBe(0);
    expect(
      rollUpConfidence([
        { confidence: 0, insufficientEvidence: true },
        { confidence: 0, insufficientEvidence: true },
      ]),
    ).toBe(0);
  });

  it("averages the supported fields and scales by how many are supported", () => {
    const allSupported = rollUpConfidence([
      { confidence: 0.8, insufficientEvidence: false },
      { confidence: 0.6, insufficientEvidence: false },
    ]);
    expect(allSupported).toBeCloseTo(0.7, 3);

    // Same supported fields, but half the persona is a declared gap.
    const halfSupported = rollUpConfidence([
      { confidence: 0.8, insufficientEvidence: false },
      { confidence: 0.6, insufficientEvidence: false },
      { confidence: 0, insufficientEvidence: true },
      { confidence: 0, insufficientEvidence: true },
    ]);
    expect(halfSupported).toBeCloseTo(0.35, 3);
    expect(halfSupported).toBeLessThan(allSupported);
  });
});
