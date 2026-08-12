import { z } from "zod";
import { QUALITY_ISSUE_CODES } from "@/contracts/prompt-generation";

export const SCHEMA_VERSION = "6.0.0";

const promptStrategySchema = z.object({
  canonicalBrand: z.string().min(2).max(160),
  parentCompany: z.string().max(160),
  aliases: z.array(z.string().min(1).max(200)).max(40),
  entityCollisions: z.array(z.string().min(1).max(200)).max(40),
  categoryTerms: z.array(z.string().min(1).max(200)).min(1).max(40),
  businessLines: z.array(z.string().min(1).max(200)).min(1).max(40),
  competitors: z.array(z.string().min(1).max(200)).max(40),
  buyerQualifiers: z.array(z.string().min(1).max(200)).max(40),
  freshnessFacts: z.array(z.string().min(1).max(200)).max(40),
  pathwaysPerPersona: z.number().int().min(1).max(10),
  targetPromptCount: z.number().int().min(12).max(100),
  funnelTargets: z.object({
    awareness: z.number().int().min(0).max(100),
    consideration: z.number().int().min(0).max(100),
    decision: z.number().int().min(0).max(100),
  }),
});

export const marketResearchBriefSchema = z.object({
  summary: z.string().min(20).max(3000),
  strategy: promptStrategySchema,
  facts: z
    .array(
      z.object({
        id: z.string().regex(/^fact-\d{3}$/),
        kind: z.enum([
          "brand_identity",
          "entity_relationship",
          "category",
          "business_line",
          "competitor",
          "buyer_context",
          "freshness_fact",
        ]),
        claim: z.string().min(5).max(1000),
        sourceTitle: z.string().min(2).max(300),
        sourceUrl: z.string().url().max(2000),
        sourceType: z.enum(["web", "uploaded"]),
        retrievedAt: z.string().datetime(),
      }),
    )
    .min(8)
    .max(80),
  researchNotes: z.array(z.string().min(2).max(500)).max(20),
});
export type MarketResearchBriefGeneration = z.infer<typeof marketResearchBriefSchema>;

const signalReference = z.object({
  signal_id: z.string().min(1),
  confidence: z.number().min(0).max(1),
});

export const signalExtractionSchema = z.object({
  signals: z
    .array(
      z.object({
        category: z.enum([
          "job_to_be_done",
          "motivation",
          "goal",
          "pain_point",
          "constraint",
          "success_measure",
          "decision_criterion",
          "objection",
          "question",
          "proof_need",
          "vocabulary",
          "buying_trigger",
          "content_preference",
          "behavior",
          "brand_name",
          "parent_company",
          "brand_alias",
          "entity_collision",
          "category_term",
          "business_line",
          "competitor",
          "buyer_qualifier",
          "freshness_fact",
          "other",
        ]),
        display_text: z.string().min(2).max(800),
        quote: z.string().min(1).max(1200),
        source_location: z.string().min(1).max(300),
        confidence: z.number().min(0).max(1),
      }),
    )
    .max(30),
});
export type SignalExtraction = z.infer<typeof signalExtractionSchema>;

const insightSchema = z.object({
  text: z.string().min(2).max(800),
  signal_ids: z.array(z.string().min(1)).min(1).max(12),
  confidence: z.number().min(0).max(1),
});

const distributionSchema = z.object({
  label: z.string().min(1).max(160),
  value: z.number(),
  unit: z.enum(["percent", "index", "count"]),
  signal_ids: z.array(z.string().min(1)).min(1).max(12),
});

export const personaGenerationSchema = z.object({
  methodology_summary: z.string().min(20).max(2000),
  personas: z
    .array(
      z.object({
        name: z.string().min(5).max(100),
        slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
        description: z.string().min(20).max(1000),
        summary: z.string().min(20).max(1600),
        demographics: z.object({
          age: z.array(distributionSchema).max(20),
          gender: z.array(distributionSchema).max(20),
          income: z.array(distributionSchema).max(20),
          education: z.array(distributionSchema).max(20),
          geography: z.array(distributionSchema).max(30),
        }),
        firmographics: z.object({
          roles: z.array(insightSchema).min(1).max(12),
          seniority: z.array(insightSchema).min(1).max(12),
          departments: z.array(insightSchema).min(1).max(12),
          industries: z.array(insightSchema).min(1).max(12),
          company_size: z.array(insightSchema).min(1).max(12),
          experience: z.array(insightSchema).min(1).max(12),
        }),
        jobs_to_be_done: z.array(insightSchema).min(1).max(12),
        motivations: z.array(insightSchema).min(1).max(12),
        goals: z.array(insightSchema).min(1).max(12),
        pain_points: z.array(insightSchema).min(1).max(12),
        constraints: z.array(insightSchema).min(1).max(12),
        success_measures: z.array(insightSchema).min(1).max(12),
        decision_criteria: z.array(insightSchema).min(1).max(12),
        objections: z.array(insightSchema).min(1).max(12),
        common_questions: z.array(insightSchema).min(1).max(12),
        proof_needs: z.array(insightSchema).min(1).max(12),
        vocabulary: z.array(insightSchema).min(1).max(16),
        buying_triggers: z.array(insightSchema).min(1).max(12),
        channels: z.array(insightSchema).min(1).max(16),
        communities: z.array(insightSchema).min(1).max(16),
        websites: z.array(insightSchema).min(1).max(16),
        content_preferences: z.array(insightSchema).min(1).max(12),
        keywords: z.array(insightSchema).min(1).max(20),
        ai_prompt_topics: z.array(insightSchema).min(1).max(20),
        confidence: z.number().min(0).max(1),
      }),
    )
    .min(3)
    .max(5),
});
export type PersonaGeneration = z.infer<typeof personaGenerationSchema>;

