import { describe, expect, it } from "vitest";
import {
  deriveCategoryTerm,
  generatePrompts,
  toClause,
  type PromptMockContext,
  type PromptMockEvidence,
  type PromptMockField,
} from "@/adapters/openai/mock/prompts";
import { mentionsBrand } from "@/jobs/handlers/generate-prompts";
import { promptGenerationSchema, PROMPT_INTENTS } from "@/prompts/schemas";
import { normalizePromptText } from "@/lib/prompt-dedupe";

function evidence(overrides: Partial<PromptMockEvidence> & { id: string }): PromptMockEvidence {
  return {
    claim: "A claim",
    category: "constraint",
    sourceType: "sales_transcript",
    journeyStage: "evaluation",
    entities: [],
    vocabulary: [],
    ...overrides,
  };
}

function field(overrides: Partial<PromptMockField> & { id: string }): PromptMockField {
  return {
    fieldType: "constraint",
    statement: "A statement",
    evidenceIds: [],
    insufficientEvidence: false,
    confidence: 0.6,
    ...overrides,
  };
}

const CONTEXT: PromptMockContext = {
  brandName: "Northwind Analytics",
  brandDescription:
    "Northwind Analytics is a product-analytics platform for regulated companies. It offers self-hosted deployment.",
  competitorNames: ["Cobalt Insights", "Tessellate BI", "Perch Metrics"],
  personaName: "Security-led deployment buyer",
  segmentDefinition: "Buyers gated by where data physically lives.",
  fields: [
    field({
      id: "pfd_job",
      fieldType: "job_to_be_done",
      statement: "The goal is to give product managers self-serve access to product analytics",
      evidenceIds: ["ev_1"],
      confidence: 0.7,
    }),
    field({
      id: "pfd_con1",
      fieldType: "constraint",
      statement: "Customer data cannot leave our approved cloud environment",
      evidenceIds: ["ev_2"],
      confidence: 0.8,
    }),
    field({
      id: "pfd_con2",
      fieldType: "constraint",
      statement: "If it can't run in our own VPC we don't even take the demo",
      evidenceIds: ["ev_3"],
      confidence: 0.4,
    }),
    field({
      id: "pfd_crit",
      fieldType: "decision_criterion",
      statement: "The deciding factor is deployment model first, then governance",
      evidenceIds: ["ev_4"],
      confidence: 0.55,
    }),
    field({
      id: "pfd_proof",
      fieldType: "proof_preference",
      statement: "Send me the SOC 2 Type II report and the architecture diagram",
      evidenceIds: ["ev_5"],
      confidence: 0.6,
    }),
    field({
      id: "pfd_metric",
      fieldType: "success_metric",
      statement:
        "Success means the platform is deployed inside our environment, security signed off",
      evidenceIds: ["ev_6"],
      confidence: 0.5,
    }),
    field({
      id: "pfd_obj",
      fieldType: "objection",
      statement: "Self-hosted versions are always a second-class product",
      evidenceIds: ["ev_7"],
      confidence: 0.45,
    }),
    field({
      id: "pfd_q",
      fieldType: "recurring_question",
      statement: "How does column-level lineage work in practice?",
      evidenceIds: ["ev_8"],
      confidence: 0.4,
    }),
    field({
      id: "pfd_topic",
      fieldType: "distinguishing_topic",
      statement: "column-level lineage",
      evidenceIds: ["ev_8"],
      confidence: 0.5,
    }),
  ],
  evidence: [
    evidence({ id: "ev_1", category: "job_to_be_done", vocabulary: ["self-serve"] }),
    evidence({ id: "ev_2", vocabulary: ["approved cloud environment"] }),
    evidence({ id: "ev_3" }),
    evidence({ id: "ev_4", category: "decision_criterion" }),
    evidence({ id: "ev_5", category: "proof_requirement" }),
    evidence({ id: "ev_6", category: "success_metric" }),
    evidence({ id: "ev_7", category: "objection" }),
    evidence({ id: "ev_8", category: "question", vocabulary: ["lineage"] }),
    evidence({
      id: "ev_9",
      category: "comparison",
      claim:
        "We looked at Cobalt Insights but they are cloud-only, and Tessellate BI is what we have now",
      entities: ["Cobalt Insights", "Tessellate BI"],
    }),
    evidence({
      id: "ev_10",
      category: "pain_point",
      claim: "Our warehouse sync fails silently about once a week",
    }),
    evidence({
      id: "ev_11",
      category: "implementation_requirement",
      claim: "The rollout has to be mostly self-service after initial setup",
    }),
    evidence({
      id: "ev_12",
      claim: "Procurement runs the vendor assessment and pricing has to clear it",
    }),
  ],
  existingPromptTexts: [],
};

