import { z } from "zod";

/**
 * Structured-output schemas.
 *
 * Every LLM response is validated against the Zod schema here before it is
 * persisted. The matching JSON Schema is what gets sent to the provider as a
 * strict structured-output format. `SCHEMA_VERSION` is stored on every
 * generated artefact so a schema change is detectable after the fact.
 */

export const SCHEMA_VERSION = "2026-08-06.1";

export const EVIDENCE_CATEGORIES = [
  "job_to_be_done",
  "constraint",
  "success_metric",
  "decision_criterion",
  "vocabulary",
  "question",
  "objection",
  "pain_point",
  "desired_outcome",
  "behavior",
  "comparison",
  "implementation_requirement",
  "proof_requirement",
  "brand_claim",
  "other",
] as const;

export const PROVENANCE = [
  "observed",
  "externally_supported",
  "brand_assertion",
  "inferred",
] as const;

export const JOURNEY_STAGES = [
  "unaware",
  "problem_discovery",
  "education",
  "solution_exploration",
  "consideration",
  "evaluation",
  "purchase",
  "implementation",
  "optimization",
  "troubleshooting",
  "retention",
  "unknown",
] as const;

export const SENTIMENTS = [
  "positive",
  "neutral",
  "negative",
  "concern",
  "mixed",
  "unknown",
] as const;

export const PROMPT_INTENTS = [
  "problem_discovery",
  "education",
  "solution_exploration",
  "comparison",
  "evaluation",
  "risk_reduction",
  "purchase",
  "implementation",
  "optimization",
  "troubleshooting",
] as const;

// ── Evidence extraction ─────────────────────────────────────────────────────

export const evidenceItemSchema = z.object({
  normalized_claim: z.string().min(3).max(600),
  quote: z.string().min(1).max(4000),
  category: z.enum(EVIDENCE_CATEGORIES),
  provenance: z.enum(PROVENANCE),
  journey_stage: z.enum(JOURNEY_STAGES),
  sentiment: z.enum(SENTIMENTS),
  entities: z.array(z.string().max(120)).max(20),
  vocabulary: z.array(z.string().max(120)).max(20),
  speaker: z.string().max(120).nullable(),
  char_start: z.number().int().min(0),
  char_end: z.number().int().min(0),
  extraction_confidence: z.number().min(0).max(1),
  quality_score: z.number().min(0).max(1),
  uncertainty_note: z.string().max(500).nullable(),
});

export const evidenceExtractionSchema = z.object({
  records: z.array(evidenceItemSchema).max(60),
});

export type EvidenceExtraction = z.infer<typeof evidenceExtractionSchema>;
export type EvidenceItem = z.infer<typeof evidenceItemSchema>;

// ── Candidate segmentation ──────────────────────────────────────────────────

export const segmentCandidateSchema = z.object({
  label: z.string().min(3).max(120),
  slug: z.string().min(3).max(80),
  definition: z.string().min(20).max(1200),
  distinguishing_variables: z.array(z.string().max(160)).min(1).max(10),
  supporting_evidence_ids: z.array(z.string()).max(200),
  contradicting_evidence_ids: z.array(z.string()).max(100),
  why_it_changes_prompts: z.string().min(20).max(1200),
  coverage_gaps: z.array(z.string().max(300)).max(10),
  overlaps: z
    .array(
      z.object({
        segment_slug: z.string().max(80),
        degree: z.number().min(0).max(1),
        note: z.string().max(400),
      }),
    )
    .max(10),
  merge_split_recommendation: z.string().max(600).nullable(),
  confidence_components: z.object({
    first_party_strength: z.number().min(0).max(1),
    cross_source_agreement: z.number().min(0).max(1),
    evidence_quantity: z.number().min(0).max(1),
    evidence_specificity: z.number().min(0).max(1),
    recency: z.number().min(0).max(1),
    segment_coverage: z.number().min(0).max(1),
    external_support: z.number().min(0).max(1),
    contradiction_penalty: z.number().min(0).max(1),
  }),
  confidence_explanation: z.string().min(10).max(600),
});

export const segmentationSchema = z.object({
  segments: z.array(segmentCandidateSchema).min(1).max(7),
});

export type SegmentationResult = z.infer<typeof segmentationSchema>;
export type SegmentCandidateOutput = z.infer<typeof segmentCandidateSchema>;

