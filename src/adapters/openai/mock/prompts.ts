import type { GeneratedPrompt, PromptGeneration } from "@/prompts/schemas";

/**
 * Deterministic rule-based prompt generation used in mock mode (§17).
 *
 * The product's central anti-pattern is starting from a brand keyword list and
 * inventing a persona around it. This generator is built the other way round and
 * cannot do that even by accident: every prompt starts from a persona field that
 * already cites evidence, and the prompt inherits that field's evidence ids. A
 * field with no evidence produces no prompt.
 *
 * Two guardrails are structural rather than advisory:
 *
 * 1. **The target brand's name is never inserted into a prompt.** Not into the
 *    text, not into the topic. Tracking "is <brand> good?" measures nothing
 *    except how often you asked about yourself. Competitor names appear only
 *    where comparison evidence actually names them.
 * 2. **Generic controls are derived by removing the persona's qualifier**, not
 *    written separately. That keeps the pair genuinely comparable — the control
 *    is the same question asked without the persona's constraint, which is what
 *    makes the lift measurement mean anything.
 *
 * Same input, same output. No clock, no randomness.
 */

export type PromptMockField = {
  id: string;
  fieldType: string;
  statement: string;
  evidenceIds: string[];
  insufficientEvidence: boolean;
  confidence: number;
};

export type PromptMockEvidence = {
  id: string;
  claim: string;
  category: string;
  sourceType: string;
  journeyStage: string;
  entities: string[];
  vocabulary: string[];
};

export type PromptMockContext = {
  brandName: string;
  brandDescription: string;
  competitorNames: string[];
  personaName: string;
  segmentDefinition: string;
  fields: PromptMockField[];
  evidence: PromptMockEvidence[];
  /** Prompt text already tracked for this brand, so the generator can avoid it. */
  existingPromptTexts: string[];
};

const MIN_PROMPTS = 15;
const MAX_PROMPTS = 30;
/** §17: "avoid unnatural overlong prompts". */
const MAX_PROMPT_CHARS = 220;
const MAX_CLAUSE_CHARS = 120;

type Intent = GeneratedPrompt["intent"];
type Stage = GeneratedPrompt["journey_stage"];

/** Each intent sits at one point in the journey. Fixed, so grouping is stable. */
const STAGE_FOR_INTENT: Record<Intent, Stage> = {
  problem_discovery: "problem_discovery",
  education: "education",
  solution_exploration: "solution_exploration",
  comparison: "consideration",
  evaluation: "evaluation",
  risk_reduction: "evaluation",
  purchase: "purchase",
  implementation: "implementation",
  optimization: "optimization",
  troubleshooting: "troubleshooting",
};

export function generatePrompts(context: PromptMockContext): PromptGeneration {
  const category = deriveCategoryTerm(context.brandDescription);
  const supported = context.fields.filter(
    (field) => !field.insufficientEvidence && field.evidenceIds.length > 0,
  );

  const byType = (type: string): PromptMockField[] =>
    supported.filter((field) => field.fieldType === type);

  const drafts: Draft[] = [
    ...problemDiscovery(context, byType, category),
    ...solutionExploration(byType, category),
    ...education(context, byType, category),
    ...comparison(context, byType, category),
    ...evaluationPrompts(byType, category),
    ...riskReduction(byType, category),
    ...implementation(context, byType, category),
    ...optimization(byType, category),
    ...purchase(context, byType, category),
    ...troubleshooting(context, byType, category),
  ];

  const existing = new Set(context.existingPromptTexts.map(normalizeForCompare));
  const seen = new Set<string>();
  const unique: Draft[] = [];

  for (const draft of drafts) {
    const key = normalizeForCompare(draft.prompt.prompt_text);
    if (key.length === 0 || seen.has(key) || existing.has(key)) continue;
    seen.add(key);
    unique.push(draft);
  }

  return { prompts: select(unique).map((draft) => draft.prompt) };
}

// ── Selection ───────────────────────────────────────────────────────────────

type Draft = {
  prompt: GeneratedPrompt;
  /** Rank within its intent. Lower is better. */
  rank: number;
  /**
   * Constraint-derived prompts survive trimming even when they rank badly:
   * §17 requires that low-frequency constraints which could determine product
   * fit are kept, and those are exactly the ones a frequency-ranked list drops.
   */
  protectedByConstraint: boolean;
};

/**
 * Trims to the 15–30 band while keeping intent coverage.
 *
 * Round-robin across intents rather than a global sort, because a global sort
 * by confidence produces twelve comparison prompts and no troubleshooting — a
 * prompt set that measures one stage of the journey very precisely and the rest
 * not at all.
 */
