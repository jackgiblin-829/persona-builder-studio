import type { GAP_TYPES, RECOMMENDATION_TYPES } from "@/prompts/schemas";

/**
 * Content-gap analysis (§27), pure and clock-free like `src/lib/profound-results.ts`
 * and `src/lib/profound-payload.ts`.
 *
 * This is the deterministic backbone behind the `content_gap` LLM template: it
 * decides `gapType` and `recommendation` from structured signals rather than
 * trusting a model to invent the decision, so the central guarantee — "do not
 * assume every visibility gap requires a new article" — is a property of code
 * that is unit-tested directly, not a hope encoded only in a system prompt.
 *
 * `src/adapters/openai/mock/content-gap.ts` calls `analyzeGap` for every
 * candidate gap to build deterministic mock opportunities. The live path asks
 * the model for prose (title, problem statement, rationale) but the service
 * layer (`src/services/content-opportunities.ts`) overwrites the model's
 * `gap_type`/`recommendation` with what this module computes, exactly the way
 * `generate-persona.ts` overwrites uncited evidence ids rather than trusting
 * the model's citation list.
 */

export type GapType = (typeof GAP_TYPES)[number];
export type RecommendationType = (typeof RECOMMENDATION_TYPES)[number];

export type ResultClassification = "brand_absent" | "competitor_dominated" | "normal";

export type GapSignal = {
  /** Most recent Profound classification for the prompt this gap is about. */
  classification: ResultClassification;
  /** Expected answer elements absent from the most recent raw answer. */
  missingElements: string[];
  /** Whether the persona-vs-control comparison shows the persona underperforming. Null if no pair exists. */
  controlOutperforms: boolean | null;
  /** A brand page already exists that at least loosely covers this topic. */
  hasExistingPage: boolean;
  /** The existing page's content already covers the substance (only missing elements need adding). */
  existingPageCoversTopic: boolean;
  /** The existing/needed content exists as prose but is not machine-extractable (no headers, lists, schema, direct answers). */
  extractabilityIssue: boolean;
  /** The gap is a wording/positioning mismatch (persona vocabulary, framing) rather than missing facts. */
  messagingMismatch: boolean;
  /** A non-competitor third-party authority is cited repeatedly for this topic while the brand is absent. */
  thirdPartyAuthorityDominant: boolean;
  /** Evidence indicates the product itself cannot do what the persona needs — no content can fix this. */
  productFitGap: boolean;
  /** Approved, available evidence exists to write this content credibly. */
  evidenceAvailable: boolean;
  /** The prompt's intent is a head-to-head comparison. */
  comparisonIntent: boolean;
  /** The missing elements read as discrete question/answer items rather than a narrative topic. */
  questionShaped: boolean;
  /** Journey stage is consideration, evaluation or purchase — decision-stage, not top-of-funnel. */
  decisionStage: boolean;
  /** The gap is specifically about a named product/feature capability. */
  productSpecific: boolean;
  /** The missing elements require deep technical/implementation detail. */
  technicalDepth: boolean;
  /** The missing element is proof of an outcome for a use case (a case study's job). */
  proofOfOutcomeNeeded: boolean;
  /** The affected surface is the brand's homepage itself, not a topic page. */
  isHomepageSurface: boolean;
  /** DataForSEO search demand for the underlying query, if known. */
  searchVolume: number | null;
  keywordDifficulty: number | null;
};

export type GapAnalysis = {
  gapType: GapType;
  recommendation: RecommendationType;
  /** Why this recommendation and not another — shown to the reviewer, asserted in tests. */
  rationale: string;
  /** False when the gap is not worth acting on — always paired with `no_content_action`. */
  material: boolean;
};

/**
 * A gap is worth acting on when the persona is doing worse than it should
 * (absent, competitor-dominated, or genuinely underperforming its control) or
 * the answer is missing something the persona was promised. A prompt that is
 * `normal`, has every expected element present, and is not losing to its
 * control has nothing left to fix.
 */
function isMaterial(signal: GapSignal): boolean {
  return (
    signal.classification !== "normal" ||
    signal.missingElements.length > 0 ||
    signal.controlOutperforms === false
  );
}