describe("deriveCategoryTerm", () => {
  it("pulls the market category out of the brand description", () => {
    expect(deriveCategoryTerm(CONTEXT.brandDescription)).toBe("product-analytics platforms");
  });

  it("falls back to something vague rather than something wrong", () => {
    expect(deriveCategoryTerm("We help teams move faster.")).toBe("tools in this category");
  });

  it("pluralises correctly", () => {
    expect(deriveCategoryTerm("Acme is a compliance service for banks.")).toBe(
      "compliance services",
    );
  });
});

describe("toClause", () => {
  it("lowercases the opening word and drops trailing punctuation", () => {
    expect(toClause("Customer data cannot leave our cloud.")).toBe(
      "customer data cannot leave our cloud",
    );
  });

  it("keeps an acronym capitalised", () => {
    expect(toClause("SOC 2 evidence is required")).toBe("SOC 2 evidence is required");
  });

  it("refuses an imperative, which cannot follow 'when'", () => {
    expect(toClause("Send me the SOC 2 Type II report")).toBe("");
  });

  it("refuses a conditional refusal, whose polarity rules cannot safely invert", () => {
    expect(toClause("If it can't run in our own VPC we don't even take the demo")).toBe("");
  });

  it("cuts a long compound statement at a clause boundary, not mid-phrase", () => {
    const clause = toClause(
      "the platform is deployed inside our environment, security has signed off, and product managers are actually using it every single working day of the week",
    );
    expect(clause).toBe("the platform is deployed inside our environment");
  });
});

