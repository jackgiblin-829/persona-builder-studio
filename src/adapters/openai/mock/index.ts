import { registerMockGenerator } from "../mock";
import {
  MARKET_RESEARCH,
  PERSONA_GENERATION,
  PROMPT_GENERATION,
  PROMPT_QUALITY_EVALUATION,
  SIGNAL_EXTRACTION,
} from "@/prompts/registry";
import type { CoverageCell, PromptStrategy } from "@/contracts/prompt-strategy";

type Signal = { id: string; category: string; displayText: string };

registerMockGenerator(SIGNAL_EXTRACTION.id, (context) => {
  const passage = String(context.passage ?? "").trim();
  const location = String(context.location ?? "source");
  const sentences = passage
    .split(/(?<=[.!?])\s+/)
    .filter((sentence) => sentence.length > 20)
    .slice(0, 8);
  const categories = [
    "pain_point",
    "job_to_be_done",
    "decision_criterion",
    "proof_need",
    "question",
    "constraint",
    "success_measure",
    "vocabulary",
  ] as const;
  return {
    signals: sentences.map((sentence, index) => ({
      category: categories[index % categories.length],
      display_text: sentence.slice(0, 780),
      quote: sentence.slice(0, 1180),
      source_location: location,
      confidence: 0.78,
    })),
  };
});

registerMockGenerator(PERSONA_GENERATION.id, (context) => {
  const signals = (context.signals as Signal[] | undefined) ?? [];
  const ids = signals.map((signal) => signal.id);
  const fallback = ids[0] ?? "mock-signal";
  const byCategory = (category: string) => signals.filter((signal) => signal.category === category);
  const insight = (text: string, preferred?: string) => {
    const candidates = preferred ? byCategory(preferred) : signals;
    return {
      text,
      signal_ids: [candidates[0]?.id ?? fallback],
      confidence: candidates.length ? 0.82 : 0.62,
    };
  };
  const distribution = (label: string, value: number) => ({
    label,
    value,
    unit: "percent" as const,
    signal_ids: [
      signals.find((signal) => signal.category.startsWith("demographic"))?.id ?? fallback,
    ],
  });
  const profiles = [
    [
      "Security-Led Enterprise Evaluator",
      "A risk-aware evaluator who must validate security, governance, and enterprise fit before building consensus.",
    ],
    [
      "Outcome-Driven Operational Buyer",
      "An operational owner who needs a practical path from today’s friction to measurable business outcomes.",
    ],
    [
      "Evidence-Seeking Strategic Champion",
      "An internal champion who compares approaches and needs credible proof to defend a recommendation.",
    ],
  ] as const;
  return {
    methodology_summary:
      "The segments separate risk, operational outcomes, and internal decision advocacy while grounding every section in project research signals.",
    personas: profiles.map(([name, description], index) => ({
      name,
      slug: name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, ""),
      description,
      summary: `${description} This persona uses search and AI answers to narrow choices, validate claims, and prepare a defensible next step.`,
      demographics: {
        age: [distribution(index === 0 ? "35–44" : index === 1 ? "25–34" : "45–54", 34)],
        gender: [distribution("Audience distribution available in SparkToro", 100)],
        income: [distribution(index === 1 ? "$75k–$124k" : "$125k+", 38)],
        education: [distribution("Bachelor’s degree or higher", 67)],
        geography: [distribution("Primary project market", 100)],
      },
      firmographics: {
        roles: [
          insight(
            index === 0
              ? "Security, IT, and risk leadership"
              : index === 1
                ? "Operations and functional leadership"
                : "Strategy and transformation leadership",
          ),
        ],
        seniority: [
          insight(index === 1 ? "Manager through director" : "Director through executive"),
        ],
        departments: [
          insight(
            index === 0
              ? "Information security and IT"
              : index === 1
                ? "Operations"
                : "Strategy and procurement",
          ),
        ],
        industries: [insight("Industries represented in the project research")],
        company_size: [
          insight(index === 1 ? "Mid-market organizations" : "Large and enterprise organizations"),
        ],
        experience: [
          insight("Experienced evaluators familiar with cross-functional buying decisions"),
        ],
      },
      jobs_to_be_done: [
        insight(
          index === 0
            ? "Validate whether an option can satisfy security and governance requirements"
            : index === 1
              ? "Find a practical solution that improves the current operating process"
              : "Build and defend a well-evidenced recommendation",
          "job_to_be_done",
        ),
      ],
      motivations: [
        insight(
          "Make a high-confidence decision without adding avoidable effort or risk",
          "motivation",
        ),
      ],
      goals: [insight("Reach an actionable shortlist with clear stakeholder alignment", "goal")],
      pain_points: [
        insight("Generic claims make it difficult to distinguish genuine fit", "pain_point"),
      ],
      constraints: [
        insight(
          index === 0
            ? "Security review and stakeholder governance limit acceptable options"
            : "Time, budget, and implementation capacity constrain the choice",
          "constraint",
        ),
      ],
      success_measures: [
        insight("A decision can be explained, implemented, and measured", "success_measure"),
      ],
      decision_criteria: [
        insight("Fit, proof, total effort, risk, and expected outcome", "decision_criterion"),
      ],
      objections: [
        insight(
          "Unverified claims and unclear implementation requirements undermine trust",
          "objection",
        ),
      ],
      common_questions: [
        insight("Which approach is the best fit for this use case and why?", "question"),
      ],
      proof_needs: [
        insight(
          "Independent evidence, transparent methodology, and relevant examples",
          "proof_need",
        ),
      ],
      vocabulary: [insight("best fit"), insight("proof"), insight("implementation")],
      buying_triggers: [
        insight("A costly workflow problem or upcoming decision creates urgency", "buying_trigger"),
      ],
      channels: [
        insight("Search, professional networks, and trusted industry publications", "channel"),
      ],
      communities: [insight("Role-specific professional and peer communities", "community")],
      websites: [insight("Trusted category publications and practitioner resources", "website")],
      content_preferences: [
        insight("Concise comparisons supported by detailed proof", "content_preference"),
      ],
      keywords: [insight("category comparison"), insight("implementation requirements")],
      ai_prompt_topics: [insight("solution recommendations"), insight("risk and proof")],
      confidence: 0.8,
    })),
  };
});

