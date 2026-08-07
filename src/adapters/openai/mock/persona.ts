import type { PersonaFieldOutput, PersonaSynthesis } from "@/prompts/schemas";

/**
 * Deterministic rule-based persona synthesis used in mock mode.
 *
 * The persona is assembled from the evidence attached to a segment: each field
 * is derived from records that actually exist, and every field carries the ids
 * it was built from. Where no evidence supports a required field, the generator
 * emits the field with `insufficient_evidence: true` rather than writing
 * something plausible — that visible gap is the point (§14).
 *
 * Three kinds of field never carry evidence and always carry the insufficient
 * marker, because they are statements about the persona's scope rather than
 * claims about the person: coverage gaps, excluded assumptions and regeneration
 * triggers. The UI labels them as such.
 *
 * Same input, same output. No clock, no randomness.
 */

export type PersonaMockEvidence = {
  id: string;
  claim: string;
  quote: string;
  category: string;
  provenance: string;
  sourceId: string;
  sourceType: string;
  sourceLabel: string;
  journeyStage: string;
  vocabulary: string[];
  entities: string[];
  hedged: boolean;
};

export type PersonaMockContext = {
  brandName: string;
  segmentLabel: string;
  segmentDefinition: string;
  segmentDistinguishingVariables: string[];
  segmentCoverageGaps: string[];
  supporting: PersonaMockEvidence[];
  contradicting: PersonaMockEvidence[];
  /** Names of personas that already exist, so the summary can differentiate. */
  otherPersonaNames: string[];
};

/**
 * Protected and sensitive attributes the product refuses to infer (§14). Stored
 * on every persona so a reviewer can see what the persona deliberately does not
 * claim, rather than having to trust that it was never guessed.
 */
export const EXCLUDED_ASSUMPTIONS = [
  "Age, generation or life stage — never inferred from evidence about work.",
  "Gender or pronouns — no record in the evidence supports an attribution.",
  "Income, household finances or personal wealth.",
  "Hobbies, interests and media consumption outside the work context.",
  "Family status, dependants or living arrangements.",
  "Personality type, communication style archetype or psychometric profile.",
  "Political beliefs, religion, ethnicity, health status or any other protected characteristic.",
  "A named real individual: this persona is a synthetic hypothesis, not a digital twin.",
];

type FieldRule = {
  fieldType: PersonaFieldOutput["field_type"];
  /** Evidence categories that qualify outright. */
  categories: string[];
  /** Additional claim-text patterns that qualify. */
  patterns?: RegExp[];
  max: number;
  /** Core fields must appear at least once, with the insufficient marker if empty. */
  required?: boolean;
  /** How the statement reads when derived from a record. */
  phrase: (claim: string) => string;
  rationale: string;
  emptyStatement?: string;
};

