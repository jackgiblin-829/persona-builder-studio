import { describe, expect, it } from "vitest";
import {
  analyzeGap,
  estimateEffort,
  estimatePriority,
  type GapSignal,
  type RecommendationType,
} from "@/lib/content-gap";
import { RECOMMENDATION_TYPES } from "@/prompts/schemas";

/**
 * §27's central guarantee — "do not assume every visibility gap requires a
 * new article" — is tested here as a property of `analyzeGap`, not merely
 * asserted in a comment: every one of the 13 recommendation types must be
 * directly reachable from a distinct, realistic signal, and the "nothing is
 * wrong" case must produce `no_content_action` rather than defaulting to
 * `new_article`.
 */

function baseSignal(overrides: Partial<GapSignal> = {}): GapSignal {
  return {
    classification: "normal",
    missingElements: [],
    controlOutperforms: null,
    hasExistingPage: false,
    existingPageCoversTopic: false,
    extractabilityIssue: false,
    messagingMismatch: false,
    thirdPartyAuthorityDominant: false,
    productFitGap: false,
    evidenceAvailable: true,
    comparisonIntent: false,
    questionShaped: false,
    decisionStage: false,
    productSpecific: false,
    technicalDepth: false,
    proofOfOutcomeNeeded: false,
    isHomepageSurface: false,
    searchVolume: null,
    keywordDifficulty: null,
    ...overrides,
  };
}

describe("analyzeGap — materiality", () => {
  it("recommends no_content_action and marks the gap immaterial when nothing is wrong", () => {
    const result = analyzeGap(baseSignal());
    expect(result.recommendation).toBe("no_content_action");
    expect(result.material).toBe(false);
  });

  it("is material when classification is brand_absent even with no missing elements", () => {
    const result = analyzeGap(
      baseSignal({ classification: "brand_absent", evidenceAvailable: false }),
    );
    expect(result.material).toBe(true);
  });

  it("is material when the persona prompt underperforms its control alone", () => {
    const result = analyzeGap(baseSignal({ controlOutperforms: false, evidenceAvailable: false }));
    expect(result.material).toBe(true);
  });
});

describe("analyzeGap — all 13 recommendation types are reachable", () => {
  const cases: { name: string; signal: GapSignal; expected: RecommendationType }[] = [
    {
      name: "product fit gap escalates regardless of everything else",
      signal: baseSignal({ productFitGap: true, classification: "brand_absent" }),
      expected: "product_or_positioning_review",
    },
    {
      name: "no evidence and no existing page defers content entirely",
      signal: baseSignal({ classification: "brand_absent", evidenceAvailable: false }),
      expected: "no_content_action",
    },
    {
      name: "no evidence but an existing page has an extractability problem",
      signal: baseSignal({
        classification: "brand_absent",
        evidenceAvailable: false,
        hasExistingPage: true,
        extractabilityIssue: true,
      }),
      expected: "structured_information_improvement",
    },
    {
      name: "a non-competitor authority dominates and no page exists",
      signal: baseSignal({
        classification: "brand_absent",
        thirdPartyAuthorityDominant: true,
        hasExistingPage: false,
      }),
      expected: "third_party_authority_or_pr",
    },
    {
      name: "existing page covers the topic but is not extractable",
      signal: baseSignal({
        classification: "brand_absent",
        hasExistingPage: true,
        existingPageCoversTopic: true,
        extractabilityIssue: true,
      }),
      expected: "structured_information_improvement",
    },
    {
      name: "existing page covers the topic and just needs the missing elements added",
      signal: baseSignal({
        classification: "brand_absent",
        missingElements: ["pricing detail"],
        hasExistingPage: true,
        existingPageCoversTopic: true,
      }),
      expected: "existing_article_update",
    },
    {
      name: "nothing exists yet and the gap is about the homepage's own framing",
      signal: baseSignal({ classification: "brand_absent", isHomepageSurface: true }),
      expected: "homepage_update",
    },
    {
      name: "a head-to-head comparison prompt with no comparison page",
      signal: baseSignal({ classification: "competitor_dominated", comparisonIntent: true }),
      expected: "comparison_page",
    },
    {
      name: "a handful of discrete question-shaped missing elements",
      signal: baseSignal({
        classification: "brand_absent",
        missingElements: ["what does it cost", "how long does onboarding take"],
        questionShaped: true,
      }),
      expected: "faq",
    },
    {
      name: "decision-stage gap that is not product-specific",
      signal: baseSignal({ classification: "competitor_dominated", decisionStage: true }),
      expected: "landing_page",
    },
    {
      name: "gap about a specific product capability",
      signal: baseSignal({ classification: "brand_absent", productSpecific: true }),
      expected: "product_page",
    },
    {
      name: "gap requiring implementation-level technical depth",
      signal: baseSignal({ classification: "brand_absent", technicalDepth: true }),
      expected: "documentation",
    },
    {
      name: "gap is a lack of proof of outcome, not a lack of explanation",
      signal: baseSignal({ classification: "brand_absent", proofOfOutcomeNeeded: true }),
      expected: "case_study",
    },
    {
      name: "a genuine information gap with no more specific shape",
      signal: baseSignal({ classification: "brand_absent" }),
      expected: "new_article",
    },
  ];

  for (const { name, signal, expected } of cases) {
    it(`${expected}: ${name}`, () => {
      expect(analyzeGap(signal).recommendation).toBe(expected);
    });
  }

  it("covers every recommendation type declared in the schema", () => {
    const covered = new Set(cases.map((c) => c.expected));
    for (const type of RECOMMENDATION_TYPES) {
      expect(covered.has(type)).toBe(true);
    }
    // And nothing extra: the schema and this test's coverage set describe
    // exactly the same 13 recommendations.
    expect(covered.size).toBe(RECOMMENDATION_TYPES.length);
  });
});

