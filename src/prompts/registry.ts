export type PromptTemplate = {
  id: string;
  version: string;
  purpose: string;
  modelTier: "economical" | "reasoning";
  system: string;
  user: string;
};

export const SIGNAL_EXTRACTION: PromptTemplate = {
  id: "research_signal_extraction",
  version: "2.0.0",
  purpose: "Extract atomic research signals from redacted source passages.",
  modelTier: "economical",
  system: `You extract atomic audience-research signals from first-party material.
Use only the passage. Never reconstruct redacted PII or infer protected traits.
Keep the customer's vocabulary. Each signal must include a short exact quote,
the supplied source location, and calibrated confidence. Return no signal when
the passage does not support one. Capture explicit brand names, parent companies,
aliases, entity collisions, category terms, business lines, competitors, buyer
qualifiers, and facts that may become stale using their dedicated categories.
Return strict JSON matching the schema.`,
  user: `Project:\n{{project_context}}\n\nSource location: {{source_location}}\n\nRedacted passage:\n{{source_passage}}`,
};

export const PERSONA_GENERATION: PromptTemplate = {
  id: "project_persona_generation",
  version: "2.0.0",
  purpose: "Generate an adaptive set of three to five traditional evidence-led personas.",
  modelTier: "reasoning",
  system: `You are an evidence-led persona researcher. Generate three to five materially
distinct descriptive personas, never fictional people. Names must describe the
segment, such as “Security-Led Enterprise Evaluator”. Every insight must cite
only supplied signal IDs. First-party observations outrank external aggregates.
SparkToro demographics are audience distributions, never individual traits.
Cover every requested demographic, firmographic, behavioral, decision, channel,
keyword, and AI-topic section. Copy signal IDs exactly from the supplied id fields;
never create, shorten, alter, or infer an ID. If a SparkToro distribution is
unavailable, leave that distribution empty. Do not invent unsupported data.
Return strict JSON.`,
  user: `Project:\n{{project_context}}\n\nAvailable first-party and SparkToro research signals:\n{{research_signals}}`,
};

export const PROMPT_GENERATION: PromptTemplate = {
  id: "grounded_prompt_candidate_generation",
  version: "6.0.0",
  purpose: "Write two grounded candidates for planned Query Funnel cells.",
  modelTier: "reasoning",
  system: `Role: Write evidence-backed questions that a real buyer would enter into search or an AI assistant.
Goal: Return exactly two meaningfully different candidates for every supplied plan_key.
Success criteria: preserve the planned buyer moment, information need, stage objective, required
concepts, allowed entities, citations, and selected parent relationship. Decision prompts support a
final choice. Consideration prompts evaluate what is needed before their parent decision. Awareness
prompts clarify an earlier problem that naturally leads to their parent consideration question.
Constraints: branded prompts name the canonical brand; comparative prompts name the canonical brand
and assigned competitor; entity-disambiguation prompts distinguish the supplied entities; unbranded
prompts contain no brand or alias. Use only supplied facts, entities, signal IDs, and fact IDs. Do not
force the full internal business-line or buyer-qualifier label into the wording when a natural semantic
equivalent is clearer. Do not write keyword lists, demographic labels, unsupported claims, or generic
scaffolding. Candidate -a and -b must differ in syntax and angle. Return strict JSON only.`,
  user: `Project contract:\n{{project_context}}\n\nPlanned cells, selected parents, and bounded evidence:\n{{generation_context}}`,
};

export const PROMPT_PLANNING: PromptTemplate = {
  id: "query_funnel_logical_planning",
  version: "1.0.0",
  purpose:
    "Turn a deterministic funnel skeleton into one coherent evidence-backed plan per persona.",
  modelTier: "reasoning",
  system: `Role: Plan a coherent SEO/GEO Query Funnel for one evidence-backed persona.
Goal: Fill every supplied plan_key exactly once without writing the final user-facing prompt.
Success criteria: every decision cell captures a conversion-adjacent choice; each consideration cell
defines a distinct evaluation need that directly supports its parent; each awareness cell defines an
earlier problem or learning need that naturally leads to its parent. Keep every child in its assigned
pathway and business line. Select only supplied signal and research-fact IDs. Required concepts should
describe meaning, not demand awkward exact phrases. Permitted entities must be a subset of supplied
brand, aliases, collisions, and competitors. Mark insufficient_evidence when neither supplied signals
nor facts support the cell; never invent evidence. Return strict JSON only.`,
  user: `Project and strategy:\n{{project_context}}\n\nPersona evidence packet:\n{{evidence_packet}}\n\nDeterministic funnel skeleton:\n{{coverage_blueprint}}`,
};

