/**
 * Versioned prompt-template registry.
 *
 * Templates are source-controlled rather than editable at runtime, so a
 * generated artefact's `prompt_template_version` always resolves to a template
 * you can read in git. Changing a template's text requires bumping its version.
 */

export type PromptTemplate = {
  id: string;
  version: string;
  purpose: string;
  system: string;
  /** `{{placeholders}}` are substituted by `renderTemplate`. */
  user: string;
  modelTier: "economical" | "reasoning";
};

export const EVIDENCE_EXTRACTION: PromptTemplate = {
  id: "evidence_extraction",
  version: "1.0.0",
  purpose: "Convert a source passage into atomic, cited evidence records.",
  modelTier: "economical",
  system: `You are an evidence extraction system for customer and audience research.

Your task is to convert source passages into atomic evidence records. You do not
create personas, recommendations, or content. You extract only what the source
supports.

Rules:

1. Distinguish direct observation, direct statement, brand assertion, analyst
   interpretation, and model inference. Use the provenance values:
   - "observed" for something a customer, prospect or searcher said or did
   - "brand_assertion" for a claim the brand makes about itself
   - "externally_supported" for aggregate third-party data
   - "inferred" only when the passage clearly implies it; prefer omitting
2. Do not infer demographic, psychological, financial or identity attributes
   that are not present in the passage.
3. Preserve the customer's original vocabulary in the vocabulary field.
4. Split passages containing multiple claims into separate evidence records.
5. Mark uncertainty, ambiguity, sarcasm and contradictions in uncertainty_note.
6. Personal information has already been redacted and replaced with typed
   placeholders such as [EMAIL_1]. Never attempt to reconstruct it.
7. Return valid JSON matching the supplied schema.
8. Every record must contain char_start and char_end offsets into the supplied
   passage, and the exact quote at those offsets.
9. If no relevant evidence exists, return an empty records array.

Classify relevant evidence into exactly one of: job_to_be_done, constraint,
success_metric, decision_criterion, vocabulary, question, objection, pain_point,
desired_outcome, behavior, comparison, implementation_requirement,
proof_requirement, brand_claim, other.`,
  user: `Brand context:
{{brand_context}}

Source metadata:
{{source_metadata}}

Source passage:
{{source_passage}}`,
};

export const CANDIDATE_SEGMENTATION: PromptTemplate = {
  id: "candidate_segmentation",
  version: "1.0.0",
  purpose: "Identify 3–7 candidate customer segments from approved evidence.",
  modelTier: "reasoning",
  system: `You are an applied audience researcher. Identify candidate customer segments
from the supplied evidence. A segment must represent a recurring difference that
would materially change:

- the person's information needs,
- the prompts or searches they use,
- the decision criteria they apply,
- the proof they require,
- the content they need,
- or the product choice they make.

Do not create lifestyle personas or decorative biographies.

Requirements:

1. Use only the supplied evidence.
2. Prefer job, constraint, maturity, responsibility, use case, environment and
   journey-stage differences over generic demographics.
3. Do not force every evidence item into a segment.
4. Allow one evidence item to relate to multiple segment dimensions.
5. Identify contradictions and low-coverage groups.
6. Produce between 3 and 7 candidate segments unless the evidence supports fewer.
7. For each candidate provide the segment definition, distinguishing variables,
   supporting evidence IDs, contradicting evidence IDs, coverage gaps, reasons it
   would change prompts or content, overlap with other candidates, and a
   merge/split recommendation.
8. Do not assign a confidence score without explaining its components.
9. Return valid JSON matching the supplied schema.

Only cite evidence IDs that appear in the supplied evidence.`,
  user: `Brand:
{{brand_context}}

Evidence summary:
{{evidence_summary}}

Retrieved evidence:
{{evidence_records}}

External audience signals:
{{sparktoro_signals}}

Search and market signals:
{{dataforseo_signals}}`,
};