// ── Persona synthesis ───────────────────────────────────────────────────────

export const PERSONA_FIELD_TYPES = [
  "job_to_be_done",
  "constraint",
  "success_metric",
  "decision_criterion",
  "vocabulary",
  "recurring_question",
  "objection",
  "proof_preference",
  "distinguishing_topic",
  "coverage_gap",
  "excluded_assumption",
  "validation_benchmark",
  "regeneration_trigger",
  "information_depth",
] as const;

export const personaFieldSchema = z.object({
  field_type: z.enum(PERSONA_FIELD_TYPES),
  statement: z.string().min(3).max(800),
  provenance: z.enum(PROVENANCE),
  supporting_evidence_ids: z.array(z.string()).max(100),
  contradicting_evidence_ids: z.array(z.string()).max(50),
  /** True when evidence could not support the claim — a gap, never a guess. */
  insufficient_evidence: z.boolean(),
  confidence_explanation: z.string().max(600),
});

export const personaSynthesisSchema = z.object({
  name: z.string().min(3).max(120),
  segment_definition: z.string().min(20).max(1200),
  summary: z.string().min(20).max(1500),
  journey_stages: z.array(z.enum(JOURNEY_STAGES)).max(6),
  information_depth: z.string().max(300),
  excluded_assumptions: z.array(z.string().max(300)).max(20),
  fields: z.array(personaFieldSchema).min(5).max(80),
});

export type PersonaSynthesis = z.infer<typeof personaSynthesisSchema>;
export type PersonaFieldOutput = z.infer<typeof personaFieldSchema>;

// ── Prompt generation ───────────────────────────────────────────────────────

export const generatedPromptSchema = z.object({
  topic: z.string().min(2).max(160),
  prompt_text: z.string().min(10).max(600),
  generic_control_prompt: z.string().min(5).max(300).nullable(),
  information_need: z.string().min(5).max(400),
  intent: z.enum(PROMPT_INTENTS),
  journey_stage: z.enum(JOURNEY_STAGES),
  constraints_used: z.array(z.string().max(200)).max(10),
  decision_criteria_used: z.array(z.string().max(200)).max(10),
  vocabulary_used: z.array(z.string().max(120)).max(10),
  expected_answer_elements: z.array(z.string().max(240)).min(1).max(10),
  evidence_ids: z.array(z.string()).max(30),
  inclusion_rationale: z.string().min(10).max(600),
  execution_mode: z.enum(["standalone", "conversational", "both"]),
  tracking_priority: z.enum(["low", "medium", "high"]),
  confidence: z.number().min(0).max(1),
});

export const promptGenerationSchema = z.object({
  prompts: z.array(generatedPromptSchema).min(1).max(30),
});

export type PromptGeneration = z.infer<typeof promptGenerationSchema>;
export type GeneratedPrompt = z.infer<typeof generatedPromptSchema>;

// ── Content gap / opportunities ─────────────────────────────────────────────

export const RECOMMENDATION_TYPES = [
  "new_article",
  "existing_article_update",
  "faq",
  "comparison_page",
  "landing_page",
  "product_page",
  "documentation",
  "case_study",
  "homepage_update",
  "structured_information_improvement",
  "third_party_authority_or_pr",
  "no_content_action",
  "product_or_positioning_review",
] as const;

export const GAP_TYPES = ["content", "evidence", "authority", "messaging", "product_fit"] as const;

export const opportunitySchema = z.object({
  title: z.string().min(5).max(200),
  problem_statement: z.string().min(20).max(1500),
  performance_gap: z.string().min(10).max(1500),
  gap_type: z.enum(GAP_TYPES),
  recommendation: z.enum(RECOMMENDATION_TYPES),
  recommendation_rationale: z.string().min(20).max(1500),
  relevant_profound_prompt_ids: z.array(z.string()).max(50),
  relevant_run_ids: z.array(z.string()).max(50),
  competitors: z.array(z.string().max(160)).max(20),
  citation_sources: z.array(z.string().max(240)).max(30),
  missing_answer_elements: z.array(z.string().max(240)).max(20),
  existing_page_url: z.string().max(2000).nullable(),
  priority: z.enum(["p1", "p2", "p3"]),
  estimated_effort: z.enum(["small", "medium", "large"]),
  evidence_ids: z.array(z.string()).max(50),
  validation_method: z.string().min(10).max(600),
});

