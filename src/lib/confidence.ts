/**
 * The confidence engine (§15).
 *
 * This is a transparent heuristic, not a statistical probability that a persona
 * claim is true. Every component is computed from evidence the reviewer can
 * open, every weight is configurable, and the result is always accompanied by a
 * plain-language explanation — the UI renders all eight components rather than
 * a single opaque number.
 *
 * Pure and dependency-free so the whole formula is unit-testable, and
 * deterministic: the reference date is always passed in rather than read from
 * the clock.
 */

export const CONFIDENCE_COMPONENT_KEYS = [
  "first_party_strength",
  "cross_source_agreement",
  "evidence_quantity",
  "evidence_specificity",
  "recency",
  "segment_coverage",
  "external_support",
  "contradiction_penalty",
] as const;

export type ConfidenceComponentKey = (typeof CONFIDENCE_COMPONENT_KEYS)[number];

export type ConfidenceComponents = Record<ConfidenceComponentKey, number>;

/** The seven additive weights from §15. `contradiction_penalty` is subtracted. */
export type ConfidenceWeights = {
  first_party_strength: number;
  cross_source_agreement: number;
  evidence_quantity: number;
  evidence_specificity: number;
  recency: number;
  segment_coverage: number;
  external_support: number;
};

export const DEFAULT_CONFIDENCE_WEIGHTS: ConfidenceWeights = {
  first_party_strength: 0.25,
  cross_source_agreement: 0.2,
  evidence_quantity: 0.15,
  evidence_specificity: 0.15,
  recency: 0.1,
  segment_coverage: 0.1,
  external_support: 0.05,
};

/**
 * Starting source weights from §15, keyed by the evidence record's source type.
 * A brand page describes positioning, not customer belief, which is why it is
 * worth 0.40 rather than 1.00 — see docs/decisions.md ADR-007.
 */
export const SOURCE_WEIGHTS: Record<string, number> = {
  interview: 1.0,
  sales_transcript: 1.0,
  support_ticket: 1.0,
  survey: 1.0,
  crm_note: 1.0,
  search_console: 0.9,
  onsite_search: 0.9,
  review: 0.8,
  community: 0.8,
  sparktoro: 0.7,
  dataforseo: 0.65,
  brand_page: 0.4,
  documentation: 0.4,
  other: 0.5,
};

/** Weight applied when a claim rests on model inference with no cited evidence. */
export const UNSUPPORTED_INFERENCE_WEIGHT = 0;

/** Evidence older than this contributes half as much to the recency component. */
export const RECENCY_HALF_LIFE_DAYS = 365;

/** Saturation point for the quantity curve: five records score ~0.9. */
const QUANTITY_TARGET = 6;

/** Each contradicting record costs this much, capped by MAX_CONTRADICTION_PENALTY. */
const CONTRADICTION_STEP = 0.12;
const MAX_CONTRADICTION_PENALTY = 0.4;

export type ConfidenceEvidence = {
  id: string;
  /** Data-source id — distinct sources are what cross-source agreement counts. */
  sourceId: string;
  sourceType: string;
  provenance: string;
  /** Extraction quality, 0–1. Drives the specificity component. */
  qualityScore: number;
  observedAt: Date | null;
  /** True when the extractor recorded hedging or a contradiction qualifier. */
  hedged?: boolean;
};

export type ConfidenceInput = {
  supporting: ConfidenceEvidence[];
  contradicting: ConfidenceEvidence[];
  /**
   * How many distinct sources exist in the scope the claim is drawn from (the
   * segment for a persona field, the brand for a segment). Segment coverage is
   * the share of those sources the claim actually reaches.
   */
  scopeSourceCount: number;
  /** Set when the generator could not support the claim at all. */
  insufficientEvidence?: boolean;
  /** Reference point for recency — normally the evidence cutoff. */
  referenceDate: Date;
  weights?: ConfidenceWeights;
};

export type ConfidenceResult = {
  score: number;
  components: ConfidenceComponents;
  explanation: string;
};

export function sourceWeightFor(sourceType: string, provenance?: string): number {
  if (provenance === "brand_assertion") return SOURCE_WEIGHTS.brand_page!;
  return SOURCE_WEIGHTS[sourceType] ?? SOURCE_WEIGHTS.other!;
}

