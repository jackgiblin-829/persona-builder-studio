import { describe, expect, it } from "vitest";
import { cosineSimilarity } from "@/adapters/openai";
import { MockOpenAIAdapter } from "@/adapters/openai/mock";
import "@/adapters/openai/mock/index";
import {
  buildCoverageBlueprint,
  TOPIC_CLASSES,
  type PromptStrategy,
} from "@/contracts/prompt-strategy";
import { validatePromptLibrary } from "@/jobs/handlers/generate-prompts";
import { toStrictJsonSchema } from "@/prompts/json-schema";
import {
  MARKET_RESEARCH,
  PERSONA_GENERATION,
  PROMPT_GENERATION,
  PROMPT_QUALITY_EVALUATION,
} from "@/prompts/registry";
import {
  marketResearchBriefSchema,
  personaGenerationSchema,
  promptCandidateLibrarySchema,
  promptQualityEvaluationSchema,
  SCHEMA_VERSION,
} from "@/prompts/schemas";

const adapter = new MockOpenAIAdapter({
  economical: "mock-small",
  reasoning: "mock-large",
  embedding: "mock-embed",
});
const signals = Array.from({ length: 16 }, (_, index) => ({
  id: `signal-${index}`,
  category: index === 15 ? "demographic:age" : "pain_point",
  displayText: `Signal ${index}`,
}));
const factIds = Array.from(
  { length: 8 },
  (_, index) => `fact-${String(index + 1).padStart(3, "0")}`,
);
const strategy: PromptStrategy = {
  canonicalBrand: "Northwind Flow",
  parentCompany: "Northwind Group",
  aliases: ["Northwind Workflow"],
  entityCollisions: ["Northwind Traders"],
  categoryTerms: ["enterprise workflow software"],
  businessLines: ["workflow automation", "governance workflows", "operations reporting"],
  competitors: ["Contoso Flow", "Fabrikam Work", "Adventure Works Cloud"],
  buyerQualifiers: ["a regulated enterprise", "a 500-person operations team"],
  freshnessFacts: ["current product name"],
  targetPromptCount: 50,
  topicTargets: {
    brand_entity_authority: 6,
    unbranded_category_discovery: 10,
    competitive_comparison: 9,
    buyer_education: 10,
    reputation_risk: 7,
    product_line_use_cases: 8,
  },
  personaPromptTargets: {},
};
const promptPersonas = [
  { slug: "founder-ceo", name: "Founder and CEO" },
  { slug: "finance-operator", name: "Finance and Operations Lead" },
  { slug: "risk-evaluator", name: "Risk and Security Evaluator" },
];

async function candidatesFor(inputStrategy: PromptStrategy) {
  const blueprint = buildCoverageBlueprint(inputStrategy, promptPersonas);
  const result = await adapter.generateStructured({
    templateId: PROMPT_GENERATION.id,
    templateVersion: PROMPT_GENERATION.version,
    schemaVersion: SCHEMA_VERSION,
    system: PROMPT_GENERATION.system,
    user: "test",
    schema: promptCandidateLibrarySchema,
    schemaName: "PromptCandidateLibrary",
    jsonSchema: toStrictJsonSchema(promptCandidateLibrarySchema, "PromptCandidateLibrary"),
    modelTier: "reasoning",
    mockContext: {
      strategy: inputStrategy,
      blueprint,
      personaNames: Object.fromEntries(
        promptPersonas.map((persona) => [persona.slug, persona.name]),
      ),
      signals,
      factIds,
    },
  });
  return { blueprint, result };
}

function selectedLibrary(
  candidates: Awaited<ReturnType<typeof candidatesFor>>["result"]["data"]["candidates"],
) {
  return {
    blueprint_summary: "A complete selected library for deterministic quality validation.",
    prompts: candidates
      .filter((candidate) => candidate.candidate_key.endsWith("-a"))
      .map((candidate) => ({
        plan_key: candidate.plan_key,
        prompt_text: candidate.prompt_text,
        intent: candidate.intent,
        expected_answer_elements: candidate.expected_answer_elements,
        signal_ids: candidate.signal_ids,
      })),
  };
}

