export const TOPIC_CLASSES = [
  "brand_entity_authority",
  "unbranded_category_discovery",
  "competitive_comparison",
  "buyer_education",
  "reputation_risk",
  "product_line_use_cases",
] as const;

export type TopicClass = (typeof TOPIC_CLASSES)[number];

export const TOPIC_CLASS_LABELS: Record<TopicClass, string> = {
  brand_entity_authority: "Brand and entity authority",
  unbranded_category_discovery: "Unbranded category discovery",
  competitive_comparison: "Competitive comparison",
  buyer_education: "Buyer education",
  reputation_risk: "Reputation and risk",
  product_line_use_cases: "Product-line use cases",
};

export const PROMPT_TYPES = [
  "branded",
  "unbranded",
  "competitor_comparative",
  "entity_disambiguation",
] as const;
export type PromptType = (typeof PROMPT_TYPES)[number];

export const QUESTION_ARCHETYPES = [
  "recommendation",
  "comparison",
  "how_to",
  "worth_it",
  "migration",
  "risk",
  "entity_verification",
  "workflow",
] as const;
export type QuestionArchetype = (typeof QUESTION_ARCHETYPES)[number];

export const FUNNEL_STAGES = ["awareness", "consideration", "decision"] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];

export type PromptStrategy = {
  canonicalBrand: string;
  parentCompany: string;
  aliases: string[];
  entityCollisions: string[];
  categoryTerms: string[];
  businessLines: string[];
  competitors: string[];
  buyerQualifiers: string[];
  freshnessFacts: string[];
  targetPromptCount: number;
  topicTargets: Record<TopicClass, number>;
  personaPromptTargets: Record<string, number>;
};

export type PromptPersona = { slug: string; name: string };

export type CoverageCell = {
  key: string;
  sequence: number;
  personaSlug: string;
  topicClass: TopicClass;
  promptType: PromptType;
  questionArchetype: QuestionArchetype;
  funnelStage: FunnelStage;
  geoCategory: GeoCategory;
  businessLine: string;
  signalTracked: string;
  buyerQualifier: string;
  competitor: string;
};

const ARCHETYPES_BY_TOPIC: Record<TopicClass, QuestionArchetype[]> = {
  brand_entity_authority: ["entity_verification", "risk", "workflow"],
  unbranded_category_discovery: ["recommendation", "worth_it", "comparison"],
  competitive_comparison: ["comparison", "migration", "recommendation"],
  buyer_education: ["how_to", "workflow", "worth_it"],
  reputation_risk: ["risk", "worth_it", "migration"],
  product_line_use_cases: ["workflow", "how_to", "recommendation"],
};

export const DEFAULT_TOPIC_TARGETS: Record<TopicClass, number> = {
  brand_entity_authority: 6,
  unbranded_category_discovery: 10,
  competitive_comparison: 9,
  buyer_education: 10,
  reputation_risk: 7,
  product_line_use_cases: 8,
};

export const EMPTY_PROMPT_STRATEGY: PromptStrategy = {
  canonicalBrand: "",
  parentCompany: "",
  aliases: [],
  entityCollisions: [],
  categoryTerms: [],
  businessLines: [],
  competitors: [],
  buyerQualifiers: [],
  freshnessFacts: [],
  targetPromptCount: 50,
  topicTargets: { ...DEFAULT_TOPIC_TARGETS },
  personaPromptTargets: {},
};

export function defaultPromptStrategy(brand: string, description = ""): PromptStrategy {
  const fallbackCategory = description
    .replace(/[.!?]+$/g, "")
    .split(/\b(?:that helps|designed for|helping|built for)\b/i)[0]!
    .replace(/^(?:an?|the)\s+/i, "")
    .trim()
    .slice(0, 100);
  return {
    ...EMPTY_PROMPT_STRATEGY,
    canonicalBrand: brand.trim(),
    parentCompany: "",
    aliases: [],
    entityCollisions: [],
    categoryTerms: fallbackCategory ? [fallbackCategory] : [],
    businessLines: fallbackCategory ? [fallbackCategory] : [],
    competitors: [],
    buyerQualifiers: [],
    freshnessFacts: [],
    topicTargets: { ...DEFAULT_TOPIC_TARGETS },
  };
}

export function strategyPromptCount(strategy: PromptStrategy) {
  return TOPIC_CLASSES.reduce((total, topic) => total + strategy.topicTargets[topic], 0);
}

export function strategyReadiness(strategy: PromptStrategy) {
  const blockers: string[] = [];
  if (!strategy.canonicalBrand.trim()) blockers.push("Add the canonical brand name.");
  if (!strategy.categoryTerms.length) blockers.push("Add at least one category term.");
  if (!strategy.businessLines.length) blockers.push("Add at least one business line.");
  if (strategy.topicTargets.competitive_comparison > 0 && !strategy.competitors.length) {
    blockers.push("Add a competitor or set the competitive-comparison target to zero.");
  }
  if (
    strategy.topicTargets.brand_entity_authority > 1 &&
    !strategy.parentCompany &&
    !strategy.aliases.length &&
    !strategy.entityCollisions.length
  ) {
    blockers.push("Add a parent company, alias, or entity collision for authority prompts.");
  }
  if (strategyPromptCount(strategy) !== strategy.targetPromptCount) {
    blockers.push("Topic targets must add up to the total prompt target.");
  }
  return { ready: blockers.length === 0, blockers };
}