function select(drafts: Draft[]): Draft[] {
  if (drafts.length <= MAX_PROMPTS) return drafts;

  const buckets = new Map<Intent, Draft[]>();
  for (const draft of drafts) {
    const list = buckets.get(draft.prompt.intent) ?? [];
    list.push(draft);
    buckets.set(draft.prompt.intent, list);
  }
  for (const list of buckets.values()) {
    list.sort(
      (a, b) =>
        Number(b.protectedByConstraint) - Number(a.protectedByConstraint) ||
        a.rank - b.rank ||
        b.prompt.confidence - a.prompt.confidence ||
        a.prompt.prompt_text.localeCompare(b.prompt.prompt_text),
    );
  }

  const intents = [...buckets.keys()].sort();
  const chosen: Draft[] = [];
  let round = 0;

  while (chosen.length < MAX_PROMPTS) {
    let addedThisRound = false;
    for (const intent of intents) {
      const list = buckets.get(intent);
      const next = list?.[round];
      if (!next) continue;
      chosen.push(next);
      addedThisRound = true;
      if (chosen.length >= MAX_PROMPTS) break;
    }
    if (!addedThisRound) break;
    round++;
  }

  return chosen;
}

// ── Intent rules ────────────────────────────────────────────────────────────

type ByType = (type: string) => PromptMockField[];

function problemDiscovery(context: PromptMockContext, byType: ByType, category: string): Draft[] {
  const out: Draft[] = [];

  byType("job_to_be_done").forEach((field, index) => {
    const clause = toClause(field.statement);
    if (!clause) return;
    out.push(
      draft({
        field,
        intent: "problem_discovery",
        rank: index,
        text: `What usually goes wrong for teams trying to ${verbClause(clause)}?`,
        control: `What usually goes wrong when teams adopt ${category}?`,
        informationNeed: `Understand the failure modes this segment is trying to avoid while it works to ${verbClause(clause)}.`,
        expected: [
          "Names the concrete failure modes rather than generic advice",
          `Describes the situation in terms a team trying to ${truncate(verbClause(clause), 80)} would recognise`,
          "Distinguishes causes from symptoms",
        ],
        rationale: `The persona's job to be done is evidence-backed, and a problem-discovery prompt measures whether AI answers describe that job in the segment's own terms before any product is named.`,
        vocabulary: vocabularyFor(context, field),
      }),
    );
  });

  byType("objection").forEach((field, index) => {
    const clause = toClause(field.statement);
    if (!clause) return;
    out.push(
      draft({
        field,
        intent: "problem_discovery",
        rank: index + 10,
        text: `Is it a real problem that ${clause}?`,
        control: null,
        informationNeed: `Find out whether AI answers treat this segment's stated concern as legitimate or dismiss it.`,
        expected: [
          "Takes the concern seriously rather than dismissing it",
          "Explains when it does and does not matter",
        ],
        rationale:
          "An objection recorded in the evidence is a question the segment is already asking elsewhere; tracking it shows whether the answers it finds are useful.",
        vocabulary: vocabularyFor(context, field),
      }),
    );
  });

  return out;
}

function solutionExploration(byType: ByType, category: string): Draft[] {
  const out: Draft[] = [];

  byType("constraint").forEach((field, index) => {
    const clause = toClause(field.statement);
    if (!clause) return;
    out.push(
      draft({
        field,
        intent: "solution_exploration",
        rank: index,
        text: `Which ${category} can you use when ${clause}?`,
        // The control is the same question with the constraint removed. If the
        // persona prompt does not outperform this, the constraint hypothesis is
        // what failed, not the content.
        control: `What are the best ${category}?`,
        informationNeed: `Discover which options AI answers surface once this segment's binding constraint is stated.`,
        expected: [
          "Lists named options rather than categories",
          `Says explicitly whether each option satisfies the requirement that ${truncate(clause, 90)}`,
          "Says when no option satisfies it",
        ],
        rationale: `Derived from an evidence-backed constraint. A constraint that changes which products are viable is the highest-value thing to track, and the generic control isolates its effect.`,
        constraints: [field.statement],
        protectedByConstraint: true,
      }),
    );
  });

  // Constraints that could not become a subordinate clause are recovered here
  // with colon framing. §17 requires that low-frequency constraints determining
  // product fit are kept, and a constraint phrased as a conditional refusal is
  // often the sharpest one in the corpus — dropping it for grammatical reasons
  // would lose exactly the evidence the rule exists to protect.
  byType("constraint").forEach((field, index) => {
    if (toClause(field.statement)) return;
    const situation = situationClause(field.statement);
    if (!situation) return;
    out.push(
      draft({
        field,
        intent: "solution_exploration",
        rank: index + 10,
        text: `Which ${category} fit a team in this situation: ${situation}?`,
        control: `What are the best ${category}?`,
        informationNeed: `Discover which options AI answers surface for a team whose requirement is stated exactly as this segment stated it.`,
        expected: [
          "Lists named options rather than categories",
          "Addresses the stated situation directly rather than generically",
          "Says when no option fits",
        ],
        rationale:
          "An evidence-backed constraint whose wording resists rephrasing, so it is quoted as a situation rather than reworded. Rewording it would risk inverting what the buyer actually requires.",
        constraints: [field.statement],
        protectedByConstraint: true,
      }),
    );
  });

  byType("job_to_be_done").forEach((field, index) => {
    const clause = toClause(field.statement);
    if (!clause) return;
    out.push(
      draft({
        field,
        intent: "solution_exploration",
        rank: index + 20,
        text: `What are the options for teams that need to ${verbClause(clause)}?`,
        control: `What are the options for teams evaluating ${category}?`,
        informationNeed: `See which approaches AI answers propose for this job to be done.`,
        expected: [
          "Covers more than one approach",
          "Explains the trade-off between the approaches",
          "Names concrete products or methods",
        ],
        rationale:
          "The job to be done is what the segment is actually shopping for; this measures whether AI answers reach the right option set from it.",
      }),
    );
  });

  return out;
}

