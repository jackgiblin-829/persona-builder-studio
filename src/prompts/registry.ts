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
keyword, and AI-topic section. If a SparkToro distribution is unavailable, leave
that distribution empty. Do not invent unsupported data. Return strict JSON.`,
  user: `Project:\n{{project_context}}\n\nAvailable first-party and SparkToro research signals:\n{{research_signals}}`,
};

export const PROMPT_GENERATION: PromptTemplate = {
  id: "grounded_prompt_candidate_generation",
  version: "4.0.0",
  purpose: "Write two grounded prompt candidates for every approved coverage cell.",
  modelTier: "reasoning",
  system: `You create a production AI-visibility prompt library from an approved market brief,
coverage blueprint, approved market-research facts, evidence-backed personas, and allowed research
signals. Return exactly two candidates for every blueprint cell, preserving each plan_key and using
candidate keys ending in -a and -b. Each candidate must naturally express that
cell's persona, topic class, prompt type, business line, funnel stage, competitor, and buyer
qualifier. Use the approved category vocabulary. Branded prompts must name the canonical brand;
entity-disambiguation prompts must distinguish it from the supplied collision, alias, or parent;
competitor-comparative prompts must name both the canonical brand and assigned competitor; and
unbranded prompts must not name the canonical brand or its aliases. Never invent a competitor,
product line, qualifier, or company fact. Vary phrasing, length, and question form across the full
library. Do not use generic scaffolding such as “when fit, evidence, risk, and implementation effort
all matter.” Cite only supplied research signal IDs. Prompts must sound like genuine buyer questions
or requests, not keyword lists or internal instructions. Cite only supplied research fact IDs and
research signal IDs. The two candidates for a cell must use meaningfully different syntax. Return
strict JSON matching the schema.`,
  user: `Project and approved prompt strategy:\n{{project_context}}\n\nApproved market brief:\n{{market_brief}}\n\nActive personas:\n{{persona_profiles}}\n\nApproved coverage blueprint:\n{{coverage_blueprint}}\n\nAllowed research signals:\n{{research_signals}}`,
};

export const MARKET_RESEARCH: PromptTemplate = {
  id: "cited_market_research_brief",
  version: "1.0.0",
  purpose: "Create a cited market brief for prompt-library generation.",
  modelTier: "reasoning",
  system: `You are a market researcher preparing an auditable AI-visibility prompt brief. Search the
web for current information and combine it with the supplied project and uploaded-source signals.
Resolve the canonical brand, parent or operator, aliases, similarly named entities, category terms,
business lines, primary competitors, realistic buyer qualifiers, and facts likely to become stale.
Every fact must have a working source URL and concise claim. Prefer the canonical company site and
credible primary sources. Do not infer an unsupported relationship. Preserve the supplied 50-prompt
topic quotas. Use fact IDs fact-001, fact-002, and so on. Return strict JSON matching the schema.`,
  user: `Project:\n{{project_context}}\n\nCurrent strategy:\n{{prompt_strategy}}\n\nUploaded-source signals:\n{{research_signals}}`,
};

export const PROMPT_QUALITY_EVALUATION: PromptTemplate = {
  id: "prompt_candidate_quality_evaluation",
  version: "1.0.0",
  purpose: "Score grounded prompt candidates against the production quality rubric.",
  modelTier: "reasoning",
  system: `Evaluate every prompt candidate independently. Score category specificity 0-20; persona
and qualifier fit 0-15; natural buyer language 0-15; AI-visibility measurement value 0-15;
research support 0-15; distinctiveness 0-10; and metadata completeness 0-10. Use the supplied
maximum semantic similarity when scoring distinctiveness. Add a hard failure for unsupported entity
claims, invented competitors, branded leakage in an unbranded cell, missing required brands or
competitors, missing category or business-line meaning, unknown citations, or obvious boilerplate.
Do not reward keyword stuffing. Return exactly one assessment per candidate key and strict JSON.`,
  user: `Approved strategy and market brief:\n{{project_context}}\n\nCoverage cells and candidates:\n{{candidates}}`,
};

export function renderTemplate(template: PromptTemplate, values: Record<string, string>) {
  return template.user.replace(/{{([a-z0-9_]+)}}/gi, (_match, key: string) => values[key] ?? "");
}