describe("persona, research, and prompt quality contracts", () => {
  it("produces three to five complete descriptive personas with valid references", async () => {
    const result = await adapter.generateStructured({
      templateId: PERSONA_GENERATION.id,
      templateVersion: PERSONA_GENERATION.version,
      schemaVersion: SCHEMA_VERSION,
      system: PERSONA_GENERATION.system,
      user: "test",
      schema: personaGenerationSchema,
      schemaName: "PersonaGeneration",
      jsonSchema: toStrictJsonSchema(personaGenerationSchema, "PersonaGeneration"),
      modelTier: "reasoning",
      mockContext: { signals },
    });
    expect(result.data.personas.length).toBeGreaterThanOrEqual(3);
    expect(result.data.personas.length).toBeLessThanOrEqual(5);
    for (const persona of result.data.personas) {
      expect(persona.name.split(" ").length).toBeGreaterThan(2);
      expect(persona.jobs_to_be_done.length).toBeGreaterThan(0);
      expect(persona.ai_prompt_topics.length).toBeGreaterThan(0);
    }
  });

  it("creates a cited, strategy-complete market brief", async () => {
    const result = await adapter.generateStructured({
      templateId: MARKET_RESEARCH.id,
      templateVersion: MARKET_RESEARCH.version,
      schemaVersion: SCHEMA_VERSION,
      system: MARKET_RESEARCH.system,
      user: "test",
      schema: marketResearchBriefSchema,
      schemaName: "MarketResearchBrief",
      jsonSchema: toStrictJsonSchema(marketResearchBriefSchema, "MarketResearchBrief"),
      modelTier: "reasoning",
      webSearch: true,
      mockContext: { strategy, domain: "northwind.example", signals },
    });
    expect(result.data.facts).toHaveLength(8);
    expect(new Set(result.data.facts.map((fact) => fact.id)).size).toBe(8);
    expect(result.data.facts.every((fact) => fact.sourceUrl.startsWith("https://"))).toBe(true);
    expect(result.data.strategy.targetPromptCount).toBe(50);
  });

  it("produces two grounded candidates per cell with balanced archetypes", async () => {
    const { blueprint, result } = await candidatesFor(strategy);
    expect(result.data.candidates).toHaveLength(100);
    expect(new Set(blueprint.map((cell) => cell.topicClass))).toEqual(new Set(TOPIC_CLASSES));
    expect(new Set(result.data.candidates.map((candidate) => candidate.candidate_key)).size).toBe(
      100,
    );
    for (const cell of blueprint) {
      const rows = result.data.candidates.filter((candidate) => candidate.plan_key === cell.key);
      expect(rows).toHaveLength(2);
      rows.forEach((candidate) => {
        expect(candidate.prompt_text.toLowerCase()).toContain(cell.businessLine.toLowerCase());
        expect(candidate.research_fact_ids.length).toBeGreaterThan(0);
        if (cell.promptType === "competitor_comparative") {
          expect(candidate.prompt_text).toContain(strategy.canonicalBrand);
          expect(candidate.prompt_text).toContain(cell.competitor);
        }
        if (cell.promptType === "unbranded") {
          expect(candidate.prompt_text).not.toContain(strategy.canonicalBrand);
        }
      });
    }
    const archetypeCounts = new Map<string, number>();
    blueprint.forEach((cell) =>
      archetypeCounts.set(
        cell.questionArchetype,
        (archetypeCounts.get(cell.questionArchetype) ?? 0) + 1,
      ),
    );
    expect(Math.max(...archetypeCounts.values())).toBeLessThanOrEqual(10);
    validatePromptLibrary(
      selectedLibrary(result.data.candidates),
      blueprint,
      new Set(signals.map((signal) => signal.id)),
      strategy,
    );
  });

  it("scores every candidate and makes near-duplicate embeddings measurable", async () => {
    const { result } = await candidatesFor(strategy);
    const evaluation = await adapter.generateStructured({
      templateId: PROMPT_QUALITY_EVALUATION.id,
      templateVersion: PROMPT_QUALITY_EVALUATION.version,
      schemaVersion: SCHEMA_VERSION,
      system: PROMPT_QUALITY_EVALUATION.system,
      user: "test",
      schema: promptQualityEvaluationSchema,
      schemaName: "PromptQualityEvaluation",
      jsonSchema: toStrictJsonSchema(promptQualityEvaluationSchema, "PromptQualityEvaluation"),
      modelTier: "reasoning",
      mockContext: { candidates: result.data.candidates },
    });
    expect(evaluation.data.assessments).toHaveLength(100);
    expect(
      evaluation.data.assessments.every((assessment) => !assessment.hard_fail_reasons.length),
    ).toBe(true);

    const embedded = await adapter.embed({
      texts: [
        "Best cap table software for a Series A startup",
        "What is the best cap table platform for a Series A company?",
        "How should an enterprise secure privileged access?",
      ],
    });
    expect(cosineSimilarity(embedded.embeddings[0]!, embedded.embeddings[1]!)).toBeGreaterThan(
      cosineSimilarity(embedded.embeddings[0]!, embedded.embeddings[2]!),
    );
  });

  it("rejects bad references, brand-rule violations, and duplicates", async () => {
    const { blueprint, result } = await candidatesFor(strategy);
    const library = selectedLibrary(result.data.candidates);
    const unknown = structuredClone(library);
    unknown.prompts[0]!.signal_ids = ["unknown"];
    expect(() =>
      validatePromptLibrary(
        unknown,
        blueprint,
        new Set(signals.map((signal) => signal.id)),
        strategy,
      ),
    ).toThrow(/unknown/i);

    const unbrandedCell = blueprint.find((cell) => cell.promptType === "unbranded")!;
    const branded = structuredClone(library);
    branded.prompts.find((prompt) => prompt.plan_key === unbrandedCell.key)!.prompt_text =
      `Is ${strategy.canonicalBrand} the best ${unbrandedCell.businessLine} option?`;
    expect(() =>
      validatePromptLibrary(
        branded,
        blueprint,
        new Set(signals.map((signal) => signal.id)),
        strategy,
      ),
    ).toThrow(/brand leakage/i);

    const duplicate = structuredClone(library);
    duplicate.prompts[1]!.prompt_text = duplicate.prompts[0]!.prompt_text;
    expect(() =>
      validatePromptLibrary(
        duplicate,
        blueprint,
        new Set(signals.map((signal) => signal.id)),
        strategy,
      ),
    ).toThrow(/duplicate/i);
  });

  it("stays category-specific across Fidelity, payroll, and cybersecurity fixtures", async () => {
    const fixtures: Array<{
      strategy: PromptStrategy;
      requiredTerms: string[];
      forbiddenTerms: string[];
    }> = [
      {
        strategy: {
          ...strategy,
          canonicalBrand: "Fidelity Private Shares",
          parentCompany: "",
          aliases: ["Fidelity PSW"],
          entityCollisions: ["Fidelity brokerage"],
          categoryTerms: ["cap table software", "equity management platform"],
          businessLines: ["cap table management", "409A valuations", "financing data room"],
          competitors: ["Carta", "Pulley", "Shareworks"],
          buyerQualifiers: ["a Series A startup with 40 employees", "a seed-stage founder"],
        },
        requiredTerms: ["cap table", "409a", "data room", "carta", "pulley", "shareworks"],
        forbiddenTerms: ["payroll processing", "privileged access"],
      },
      {
        strategy: {
          ...strategy,
          canonicalBrand: "Acme Payroll",
          parentCompany: "Acme HR",
          categoryTerms: ["payroll software"],
          businessLines: ["payroll processing", "tax filing", "employee onboarding"],
          competitors: ["Gusto", "Rippling"],
          buyerQualifiers: ["a 75-person business"],
        },
        requiredTerms: ["payroll processing", "tax filing", "employee onboarding"],
        forbiddenTerms: ["cap table", "privileged access"],
      },
      {
        strategy: {
          ...strategy,
          canonicalBrand: "Shield Access",
          parentCompany: "Shield Security",
          categoryTerms: ["identity security platform"],
          businessLines: ["privileged access", "identity threat detection", "access governance"],
          competitors: ["CyberArk", "Delinea"],
          buyerQualifiers: ["a regulated enterprise"],
        },
        requiredTerms: ["privileged access", "identity threat detection", "access governance"],
        forbiddenTerms: ["cap table", "payroll processing"],
      },
    ];

    for (const fixture of fixtures) {
      const { result } = await candidatesFor(fixture.strategy);
      const corpus = result.data.candidates
        .map((candidate) => candidate.prompt_text.toLowerCase())
        .join(" ");
      for (const term of fixture.requiredTerms) expect(corpus).toContain(term);
      for (const term of fixture.forbiddenTerms) expect(corpus).not.toContain(term);
    }
  });
});