function education(context: PromptMockContext, byType: ByType, category: string): Draft[] {
  const out: Draft[] = [];

  byType("distinguishing_topic").forEach((field, index) => {
    const topic = field.statement.trim();
    if (topic.length < 3 || isBrandName(context, topic)) return;
    out.push(
      draft({
        field,
        intent: "education",
        rank: index,
        text: `How does ${topic} work in ${category}?`,
        control: null,
        informationNeed: `Establish whether AI answers explain ${topic} accurately for someone evaluating ${category}.`,
        expected: [
          `Defines ${truncate(topic, 60)} without marketing language`,
          "Explains why it matters during an evaluation",
          "Is specific enough to act on",
        ],
        rationale: `${topic} is named across this segment's evidence, so an inaccurate or missing explanation is a measurable gap.`,
        vocabulary: [topic],
        priority: "medium",
      }),
    );
  });

  byType("recurring_question").forEach((field, index) => {
    const question = asQuestion(field.statement);
    if (!question || looksLikeTrouble(field.statement)) return;
    out.push(
      draft({
        field,
        intent: "education",
        rank: index + 20,
        text: question,
        control: null,
        informationNeed: `A question this segment asked verbatim; track it as asked rather than rewritten.`,
        expected: [
          "Answers the question directly in the first sentence",
          "Uses the asker's own terms",
        ],
        rationale:
          "Recorded verbatim in first-party evidence. Preserving the wording is the point: rewriting it into brand language would measure a question nobody asked.",
        vocabulary: vocabularyFor(context, field),
        priority: "medium",
      }),
    );
  });

  return out;
}

/**
 * Comparison prompts.
 *
 * Competitor names are only inserted where a comparison-category evidence record
 * actually names that competitor. Without that check the generator would quietly
 * turn "our decision criteria" into a competitor-shaped prompt set, which is the
 * brand-first inversion the product exists to prevent.
 */
function comparison(context: PromptMockContext, byType: ByType, category: string): Draft[] {
  const out: Draft[] = [];
  const named = namedCompetitors(context);

  byType("decision_criterion").forEach((field, index) => {
    const clause = toClause(field.statement);
    if (!clause) return;
    out.push(
      draft({
        field,
        intent: "comparison",
        rank: index,
        text: `How do ${category} compare on ${criterionNoun(clause)}?`,
        control: `How do ${category} compare?`,
        informationNeed: `See whether AI comparisons are organised around the criterion this segment actually decides on.`,
        expected: [
          `Compares options specifically on ${truncate(criterionNoun(clause), 80)}`,
          "Names the options being compared",
          "States where the information came from",
        ],
        rationale:
          "An evidence-backed decision criterion. If comparisons ignore it, the segment's real question is going unanswered even where the brand appears.",
        criteria: [field.statement],
      }),
    );
  });

  if (named.length >= 2) {
    const [first, second] = named;
    out.push(
      draft({
        field: syntheticField("comparison", context, named),
        intent: "comparison",
        rank: 5,
        text: `${first} vs ${second}: which is the better fit for a regulated environment?`,
        control: `${first} vs ${second}: which is better?`,
        informationNeed: `Track the head-to-head comparison this segment's evidence already names.`,
        expected: [
          "Compares the two on concrete capabilities",
          "States the conditions under which each wins",
          "Does not present marketing claims as verified fact",
        ],
        rationale: `Both vendors are named in comparison evidence for this segment, so a branded comparison reflects a question that is genuinely being asked. Neither the persona nor this prompt names ${context.brandName}: inserting the brand would measure the question we wish were asked.`,
        priority: "high",
      }),
    );
  }

  return out;
}