const EXTERNAL_SOURCE_TYPES = new Set([
  "search_console",
  "onsite_search",
  "sparktoro",
  "dataforseo",
]);

export function isExternalSupport(evidence: ConfidenceEvidence): boolean {
  return (
    evidence.provenance === "externally_supported" || EXTERNAL_SOURCE_TYPES.has(evidence.sourceType)
  );
}

const ZERO_COMPONENTS: ConfidenceComponents = {
  first_party_strength: 0,
  cross_source_agreement: 0,
  evidence_quantity: 0,
  evidence_specificity: 0,
  recency: 0,
  segment_coverage: 0,
  external_support: 0,
  contradiction_penalty: 0,
};

export function evaluateConfidence(input: ConfidenceInput): ConfidenceResult {
  const weights = input.weights ?? DEFAULT_CONFIDENCE_WEIGHTS;
  const supporting = input.supporting;
  const contradicting = input.contradicting;

  if (input.insufficientEvidence || supporting.length === 0) {
    // An unsupported claim scores zero rather than an average of nothing. The
    // penalty is still shown so a reviewer can see contradictions exist.
    const penalty = contradictionPenalty(contradicting.length);
    return {
      score: 0,
      components: { ...ZERO_COMPONENTS, contradiction_penalty: round(penalty) },
      explanation: input.insufficientEvidence
        ? "Marked insufficient evidence: no approved evidence supports this claim, so it scores zero rather than being filled in."
        : "No approved, available evidence is attached, so this claim scores zero.",
    };
  }

  const components: ConfidenceComponents = {
    first_party_strength: firstPartyStrength(supporting),
    cross_source_agreement: crossSourceAgreement(supporting),
    evidence_quantity: evidenceQuantity(supporting.length),
    evidence_specificity: evidenceSpecificity(supporting),
    recency: recency(supporting, input.referenceDate),
    segment_coverage: segmentCoverage(supporting, input.scopeSourceCount),
    external_support: externalSupport(supporting),
    contradiction_penalty: contradictionPenalty(contradicting.length),
  };

  const positive =
    weights.first_party_strength * components.first_party_strength +
    weights.cross_source_agreement * components.cross_source_agreement +
    weights.evidence_quantity * components.evidence_quantity +
    weights.evidence_specificity * components.evidence_specificity +
    weights.recency * components.recency +
    weights.segment_coverage * components.segment_coverage +
    weights.external_support * components.external_support;

  const score = clamp01(positive - components.contradiction_penalty);

  return {
    score: round(score),
    components: roundComponents(components),
    explanation: explain(components, supporting, contradicting),
  };
}

// ── Components ──────────────────────────────────────────────────────────────

/** Mean source weight — a claim carried by brand copy cannot reach 1.0. */
function firstPartyStrength(supporting: ConfidenceEvidence[]): number {
  const total = supporting.reduce(
    (sum, item) => sum + sourceWeightFor(item.sourceType, item.provenance),
    0,
  );
  return clamp01(total / supporting.length);
}

/** One source scores 0: a single voice is not agreement. Three or more scores 1. */
function crossSourceAgreement(supporting: ConfidenceEvidence[]): number {
  const distinct = new Set(supporting.map((item) => item.sourceId)).size;
  return clamp01((distinct - 1) / 2);
}

/** Saturating so the tenth record adds far less than the second. */
function evidenceQuantity(count: number): number {
  return clamp01(Math.log1p(count) / Math.log1p(QUANTITY_TARGET));
}

function evidenceSpecificity(supporting: ConfidenceEvidence[]): number {
  const total = supporting.reduce((sum, item) => sum + clamp01(item.qualityScore), 0);
  return clamp01(total / supporting.length);
}

/**
 * Exponential decay with a one-year half-life. Records with no observation date
 * score 0.5 — unknown recency is not the same as stale.
 */