const FIELD_RULES: FieldRule[] = [
  {
    fieldType: "job_to_be_done",
    categories: ["job_to_be_done", "desired_outcome"],
    patterns: [
      /\b(?:we(?:'| a)?re trying to|our goal is|we need to|what we want is|we'?re looking to|ideally)\b/i,
    ],
    max: 4,
    required: true,
    phrase: (claim) => claim,
    rationale: "Derived from evidence stating what the buyer is trying to accomplish.",
    emptyStatement:
      "No approved evidence states this segment's job to be done. Interview or discovery evidence is needed before any prompt set is built on it.",
  },
  {
    fieldType: "constraint",
    categories: ["constraint"],
    patterns: [/\b(?:cannot|can'?t|must not|has to (?:stay|remain|run)|only if|deadline)\b/i],
    max: 6,
    required: true,
    phrase: (claim) => claim,
    rationale: "Derived from evidence describing a limit the buyer cannot negotiate away.",
    emptyStatement:
      "No approved evidence records a constraint for this segment. Treat the segment as unconstrained only if that has been verified.",
  },
  {
    fieldType: "success_metric",
    categories: ["success_metric"],
    patterns: [
      /\bsuccess (?:means|looks like|is)\b/i,
      /\bwe'?ll know it worked\b/i,
      /\b(?:measure(?:d)? (?:by|on)|target of|kpi)\b/i,
    ],
    max: 4,
    required: true,
    phrase: (claim) => claim,
    rationale: "Derived from evidence stating how the buyer will judge the outcome.",
    emptyStatement:
      "No approved evidence states how this segment measures success. Any success metric would be invention, so none is claimed.",
  },
  {
    fieldType: "decision_criterion",
    categories: ["decision_criterion"],
    patterns: [
      /\b(?:deciding factor|non-?negotiable|comes down to|what matters most|we evaluate on|criteria|top of (?:my|our) list)\b/i,
    ],
    max: 5,
    required: true,
    phrase: (claim) => claim,
    rationale: "Derived from evidence describing how the buyer chooses between options.",
    emptyStatement: "No approved evidence records an explicit decision criterion for this segment.",
  },
  {
    fieldType: "recurring_question",
    categories: ["question"],
    max: 8,
    phrase: (claim) => claim,
    rationale: "A question this segment actually asked, preserved in its original form.",
  },
  {
    fieldType: "objection",
    categories: ["objection"],
    max: 6,
    phrase: (claim) => claim,
    rationale: "An objection raised in the evidence rather than an anticipated one.",
  },
  {
    fieldType: "proof_preference",
    categories: ["proof_requirement"],
    max: 6,
    phrase: (claim) => claim,
    rationale: "Evidence of the proof this segment asks for before it will proceed.",
  },
];

/** Vocabulary is assembled across records rather than taken from one. */
const MAX_VOCABULARY = 12;
const MAX_DISTINGUISHING_TOPICS = 8;

/**
 * Sources that measure aggregate demand rather than an individual's belief.
 *
 * §14: search volume is evidence that a question is being asked, not evidence
 * about who is asking it. These records may support a claim drawn from
 * first-party evidence, and they legitimately tell you which words people use,
 * but a search query must never become the persona's own statement of a
 * constraint, a job to be done or a proof requirement.
 */
const AGGREGATE_DEMAND_SOURCE_TYPES = new Set(["search_console", "onsite_search"]);

function isAggregateDemand(record: PersonaMockEvidence): boolean {
  return AGGREGATE_DEMAND_SOURCE_TYPES.has(record.sourceType);
}

export function generatePersona(context: PersonaMockContext): PersonaSynthesis {
  const fields: PersonaFieldOutput[] = [];

  for (const rule of FIELD_RULES) {
    const matched = context.supporting.filter((record) => matchesRule(rule, record));
    const deduped = dedupeByClaim(matched).slice(0, rule.max);

    if (deduped.length === 0) {
      if (rule.required) {
        fields.push({
          field_type: rule.fieldType,
          statement: rule.emptyStatement ?? "No approved evidence supports this field.",
          provenance: "inferred",
          supporting_evidence_ids: [],
          contradicting_evidence_ids: [],
          insufficient_evidence: true,
          confidence_explanation:
            "No approved, available evidence matched this field, so it is recorded as a gap rather than filled in.",
        });
      }
      continue;
    }

    for (const record of deduped) {
      const contradicting = contradictionsFor(context, record);
      fields.push({
        field_type: rule.fieldType,
        statement: rule.phrase(record.claim),
        provenance: provenanceFor(record),
        supporting_evidence_ids: supportingIdsFor(context, record),
        contradicting_evidence_ids: contradicting,
        insufficient_evidence: false,
        confidence_explanation: rule.rationale,
      });
    }
  }

  fields.push(...vocabularyFields(context));
  fields.push(...distinguishingTopicFields(context));
  fields.push(informationDepthField(context));
  fields.push(...validationBenchmarkFields(context));
  fields.push(...structuralFields(context));

  const stages = journeyStages(context.supporting);

  return {
    name: context.segmentLabel,
    segment_definition: context.segmentDefinition,
    summary: summarise(context, fields),
    journey_stages: stages,
    information_depth: informationDepthLabel(context),
    excluded_assumptions: EXCLUDED_ASSUMPTIONS,
    fields,
  };
}

// ── Field builders ──────────────────────────────────────────────────────────

function matchesRule(rule: FieldRule, record: PersonaMockEvidence): boolean {
  // Aggregate demand can support a claim but can never be the claim.
  if (isAggregateDemand(record)) return false;
  if (rule.categories.includes(record.category)) return true;
  if (!rule.patterns) return false;
  const haystack = `${record.claim} ${record.quote}`;
  return rule.patterns.some((pattern) => pattern.test(haystack));
}

/**
 * Vocabulary fields preserve the customer's own words. Terms are ranked by how
 * many distinct records use them, so a term used once does not outrank one used
 * across the corpus.
 */
function vocabularyFields(context: PersonaMockContext): PersonaFieldOutput[] {
  const byTerm = new Map<string, PersonaMockEvidence[]>();
  for (const record of context.supporting) {
    for (const term of record.vocabulary) {
      const key = term.trim().toLowerCase();
      if (!key) continue;
      const list = byTerm.get(key) ?? [];
      list.push(record);
      byTerm.set(key, list);
    }
  }

  const ranked = [...byTerm.entries()]
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .slice(0, MAX_VOCABULARY);

  if (ranked.length === 0) {
    return [
      {
        field_type: "vocabulary",
        statement:
          "No customer vocabulary was captured for this segment. Prompts must not invent terminology, so none is claimed.",
        provenance: "inferred",
        supporting_evidence_ids: [],
        contradicting_evidence_ids: [],
        insufficient_evidence: true,
        confidence_explanation:
          "No approved evidence contributed vocabulary terms, so this core field is recorded as a gap.",
      },
    ];
  }

  return ranked.map(([term, records]) => ({
    field_type: "vocabulary" as const,
    statement: term,
    provenance: "observed" as const,
    supporting_evidence_ids: records.map((record) => record.id),
    contradicting_evidence_ids: [],
    insufficient_evidence: false,
    confidence_explanation: `Used verbatim in ${records.length} approved record${records.length === 1 ? "" : "s"}.`,
  }));
}

/**
 * Distinguishing topics come from the entities this segment's evidence names —
 * the concrete systems, standards and competitors it talks about.
 */
function distinguishingTopicFields(context: PersonaMockContext): PersonaFieldOutput[] {
  const byEntity = new Map<string, PersonaMockEvidence[]>();
  for (const record of context.supporting) {
    for (const entity of record.entities) {
      const key = entity.trim();
      if (key.length < 3) continue;
      const list = byEntity.get(key) ?? [];
      list.push(record);
      byEntity.set(key, list);
    }
  }

  return [...byEntity.entries()]
    .filter(([, records]) => records.length >= 2)
    .sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]))
    .slice(0, MAX_DISTINGUISHING_TOPICS)
    .map(([entity, records]) => ({
      field_type: "distinguishing_topic" as const,
      statement: entity,
      provenance: "observed" as const,
      supporting_evidence_ids: records.map((record) => record.id),
      contradicting_evidence_ids: [],
      insufficient_evidence: false,
      confidence_explanation: `Named in ${records.length} approved records for this segment.`,
    }));
}