function evaluationPrompts(byType: ByType, category: string): Draft[] {
  const out: Draft[] = [];

  byType("proof_preference").forEach((field, index) => {
    const clause = toClause(field.statement);
    if (!clause) return;
    out.push(
      draft({
        field,
        intent: "evaluation",
        rank: index,
        text: `What evidence should you ask a ${singular(category)} vendor for when ${clause}?`,
        control: `What evidence should you ask a ${singular(category)} vendor for?`,
        informationNeed: `Check whether AI answers point this segment at the proof it says it needs.`,
        expected: [
          "Names specific documents or artefacts",
          "Explains what each one proves",
          "Distinguishes vendor claims from independent verification",
        ],
        rationale:
          "The segment stated what proof it requires before proceeding; this measures whether that proof is what AI answers recommend asking for.",
      }),
    );
  });

  // Proof requirements are usually stated as commands ("send me the SOC 2
  // report"), which `toClause` refuses. The object of the command is the
  // trackable part.
  byType("proof_preference").forEach((field, index) => {
    const object = imperativeObject(field.statement);
    if (!object) return;
    out.push(
      draft({
        field,
        intent: "evaluation",
        rank: index + 10,
        text: `Why would a buyer ask a vendor for ${object} before signing?`,
        control: null,
        informationNeed: `Check whether answers explain what this proof actually establishes, rather than treating it as a formality.`,
        expected: [
          "Explains what each document proves and what it does not",
          "Distinguishes a certification from an assurance about this deployment",
        ],
        rationale:
          "The segment named these artefacts as the proof it requires. An answer that treats them as box-ticking will not move this buyer.",
        priority: "high",
      }),
    );
  });

  byType("success_metric").forEach((field, index) => {
    const outcome = metricClause(toClause(field.statement));
    if (!outcome) return;
    out.push(
      draft({
        field,
        intent: "evaluation",
        rank: index + 20,
        text: `How do you verify before committing that ${outcome}?`,
        control: null,
        informationNeed: `Find out whether answers describe a way to test this outcome before purchase.`,
        expected: [
          "Describes a concrete verification step",
          "States what a good result looks like",
        ],
        rationale:
          "Derived from the segment's own success metric, so a useful answer has to be testable rather than reassuring.",
      }),
    );
  });

  return out;
}

function riskReduction(byType: ByType, category: string): Draft[] {
  const out: Draft[] = [];

  byType("objection").forEach((field, index) => {
    const clause = toClause(field.statement);
    if (!clause) return;
    out.push(
      draft({
        field,
        intent: "risk_reduction",
        rank: index,
        text: `What are the risks of adopting ${category} for a buyer with this concern: ${clause}?`,
        control: `What are the risks of adopting ${category}?`,
        informationNeed: `Measure whether AI answers address this segment's stated objection honestly.`,
        expected: [
          "Names the specific risk rather than generic caution",
          "Describes how the risk is mitigated in practice",
          "Says when the risk is not mitigable",
        ],
        rationale:
          "An objection raised in the evidence rather than an anticipated one. Answers that ignore it will not move this segment forward.",
        priority: "high",
      }),
    );
  });

  byType("constraint").forEach((field, index) => {
    const clause = toClause(field.statement);
    if (!clause) return;
    out.push(
      draft({
        field,
        intent: "risk_reduction",
        rank: index + 20,
        // Colon framing rather than a forced noun phrase: a constraint is stated
        // as a whole clause ("customer data cannot leave our approved cloud
        // environment"), and rules cannot reliably reduce an arbitrary clause to
        // a grammatical object without changing what it says.
        text: `How do you verify a vendor really supports this requirement: ${clause}?`,
        control: null,
        informationNeed: `Understand whether answers help this segment verify a constraint claim rather than trust it.`,
        expected: [
          "Explains how to verify the claim",
          "Describes the consequence of an unverified claim",
        ],
        rationale:
          "A constraint that decides product fit is also the thing most likely to be overstated by a vendor; the segment needs a way to check.",
        constraints: [field.statement],
        protectedByConstraint: true,
      }),
    );
  });

  return out;
}

function implementation(context: PromptMockContext, byType: ByType, category: string): Draft[] {
  const out: Draft[] = [];
  const requirements = context.evidence.filter(
    (record) => record.category === "implementation_requirement",
  );

  byType("constraint").forEach((field, index) => {
    const clause = toClause(field.statement);
    if (!clause) return;
    out.push(
      draft({
        field,
        intent: "implementation",
        rank: index,
        text: `What does it take to roll out ${category} when ${clause}?`,
        control: `What does it take to roll out ${category}?`,
        informationNeed: `See whether answers describe the real implementation effort under this segment's constraint.`,
        expected: [
          "Describes the steps in order",
          "States who has to be involved",
          "Gives a realistic timescale",
        ],
        rationale:
          "Implementation effort under a binding constraint is what stalls this segment after the demo; tracking it shows whether answers set the right expectation.",
        constraints: [field.statement],
        protectedByConstraint: true,
      }),
    );
  });

  requirements.slice(0, 3).forEach((record, index) => {
    const clause = toClause(record.claim);
    if (!clause) return;
    out.push(
      draft({
        field: {
          id: `evidence:${record.id}`,
          fieldType: "implementation_requirement",
          statement: record.claim,
          evidenceIds: [record.id],
          insufficientEvidence: false,
          confidence: 0.5,
        },
        intent: "implementation",
        rank: index + 20,
        text: `During a ${singular(category)} rollout, how do you handle this: ${clause}?`,
        control: null,
        informationNeed: `A concrete implementation requirement recorded in the evidence.`,
        expected: ["Gives a concrete method", "Names the tooling or process involved"],
        rationale:
          "Taken directly from an implementation requirement in the evidence rather than from a persona field, so it stays specific.",
        priority: "medium",
      }),
    );
  });

  return out;
}