const promptPlanCellSchema = z.object({
  plan_key: z.string().regex(/^cell-\d{3}$/),
  buyer_moment: z.string().min(8).max(300),
  information_need: z.string().min(8).max(400),
  stage_objective: z.string().min(8).max(400),
  required_concepts: z.array(z.string().min(2).max(160)).min(1).max(8),
  permitted_entities: z.array(z.string().min(1).max(200)).max(12),
  signal_ids: z.array(z.string().min(1)).max(8),
  research_fact_ids: z.array(z.string().regex(/^fact-\d{3}$/)).max(8),
  parent_reason: z.string().min(8).max(400),
  evidence_status: z.enum(["supported", "insufficient_evidence"]),
});

export const promptPlanSchema = z.object({
  persona_slug: z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  plan_summary: z.string().min(20).max(1600),
  cells: z.array(promptPlanCellSchema).min(1).max(100),
});
export type PromptPlanGeneration = z.infer<typeof promptPlanSchema>;

export const promptCandidateLibrarySchema = z.object({
  blueprint_summary: z.string().min(20).max(2000),
  candidates: z
    .array(
      z.object({
        plan_key: z.string().regex(/^cell-\d{3}$/),
        candidate_key: z.string().regex(/^cell-\d{3}-[ab]$/),
        prompt_text: z.string().min(12).max(500),
        intent: z.string().min(2).max(160),
        expected_answer_elements: z.array(z.string().min(2).max(300)).min(2).max(10),
        signal_ids: z.array(z.string().min(1)).max(16),
        research_fact_ids: z.array(z.string().regex(/^fact-\d{3}$/)).max(16),
      }),
    )
    .min(2)
    .max(200),
});
export type PromptCandidateLibrary = z.infer<typeof promptCandidateLibrarySchema>;

export const promptRepairSchema = promptCandidateLibrarySchema;

export const promptQualityEvaluationSchema = z.object({
  assessments: z
    .array(
      z.object({
        candidate_key: z.string().regex(/^cell-\d{3}-[ab]$/),
        category_specificity: z.number().int().min(0).max(15),
        persona_context_fit: z.number().int().min(0).max(15),
        natural_buyer_language: z.number().int().min(0).max(15),
        funnel_coherence: z.number().int().min(0).max(20),
        answer_value: z.number().int().min(0).max(15),
        evidence_support: z.number().int().min(0).max(10),
        distinctiveness: z.number().int().min(0).max(10),
        issues: z
          .array(
            z.object({
              code: z.enum(QUALITY_ISSUE_CODES),
              message: z.string().min(2).max(300),
              blocking: z.boolean(),
            }),
          )
          .max(10),
        explanation: z.string().min(5).max(600),
        repair_instruction: z.string().max(600),
      }),
    )
    .min(2)
    .max(200),
});
export type PromptQualityEvaluation = z.infer<typeof promptQualityEvaluationSchema>;

// Backward-compatible alias for callers that only need the selected prompt shape.
export const promptLibraryGenerationSchema = z.object({
  blueprint_summary: z.string().min(20).max(2000),
  prompts: z.array(
    z.object({
      plan_key: z.string().regex(/^cell-\d{3}$/),
      prompt_text: z.string().min(12).max(500),
      intent: z.string().min(2).max(160),
      expected_answer_elements: z.array(z.string().min(2).max(300)).min(2).max(10),
      signal_ids: z.array(z.string().min(1)).min(1).max(16),
    }),
  ),
});
export type PromptLibraryGeneration = z.infer<typeof promptLibraryGenerationSchema>;

export { signalReference };