const DEPTH_SIGNALS = [
  /\b(?:soc\s?2|iso\s?27001|architecture diagram|pen(?:etration)? test|release notes|attestation)\b/i,
  /\b(?:vpc|single-?tenant|column-?level|row-?level|schema|warehouse)\b/i,
];

function informationDepthLabel(context: PersonaMockContext): string {
  const technical = depthEvidence(context).length;
  const firstParty = context.supporting.filter((record) => !isAggregateDemand(record));
  const share = firstParty.length === 0 ? 0 : technical / firstParty.length;

  if (share >= 0.4) {
    return "Deep: expects primary documents and architecture-level specifics, and treats summary marketing claims as unverified.";
  }
  if (share >= 0.15) {
    return "Mixed: wants a plain answer first, then the ability to drill into specifics before committing.";
  }
  return "Practical: wants the working answer and the effort involved, not the underlying architecture.";
}

function depthEvidence(context: PersonaMockContext): PersonaMockEvidence[] {
  return context.supporting.filter(
    (record) =>
      !isAggregateDemand(record) &&
      DEPTH_SIGNALS.some((pattern) => pattern.test(`${record.claim} ${record.quote}`)),
  );
}

function informationDepthField(context: PersonaMockContext): PersonaFieldOutput {
  const technical = depthEvidence(context);

  if (technical.length === 0) {
    return {
      field_type: "information_depth",
      statement: informationDepthLabel(context),
      provenance: "inferred",
      supporting_evidence_ids: [],
      contradicting_evidence_ids: [],
      insufficient_evidence: true,
      confidence_explanation:
        "No evidence indicates the depth of detail this segment requires, so the default reading is recorded as unsupported.",
    };
  }

  return {
    field_type: "information_depth",
    statement: informationDepthLabel(context),
    provenance: "observed",
    supporting_evidence_ids: technical.slice(0, 10).map((record) => record.id),
    contradicting_evidence_ids: [],
    insufficient_evidence: false,
    confidence_explanation: `${technical.length} of ${context.supporting.filter((record) => !isAggregateDemand(record)).length} first-party records ask for specific technical or documentary detail.`,
  };
}