function optimization(byType: ByType, category: string): Draft[] {
  return byType("success_metric")
    .map((field, index) => {
      const outcome = metricClause(toClause(field.statement));
      if (!outcome) return null;
      return draft({
        field,
        intent: "optimization",
        rank: index,
        text: `Once ${category} are already in place, how do you get to the point where ${outcome}?`,
        control: `How do you get more value from ${category}?`,
        informationNeed: `Check whether answers help this segment improve the outcome it measures, not just adopt a tool.`,
        expected: [
          `Focuses on reaching the outcome: ${truncate(outcome, 80)}`,
          "Gives changes that can be made without replacing the tool",
        ],
        rationale:
          "The segment's own success metric, tracked post-purchase — retention-stage visibility is invisible to a purchase-only prompt set.",
        priority: "medium",
      });
    })
    .filter((item): item is Draft => item !== null);
}

function purchase(context: PromptMockContext, byType: ByType, category: string): Draft[] {
  const out: Draft[] = [];
  const commercial = context.evidence.filter((record) => COMMERCIAL_PATTERN.test(record.claim));

  commercial.slice(0, 3).forEach((record, index) => {
    const clause = toClause(record.claim);
    if (!clause) return;
    out.push(
      draft({
        field: {
          id: `evidence:${record.id}`,
          fieldType: "commercial",
          statement: record.claim,
          evidenceIds: [record.id],
          insufficientEvidence: false,
          confidence: 0.5,
        },
        intent: "purchase",
        rank: index,
        text: `How is pricing for ${category} usually structured for a buyer in this situation: ${clause}?`,
        control: `How is pricing for ${category} usually structured?`,
        informationNeed: `Understand whether AI answers describe commercial terms this segment would recognise.`,
        expected: [
          "Describes the pricing model rather than a number",
          "Names what drives the cost up or down",
          "Flags where published pricing does not apply",
        ],
        rationale:
          "Commercial terms were raised in this segment's evidence; an answer that misdescribes them costs a deal at the last step.",
      }),
    );
  });

  byType("decision_criterion")
    .slice(0, 2)
    .forEach((field, index) => {
      const clause = toClause(field.statement);
      if (!clause) return;
      out.push(
        draft({
          field,
          intent: "purchase",
          rank: index + 20,
          text: `What should be in the contract when ${criterionNoun(clause)} is the deciding factor?`,
          control: null,
          informationNeed: `See whether answers connect the segment's decision criterion to what it can actually hold a vendor to.`,
          expected: [
            "Names specific contractual terms",
            "Explains what each term protects against",
          ],
          rationale:
            "A decision criterion that never reaches the contract is not enforced; this measures whether answers close that gap.",
          criteria: [field.statement],
          priority: "medium",
        }),
      );
    });

  return out;
}

function troubleshooting(context: PromptMockContext, byType: ByType, category: string): Draft[] {
  const out: Draft[] = [];

  byType("recurring_question")
    .filter((field) => looksLikeTrouble(field.statement))
    .forEach((field, index) => {
      const question = asQuestion(field.statement);
      if (!question) return;
      out.push(
        draft({
          field,
          intent: "troubleshooting",
          rank: index,
          text: question,
          control: null,
          informationNeed: `A problem this segment reported in its own words.`,
          expected: ["Identifies the likely cause", "Gives a concrete first step to check"],
          rationale:
            "Recorded verbatim as a problem in first-party evidence; troubleshooting visibility affects retention, not acquisition, and is invisible to a purchase-stage prompt set.",
          vocabulary: vocabularyFor(context, field),
          priority: "medium",
        }),
      );
    });

  const painPoints = context.evidence.filter((record) => record.category === "pain_point");
  painPoints.slice(0, 3).forEach((record, index) => {
    const clause = toClause(record.claim);
    if (!clause) return;
    out.push(
      draft({
        field: {
          id: `evidence:${record.id}`,
          fieldType: "pain_point",
          statement: record.claim,
          evidenceIds: [record.id],
          insufficientEvidence: false,
          confidence: 0.5,
        },
        intent: "troubleshooting",
        rank: index + 20,
        text: `Why does this keep happening with ${category}: ${clause}?`,
        control: null,
        informationNeed: `Track a recorded pain point as the question the segment would type when it recurs.`,
        expected: [
          "Names the usual cause",
          "Distinguishes a configuration problem from a product limit",
        ],
        rationale:
          "Derived from a pain point in the evidence rather than an imagined support question.",
        priority: "low",
      }),
    );
  });

  return out;
}

// ── Draft construction ──────────────────────────────────────────────────────