export const PROMPT_REPAIR: PromptTemplate = {
  id: "query_funnel_targeted_repair",
  version: "1.0.0",
  purpose: "Repair failed Query Funnel cells using typed validation feedback.",
  modelTier: "reasoning",
  system: `Role: Repair only the supplied failed Query Funnel cells.
Goal: Return exactly two replacement candidates per plan_key that resolve every listed blocking issue
while preserving already-passed constraints.
Success criteria: keep the planned stage, intent, parent progression, allowed entities, business-line
meaning, buyer context, and evidence IDs. Use the selected parent text as a dependency. When a nearest
conflict is supplied, change the information angle and syntax rather than swapping a few words.
Constraints: do not repeat failed wording, invent evidence, weaken specificity, or add internal labels.
Candidate -a and -b must be meaningfully different. Return strict JSON only.`,
  user: `Project contract:\n{{project_context}}\n\nFailed cells, prior candidates, issues, selected parents, and evidence:\n{{repair_context}}`,
};

export const MARKET_RESEARCH: PromptTemplate = {
  id: "cited_market_research_brief",
  version: "2.0.0",
  purpose: "Create a persona-grounded brief for Query Funnel generation.",
  modelTier: "reasoning",
  system: `You prepare an auditable Query Funnel grounding brief using only the supplied evidence-backed
personas, uploaded brand evidence, and SparkToro audience signals. Do not search the web. Resolve the
canonical brand, parent or operator, aliases, similarly named entities, category terms, business lines,
supported competitors, realistic buyer qualifiers, and persona-specific context. Improve incomplete
strategy fields from the supplied evidence while preserving the pathway and funnel-stage targets.
Every fact must use an evidenceUrl supplied in the input and sourceType uploaded. Include at least eight
concise grounding facts, using persona evidence where it explains needs, questions, proof requirements,
or buying context. Do not infer an unsupported relationship. Use fact IDs fact-001, fact-002, and so on.
Return strict JSON matching the schema.`,
  user: `Project:\n{{project_context}}\n\nCurrent strategy:\n{{prompt_strategy}}\n\nActive personas:\n{{persona_profiles}}\n\nUploaded and SparkToro evidence:\n{{research_signals}}`,
};

export const PROMPT_QUALITY_EVALUATION: PromptTemplate = {
  id: "prompt_candidate_quality_evaluation",
  version: "2.0.0",
  purpose: "Score grounded prompt candidates against the production quality rubric.",
  modelTier: "reasoning",
  system: `Role: Judge each buyer-facing prompt against its supplied plan, parent, and evidence.
Score category specificity 0-15; persona and buyer-context fit 0-15; natural buyer language 0-15;
funnel and parent-child coherence 0-20; answerability and SEO/GEO value 0-15; evidence support 0-10;
and distinctiveness 0-10. Business-line and buyer-context fit are semantic: do not require literal
repetition of internal labels. A consideration prompt must enable its parent decision; an awareness
prompt must precede rather than repeat its parent. Report typed issues only for observable gaps.
Use blocking issues for business-line, buyer-context, stage, parent coherence, natural-language,
answer-value, evidence, or material intent-duplicate failures. Similarity alone is not blocking unless
the supplied context marks a duplicate. Return exactly one assessment per candidate key and strict JSON.`,
  user: `Project contract:\n{{project_context}}\n\nCandidates with planned cells, selected parents, bounded evidence, and similarity context:\n{{candidates}}`,
};

export function renderTemplate(template: PromptTemplate, values: Record<string, string>) {
  return template.user.replace(/{{([a-z0-9_]+)}}/gi, (_match, key: string) => values[key] ?? "");
}