function recency(supporting: ConfidenceEvidence[], referenceDate: Date): number {
  const total = supporting.reduce((sum, item) => {
    if (!item.observedAt) return sum + 0.5;
    const ageDays = (referenceDate.getTime() - item.observedAt.getTime()) / 86_400_000;
    if (ageDays <= 0) return sum + 1;
    return sum + Math.pow(2, -ageDays / RECENCY_HALF_LIFE_DAYS);
  }, 0);
  return clamp01(total / supporting.length);
}

/** Share of the scope's sources this claim actually reaches. */
function segmentCoverage(supporting: ConfidenceEvidence[], scopeSourceCount: number): number {
  if (scopeSourceCount <= 0) return 0;
  const distinct = new Set(supporting.map((item) => item.sourceId)).size;
  return clamp01(distinct / scopeSourceCount);
}

/** Two independent external signals are enough to score full external support. */
function externalSupport(supporting: ConfidenceEvidence[]): number {
  const external = supporting.filter(isExternalSupport).length;
  return clamp01(external / 2);
}

function contradictionPenalty(count: number): number {
  return Math.min(MAX_CONTRADICTION_PENALTY, count * CONTRADICTION_STEP);
}

// ── Explanation ─────────────────────────────────────────────────────────────

function explain(
  components: ConfidenceComponents,
  supporting: ConfidenceEvidence[],
  contradicting: ConfidenceEvidence[],
): string {
  const distinctSources = new Set(supporting.map((item) => item.sourceId)).size;
  const parts: string[] = [];

  parts.push(
    `${supporting.length} supporting record${supporting.length === 1 ? "" : "s"} across ${distinctSources} source${distinctSources === 1 ? "" : "s"}`,
  );

  const strength = components.first_party_strength;
  parts.push(
    strength >= 0.9
      ? "carried by direct first-party evidence"
      : strength >= 0.7
        ? "mostly first-party with some external or review evidence"
        : strength >= 0.5
          ? "a mix of first-party and lower-weight sources"
          : "weighted down because it leans on brand assertions or aggregate signals",
  );

  if (distinctSources === 1) {
    parts.push("cross-source agreement scores zero because only one source is cited");
  }

  if (components.external_support > 0) {
    parts.push("supported by aggregate search or audience data");
  }

  if (contradicting.length > 0) {
    parts.push(
      `reduced by ${contradicting.length} contradicting or hedged record${contradicting.length === 1 ? "" : "s"}`,
    );
  }

  if (components.recency < 0.6) {
    parts.push("recency is low, so re-validate before relying on this");
  }

  return `${parts.join("; ")}.`;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function roundComponents(components: ConfidenceComponents): ConfidenceComponents {
  const out = { ...components };
  for (const key of CONFIDENCE_COMPONENT_KEYS) out[key] = round(out[key]);
  return out;
}

/**
 * Rolls field confidences up to a version-level score. The mean of *supported*
 * fields, scaled by the share of fields that are supported at all — so a
 * persona with half its fields marked insufficient cannot look strong.
 */
export function rollUpConfidence(
  fields: { confidence: number; insufficientEvidence: boolean }[],
): number {
  if (fields.length === 0) return 0;
  const supported = fields.filter((field) => !field.insufficientEvidence);
  if (supported.length === 0) return 0;
  const mean =
    supported.reduce((sum, field) => sum + clamp01(field.confidence), 0) / supported.length;
  const coverage = supported.length / fields.length;
  return round(clamp01(mean * coverage));
}

/** Human label for a component key, used by the UI and by exports. */
export const COMPONENT_LABELS: Record<ConfidenceComponentKey, string> = {
  first_party_strength: "First-party strength",
  cross_source_agreement: "Cross-source agreement",
  evidence_quantity: "Evidence quantity",
  evidence_specificity: "Evidence specificity",
  recency: "Recency",
  segment_coverage: "Segment coverage",
  external_support: "External support",
  contradiction_penalty: "Contradiction penalty",
};

export const COMPONENT_WEIGHT_LABELS: Record<ConfidenceComponentKey, string> = {
  first_party_strength: "0.25",
  cross_source_agreement: "0.20",
  evidence_quantity: "0.15",
  evidence_specificity: "0.15",
  recency: "0.10",
  segment_coverage: "0.10",
  external_support: "0.05",
  contradiction_penalty: "subtracted",
};