/**
 * Validation benchmarks state how the hypothesis gets tested. Each one cites
 * the evidence it proposes to test, so an unfalsifiable benchmark cannot be
 * written.
 */
function validationBenchmarkFields(context: PersonaMockContext): PersonaFieldOutput[] {
  const out: PersonaFieldOutput[] = [];

  const constraints = context.supporting.filter((record) => record.category === "constraint");
  if (constraints.length > 0) {
    out.push({
      field_type: "validation_benchmark",
      statement: `Persona prompts built on this segment's constraints should outperform their generic controls on brand presence; if they do not, the constraint hypothesis is wrong rather than the content.`,
      provenance: "inferred",
      supporting_evidence_ids: constraints.slice(0, 8).map((record) => record.id),
      contradicting_evidence_ids: [],
      insufficient_evidence: false,
      confidence_explanation: `Testable against the ${constraints.length} constraint record${constraints.length === 1 ? "" : "s"} cited here.`,
    });
  }

  const questions = context.supporting.filter((record) => record.category === "question");
  if (questions.length > 0) {
    out.push({
      field_type: "validation_benchmark",
      statement:
        "At least half of the recurring questions recorded here should appear as tracked prompts, and the answers should contain the expected elements; a question with no measurable answer is not a validated information need.",
      provenance: "inferred",
      supporting_evidence_ids: questions.slice(0, 8).map((record) => record.id),
      contradicting_evidence_ids: [],
      insufficient_evidence: false,
      confidence_explanation: `Testable against the ${questions.length} recorded question${questions.length === 1 ? "" : "s"}.`,
    });
  }

  const sources = new Set(context.supporting.map((record) => record.sourceId)).size;
  out.push({
    field_type: "validation_benchmark",
    statement: `Confirm this segment against at least ${Math.max(2, 4 - sources)} additional independent source${Math.max(2, 4 - sources) === 1 ? "" : "s"} before it drives content investment; it currently rests on ${sources} source${sources === 1 ? "" : "s"}.`,
    provenance: "inferred",
    supporting_evidence_ids: context.supporting.slice(0, 8).map((record) => record.id),
    contradicting_evidence_ids: [],
    insufficient_evidence: false,
    confidence_explanation: `Derived from the ${sources} distinct source${sources === 1 ? "" : "s"} currently cited.`,
  });

  return out;
}

/**
 * Coverage gaps, excluded assumptions and regeneration triggers. These describe
 * the persona's scope and process, not the person, so they always carry the
 * insufficient-evidence marker.
 */