function draft(input: {
  field: PromptMockField;
  intent: Intent;
  rank: number;
  text: string;
  control: string | null;
  informationNeed: string;
  expected: string[];
  rationale: string;
  constraints?: string[];
  criteria?: string[];
  vocabulary?: string[];
  priority?: GeneratedPrompt["tracking_priority"];
  protectedByConstraint?: boolean;
}): Draft {
  const text = tidy(input.text);
  const control = input.control ? tidy(input.control) : null;

  return {
    rank: input.rank,
    protectedByConstraint: input.protectedByConstraint ?? false,
    prompt: {
      topic: topicFor(input.field, input.intent),
      prompt_text: text,
      // A control identical to its persona prompt measures nothing, so it is
      // dropped rather than stored as a pair that can never show lift.
      generic_control_prompt:
        control && normalizeForCompare(control) !== normalizeForCompare(text) ? control : null,
      information_need: truncate(input.informationNeed, 400),
      intent: input.intent,
      journey_stage: STAGE_FOR_INTENT[input.intent],
      constraints_used: (input.constraints ?? []).map((value) => truncate(value, 200)).slice(0, 10),
      decision_criteria_used: (input.criteria ?? [])
        .map((value) => truncate(value, 200))
        .slice(0, 10),
      vocabulary_used: (input.vocabulary ?? []).map((value) => truncate(value, 120)).slice(0, 10),
      expected_answer_elements: input.expected.map((value) => truncate(value, 240)).slice(0, 10),
      evidence_ids: [...new Set(input.field.evidenceIds)].slice(0, 30),
      inclusion_rationale: truncate(input.rationale, 600),
      // Conversational mode is claimed only where a follow-up is the natural
      // next move: a comparison or an evaluation invites one, a troubleshooting
      // question is usually asked once.
      execution_mode:
        input.intent === "comparison" || input.intent === "evaluation" ? "both" : "standalone",
      tracking_priority: input.priority ?? priorityFor(input.field),
      confidence: clamp01(input.field.confidence),
    },
  };
}

function priorityFor(field: PromptMockField): GeneratedPrompt["tracking_priority"] {
  const core = CORE_FIELD_TYPES.has(field.fieldType);
  if (core && field.confidence >= 0.5) return "high";
  if (core || field.confidence >= 0.5) return "medium";
  return "low";
}

const CORE_FIELD_TYPES = new Set([
  "job_to_be_done",
  "constraint",
  "success_metric",
  "decision_criterion",
]);

function syntheticField(
  kind: string,
  context: PromptMockContext,
  competitors: string[],
): PromptMockField {
  const cited = context.evidence.filter(
    (record) =>
      record.category === "comparison" &&
      competitors.some((name) => record.entities.some((entity) => equalsLoose(entity, name))),
  );
  return {
    id: `synthetic:${kind}`,
    fieldType: kind,
    statement: competitors.join(" vs "),
    evidenceIds: cited.map((record) => record.id),
    insufficientEvidence: cited.length === 0,
    confidence: cited.length >= 2 ? 0.6 : 0.4,
  };
}

// ── Text helpers ────────────────────────────────────────────────────────────

/**
 * Pulls the product category out of the brand description.
 *
 * The category noun is what makes a prompt answerable ("which product-analytics
 * platforms…" rather than "which tools…"), and it is the one brand-derived value
 * a prompt legitimately needs — it describes the market, not the vendor. The
 * fallback is deliberately vague rather than wrong.
 */
export function deriveCategoryTerm(description: string): string {
  const match =
    /\bis (?:an?|the)\s+([a-z0-9][a-z0-9-]*(?:\s+[a-z0-9][a-z0-9-]*){0,3}?\s*(?:platform|tool|software|service|solution|system|suite|application|provider))\b/i.exec(
      description,
    );
  const term = match?.[1]?.trim().toLowerCase();
  if (!term) return "tools in this category";
  return pluralize(term);
}

function pluralize(term: string): string {
  if (/(?:s|x|z|ch|sh)$/.test(term)) return `${term}es`;
  if (/[^aeiou]y$/.test(term)) return `${term.slice(0, -1)}ies`;
  return `${term}s`;
}

function singular(term: string): string {
  if (term.endsWith("ies")) return `${term.slice(0, -3)}y`;
  if (term.endsWith("es") && /(?:s|x|z|ch|sh)es$/.test(term)) return term.slice(0, -2);
  if (term.endsWith("s")) return term.slice(0, -1);
  return term;
}

/**
 * Openers that make a statement unusable as a subordinate clause.
 *
 * An imperative ("show me the SOC 2 report") cannot follow "when", and a
 * conditional refusal ("if it can't run in our own VPC we don't even take the
 * demo") states the *inverse* of the requirement — dropping the "if" would
 * produce a prompt asking for the opposite of what the buyer needs. Rules
 * cannot reliably flip that polarity, so these statements are refused as clause
 * sources rather than mangled. The evidence behind them still reaches prompts
 * through the other rules that cite it.
 */
const UNUSABLE_AS_CLAUSE = [
  /^(?:show|send|give|tell|prove|explain|list|describe)\s+(?:me|us)\b/i,
  /^if\b/i,
  /^(?:honestly|realistically|basically)\b.*\bif\b/i,
];

/**
 * Turns a persona statement into a subordinate clause that reads naturally
 * after "when", "if" or "that".
 *
 * Only mechanical transformations: trailing punctuation, leading connectives,
 * sentence case, and a cut at the first clause boundary. Nothing is paraphrased,
 * because a paraphrase would quietly change what the cited evidence supports.
 * Returns an empty string when the statement cannot become a clause, and every
 * caller treats that as "generate nothing here".
 */