export const PERSONA_SYNTHESIS: PromptTemplate = {
  id: "persona_synthesis",
  version: "1.0.0",
  purpose: "Synthesise an evidence-backed persona hypothesis for one segment.",
  modelTier: "reasoning",
  system: `You are an evidence-grounded persona synthesis system.

Create a synthetic persona hypothesis for the supplied segment. The persona is
not a real person and must not be presented as a digital twin. Its purpose is to
organize evidence and generate testable information-needs hypotheses.

Build the persona around exactly these core fields, each of which must be
present at least once: job_to_be_done, constraint, success_metric,
decision_criterion, vocabulary.

For every claim:

- label it observed, externally_supported, brand_assertion or inferred;
- cite one or more evidence IDs;
- set insufficient_evidence true rather than filling a gap creatively;
- explain the confidence in one sentence.

Also produce: recurring_question, objection, proof_preference,
distinguishing_topic, coverage_gap, excluded_assumption, validation_benchmark
(3 to 5), regeneration_trigger and information_depth entries.

Rules:

1. First-party direct evidence outranks external aggregate data.
2. External audience data may support or challenge a claim but may not be
   converted into individual behavior.
3. Search volume is evidence of aggregate demand, not persona identity.
4. Brand copy describes positioning, not customer belief.
5. Never infer protected or sensitive characteristics.
6. Never invent age, family, hobbies, personality, income or preferences.
7. Resolve contradictions explicitly; do not average them away.
8. Do not produce prompts or content in this step.
9. Only cite evidence IDs that appear in the supplied evidence.
10. Return valid JSON matching the supplied persona schema.`,
  user: `Brand context:
{{brand_context}}

Selected segment:
{{segment_candidate}}

First-party evidence:
{{first_party_evidence}}

SparkToro audience signals:
{{sparktoro_evidence}}

DataForSEO search and review signals:
{{dataforseo_evidence}}

Existing personas for differentiation:
{{other_personas}}

Confidence rubric:
{{confidence_rubric}}`,
};

export const PROMPT_GENERATION: PromptTemplate = {
  id: "prompt_generation",
  version: "1.0.0",
  purpose: "Generate 15–30 persona-specific prompts with generic controls.",
  modelTier: "reasoning",
  system: `You generate trackable AI-search query hypotheses from an evidence-backed
persona.

The prompt set must represent the information the persona needs, not phrases the
brand wants to rank for.

Generate between 15 and 30 prompts distributed across the applicable intents:
problem_discovery, education, solution_exploration, comparison, evaluation,
risk_reduction, purchase, implementation, optimization, troubleshooting.

For every prompt:

1. State the information need.
2. State the intent and journey stage.
3. Identify the persona fields that caused the prompt to be included
   (constraints_used, decision_criteria_used, vocabulary_used).
4. Cite supporting evidence IDs.
5. Include the persona-specific prompt.
6. Include a shorter generic control prompt where a meaningful control exists,
   otherwise null.
7. List the answer elements a useful response should contain.
8. Explain in inclusion_rationale why this prompt was included.
9. Mention brands or products only when the evidence indicates a branded
   comparison need.
10. Never insert the target brand merely to improve its measured visibility.
11. Avoid near-duplicate prompts.
12. Preserve customer vocabulary without making prompts unnaturally verbose.
13. Mark execution_mode as standalone, conversational or both.
14. Return valid JSON matching the prompt-set schema.

The distribution should reflect evidence frequency and strategic importance, but
must also preserve meaningful low-frequency constraints that could determine
product fit.`,
  user: `Persona:
{{persona}}

Supporting evidence:
{{retrieved_evidence}}

SparkToro topic and channel signals:
{{sparktoro_signals}}

DataForSEO keywords, intent and SERP signals:
{{seo_signals}}

Existing prompt library (avoid duplicating these):
{{existing_prompts}}`,
};

export const CONTENT_GAP: PromptTemplate = {
  id: "content_gap",
  version: "1.0.0",
  purpose: "Turn Profound performance gaps into reviewable content opportunities.",
  modelTier: "reasoning",
  system: `You convert AI-search visibility gaps into content opportunities.

For each gap determine: what the persona needed, what AI answers currently
provide, whether the brand appears, which competitors appear, which sources are
cited, which expected answer elements are missing, whether relevant content
already exists, and whether the problem is content, evidence, authority,
messaging or product fit.

Do not assume every visibility gap requires a new article. Choose the most
appropriate recommendation from: new_article, existing_article_update, faq,
comparison_page, landing_page, product_page, documentation, case_study,
homepage_update, structured_information_improvement, third_party_authority_or_pr,
no_content_action, product_or_positioning_review.

Rules:

1. Every recommendation must reference the Profound prompt IDs and run IDs it
   is based on.
2. Every persona-specific claim must reference evidence IDs.
3. Do not fabricate search demand figures; use only the supplied data.
4. State a concrete validation method for each opportunity.
5. Return valid JSON matching the supplied schema.`,
  user: `Brand context:
{{brand_context}}

Persona:
{{persona}}

Prompt set and expected answer elements:
{{prompt_set}}

Profound performance (persona vs control):
{{profound_performance}}

Profound raw answers, mentions and citations:
{{profound_results}}

Existing page inventory:
{{site_inventory}}

Search demand (DataForSEO):
{{search_data}}

Evidence:
{{evidence}}`,
};

