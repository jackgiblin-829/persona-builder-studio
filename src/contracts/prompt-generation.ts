import type { CoverageCell, FunnelStage } from "./prompt-strategy";

export const QUALITY_ISSUE_CODES = [
  "insufficient_evidence",
  "unknown_signal",
  "unknown_research_fact",
  "missing_research_support",
  "brand_leakage",
  "missing_canonical_brand",
  "missing_competitor",
  "missing_disambiguating_entity",
  "unsupported_entity",
  "invalid_parent",
  "business_line_mismatch",
  "buyer_context_mismatch",
  "funnel_stage_mismatch",
  "parent_child_incoherent",
  "unnatural_buyer_language",
  "weak_answer_value",
  "weak_evidence_support",
  "exact_duplicate",
  "semantic_duplicate",
  "semantic_similarity_warning",
  "repeated_opening",
  "boilerplate",
] as const;

export type QualityIssueCode = (typeof QUALITY_ISSUE_CODES)[number];

export type PromptQualityIssue = {
  code: QualityIssueCode;
  message: string;
  blocking: boolean;
};

export type PromptPlanCell = CoverageCell & {
  buyerMoment: string;
  informationNeed: string;
  stageObjective: string;
  requiredConcepts: string[];
  permittedEntities: string[];
  signalIds: string[];
  researchFactIds: string[];
  parentReason: string;
  evidenceStatus: "supported" | "insufficient_evidence";
};

export type PromptEvidencePacket = {
  personaSlug: string;
  personaName: string;
  personaDescription: string;
  personaSummary: string;
  market: string;
  locale: string;
  signals: Array<{
    id: string;
    category: string;
    text: string;
    confidence: number;
  }>;
  facts: Array<{
    id: string;
    kind: string;
    claim: string;
  }>;
};

export type PromptQualityScores = {
  categorySpecificity: number;
  personaContextFit: number;
  naturalBuyerLanguage: number;
  funnelCoherence: number;
  answerValue: number;
  evidenceSupport: number;
  distinctiveness: number;
  total: number;
};

export type PromptQualityResult = {
  scores: PromptQualityScores;
  issues: PromptQualityIssue[];
  explanation: string;
  repairInstruction: string;
  passed: boolean;
};

export function hasPromptEvidence(signalIds: string[], researchFactIds: string[]) {
  return signalIds.length > 0 || researchFactIds.length > 0;
}

export type PromptGenerationMetrics = {
  plannerCalls: number;
  writerCalls: number;
  evaluatorCalls: number;
  repairCalls: number;
  repairRounds: number;
  initialCellCount: number;
  initialPassCount: number;
  finalPassCount: number;
  durationMs: number;
  tokensIn: number;
  tokensOut: number;
  costCents: number;
  modelIds: string[];
  byTemplate: Record<
    string,
    {
      calls: number;
      latencyMs: number;
      tokensIn: number;
      tokensOut: number;
      costCents: number;
      modelIds: string[];
    }
  >;
};

export type PromptVersionProvenance = {
  plannerPromptVersion: string;
  writerPromptVersion: string;
  evaluatorPromptVersion: string;
  repairPromptVersion: string;
  schemaVersion: string;
};

export function stageOrder(stage: FunnelStage) {
  return stage === "decision" ? 0 : stage === "consideration" ? 1 : 2;
}

export function qualityIssue(
  code: QualityIssueCode,
  message: string,
  blocking = true,
): PromptQualityIssue {
  return { code, message, blocking };
}