export const opportunityGenerationSchema = z.object({
  opportunities: z.array(opportunitySchema).max(12),
});

export type OpportunityGeneration = z.infer<typeof opportunityGenerationSchema>;
export type OpportunityOutput = z.infer<typeof opportunitySchema>;

// ── SEO brief (§29 — all required sections) ─────────────────────────────────

export const briefSchema = z.object({
  working_title: z.string().min(5).max(240),
  target_persona: z.string().min(3).max(200),
  job_to_be_done: z.string().min(10).max(800),
  primary_information_need: z.string().min(10).max(800),
  intent: z.enum(PROMPT_INTENTS),
  journey_stage: z.enum(JOURNEY_STAGES),
  primary_query: z.string().min(3).max(300),
  supporting_queries: z.array(z.string().max(300)).max(20),
  relevant_profound_prompts: z
    .array(
      z.object({
        profound_prompt_id: z.string().max(120),
        prompt_text: z.string().max(600),
        gap: z.string().max(600),
      }),
    )
    .max(20),
  profound_gap_summary: z.string().max(2000),
  reader_existing_knowledge: z.string().max(1200),
  constraints: z
    .array(z.object({ statement: z.string().max(400), evidence_ids: z.array(z.string()).max(20) }))
    .max(20),
  objections: z
    .array(z.object({ statement: z.string().max(400), evidence_ids: z.array(z.string()).max(20) }))
    .max(20),
  decision_criteria: z
    .array(z.object({ statement: z.string().max(400), evidence_ids: z.array(z.string()).max(20) }))
    .max(20),
  expected_answer_elements: z.array(z.string().max(300)).max(25),
  recommended_content_type: z.string().max(200),
  recommended_outline: z
    .array(
      z.object({
        heading: z.string().max(240),
        purpose: z.string().max(600),
        must_cover: z.array(z.string().max(300)).max(10),
        evidence_ids: z.array(z.string()).max(20),
      }),
    )
    .min(1)
    .max(20),
  customer_vocabulary: z.array(z.string().max(160)).max(40),
  concepts_and_entities: z.array(z.string().max(200)).max(40),
  required_evidence: z.array(z.string().max(400)).max(20),
  required_examples: z.array(z.string().max(400)).max(20),
  source_requirements: z.array(z.string().max(400)).max(20),
  product_proof: z.array(z.string().max(400)).max(20),
  competitor_coverage: z.array(z.string().max(400)).max(20),
  internal_links: z
    .array(z.object({ url: z.string().max(2000), rationale: z.string().max(400) }))
    .max(20),
  conversion_action: z.string().max(400),
  unsupported_claims_to_avoid: z.array(z.string().max(400)).max(20),
  final_quality_checklist: z.array(z.string().max(400)).min(3).max(25),
});

export type BriefOutput = z.infer<typeof briefSchema>;

// ── Page audit (§30) ────────────────────────────────────────────────────────

export const auditFindingSchema = z.object({
  severity: z.enum(["critical", "high", "medium", "low", "info"]),
  page_element: z.string().min(2).max(240),
  page_excerpt: z.string().max(1200).nullable(),
  persona_requirement: z.string().min(5).max(800),
  explanation: z.string().min(10).max(1500),
  recommended_change: z.string().min(10).max(1500),
  suggested_replacement: z.string().max(2000).nullable(),
  validation_method: z.string().min(5).max(600),
  evidence_ids: z.array(z.string()).max(30),
  related_prompt_ids: z.array(z.string()).max(30),
  related_profound_prompt_ids: z.array(z.string()).max(30),
  /** Distinguishes homepage requirements from supporting-page content. */
  belongs_on_supporting_page: z.boolean(),
});

export const pageAuditSchema = z.object({
  summary: z.string().min(20).max(2000),
  scores: z.record(z.string(), z.number().min(0).max(1)),
  findings: z.array(auditFindingSchema).max(40),
  supporting_page_recommendations: z
    .array(
      z.object({
        need: z.string().max(400),
        suggested_page_type: z.string().max(160),
        rationale: z.string().max(600),
      }),
    )
    .max(15),
});

export type PageAuditOutput = z.infer<typeof pageAuditSchema>;
