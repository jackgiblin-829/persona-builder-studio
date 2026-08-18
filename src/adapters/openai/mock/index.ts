import { registerMockGenerator, type MockGenerator } from "../mock";
import {
  MARKET_RESEARCH,
  PERSONA_GENERATION,
  PROMPT_GENERATION,
  PROMPT_PLANNING,
  PROMPT_QUALITY_EVALUATION,
  PROMPT_REPAIR,
  SIGNAL_EXTRACTION,
} from "@/prompts/registry";
import type { CoverageCell, PromptStrategy } from "@/contracts/prompt-strategy";
import { hasPromptEvidence } from "@/contracts/prompt-generation";

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
      deck_profile: {
        role: insight(
          index === 0
            ? "Enterprise Risk and Governance Evaluator"
            : index === 1
              ? "Operational Improvement Buyer"
              : "Strategic Recommendation Champion",
        ),
        industry: insight("Enterprise Software / Workflow Operations"),
        expertise_level: insight(index === 1 ? "Practitioner" : "Advanced Practitioner"),
        tone: insight(
          index === 0
            ? "Measured, precise, and risk-aware. Responds to transparent evidence and clear boundaries."
            : index === 1
              ? "Practical, direct, and outcome-oriented. Prefers plain language over category jargon."
              : "Analytical, credible, and persuasive. Needs language that can travel across stakeholders.",
        ),
        pov_lens: insight(
          index === 0
            ? "Filters every option through security, governance, and enterprise fit before building consensus."
            : index === 1
              ? "Evaluates solutions by the effort required to produce measurable operating improvement."
              : "Compares approaches through the quality of proof and the strength of the recommendation they enable.",
        ),
        cares_about: [
          insight("A clear fit for the real operating environment", "decision_criterion"),
          insight("Credible proof that can withstand stakeholder review", "proof_need"),
          insight("Implementation requirements that are concrete and realistic", "constraint"),
          insight("A decision path that reduces avoidable effort and risk", "job_to_be_done"),
        ],
        never_say: [
          insight("“Just trust the platform” without transparent evidence", "objection"),
          insight(
            "“Implementation will be effortless” without specific requirements",
            "constraint",
          ),
          insight("“Every organization gets the same result” without context", "proof_need"),
        ],
        content_best_suited_for: [
          insight(
            "Evidence-led comparison pages, implementation guides, and proof-rich decision content.",
            "content_preference",
          ),
          insight(
            "Best paired with evaluation-stage pillar content and conversion pages that make fit, effort, and risk explicit.",
            "content_preference",
          ),
        ],
      },
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

registerMockGenerator(PROMPT_PLANNING.id, (context) => {
  const blueprint = (context.blueprint as CoverageCell[] | undefined) ?? [];
  const signals = (context.signals as Signal[] | undefined) ?? [];
  const factIds = ((context.factIds as string[] | undefined) ?? []).filter(Boolean);
  const personaSlug = String(context.personaSlug ?? blueprint[0]?.personaSlug ?? "buyer");
  const personaName = String(context.personaName ?? "Evidence-backed buyer");
  const strategy = context.strategy as PromptStrategy | undefined;
  const safeSignalIds = signals.map((signal) => signal.id);
  return {
    persona_slug: personaSlug,
    plan_summary:
      "A search-intent taxonomy grounded in the persona's questions, proof needs, comparisons, and product use cases.",
    cells: blueprint.map((cell) => {
      const signalId = safeSignalIds[cell.sequence % Math.max(1, safeSignalIds.length)];
      const factId = factIds[cell.sequence % Math.max(1, factIds.length)];
      const permittedEntities =
        cell.promptType === "competitor_comparative"
          ? [strategy?.canonicalBrand, cell.competitor]
          : cell.promptType === "branded" || cell.promptType === "entity_disambiguation"
            ? [
                strategy?.canonicalBrand,
                strategy?.parentCompany,
                ...(strategy?.aliases ?? []),
                ...(strategy?.entityCollisions ?? []),
              ]
            : [];
      return {
        plan_key: cell.key,
        buyer_moment: cell.buyerQualifier || `${personaName} evaluating ${cell.businessLine}`,
        information_need: `${cell.signalTracked} for ${cell.businessLine}`,
        stage_objective:
          cell.funnelStage === "decision"
            ? `Capture a realistic ${cell.businessLine} selection search.`
            : cell.funnelStage === "consideration"
              ? `Capture a realistic ${cell.businessLine} comparison or fit search.`
              : `Capture a realistic ${cell.businessLine} discovery or education search.`,
        required_concepts: [cell.businessLine, cell.signalTracked],
        permitted_entities: permittedEntities.filter((value): value is string => Boolean(value)),
        signal_ids: signalId ? [signalId] : [],
        research_fact_ids: factId ? [factId] : [],
        parent_reason: "This intent adds distinct, evidence-backed search coverage.",
        evidence_status: hasPromptEvidence(signalId ? [signalId] : [], factId ? [factId] : [])
          ? "supported"
          : "insufficient_evidence",
      };
    }),
  };
});