export function toClause(statement: string): string {
  const normalized = statement.replace(/\s+/g, " ").trim();
  if (UNUSABLE_AS_CLAUSE.some((pattern) => pattern.test(normalized))) return "";

  let clause = normalized
    .replace(/[.!?;:]+$/, "")
    .replace(/^(?:that|which|because|so that|and|but|honestly|basically)\s+/i, "");

  if (clause.length === 0) return "";

  // Lowercase a leading capital unless the word is an acronym or looks like a
  // proper noun (two capitals, or a capital after the first character).
  const [first = "", ...rest] = clause.split(" ");
  if (!/[A-Z]{2,}/.test(first) && !/^[A-Z][a-z]+[A-Z]/.test(first)) {
    clause = [first.charAt(0).toLowerCase() + first.slice(1), ...rest].join(" ");
  }

  return cutAtClauseBoundary(clause, MAX_CLAUSE_CHARS);
}

/**
 * Cuts a long statement at its first clause boundary rather than mid-phrase.
 *
 * "…deployed inside our environment, security has signed off, and product
 * managers are actually using it" truncated by character count ends with
 * "product managers are", which reads as a typo. Cutting at the comma keeps a
 * complete thought, and a complete thought is the only kind that makes a
 * sensible prompt.
 */
function cutAtClauseBoundary(clause: string, max: number): string {
  if (clause.length <= max) return clause;

  // The *first* boundary past a sensible minimum, not the last one that fits.
  // Keeping every clause that fits under the cap produces comma-spliced prompts
  // ("…inside our environment, security has signed off") that read as a
  // sentence someone forgot to finish. One complete thought is the goal.
  const boundary = /,\s|\s+and\s+|\s+but\s+|\s+so\s+|\s+then\s+|\s+because\s+/g;
  let match: RegExpExecArray | null;
  while ((match = boundary.exec(clause)) !== null) {
    if (match.index > max) break;
    if (match.index >= max * 0.35) return clause.slice(0, match.index).trimEnd();
  }

  return truncateAtWord(clause, max);
}

/** Strips a leading subject and goal frame so the clause follows "trying to …". */
function verbClause(clause: string): string {
  return clause
    .replace(/^(?:the|our|my)\s+goal\s+is\s+to\s+/i, "")
    .replace(/^what\s+we\s+want\s+is\s+for\s+/i, "")
    .replace(
      /^(?:we|they|our team|the team|teams|i|customers?|buyers?)\s+(?:are\s+|is\s+)?(?:need\s+to|needs\s+to|want\s+to|wants\s+to|have\s+to|has\s+to|are\s+trying\s+to|is\s+trying\s+to|must)\s+/i,
      "",
    )
    .replace(/^(?:we|they|our team|the team|teams|i)\s+/i, "")
    .replace(/^to\s+/i, "");
}

/** The noun phrase a criterion is about, for "compare on X". */
function criterionNoun(clause: string): string {
  return cutAtClauseBoundary(
    clause
      .replace(
        /^(?:the\s+)?(?:deciding factor is|what matters most is|we evaluate on|it comes down to|criteria(?:\s+is|\s+are)?|non-negotiable(?:\s+is)?)\s*/i,
        "",
      )
      .replace(/^(?:that|is)\s+/i, ""),
    90,
  );
}

/**
 * The clause a success metric describes, with its "success means" frame removed.
 *
 * The interposed group is restricted to a short prepositional phrase ("success
 * *for us* looks like"). An open `\w+{0,3}` swallowed "means the platform" out
 * of "success means the platform is deployed…", leaving a fragment that began
 * mid-sentence.
 */
function metricClause(clause: string): string {
  const stripped = clause
    .replace(
      /^(?:success(?:\s+(?:for|to)\s+(?:us|me|them|the\s+\w+))?\s+(?:means|looks like|is|would be)|we'?ll know it worked when|we measure(?:d)?\s+(?:by|on))\s*(?:that\s+)?/i,
      "",
    )
    .replace(/^(?:we|they|our team|the team|teams|i)\s+/i, "");

  // Success metrics are usually stated as a list ("deployed, signed off, and
  // actually used"). Always keep the first item rather than only trimming when
  // over length: a comma-spliced prompt reads as an unfinished sentence, and
  // the remaining items are still visible on the persona field the prompt cites.
  return firstClause(stripped, 90);
}

/** Keeps the first complete clause, however short the whole statement is. */
function firstClause(text: string, max: number): string {
  const boundary = /,\s|\s+and\s+|\s+but\s+/.exec(text);
  if (boundary && boundary.index >= 20) return text.slice(0, boundary.index).trimEnd();
  return cutAtClauseBoundary(text, max);
}

/**
 * A statement kept whole, for colon framing.
 *
 * Some evidence resists every grammatical transformation — a conditional
 * refusal, a past-experience narrative, an imperative. Rather than drop it or
 * mangle it, the prompt names it as a situation and asks about it. The
 * statement's meaning is preserved exactly, which is the property that matters:
 * the prompt still traces to what the customer actually said.
 */
function situationClause(statement: string): string {
  const clean = statement
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?;:]+$/, "")
    .replace(/^(?:honestly|basically|realistically)[,\s]+/i, "");
  return cutAtClauseBoundary(clean.charAt(0).toLowerCase() + clean.slice(1), MAX_CLAUSE_CHARS);
}