function allocatePersonaSequence(strategy: PromptStrategy, personas: PromptPersona[]) {
  const explicit = personas.map((persona) => ({
    slug: persona.slug,
    count: Math.max(0, Math.floor(strategy.personaPromptTargets[persona.slug] ?? 0)),
  }));
  const useExplicit = explicit.some((item) => item.count > 0);
  const allocations = useExplicit
    ? explicit
    : personas.map((persona, index) => ({
        slug: persona.slug,
        count:
          Math.floor(strategy.targetPromptCount / personas.length) +
          (index < strategy.targetPromptCount % personas.length ? 1 : 0),
      }));
  const assigned = allocations.reduce((total, item) => total + item.count, 0);
  if (assigned !== strategy.targetPromptCount) {
    throw new Error(
      `Persona prompt targets add up to ${assigned}, not ${strategy.targetPromptCount}.`,
    );
  }
  const sequence: string[] = [];
  let remaining = allocations.map((item) => ({ ...item }));
  while (sequence.length < strategy.targetPromptCount) {
    const next = remaining.find((item) => item.count > 0);
    if (!next) break;
    sequence.push(next.slug);
    next.count--;
    remaining = [...remaining.slice(1), remaining[0]!];
  }
  return sequence;
}

function promptTypeFor(
  strategy: PromptStrategy,
  topic: TopicClass,
  topicIndex: number,
): PromptType {
  if (topic === "competitive_comparison") return "competitor_comparative";
  if (topic === "unbranded_category_discovery" || topic === "buyer_education") {
    return "unbranded";
  }
  if (topic === "product_line_use_cases") return "unbranded";
  if (topic === "brand_entity_authority") {
    const canDisambiguate = Boolean(
      strategy.parentCompany || strategy.aliases.length || strategy.entityCollisions.length,
    );
    return canDisambiguate && topicIndex % 2 === 0 ? "entity_disambiguation" : "branded";
  }
  return topicIndex % 2 === 0 ? "branded" : "unbranded";
}

function funnelFor(topic: TopicClass, topicIndex: number): FunnelStage {
  if (topic === "buyer_education" || topic === "unbranded_category_discovery") {
    return topicIndex % 3 === 0 ? "consideration" : "awareness";
  }
  if (topic === "competitive_comparison" || topic === "reputation_risk") {
    return topicIndex % 3 === 0 ? "decision" : "consideration";
  }
  return topicIndex % 2 === 0 ? "consideration" : "decision";
}

function geoCategoryFor(topic: TopicClass, topicIndex: number): GeoCategory {
  const options: Record<TopicClass, GeoCategory[]> = {
    brand_entity_authority: ["evaluation_trust_and_proof", "purchase_and_selection"],
    unbranded_category_discovery: ["problem_discovery", "solution_recommendations"],
    competitive_comparison: ["comparisons_and_alternatives"],
    buyer_education: ["foundational_education", "problem_discovery"],
    reputation_risk: ["objections_and_risk", "evaluation_trust_and_proof"],
    product_line_use_cases: ["implementation_and_optimization", "purchase_and_selection"],
  };
  return options[topic][topicIndex % options[topic].length]!;
}

const SIGNAL_BY_TOPIC: Record<TopicClass, string> = {
  brand_entity_authority: "entity accuracy",
  unbranded_category_discovery: "category recommendation",
  competitive_comparison: "competitive preference",
  buyer_education: "buyer understanding",
  reputation_risk: "trust and objection handling",
  product_line_use_cases: "product-line relevance",
};

export function buildCoverageBlueprint(
  strategy: PromptStrategy,
  personas: PromptPersona[],
): CoverageCell[] {
  const readiness = strategyReadiness(strategy);
  if (!readiness.ready) throw new Error(readiness.blockers.join(" "));
  if (!personas.length) throw new Error("At least one active persona is required.");
  const personaSequence = allocatePersonaSequence(strategy, personas);
  const cells: CoverageCell[] = [];
  let sequence = 0;
  for (const topicClass of TOPIC_CLASSES) {
    for (let topicIndex = 0; topicIndex < strategy.topicTargets[topicClass]; topicIndex++) {
      const promptType = promptTypeFor(strategy, topicClass, topicIndex);
      const usesQualifier = !["brand_entity_authority"].includes(topicClass);
      cells.push({
        key: `cell-${String(sequence + 1).padStart(3, "0")}`,
        sequence,
        personaSlug: personaSequence[sequence]!,
        topicClass,
        promptType,
        questionArchetype:
          ARCHETYPES_BY_TOPIC[topicClass][topicIndex % ARCHETYPES_BY_TOPIC[topicClass].length]!,
        funnelStage: funnelFor(topicClass, topicIndex),
        geoCategory: geoCategoryFor(topicClass, topicIndex),
        businessLine: strategy.businessLines[sequence % strategy.businessLines.length]!,
        signalTracked: SIGNAL_BY_TOPIC[topicClass],
        buyerQualifier:
          usesQualifier && strategy.buyerQualifiers.length
            ? strategy.buyerQualifiers[sequence % strategy.buyerQualifiers.length]!
            : "",
        competitor:
          promptType === "competitor_comparative"
            ? strategy.competitors[topicIndex % strategy.competitors.length]!
            : "",
      });
      sequence++;
    }
  }
  return cells;
}
import type { GeoCategory } from "./studio";