const promptCandidateGenerator: MockGenerator = (context) => {
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
  const category = strategy.categoryTerms[0] ?? "workflow software";
  const collision =
    strategy.entityCollisions[0] ??
    strategy.parentCompany ??
    strategy.aliases[0] ??
    "the parent brand";

  const searchFocus = (cell: CoverageCell) =>
    [
      "easy implementation",
      "strict security needs",
      "lower operating costs",
      "proven results",
      "stakeholder adoption",
      "existing integrations",
      "lower vendor risk",
      "change management",
      "faster time to value",
      "better reporting",
      "strong governance",
      "reliable support",
      "growing teams",
      "cleaner data",
      "procurement approval",
      "lean teams",
      "long-term flexibility",
    ][cell.sequence % 17]!;

  const unbrandedPrompt = (cell: CoverageCell) => {
    const focus = searchFocus(cell);
    const variants: Record<CoverageCell["questionArchetype"], string> = {
      recommendation: `What are the best ${cell.businessLine} options for ${focus}?`,
      comparison: `Which ${cell.businessLine} tools are easiest to compare for ${focus}?`,
      how_to: `How does ${cell.businessLine} work with ${focus}?`,
      worth_it: `Is ${cell.businessLine} worth it for ${focus}?`,
      migration: `How hard is it to switch ${cell.businessLine} providers with ${focus}?`,
      risk: `What are the biggest ${cell.businessLine} risks with ${focus}?`,
      entity_verification: `Which companies specialize in ${cell.businessLine} for ${focus}?`,
      workflow: `How can ${cell.businessLine} improve ${focus}?`,
    };
    return variants[cell.questionArchetype];
  };

  const promptFor = (cell: CoverageCell) => {
    const focus = searchFocus(cell);
    if (cell.promptType === "competitor_comparative") {
      const variants = [
        `Is ${strategy.canonicalBrand} or ${cell.competitor} better for ${cell.businessLine} and ${focus}?`,
        `How do ${strategy.canonicalBrand} and ${cell.competitor} compare for ${cell.businessLine} with ${focus}?`,
        `Which has better ${cell.businessLine} support, ${strategy.canonicalBrand} or ${cell.competitor}, for ${focus}?`,
        `What are the ${cell.businessLine} tradeoffs between ${strategy.canonicalBrand} and ${cell.competitor} for ${focus}?`,
      ];
      return variants[cell.sequence % variants.length]!;
    }
    if (cell.promptType === "entity_disambiguation") {
      const variants = [
        `Is ${strategy.canonicalBrand} affiliated with ${collision} for ${cell.businessLine} and ${focus}?`,
        `How is ${strategy.canonicalBrand} different from ${collision} for ${cell.businessLine} with ${focus}?`,
        `Is ${strategy.canonicalBrand} or ${collision} the ${cell.businessLine} company for ${focus}?`,
        `Which ${cell.businessLine} company is ${strategy.canonicalBrand}, not ${collision}, for ${focus}?`,
      ];
      return variants[Math.floor(cell.sequence / 2) % variants.length]!;
    }
    if (cell.promptType === "branded") {
      const variants = [
        `Is ${strategy.canonicalBrand} good for ${cell.businessLine} with ${focus}?`,
        `What do users say about ${strategy.canonicalBrand} for ${cell.businessLine} and ${focus}?`,
        `How well does ${strategy.canonicalBrand} handle ${cell.businessLine} with ${focus}?`,
        `Can I trust ${strategy.canonicalBrand} for ${cell.businessLine} and ${focus}?`,
      ];
      return variants[cell.sequence % variants.length]!;
    }
    return unbrandedPrompt(cell);
  };
  const alternatePromptFor = (cell: CoverageCell) => {
    const focus = searchFocus(cell);
    if (cell.promptType === "competitor_comparative") {
      return `When is ${strategy.canonicalBrand} better than ${cell.competitor} for ${cell.businessLine} and ${focus}?`;
    }
    if (cell.promptType === "entity_disambiguation") {
      return `Does ${strategy.canonicalBrand}, rather than ${collision}, provide ${cell.businessLine}?`;
    }
    if (cell.promptType === "branded") {
      return `Should I consider ${strategy.canonicalBrand} for ${cell.businessLine} when I need ${focus}?`;
    }
    return `What should I search for in ${category} for ${cell.businessLine} and ${focus}?`;
  };
  return {
    blueprint_summary:
      "The approved strategy is expanded into two category-grounded candidates per coverage cell with project-wide phrasing variation.",
    candidates: blueprint.flatMap((cell) =>
      [promptFor(cell), alternatePromptFor(cell)].map((promptText, index) => ({
        plan_key: cell.key,
        candidate_key: `${cell.key}-${index === 0 ? "a" : "b"}`,
        prompt_text: promptText,
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
};

registerMockGenerator(PROMPT_GENERATION.id, promptCandidateGenerator);
registerMockGenerator(PROMPT_REPAIR.id, promptCandidateGenerator);

registerMockGenerator(PROMPT_QUALITY_EVALUATION.id, (context) => {
  const candidates = (context.candidates as Array<{ candidate_key: string }> | undefined) ?? [];
  return {
    assessments: candidates.map((candidate, index) => ({
      candidate_key: candidate.candidate_key,
      category_specificity: 14,
      persona_context_fit: index % 2 === 0 ? 14 : 13,
      natural_buyer_language: index % 2 === 0 ? 14 : 13,
      funnel_coherence: 18,
      answer_value: 14,
      evidence_support: 9,
      distinctiveness: index % 2 === 0 ? 9 : 8,
      issues: [],
      explanation:
        "The candidate is specific, supported, natural, search-ready, and aligned to its assigned intent.",
      repair_instruction: "",
    })),
  };
});