/**
 * The object of an imperative request, for "ask for X".
 *
 * "Send me the SOC 2 Type II report and the architecture diagram" is a proof
 * requirement stated as a command; the object is the part worth tracking.
 */
function imperativeObject(statement: string): string {
  const match = /^(?:show|send|give|tell|prove|explain|list|describe)\s+(?:me|us)\s+(.+)$/i.exec(
    statement.replace(/\s+/g, " ").trim(),
  );
  if (!match?.[1]) return "";

  // "…the release notes and prove the self-hosted version shipped" is two
  // commands sharing one opener. Only the first has an object that reads as a
  // thing you can ask a vendor for; keep that and drop the second verb phrase.
  const object = match[1]
    .replace(/[.!?;:]+$/, "")
    .split(/\s+and\s+(?=(?:prove|show|send|give|confirm|verify|explain|demonstrate)\b)/i)[0];

  return cutAtClauseBoundary(object ?? "", MAX_CLAUSE_CHARS);
}

/** Normalises a recorded question back into a question, keeping its wording. */
function asQuestion(statement: string): string | null {
  const text = statement.replace(/\s+/g, " ").trim();
  if (text.length < 8) return null;
  const withoutTrailing = text.replace(/[.!?]+$/, "");
  const capitalised = withoutTrailing.charAt(0).toUpperCase() + withoutTrailing.slice(1);
  return truncateAtWord(capitalised, MAX_PROMPT_CHARS - 1) + "?";
}

const TROUBLE_PATTERN =
  /\b(?:not working|does ?n'?t work|fails?|failing|broken|error|stuck|slow|times? out|timeout|why (?:is|does|are|do)|keeps? )\b/i;

function looksLikeTrouble(statement: string): boolean {
  return TROUBLE_PATTERN.test(statement);
}

const COMMERCIAL_PATTERN =
  /\b(?:pricing|price|cost|budget|quote|contract|procurement|licen[cs]e|per[- ]seat|renewal|discount)\b/i;

function vocabularyFor(context: PromptMockContext, field: PromptMockField): string[] {
  const ids = new Set(field.evidenceIds);
  const terms = new Set<string>();
  for (const record of context.evidence) {
    if (!ids.has(record.id)) continue;
    for (const term of record.vocabulary) {
      const clean = term.trim();
      if (clean.length >= 3) terms.add(clean);
    }
  }
  return [...terms].sort().slice(0, 6);
}

/**
 * Competitors this segment's comparison evidence actually names.
 *
 * The gate for putting a vendor name in a prompt. A competitor listed in brand
 * setup but never mentioned by a customer is the brand's view of the market, not
 * the segment's.
 */
function namedCompetitors(context: PromptMockContext): string[] {
  const named = context.competitorNames.filter((name) =>
    context.evidence.some(
      (record) =>
        (record.category === "comparison" || record.category === "decision_criterion") &&
        (record.entities.some((entity) => equalsLoose(entity, name)) ||
          new RegExp(`\\b${escapeRegExp(name)}\\b`, "i").test(record.claim)),
    ),
  );
  return [...new Set(named)].sort().slice(0, 2);
}

function isBrandName(context: PromptMockContext, text: string): boolean {
  return equalsLoose(text, context.brandName);
}

function equalsLoose(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function topicFor(field: PromptMockField, intent: Intent): string {
  const words = field.statement
    .replace(/[^A-Za-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !TOPIC_STOPWORDS.has(word.toLowerCase()))
    .slice(0, 4);

  const label = words.length > 0 ? words.join(" ") : intent.replace(/_/g, " ");
  return truncate(label.charAt(0).toUpperCase() + label.slice(1), 160);
}

const TOPIC_STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "our",
  "with",
  "that",
  "this",
  "have",
  "has",
  "not",
  "can",
  "cannot",
  "will",
  "would",
  "are",
  "was",
  "were",
  "been",
  "its",
  "any",
  "all",
  "must",
  "need",
  "needs",
  "want",
  "wants",
  "from",
  "into",
]);

function tidy(text: string): string {
  const collapsed = text
    .replace(/\s+/g, " ")
    .replace(/\s+([?.,])/g, "$1")
    .trim();
  if (collapsed.length <= MAX_PROMPT_CHARS) return collapsed;
  const trailing = collapsed.endsWith("?") ? "?" : "";
  return (
    truncateAtWord(collapsed.replace(/\?$/, ""), MAX_PROMPT_CHARS - trailing.length) + trailing
  );
}

function truncate(value: string, max: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`;
}

function truncateAtWord(value: string, max: number): string {
  if (value.length <= max) return value;
  const cut = value.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd();
}

function normalizeForCompare(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/** Exported for the guardrail test: the generator must never reach this count. */
export const PROMPT_COUNT_BOUNDS = { min: MIN_PROMPTS, max: MAX_PROMPTS } as const;