function structuralFields(context: PersonaMockContext): PersonaFieldOutput[] {
  const out: PersonaFieldOutput[] = [];

  for (const gap of context.segmentCoverageGaps.slice(0, 8)) {
    out.push({
      field_type: "coverage_gap",
      statement: gap,
      provenance: "inferred",
      supporting_evidence_ids: [],
      contradicting_evidence_ids: [],
      insufficient_evidence: true,
      confidence_explanation:
        "A gap is the absence of evidence, so it carries no supporting records by definition.",
    });
  }

  const aggregate = context.supporting.filter(isAggregateDemand);
  if (aggregate.length > 0) {
    out.push({
      field_type: "coverage_gap",
      statement: `${aggregate.length} record${aggregate.length === 1 ? "" : "s"} in this segment come from aggregate search or on-site search data. They show which questions are being asked, so they support claims and vocabulary, but none of them was used as the persona's own statement of a job, constraint or proof requirement.`,
      provenance: "inferred",
      supporting_evidence_ids: [],
      contradicting_evidence_ids: [],
      insufficient_evidence: true,
      confidence_explanation:
        "A note about how aggregate demand was and was not used, rather than a claim about the buyer.",
    });
  }

  if (context.contradicting.length > 0) {
    out.push({
      field_type: "coverage_gap",
      statement: `${context.contradicting.length} record${context.contradicting.length === 1 ? "" : "s"} in scope for this segment hedge or contradict its premise and are attached as contradicting evidence rather than averaged away.`,
      provenance: "inferred",
      supporting_evidence_ids: [],
      contradicting_evidence_ids: context.contradicting.slice(0, 20).map((record) => record.id),
      insufficient_evidence: true,
      confidence_explanation:
        "Recorded so the contradiction stays visible; it is a note about coverage, not a claim about the buyer.",
    });
  }

  for (const assumption of EXCLUDED_ASSUMPTIONS) {
    out.push({
      field_type: "excluded_assumption",
      statement: assumption,
      provenance: "inferred",
      supporting_evidence_ids: [],
      contradicting_evidence_ids: [],
      insufficient_evidence: true,
      confidence_explanation:
        "A deliberate exclusion, not a gap to be filled: this attribute is never inferred.",
    });
  }

  const triggers = [
    "New first-party evidence changes the constraint mix for this segment.",
    "A contradicting record is approved for a core field, or a supporting source is deleted.",
    "Persona prompts stop outperforming their generic controls in Profound results.",
    "The evidence cutoff is more than two quarters old.",
  ];
  for (const trigger of triggers) {
    out.push({
      field_type: "regeneration_trigger",
      statement: trigger,
      provenance: "inferred",
      supporting_evidence_ids: [],
      contradicting_evidence_ids: [],
      insufficient_evidence: true,
      confidence_explanation:
        "A process rule for when to regenerate, not an evidence-backed claim about the buyer.",
    });
  }

  return out;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function provenanceFor(record: PersonaMockEvidence): PersonaFieldOutput["provenance"] {
  if (record.provenance === "brand_assertion") return "brand_assertion";
  if (record.provenance === "externally_supported") return "externally_supported";
  if (record.provenance === "observed") return "observed";
  return "inferred";
}

/**
 * A field cites the record it was derived from plus any other record making the
 * same point, which is what lets cross-source agreement rise above zero.
 */
function supportingIdsFor(context: PersonaMockContext, record: PersonaMockEvidence): string[] {
  const tokens = significantTokens(record.claim);
  const ids = new Set<string>([record.id]);

  if (tokens.length >= 2) {
    for (const other of context.supporting) {
      if (other.id === record.id) continue;
      if (other.category !== record.category) continue;
      const overlap = significantTokens(other.claim).filter((token) => tokens.includes(token));
      if (overlap.length >= 2) ids.add(other.id);
    }
  }

  return [...ids].slice(0, 20);
}

function contradictionsFor(context: PersonaMockContext, record: PersonaMockEvidence): string[] {
  const tokens = significantTokens(record.claim);
  if (tokens.length < 2) return [];
  return context.contradicting
    .filter((other) => {
      const overlap = significantTokens(other.claim).filter((token) => tokens.includes(token));
      return overlap.length >= 2;
    })
    .slice(0, 10)
    .map((other) => other.id);
}

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "our",
  "we",
  "us",
  "you",
  "your",
  "that",
  "this",
  "with",
  "from",
  "have",
  "has",
  "had",
  "not",
  "but",
  "can",
  "cannot",
  "will",
  "would",
  "into",
  "than",
  "then",
  "they",
  "them",
  "their",
  "what",
  "when",
  "which",
  "who",
  "how",
  "are",
  "was",
  "were",
  "been",
  "its",
  "it",
  "a",
  "an",
  "of",
  "to",
  "in",
  "is",
  "be",
  "on",
  "at",
  "or",
  "if",
  "as",
  "so",
  "do",
  "does",
  "did",
  "get",
  "got",
  "any",
  "all",
  "one",
  "two",
  "about",
  "more",
  "most",
  "some",
  "still",
  "just",
  "even",
  "very",
  "much",
  "every",
]);