function cleanDemoStrategyTerm(value: string, canonicalBrand: string) {
  let cleaned = value.replaceAll("**", "").trim();
  if (cleaned.toLowerCase().startsWith(canonicalBrand.toLowerCase())) {
    cleaned = cleaned.slice(canonicalBrand.length).trim();
  }
  cleaned = cleaned
    .replace(/^(?:is\s+)?(?:an?\s+)?/i, "")
    .replace(/^all-in-one\s+/i, "")
    .trim();
  const bounded = cleaned.match(/^(.+?\b(?:platform|software|service|solution|tool|system))\b/i);
  return (bounded?.[1] ?? cleaned)
    .replace(/\s+des$/i, "")
    .trim()
    .slice(0, 160);
}

registerMockGenerator(MARKET_RESEARCH.id, (context) => {
  const current = context.strategy as PromptStrategy;
  const domain = String(context.domain ?? "example.com").replace(/^https?:\/\//, "");
  const now = "2026-08-11T12:00:00.000Z";
  const categoryTerms = current.categoryTerms
    .map((value) => cleanDemoStrategyTerm(value, current.canonicalBrand))
    .filter(Boolean);
  const businessLines = current.businessLines
    .map((value) => cleanDemoStrategyTerm(value, current.canonicalBrand))
    .filter(Boolean);
  const normalizedCategories = categoryTerms.length ? categoryTerms : ["business software"];
  const strategy: PromptStrategy = {
    ...current,
    categoryTerms: normalizedCategories,
    businessLines: businessLines.length ? businessLines : normalizedCategories,
    competitors: current.competitors.length
      ? current.competitors
      : ["Example Rival", "Example Alternative"],
    entityCollisions:
      current.entityCollisions.length || current.parentCompany || current.aliases.length
        ? current.entityCollisions
        : ["a similarly named company"],
  };
  const facts = [
    ["brand_identity", `${strategy.canonicalBrand} is the canonical brand name.`],
    [
      "entity_relationship",
      `${strategy.canonicalBrand} must be distinguished from similarly named entities.`,
    ],
    ["category", `${strategy.canonicalBrand} operates in ${strategy.categoryTerms[0]}.`],
    ["business_line", `${strategy.businessLines[0]} is a researched business line.`],
    [
      "business_line",
      `${strategy.businessLines[1] ?? strategy.businessLines[0]} is a researched use case.`,
    ],
    ["competitor", `${strategy.competitors[0]} is a named comparison vendor.`],
    ["competitor", `${strategy.competitors[1] ?? strategy.competitors[0]} is a named alternative.`],
    [
      "buyer_context",
      `${strategy.buyerQualifiers[0] ?? "A growing organization"} is an approved buyer context.`,
    ],
  ] as const;
  return {
    summary: `A deterministic demo brief for ${strategy.canonicalBrand}, covering its category, business lines, competitors, buyer context, and entity accuracy.`,
    strategy,
    facts: facts.map(([kind, claim], index) => ({
      id: `fact-${String(index + 1).padStart(3, "0")}`,
      kind,
      claim,
      sourceTitle: `${strategy.canonicalBrand} demo research`,
      sourceUrl: `https://evidence.persona-builder.local/${domain}/research-${index + 1}`,
      sourceType: "uploaded",
      retrievedAt: now,
    })),
    researchNotes: ["Demo research is deterministic and must not be used as production evidence."],
  };
});

registerMockGenerator(PROMPT_GENERATION.id, (context) => {
  const signals = (context.signals as Signal[] | undefined) ?? [];
  const blueprint = (context.blueprint as CoverageCell[] | undefined) ?? [];
  const strategy = (context.strategy as PromptStrategy | undefined) ?? {
    canonicalBrand: "Target Brand",
    parentCompany: "Parent Company",
    aliases: [],
    entityCollisions: ["another similarly named business"],
    categoryTerms: ["workflow software"],
    businessLines: ["workflow management"],
    competitors: ["Alternative Platform"],
    buyerQualifiers: [],
    freshnessFacts: [],
    pathwaysPerPersona: 3,
    targetPromptCount: blueprint.length,
    funnelTargets: {
      awareness: Math.max(1, Math.floor(blueprint.length * 0.6)),
      consideration: Math.max(1, Math.floor(blueprint.length * 0.3)),
      decision: Math.max(1, blueprint.length - Math.floor(blueprint.length * 0.9)),
    },
  };
  const signalIds = signals.map((signal) => signal.id);
  const safeIds = signalIds.length ? signalIds : ["mock-signal"];
  const factIds = ((context.factIds as string[] | undefined) ?? ["fact-001"]).filter(Boolean);
  const personaNames = (context.personaNames as Record<string, string> | undefined) ?? {};
  const category = strategy.categoryTerms[0] ?? "workflow software";
  const collision =
    strategy.entityCollisions[0] ??
    strategy.parentCompany ??
    strategy.aliases[0] ??
    "the parent brand";

  const unbrandedPrompt = (cell: CoverageCell) => {
    const qualifier = cell.buyerQualifier ? ` ${cell.buyerQualifier}` : "";
    const persona = personaNames[cell.personaSlug] ?? "buyer";
    const angle = {
      brand_entity_authority: "checking brand facts",
      unbranded_category_discovery: "building a category shortlist",
      competitive_comparison: "comparing named vendors",
      buyer_education: "learning the category basics",
      reputation_risk: "checking trust and risk",
      product_line_use_cases: "matching the product to a use case",
    }[cell.topicClass];
    const variants = [
      `What are the best ${cell.businessLine} options for${qualifier || ` a ${persona.toLowerCase()}`} while ${angle}?`,
      `Which ${category} platforms handle ${cell.businessLine} well for${qualifier || " growing teams"} while ${angle}?`,
      `How do I choose a ${cell.businessLine} provider for${qualifier || ` a ${persona.toLowerCase()}`} while ${angle}?`,
      `Is ${cell.businessLine} worth paying for if I am${qualifier || " comparing software for my team"} and ${angle}?`,
      `What features matter most in ${category} for ${cell.businessLine}${qualifier} when ${angle}?`,
      `Can ${cell.businessLine} simplify the process for${qualifier || " a growing organization"} while ${angle}?`,
      `What does a reliable ${cell.businessLine} solution usually cost${qualifier} when ${angle}?`,
      `Where should I start when evaluating ${category} for ${cell.businessLine}${qualifier} and ${angle}?`,
      `Are there ${cell.businessLine} tools designed for${qualifier || ` a ${persona.toLowerCase()}`} that help with ${angle}?`,
      `Which providers are trusted for ${cell.businessLine}${qualifier} when ${angle}?`,
      `What risks should I check before adopting ${cell.businessLine}${qualifier} while ${angle}?`,
      `How can I tell whether a ${cell.businessLine} platform is credible${qualifier} when ${angle}?`,
    ];
    return variants[cell.sequence % variants.length]!;
  };

  const promptFor = (cell: CoverageCell) => {
    const qualifier = cell.buyerQualifier ? ` for ${cell.buyerQualifier}` : "";
    if (cell.promptType === "competitor_comparative") {
      const buyer = cell.buyerQualifier || "a growing organization";
      const variants = [
        `How does ${strategy.canonicalBrand} compare with ${cell.competitor} for ${cell.businessLine}${qualifier}?`,
        `Which is better for ${cell.businessLine}, ${strategy.canonicalBrand} or ${cell.competitor}, for ${buyer}?`,
        `What are the main ${cell.businessLine} tradeoffs between ${strategy.canonicalBrand} and ${cell.competitor}${qualifier}?`,
        `Should ${buyer} choose ${strategy.canonicalBrand} or ${cell.competitor} for ${cell.businessLine}?`,
        `Is ${strategy.canonicalBrand} easier to use than ${cell.competitor} for ${cell.businessLine}${qualifier}?`,
        `Compare ${strategy.canonicalBrand} and ${cell.competitor} for ${cell.businessLine} in the context of ${buyer}.`,
        `What makes ${strategy.canonicalBrand} different from ${cell.competitor} for ${cell.businessLine}${qualifier}?`,
        `When would ${buyer} prefer ${strategy.canonicalBrand} over ${cell.competitor} for ${cell.businessLine}?`,
        `Does ${strategy.canonicalBrand} offer an advantage over ${cell.competitor} for ${cell.businessLine}${qualifier}?`,
        `Where does ${cell.competitor} outperform ${strategy.canonicalBrand} for ${cell.businessLine}${qualifier}?`,
      ];
      return variants[cell.sequence % variants.length]!;
    }
    if (cell.promptType === "entity_disambiguation") {
      const variants = [
        `What is ${strategy.canonicalBrand}, how is it different from ${collision}, and does it provide ${cell.businessLine}?`,
        `Is ${strategy.canonicalBrand} part of ${collision}, and what ${cell.businessLine} services does it offer?`,
        `How can I distinguish ${strategy.canonicalBrand} from ${collision} when researching ${cell.businessLine}?`,
        `Which company operates ${strategy.canonicalBrand}, and is ${cell.businessLine} one of its products?`,
      ];
      return variants[Math.floor(cell.sequence / 2) % variants.length]!;
    }
    if (cell.promptType === "branded") {
      const angle =
        cell.topicClass === "reputation_risk"
          ? "while evaluating trust and risk"
          : "while verifying brand and entity facts";
      const variants = [
        `Is ${strategy.canonicalBrand} a credible choice for ${cell.businessLine}${qualifier} ${angle}?`,
        `What should buyers know about ${strategy.canonicalBrand} for ${cell.businessLine}${qualifier} ${angle}?`,
        `How well does ${strategy.canonicalBrand} support ${cell.businessLine}${qualifier} ${angle}?`,
        `Does ${strategy.canonicalBrand} have a strong reputation for ${cell.businessLine}${qualifier} ${angle}?`,
        `Who is ${strategy.canonicalBrand} best suited for when evaluating ${cell.businessLine}${qualifier} ${angle}?`,
        `Can ${strategy.canonicalBrand} handle ${cell.businessLine}${qualifier} ${angle}?`,
        `What evidence supports choosing ${strategy.canonicalBrand} for ${cell.businessLine}${qualifier} ${angle}?`,
        `Why would a buyer use ${strategy.canonicalBrand} for ${cell.businessLine}${qualifier} ${angle}?`,
      ];
      return variants[cell.sequence % variants.length]!;
    }
    return unbrandedPrompt(cell);
  };
  const alternatePromptFor = (cell: CoverageCell) => {
    const buyer = cell.buyerQualifier || (personaNames[cell.personaSlug] ?? "a growing team");
    if (cell.promptType === "competitor_comparative") {
      return `For ${buyer}, when does ${strategy.canonicalBrand} make more sense than ${cell.competitor} for ${cell.businessLine}?`;
    }
    if (cell.promptType === "entity_disambiguation") {
      return `At the ${cell.funnelStage} stage, does ${strategy.canonicalBrand} refer to the same business as ${collision}, and which one offers ${cell.businessLine}?`;
    }
    if (cell.promptType === "branded") {
      return `Would ${strategy.canonicalBrand} be a strong ${cell.businessLine} option for ${buyer} when measuring ${cell.signalTracked}?`;
    }
    return `For ${buyer}, what should I look for when shortlisting ${cell.businessLine} providers in ${category} to assess ${cell.signalTracked}?`;
  };
  const contextualize = (cell: CoverageCell, prompt: string) => {
    const focus = [
      "implementation effort",
      "security requirements",
      "total operating cost",
      "proof of outcomes",
      "stakeholder adoption",
      "integration fit",
      "vendor risk",
      "change management",
      "time to value",
      "reporting needs",
      "governance",
      "customer support",
      "scalability",
      "data quality",
      "procurement concerns",
      "team capacity",
      "long-term flexibility",
    ][cell.sequence % 17]!;
    const moment = {
      decision: "before a final selection",
      consideration: "while narrowing the shortlist",
      awareness: "while first understanding the problem",
    }[cell.funnelStage];
    return `${prompt} Include ${focus} in the answer ${moment}.`;
  };
  return {
    blueprint_summary:
      "The approved strategy is expanded into two category-grounded candidates per coverage cell with project-wide phrasing variation.",
    candidates: blueprint.flatMap((cell) =>
      [promptFor(cell), alternatePromptFor(cell)].map((promptText, index) => ({
        plan_key: cell.key,
        candidate_key: `${cell.key}-${index === 0 ? "a" : "b"}`,
        prompt_text: contextualize(cell, promptText),
        intent: `${cell.topicClass.replaceAll("_", " ")} for ${cell.businessLine}`,
        expected_answer_elements: [
          "A direct answer grounded in the named category or entity",
          "Relevant options, evidence, and decision criteria",
          "Tradeoffs appropriate to the buyer context",
        ],
        signal_ids: [safeIds[cell.sequence % safeIds.length]!],
        research_fact_ids: [factIds[cell.sequence % factIds.length]!],
      })),
    ),
  };
});

registerMockGenerator(PROMPT_QUALITY_EVALUATION.id, (context) => {
  const candidates = (context.candidates as Array<{ candidate_key: string }> | undefined) ?? [];
  return {
    assessments: candidates.map((candidate, index) => ({
      candidate_key: candidate.candidate_key,
      category_specificity: 19,
      persona_qualifier_fit: index % 2 === 0 ? 14 : 13,
      natural_buyer_language: index % 2 === 0 ? 14 : 13,
      measurement_value: 14,
      research_support: 14,
      distinctiveness: index % 2 === 0 ? 9 : 8,
      metadata_completeness: 10,
      hard_fail_reasons: [],
      explanation:
        "The candidate is category-specific, supported, natural, measurable, and complete.",
    })),
  };
});