describe("analyzeGap — precedence", () => {
  it("prioritizes product fit over an otherwise reachable new_article shape", () => {
    const signal = baseSignal({ classification: "brand_absent", productFitGap: true });
    expect(analyzeGap(signal).recommendation).toBe("product_or_positioning_review");
  });

  it("prioritizes the existing-page branch over comparison/FAQ/landing-page shapes", () => {
    const signal = baseSignal({
      classification: "brand_absent",
      hasExistingPage: true,
      existingPageCoversTopic: true,
      comparisonIntent: true,
      questionShaped: true,
      decisionStage: true,
    });
    expect(analyzeGap(signal).recommendation).toBe("existing_article_update");
  });

  it("prioritizes FAQ over landing_page/product_page/documentation when question-shaped with few missing elements", () => {
    const signal = baseSignal({
      classification: "brand_absent",
      missingElements: ["one", "two"],
      questionShaped: true,
      decisionStage: true,
      productSpecific: true,
      technicalDepth: true,
    });
    expect(analyzeGap(signal).recommendation).toBe("faq");
  });

  it("does not choose FAQ when there are too many missing elements for a discrete answer", () => {
    const signal = baseSignal({
      classification: "brand_absent",
      missingElements: ["one", "two", "three", "four"],
      questionShaped: true,
    });
    expect(analyzeGap(signal).recommendation).not.toBe("faq");
  });
});

describe("estimatePriority", () => {
  it("is always p3 for an immaterial or no_content_action gap", () => {
    const immaterial = baseSignal();
    expect(estimatePriority(immaterial, analyzeGap(immaterial))).toBe("p3");

    const noAction = baseSignal({ classification: "brand_absent", evidenceAvailable: false });
    expect(estimatePriority(noAction, analyzeGap(noAction))).toBe("p3");
  });

  it("scores brand-absent with high search volume and several missing elements as p1", () => {
    const signal = baseSignal({
      classification: "brand_absent",
      missingElements: ["a", "b", "c"],
      searchVolume: 900,
    });
    expect(estimatePriority(signal, analyzeGap(signal))).toBe("p1");
  });

  it("scores a mild competitor-dominated gap with no demand data as p3", () => {
    const signal = baseSignal({ classification: "competitor_dominated" });
    expect(estimatePriority(signal, analyzeGap(signal))).toBe("p3");
  });
});

describe("estimateEffort", () => {
  it("rates structural and small text fixes as small effort", () => {
    expect(estimateEffort("faq")).toBe("small");
    expect(estimateEffort("structured_information_improvement")).toBe("small");
    expect(estimateEffort("homepage_update")).toBe("small");
  });

  it("rates a product/positioning review as large effort", () => {
    expect(estimateEffort("product_or_positioning_review")).toBe("large");
  });

  it("rates a new article as medium effort", () => {
    expect(estimateEffort("new_article")).toBe("medium");
  });
});