function significantTokens(text: string): string[] {
  return [
    ...new Set(
      text
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, " ")
        .split(/\s+/)
        .filter((token) => token.length >= 4 && !STOPWORDS.has(token)),
    ),
  ];
}

function dedupeByClaim(records: PersonaMockEvidence[]): PersonaMockEvidence[] {
  const seen = new Set<string>();
  const out: PersonaMockEvidence[] = [];
  for (const record of records) {
    const key = record.claim.trim().toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(record);
  }
  return out;
}

const STAGE_ORDER = [
  "unaware",
  "problem_discovery",
  "education",
  "solution_exploration",
  "consideration",
  "evaluation",
  "purchase",
  "implementation",
  "optimization",
  "troubleshooting",
  "retention",
] as const;

function journeyStages(supporting: PersonaMockEvidence[]): PersonaSynthesis["journey_stages"] {
  const counts = new Map<string, number>();
  for (const record of supporting) {
    if (record.journeyStage === "unknown") continue;
    counts.set(record.journeyStage, (counts.get(record.journeyStage) ?? 0) + 1);
  }

  const present = STAGE_ORDER.filter((stage) => (counts.get(stage) ?? 0) > 0).slice(0, 6);
  return present.length > 0
    ? (present as PersonaSynthesis["journey_stages"])
    : (["unknown"] as PersonaSynthesis["journey_stages"]);
}

function summarise(context: PersonaMockContext, fields: PersonaFieldOutput[]): string {
  const job = fields.find(
    (field) => field.field_type === "job_to_be_done" && !field.insufficient_evidence,
  );
  const constraint = fields.find(
    (field) => field.field_type === "constraint" && !field.insufficient_evidence,
  );
  const criterion = fields.find(
    (field) => field.field_type === "decision_criterion" && !field.insufficient_evidence,
  );

  const parts: string[] = [
    `A synthetic hypothesis about ${context.brandName}'s "${context.segmentLabel}" segment, assembled from approved evidence rather than imagined.`,
  ];

  if (job) parts.push(`The job to be done: ${trimSentence(job.statement)}.`);
  if (constraint) parts.push(`The binding constraint: ${trimSentence(constraint.statement)}.`);
  if (criterion) parts.push(`Decisions turn on: ${trimSentence(criterion.statement)}.`);

  const unsupported = fields.filter(
    (field) => field.insufficient_evidence && CORE_FIELD_TYPES.has(field.field_type),
  ).length;
  if (unsupported > 0) {
    parts.push(
      unsupported === 1
        ? "1 core field has no supporting evidence and is marked insufficient rather than filled in."
        : `${unsupported} core fields have no supporting evidence and are marked insufficient rather than filled in.`,
    );
  }

  if (context.otherPersonaNames.length > 0) {
    parts.push(
      `Distinct from ${context.otherPersonaNames.slice(0, 3).join(", ")} in its distinguishing variables: ${context.segmentDistinguishingVariables.slice(0, 2).join("; ")}.`,
    );
  }

  return parts.join(" ").slice(0, 1500);
}

export const CORE_FIELD_TYPES = new Set<PersonaFieldOutput["field_type"]>([
  "job_to_be_done",
  "constraint",
  "success_metric",
  "decision_criterion",
  "vocabulary",
]);

function trimSentence(text: string): string {
  const clean = text
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?]+$/, "");
  return clean.length > 180 ? `${clean.slice(0, 177).trimEnd()}…` : clean;
}
