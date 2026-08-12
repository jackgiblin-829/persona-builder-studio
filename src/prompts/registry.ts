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
  version: "5.0.0",
  purpose: "Write two grounded Query Funnel candidates for every persona pathway cell.",
  modelTier: "reasoning",
  system: `You create an evidence-backed SEO/GEO prompt baseline from an approved market brief,
coverage blueprint, approved market-research facts, evidence-backed personas, and allowed research
signals. Return exactly two candidates for every blueprint cell, preserving each plan_key and using
candidate keys ending in -a and -b. Each candidate must naturally express that
cell's persona, topic class, prompt type, business line, funnel stage, competitor, and buyer
qualifier. Respect the parent_key relationship: decision cells are conversion-adjacent anchors,
consideration cells are questions a buyer asks before their assigned decision anchor, and awareness
cells are earlier problem or education questions that naturally lead to their assigned consideration
question. Use the approved category vocabulary. Branded prompts must name the canonical brand;
entity-disambiguation prompts must distinguish it from the supplied collision, alias, or parent;
competitor-comparative prompts must name both the canonical brand and assigned competitor; and
unbranded prompts must not name the canonical brand or its aliases. Never invent a competitor,
product line, qualifier, or company fact. Vary phrasing, length, and question form across the full
library. Do not use generic scaffolding such as “when fit, evidence, risk, and implementation effort
all matter.” Cite only supplied research signal IDs. Prompts must sound like genuine questions or
requests the assigned persona would actually enter into search or an AI assistant, not keyword lists,
demographic labels, or internal instructions. Cite only supplied research fact IDs and
research signal IDs. The two candidates for a cell must use meaningfully different syntax. Return
strict JSON matching the schema.`,
  user: `Project and approved prompt strategy:\n{{project_context}}\n\nApproved market brief:\n{{market_brief}}\n\nActive personas:\n{{persona_profiles}}\n\nApproved coverage blueprint:\n{{coverage_blueprint}}\n\nAllowed research signals:\n{{research_signals}}`,
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
  version: "1.0.0",
  purpose: "Score grounded prompt candidates against the production quality rubric.",
  modelTier: "reasoning",
  system: `Evaluate every prompt candidate independently. Score category specificity 0-20; persona
and qualifier fit 0-15; natural buyer language 0-15; SEO/GEO baseline usefulness 0-15;
research support 0-15; distinctiveness 0-10; and metadata completeness 0-10. Use the supplied
maximum semantic similarity when scoring distinctiveness. Add a hard failure for unsupported entity
claims, invented competitors, branded leakage in an unbranded cell, missing required brands or
competitors, missing category or business-line meaning, a prompt that does not fit its funnel stage
or parent relationship, unknown citations, or obvious boilerplate.
Do not reward keyword stuffing. Return exactly one assessment per candidate key and strict JSON.`,
  user: `Approved strategy and market brief:\n{{project_context}}\n\nCoverage cells and candidates:\n{{candidates}}`,
};

export function renderTemplate(template: PromptTemplate, values: Record<string, string>) {
  return template.user.replace(/{{([a-z0-9_]+)}}/gi, (_match, key: string) => values[key] ?? "");
}