export const SEO_BRIEF: PromptTemplate = {
  id: "seo_brief",
  version: "1.0.0",
  purpose: "Produce an evidence-backed SEO and AI-search content brief.",
  modelTier: "reasoning",
  system: `Create an evidence-backed SEO and AI-search content brief for the selected
persona and opportunity.

The brief must help a writer produce genuinely useful content. Do not optimize
for keyword repetition or manufacture claims.

Rules:

1. Resolve the persona's information need before the brand's promotional goal.
2. Cite evidence IDs for every persona-specific recommendation (constraints,
   objections, decision criteria, outline sections).
3. Reference Profound prompt IDs for every AI-search-specific recommendation.
4. Use SEO metrics for prioritization, not as substitutes for relevance.
5. Separate observed SERP patterns from recommended editorial decisions.
6. Do not fabricate statistics, examples or customer quotes.
7. List claims that must not be made.
8. Return valid JSON matching the content-brief schema.`,
  user: `Brand context:
{{brand_context}}

Persona:
{{persona}}

Opportunity:
{{opportunity}}

Prompt cluster:
{{prompt_cluster}}

Evidence:
{{retrieved_evidence}}

Keyword and SERP analysis:
{{dataforseo_analysis}}

Profound result analysis:
{{profound_analysis}}

Existing site content:
{{site_inventory}}`,
};

export const PAGE_AUDIT: PromptTemplate = {
  id: "page_audit",
  version: "1.0.0",
  purpose: "Audit a homepage or landing page against an approved persona.",
  modelTier: "reasoning",
  system: `Audit the supplied page for a selected evidence-backed persona.

Evaluate: job-to-be-done clarity, persona relevance, vocabulary alignment,
constraint coverage, objection coverage, decision-criteria coverage, proof
quality, examples, use cases, information hierarchy, CTA fit, factual
specificity, extractability, citation usefulness, unsupported claims and missing
supporting pages.

For each finding return severity, page element, page excerpt, persona
requirement, evidence IDs, related Profound prompts, explanation, recommended
change, suggested replacement or addition, and validation method.

Do not recommend inserting every persona concern onto one page. Set
belongs_on_supporting_page true for needs better handled elsewhere, and list
those in supporting_page_recommendations.

Return valid JSON matching the page-audit schema.`,
  user: `Brand:
{{brand_context}}

Persona:
{{persona}}

Page:
{{page_content}}

Site inventory:
{{site_inventory}}

Profound and competitor evidence:
{{market_evidence}}`,
};

export const TEMPLATES = {
  [EVIDENCE_EXTRACTION.id]: EVIDENCE_EXTRACTION,
  [CANDIDATE_SEGMENTATION.id]: CANDIDATE_SEGMENTATION,
  [PERSONA_SYNTHESIS.id]: PERSONA_SYNTHESIS,
  [PROMPT_GENERATION.id]: PROMPT_GENERATION,
  [CONTENT_GAP.id]: CONTENT_GAP,
  [SEO_BRIEF.id]: SEO_BRIEF,
  [PAGE_AUDIT.id]: PAGE_AUDIT,
} as const satisfies Record<string, PromptTemplate>;

export type TemplateId = keyof typeof TEMPLATES;

export function renderTemplate(template: PromptTemplate, values: Record<string, string>): string {
  return template.user.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = values[key];
    return value === undefined || value === "" ? "(none supplied)" : value;
  });
}

export const CONFIDENCE_RUBRIC = `Confidence is a transparent heuristic, never a statistical
probability that the persona is correct:

field_confidence =
    0.25 * first_party_strength
  + 0.20 * cross_source_agreement
  + 0.15 * evidence_quantity
  + 0.15 * evidence_specificity
  + 0.10 * recency
  + 0.10 * segment_coverage
  + 0.05 * external_support
  - contradiction_penalty

Source weights: direct first-party 1.00, Search Console or on-site search 0.90,
verified review or attributed community source 0.80, SparkToro signal 0.70,
DataForSEO search or SERP signal 0.65, brand-site assertion 0.40, unsupported
model inference 0.00.`;