/**
 * The gap-typing and recommendation decision tree. Rules are checked in a
 * fixed priority order — highest-stakes diagnosis first (a product that can't
 * do what's asked, then "nothing to do here"), then the concrete cases from
 * cheapest to explain, ending in `new_article` only once every more specific
 * shape has been ruled out. This ordering, not any single rule, is what
 * prevents `new_article` from becoming the silent default.
 */
export function analyzeGap(signal: GapSignal): GapAnalysis {
  // 1. Product fit overrides everything: no content, however good, fixes a
  //    capability the product does not have.
  if (signal.productFitGap) {
    return {
      gapType: "product_fit",
      recommendation: "product_or_positioning_review",
      rationale:
        "Evidence indicates the product itself does not do what this persona needs here. Publishing content would not close the gap and risks an unsupported claim; the product or its positioning needs review first.",
      material: true,
    };
  }

  // 2. Nothing is actually wrong.
  if (!isMaterial(signal)) {
    return {
      gapType: "content",
      recommendation: "no_content_action",
      rationale:
        "The persona's most recent result is normal, every expected answer element is present, and it is not underperforming its control. There is no visibility gap to act on.",
      material: false,
    };
  }

  // 3. No evidence to write anything credible, and nothing existing to fix
  //    structurally either. Acting now would mean inventing claims.
  if (!signal.evidenceAvailable && !signal.hasExistingPage) {
    return {
      gapType: "evidence",
      recommendation: "no_content_action",
      rationale:
        "There is a visibility gap, but no approved evidence supports a credible claim here and no existing page to improve. Writing content now would mean inventing the persona's needs rather than answering them; evidence collection should come before content.",
      material: true,
    };
  }

  // 4. Evidence is missing but an existing page could still be structurally
  //    improved without inventing new claims (e.g. exposing facts already on
  //    the brand's own page in an extractable form).
  if (!signal.evidenceAvailable && signal.hasExistingPage && signal.extractabilityIssue) {
    return {
      gapType: "evidence",
      recommendation: "structured_information_improvement",
      rationale:
        "An existing page already carries the relevant facts as brand assertions, but they are not exposed in a form an AI answer can extract (headings, lists, direct Q&A, structured data). This can be improved without new evidence; a new claim would need evidence this brand does not yet have.",
      material: true,
    };
  }

  // 5. A non-competitor authority dominates the citations and the brand has
  //    no comparable page. More owned content would not out-cite an
  //    established third party; earning citations or coverage is the lever.
  if (
    signal.thirdPartyAuthorityDominant &&
    (signal.classification === "brand_absent" ||
      signal.classification === "competitor_dominated") &&
    !signal.hasExistingPage
  ) {
    return {
      gapType: "authority",
      recommendation: "third_party_authority_or_pr",
      rationale:
        "AI answers here are dominated by an independent third-party authority rather than a competitor, and the brand has no comparable page to compete with on-site content alone. Earning a citation-worthy mention (PR, contributed research, a partner citation) is the more direct lever than publishing another owned page.",
      material: true,
    };
  }

  // 6. An existing page already covers the topic.
  if (signal.hasExistingPage && signal.existingPageCoversTopic) {
    if (signal.extractabilityIssue) {
      return {
        gapType: "content",
        recommendation: "structured_information_improvement",
        rationale:
          "The existing page already covers this topic; the gap is that its content is not structured for extraction by an AI answer (no direct Q&A framing, headings or structured data), not that the substance is missing.",
        material: true,
      };
    }
    if (signal.messagingMismatch) {
      return {
        gapType: "messaging",
        recommendation: "existing_article_update",
        rationale:
          "The existing page covers the topic, but its vocabulary and framing do not match how this persona describes the problem. Updating the page's language and framing addresses the gap without a new asset.",
        material: true,
      };
    }
    return {
      gapType: "content",
      recommendation: "existing_article_update",
      rationale: `The existing page already covers this topic; it only needs the missing element${signal.missingElements.length === 1 ? "" : "s"} added rather than a new page.`,
      material: true,
    };
  }

  // 7. Nothing exists yet. Pick the shape the gap actually has.
  if (signal.isHomepageSurface) {
    return {
      gapType: "messaging",
      recommendation: "homepage_update",
      rationale:
        "The gap concerns how the homepage itself frames the persona's job to be done, not a missing supporting page. The homepage's own messaging should change.",
      material: true,
    };
  }

  if (signal.comparisonIntent) {
    return {
      gapType: "content",
      recommendation: "comparison_page",
      rationale:
        "The prompt is a head-to-head comparison and no comparison page exists. A dedicated comparison page answers the actual question rather than a general article that happens to mention competitors.",
      material: true,
    };
  }

  if (
    signal.questionShaped &&
    signal.missingElements.length > 0 &&
    signal.missingElements.length <= 3
  ) {
    return {
      gapType: "content",
      recommendation: "faq",
      rationale:
        "The missing elements are a small number of discrete question-and-answer items rather than a narrative topic. An FAQ entry answers them directly; a full article would bury the answer.",
      material: true,
    };
  }

  if (signal.decisionStage && !signal.productSpecific) {
    return {
      gapType: "content",
      recommendation: "landing_page",
      rationale:
        "This gap sits at the decision stage of the journey (consideration, evaluation or purchase) rather than early research. A landing page built around this persona's decision criteria and a conversion action fits better than an informational article.",
      material: true,
    };
  }

  if (signal.productSpecific) {
    return {
      gapType: "content",
      recommendation: "product_page",
      rationale:
        "The gap is about a specific product capability the persona is asking about, not a general topic. It belongs on or near the relevant product page rather than in editorial content.",
      material: true,
    };
  }

  if (signal.technicalDepth) {
    return {
      gapType: "content",
      recommendation: "documentation",
      rationale:
        "The missing elements require implementation-level technical detail. This persona is asking for documentation depth, not marketing narrative.",
      material: true,
    };
  }

  if (signal.proofOfOutcomeNeeded) {
    return {
      gapType: "evidence",
      recommendation: "case_study",
      rationale:
        "The gap is a lack of proof that the outcome actually happens for a use case like this persona's, not a lack of explanation. A case study supplies the missing proof; a new explanatory article would not.",
      material: true,
    };
  }

  return {
    gapType: "content",
    recommendation: "new_article",
    rationale:
      "This is a genuine information gap with no existing page, no FAQ, comparison, decision-stage, product-specific, documentation or proof shape, and evidence exists to write it credibly. A new article is the closest fit once every more specific option has been ruled out.",
    material: true,
  };
}

