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
  awareness: "Explore",
  consideration: "Evaluate",
  decision: "Choose",
};

export const SEARCH_STAGE_LABELS = FUNNEL_STAGE_LABELS;

export type FunnelTargets = Record<FunnelStage, number>;

export const DEFAULT_FUNNEL_TARGETS: FunnelTargets = {
  awareness: 30,
  consideration: 15,
  decision: 5,
};

export type PromptWorkbookProfile = {
  preparedBy: string;
  primaryCommercialJob: string;
  targetRegions: string[];
  trackingSurfaces: string[];
  competitorContext: string[];
  entityRiskRows: string[];
};

export const DEFAULT_TRACKING_SURFACES = [
  "ChatGPT",
  "Google AI Overviews / AI Mode",
  "Perplexity",
  "Gemini",
  "Copilot",
  "Claude",
];

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
  workbook?: PromptWorkbookProfile;
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
  workbook: {
    preparedBy: "829 Studios",
    primaryCommercialJob:
      "Earn recommendation visibility among priority buyers before the brand is named.",
    targetRegions: ["US"],
    trackingSurfaces: [...DEFAULT_TRACKING_SURFACES],
    competitorContext: [],
    entityRiskRows: [],
  },
};

export function defaultPromptStrategy(
  brand: string,
  description = "",
  primaryMarket = "US",
): PromptStrategy {
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
    workbook: {
      preparedBy: "829 Studios",
      primaryCommercialJob:
        "Earn recommendation visibility among priority buyers before the brand is named.",
      targetRegions: [primaryMarket],
      trackingSurfaces: [...DEFAULT_TRACKING_SURFACES],
      competitorContext: [],
      entityRiskRows: [],
    },
  };
}

export function resolvePromptWorkbookProfile(
  strategy: PromptStrategy,
  primaryMarket = "US",
): PromptWorkbookProfile {
  return {
    preparedBy: strategy.workbook?.preparedBy?.trim() || "829 Studios",
    primaryCommercialJob:
      strategy.workbook?.primaryCommercialJob?.trim() ||
      "Earn recommendation visibility among priority buyers before the brand is named.",
    targetRegions: strategy.workbook?.targetRegions?.length
      ? strategy.workbook.targetRegions
      : [primaryMarket],
    trackingSurfaces: strategy.workbook?.trackingSurfaces?.length
      ? strategy.workbook.trackingSurfaces
      : [...DEFAULT_TRACKING_SURFACES],
    competitorContext: strategy.workbook?.competitorContext ?? [],
    entityRiskRows: strategy.workbook?.entityRiskRows ?? [],
  };
}

export function strategyPromptCount(strategy: PromptStrategy) {
  return FUNNEL_STAGES.reduce((total, stage) => total + strategy.funnelTargets[stage], 0);
}

export function deriveSearchStageTargets(targetPromptCount: number): FunnelTargets {
  const total = Math.max(12, Math.min(100, Math.round(targetPromptCount)));
  const decision = Math.max(2, Math.round(total * 0.1));
  const consideration = Math.max(decision, Math.round(total * 0.3));
  const awareness = total - decision - consideration;
  return { awareness, consideration, decision };
}

export function strategyReadiness(strategy: PromptStrategy) {
  const blockers: string[] = [];
  if (!strategy.canonicalBrand.trim()) blockers.push("Add the canonical brand name.");
  if (!strategy.categoryTerms.length) blockers.push("Add at least one category term.");
  if (!strategy.businessLines.length) blockers.push("Add at least one business line.");
  if (strategyPromptCount(strategy) !== strategy.targetPromptCount) {
    blockers.push("The search-intent mix must add up to the prompts-per-persona target.");
  }
  if (strategy.pathwaysPerPersona < 1 || strategy.pathwaysPerPersona > 10) {
    blockers.push("Choose between one and ten search themes per persona.");
  }
  if (strategy.funnelTargets.decision < strategy.pathwaysPerPersona) {
    blockers.push("Create at least one selection query for every search theme.");
  }
  if (strategy.funnelTargets.consideration < strategy.funnelTargets.decision) {
    blockers.push("Evaluation queries must equal or exceed selection queries.");
  }
  if (strategy.funnelTargets.awareness < strategy.funnelTargets.consideration) {
    blockers.push("Exploration queries must equal or exceed evaluation queries.");
  }
  return { ready: blockers.length === 0, blockers };
}

function promptTypeFor(
  strategy: PromptStrategy,
  topic: TopicClass,
  topicOccurrence: number,
): PromptType {
  if (topic === "brand_entity_authority") {
    const canDisambiguate = Boolean(
      strategy.parentCompany || strategy.aliases.length || strategy.entityCollisions.length,
    );
    return canDisambiguate && topicOccurrence % 5 === 0 ? "entity_disambiguation" : "branded";
  }
  if (topic === "competitive_comparison") {
    return strategy.competitors.length && topicOccurrence % 2 === 0
      ? "competitor_comparative"
      : "unbranded";
  }
  if (topic === "product_line_use_cases") {
    return topicOccurrence % 5 === 0 ? "branded" : "unbranded";
  }
  if (topic === "reputation_risk") {
    return topicOccurrence % 3 === 0 ? "branded" : "unbranded";
  }
  return "unbranded";
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
        const topicOccurrence = personaCells.filter(
          (cell) => cell.topicClass === topicClass,
        ).length;
        const promptType = promptTypeFor(strategy, topicClass, topicOccurrence);
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
          pathwayLabel: `${businessLine} search theme`,
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
              ? strategy.competitors[topicOccurrence % strategy.competitors.length]!
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
  return [
    "buyer_education",
    "unbranded_category_discovery",
    "product_line_use_cases",
    "reputation_risk",
    hasCompetitors ? "competitive_comparison" : "unbranded_category_discovery",
    "brand_entity_authority",
  ];
}
import type { GeoCategory } from "./studio";