describe("generatePrompts", () => {
  const result = generatePrompts(CONTEXT);

  it("produces output that satisfies its own schema", () => {
    expect(promptGenerationSchema.safeParse(result).success).toBe(true);
  });

  it("is deterministic", () => {
    expect(generatePrompts(CONTEXT)).toEqual(result);
  });

  it("never exceeds the 30-prompt ceiling", () => {
    expect(result.prompts.length).toBeLessThanOrEqual(30);
  });

  it("spreads across several intents rather than clustering on one", () => {
    const intents = new Set(result.prompts.map((prompt) => prompt.intent));
    expect(intents.size).toBeGreaterThanOrEqual(6);
    for (const intent of intents) expect(PROMPT_INTENTS).toContain(intent);
  });

  // ── The two structural guardrails (§17) ──────────────────────────────────

  it("never inserts the target brand into a prompt", () => {
    for (const prompt of result.prompts) {
      expect(mentionsBrand(prompt.prompt_text, CONTEXT.brandName)).toBe(false);
      expect(mentionsBrand(prompt.topic, CONTEXT.brandName)).toBe(false);
      if (prompt.generic_control_prompt) {
        expect(mentionsBrand(prompt.generic_control_prompt, CONTEXT.brandName)).toBe(false);
      }
    }
  });

  it("only names a competitor when comparison evidence names it", () => {
    const named = result.prompts.filter((prompt) =>
      /Cobalt Insights|Tessellate BI/.test(prompt.prompt_text),
    );
    for (const prompt of named) {
      expect(prompt.intent).toBe("comparison");
    }
    // Perch Metrics is configured as a competitor but appears in no comparison
    // evidence, so it is the brand's view of the market rather than the
    // segment's — and must not reach a tracked prompt.
    for (const prompt of result.prompts) {
      expect(prompt.prompt_text).not.toMatch(/Perch Metrics/);
    }
  });

  it("cites only evidence ids that were supplied", () => {
    const supplied = new Set(CONTEXT.evidence.map((record) => record.id));
    for (const prompt of result.prompts) {
      expect(prompt.evidence_ids.length).toBeGreaterThan(0);
      for (const id of prompt.evidence_ids) expect(supplied.has(id)).toBe(true);
    }
  });

  it("generates nothing from a field with no evidence", () => {
    const bare = generatePrompts({
      ...CONTEXT,
      fields: [
        field({
          id: "pfd_empty",
          statement: "A constraint nobody stated",
          evidenceIds: [],
          insufficientEvidence: true,
        }),
      ],
      evidence: [],
    });
    expect(bare.prompts).toHaveLength(0);
  });

  it("generates nothing from a field marked insufficient even if ids linger", () => {
    const bare = generatePrompts({
      ...CONTEXT,
      fields: [
        field({
          id: "pfd_insufficient",
          statement: "Customer data cannot leave our approved cloud environment",
          evidenceIds: ["ev_2"],
          insufficientEvidence: true,
        }),
      ],
      evidence: [evidence({ id: "ev_2" })],
    });
    expect(bare.prompts).toHaveLength(0);
  });

  // ── Quality rules ─────────────────────────────────────────────────────────

  it("explains why every prompt was included", () => {
    for (const prompt of result.prompts) {
      expect(prompt.inclusion_rationale.length).toBeGreaterThanOrEqual(10);
      expect(prompt.expected_answer_elements.length).toBeGreaterThan(0);
      expect(prompt.information_need.length).toBeGreaterThan(0);
    }
  });

  it("avoids unnaturally long prompts", () => {
    for (const prompt of result.prompts) {
      expect(prompt.prompt_text.length).toBeLessThanOrEqual(220);
    }
  });

  it("emits no exact duplicates", () => {
    const seen = result.prompts.map((prompt) => normalizePromptText(prompt.prompt_text));
    expect(new Set(seen).size).toBe(seen.length);
  });

  it("never pairs a control identical to its own prompt", () => {
    for (const prompt of result.prompts) {
      if (!prompt.generic_control_prompt) continue;
      expect(normalizePromptText(prompt.generic_control_prompt)).not.toBe(
        normalizePromptText(prompt.prompt_text),
      );
    }
  });

  it("pairs a control wherever a meaningful one exists, and none where it does not", () => {
    const withControl = result.prompts.filter((prompt) => prompt.generic_control_prompt !== null);
    expect(withControl.length).toBeGreaterThan(0);
    expect(withControl.length).toBeLessThan(result.prompts.length);
  });

  it("keeps a constraint-derived prompt for every supported constraint", () => {
    // §17: low-frequency constraints that could determine product fit survive
    // trimming. `pfd_con2` has the lowest confidence in the set.
    const constraintPrompts = result.prompts.filter((prompt) => prompt.constraints_used.length > 0);
    const cited = new Set(constraintPrompts.flatMap((prompt) => prompt.evidence_ids));
    expect(cited.has("ev_2")).toBe(true);
    expect(cited.has("ev_3")).toBe(true);
  });

  it("preserves customer vocabulary rather than rewriting it", () => {
    const vocabulary = result.prompts.flatMap((prompt) => prompt.vocabulary_used);
    expect(vocabulary).toContain("self-serve");
  });

  it("skips prompts that already exist in the brand's library", () => {
    const first = result.prompts[0]!;
    const second = generatePrompts({
      ...CONTEXT,
      existingPromptTexts: [first.prompt_text],
    });
    const texts = second.prompts.map((prompt) => normalizePromptText(prompt.prompt_text));
    expect(texts).not.toContain(normalizePromptText(first.prompt_text));
  });

  it("assigns each intent its journey stage consistently", () => {
    const byIntent = new Map<string, Set<string>>();
    for (const prompt of result.prompts) {
      const set = byIntent.get(prompt.intent) ?? new Set<string>();
      set.add(prompt.journey_stage);
      byIntent.set(prompt.intent, set);
    }
    for (const stages of byIntent.values()) expect(stages.size).toBe(1);
  });

  it("caps at 30 even when the persona is very large", () => {
    const many = generatePrompts({
      ...CONTEXT,
      fields: Array.from({ length: 60 }, (_, i) =>
        field({
          id: `pfd_${i}`,
          fieldType: "constraint",
          statement: `Constraint number ${i} means the data has to stay in region ${i}`,
          evidenceIds: ["ev_2"],
        }),
      ),
    });
    expect(many.prompts.length).toBeLessThanOrEqual(30);
    expect(new Set(many.prompts.map((prompt) => prompt.intent)).size).toBeGreaterThan(1);
  });
});

describe("mentionsBrand", () => {
  it("catches the full name and a distinctive first word", () => {
    expect(mentionsBrand("Is Northwind Analytics any good?", "Northwind Analytics")).toBe(true);
    expect(mentionsBrand("Does Northwind support VPC?", "Northwind Analytics")).toBe(true);
  });

  it("does not blacklist a generic word that happens to lead the brand name", () => {
    // A brand called "Analytics Co" must not make the word "analytics"
    // unusable in every prompt in the set.
    expect(mentionsBrand("Which analytics tools support HIPAA?", "Analytics Co")).toBe(false);
  });

  it("matches on a word boundary rather than a substring", () => {
    expect(mentionsBrand("northwinds blowing", "Northwind Analytics")).toBe(false);
  });

  it("ignores a brand name too short to match safely", () => {
    expect(mentionsBrand("What is AI good for?", "AI")).toBe(false);
  });
});