// ── Priority and effort ──────────────────────────────────────────────────────

export type Priority = "p1" | "p2" | "p3";
export type Effort = "small" | "medium" | "large";

/**
 * Priority weighs how bad the gap is against how much demand exists for it —
 * a brand-absent result on a high-volume query outranks a competitor-
 * dominated result on a query nobody searches for.
 */
export function estimatePriority(signal: GapSignal, analysis: GapAnalysis): Priority {
  if (!analysis.material || analysis.recommendation === "no_content_action") return "p3";

  const demandScore =
    signal.searchVolume == null
      ? 0
      : signal.searchVolume >= 500
        ? 2
        : signal.searchVolume >= 50
          ? 1
          : 0;
  const severityScore =
    signal.classification === "brand_absent"
      ? 2
      : signal.classification === "competitor_dominated"
        ? 1
        : 0;
  const missingScore = signal.missingElements.length >= 3 ? 1 : 0;

  const score = demandScore + severityScore + missingScore;
  if (score >= 4) return "p1";
  if (score >= 2) return "p2";
  return "p3";
}

/** Effort follows the shape of the asset, not the severity of the gap. */
export function estimateEffort(recommendation: RecommendationType): Effort {
  switch (recommendation) {
    case "structured_information_improvement":
    case "faq":
    case "homepage_update":
      return "small";
    case "existing_article_update":
    case "no_content_action":
    case "third_party_authority_or_pr":
      return "small";
    case "new_article":
    case "comparison_page":
    case "product_page":
      return "medium";
    case "landing_page":
    case "documentation":
    case "case_study":
      return "medium";
    case "product_or_positioning_review":
      return "large";
    default:
      return "medium";
  }
}
