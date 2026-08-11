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

export const FUNNEL_STAGE_LABELS: Record<FunnelStage, string> = {
  awareness: "Top of funnel",
  consideration: "Middle of funnel",
  decision: "Bottom of funnel",
};

export type FunnelTargets = Record<FunnelStage, number>;

export const DEFAULT_FUNNEL_TARGETS: FunnelTargets = {
  awareness: 30,
  consideration: 15,
  decision: 5,
};

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
  pathwaysPerPersona: number;
  targetPromptCount: number;
  funnelTargets: FunnelTargets;
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
  pathwayKey: string;
  pathwayLabel: string;
  parentKey: string | null;
  geoCategory: GeoCategory;
  businessLine: string;
  signalTracked: string;
  buyerQualifier: string;
  competitor: string;
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
  pathwaysPerPersona: 3,
  targetPromptCount: 50,
  funnelTargets: { ...DEFAULT_FUNNEL_TARGETS },
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
    pathwaysPerPersona: 3,
    funnelTargets: { ...DEFAULT_FUNNEL_TARGETS },
  };
}

export function strategyPromptCount(strategy: PromptStrategy) {
  return FUNNEL_STAGES.reduce((total, stage) => total + strategy.funnelTargets[stage], 0);
}

export function strategyReadiness(strategy: PromptStrategy) {
  const blockers: string[] = [];
  if (!strategy.canonicalBrand.trim()) blockers.push("Add the canonical brand name.");
  if (!strategy.categoryTerms.length) blockers.push("Add at least one category term.");
  if (!strategy.businessLines.length) blockers.push("Add at least one business line.");
  if (strategyPromptCount(strategy) !== strategy.targetPromptCount) {
    blockers.push("Funnel-stage targets must add up to the prompts-per-persona target.");
  }
  if (strategy.pathwaysPerPersona < 1 || strategy.pathwaysPerPersona > 10) {
    blockers.push("Choose between one and ten pathways per persona.");
  }
  if (strategy.funnelTargets.decision < strategy.pathwaysPerPersona) {
    blockers.push("Create at least one bottom-of-funnel anchor for every pathway.");
  }
  if (strategy.funnelTargets.consideration < strategy.funnelTargets.decision) {
    blockers.push("Middle-of-funnel prompts must equal or exceed bottom-of-funnel anchors.");
  }
  if (strategy.funnelTargets.awareness < strategy.funnelTargets.consideration) {
    blockers.push("Top-of-funnel prompts must equal or exceed middle-of-funnel prompts.");
  }
  return { ready: blockers.length === 0, blockers };
}

function promptTypeFor(
  strategy: PromptStrategy,
  topic: TopicClass,
  topicIndex: number,
  funnelStage: FunnelStage,
): PromptType {
  if (funnelStage === "awareness") return "unbranded";
  if (topic === "competitive_comparison" && strategy.competitors.length) {
    return "competitor_comparative";
  }
  if (funnelStage === "consideration") return "unbranded";
  if (topic === "brand_entity_authority") {
    const canDisambiguate = Boolean(
      strategy.parentCompany || strategy.aliases.length || strategy.entityCollisions.length,
    );
    return canDisambiguate && topicIndex % 2 === 0 ? "entity_disambiguation" : "branded";
  }
  return "branded";
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
  const cells: CoverageCell[] = [];
  let sequence = 0;
  for (const persona of personas) {
    const personaCells: CoverageCell[] = [];
    const addStage = (funnelStage: FunnelStage, count: number) => {
      const stageTopics = topicsForStage(funnelStage, strategy.competitors.length > 0);
      for (let stageIndex = 0; stageIndex < count; stageIndex++) {
        const localSequence = personaCells.length;
        const topicClass = stageTopics[stageIndex % stageTopics.length]!;
        const promptType = promptTypeFor(strategy, topicClass, stageIndex, funnelStage);
        const parent = parentForStage(personaCells, funnelStage, stageIndex);
        const pathwayIndex =
          parent?.pathwayKey != null
            ? Number(parent.pathwayKey.split("-").at(-1)) - 1
            : stageIndex % strategy.pathwaysPerPersona;
        const businessLine = strategy.businessLines[pathwayIndex % strategy.businessLines.length]!;
        const pathwayKey = `${persona.slug}-path-${String(pathwayIndex + 1).padStart(2, "0")}`;
        const usesQualifier = topicClass !== "brand_entity_authority";
        const cell: CoverageCell = {
          key: `cell-${String(sequence + 1).padStart(3, "0")}`,
          sequence,
          personaSlug: persona.slug,
          topicClass,
          promptType,
          questionArchetype: QUESTION_ARCHETYPES[localSequence % QUESTION_ARCHETYPES.length]!,
          funnelStage,
          pathwayKey,
          pathwayLabel: `${businessLine} decision pathway`,
          parentKey: parent?.key ?? null,
          geoCategory: geoCategoryFor(topicClass, stageIndex),
          businessLine,
          signalTracked: SIGNAL_BY_TOPIC[topicClass],
          buyerQualifier:
            usesQualifier && strategy.buyerQualifiers.length
              ? strategy.buyerQualifiers[stageIndex % strategy.buyerQualifiers.length]!
              : "",
          competitor:
            promptType === "competitor_comparative"
              ? strategy.competitors[stageIndex % strategy.competitors.length]!
              : "",
        };
        cells.push(cell);
        personaCells.push(cell);
        sequence++;
      }
    };
    addStage("decision", strategy.funnelTargets.decision);
    addStage("consideration", strategy.funnelTargets.consideration);
    addStage("awareness", strategy.funnelTargets.awareness);
  }
  return cells;
}

function parentForStage(cells: CoverageCell[], stage: FunnelStage, index: number) {
  if (stage === "decision") return null;
  const parentStage: FunnelStage = stage === "consideration" ? "decision" : "consideration";
  const parents = cells.filter((cell) => cell.funnelStage === parentStage);
  return parents[index % parents.length] ?? null;
}

function topicsForStage(stage: FunnelStage, hasCompetitors: boolean): TopicClass[] {
  if (stage === "decision") {
    return [
      "brand_entity_authority",
      hasCompetitors ? "competitive_comparison" : "product_line_use_cases",
      "reputation_risk",
      "product_line_use_cases",
      hasCompetitors ? "competitive_comparison" : "brand_entity_authority",
    ];
  }
  if (stage === "consideration") {
    return [
      "buyer_education",
      hasCompetitors ? "competitive_comparison" : "unbranded_category_discovery",
      "reputation_risk",
      "product_line_use_cases",
      "unbranded_category_discovery",
    ];
  }
  return ["buyer_education", "unbranded_category_discovery", "product_line_use_cases"];
}
import type { GeoCategory } from "./studio";
