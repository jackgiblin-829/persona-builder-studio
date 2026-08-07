import type { EvidenceExtraction, EvidenceItem } from "@/prompts/schemas";

/**
 * Deterministic rule-based evidence extractor used in mock mode.
 *
 * This is a genuine extractor, not a fixture lookup: it reads the supplied
 * passage, splits it into atomic claims, classifies each one and returns real
 * character offsets. That matters because the seeded demo must produce evidence
 * that actually traces back to the seeded sources — a fixture of pre-written
 * records would make traceability look real while proving nothing.
 *
 * Same input, same output. No clock, no randomness.
 */

export type EvidenceMockContext = {
  passage: string;
  speaker?: string | null;
  sourceType: string;
  brandName: string;
  competitorNames: string[];
  observedAt?: string | null;
};

type CategoryRule = {
  category: EvidenceItem["category"];
  patterns: RegExp[];
  journeyStage?: EvidenceItem["journey_stage"];
  sentiment?: EvidenceItem["sentiment"];
  /** Higher wins when several rules match the same sentence. */
  weight: number;
};

const RULES: CategoryRule[] = [
  {
    category: "constraint",
    weight: 9,
    journeyStage: "evaluation",
    sentiment: "concern",
    patterns: [
      /\b(?:can(?:'|no)?t|cannot|not allowed|won'?t be able to|prohibited|forbidden|must not)\b/i,
      /\b(?:has to|have to|must|need(?:s)? to) (?:stay|remain|live|run|be deployed|be hosted)\b/i,
      /\b(?:only|no) (?:if|budget|headroom|capacity|staff|engineers)\b/i,
      /\b(?:within|inside) (?:our|the) (?:own |approved )?(?:cloud|vpc|tenant|network|environment)\b/i,
      /\b(?:air-?gapped|on-?prem|self-?hosted|private cloud|data residency|residency)\b/i,
      /\b(?:deadline|by the end of|weeks? to|months? to|before renewal)\b/i,
      // Conditional refusal — "if I have to leave the planning tool, I won't do
      // it" is a constraint on workflow, stated the way people actually state
      // one, and it decides product fit just as firmly as a residency rule.
      /\bif (?:I|we) (?:have to|need to|must)\b.*\b(?:won'?t|can'?t|cannot|wouldn'?t)\b/i,
    ],
  },
  {
    category: "objection",
    weight: 8,
    journeyStage: "evaluation",
    sentiment: "negative",
    patterns: [
      /\b(?:the problem (?:is|with)|my concern|we'?re worried|worried about|hesitant|blocker|deal-?breaker)\b/i,
      /\b(?:too (?:expensive|slow|complex|risky|small|big|basic|limited|manual)|not convinced|doesn'?t justify|hard to justify)\b/i,
      /\b(?:last time we|we got burned|we tried .* and it)\b/i,
    ],
  },
  {
    category: "question",
    weight: 8,
    journeyStage: "education",
    patterns: [
      /\?\s*$/,
      /\b(?:can you (?:explain|tell me)|what happens if|how (?:do|does|would) (?:you|it|we))\b/i,
    ],
  },
  {
    /**
     * An explicit demand for evidence outranks `constraint` at 9.
     *
     * "Show me the release notes for the last four releases and prove the
     * self-hosted version shipped at the same time" matches the constraint
     * pattern on "self-hosted" and was being filed as a deployment constraint.
     * It is not one — it is the buyer naming the artefact that would settle the
     * question, which is a different thing to track and a different thing for
     * content to supply.
     */
    category: "proof_requirement",
    weight: 10,
    journeyStage: "evaluation",
    patterns: [
      /^(?:show|send|give)\s+(?:me|us)\b/i,
      /\bprove\s+(?:that\s+)?\b/i,
      /\b(?:that'?s|that is) a factual claim I can verify\b/i,
    ],
  },
  {
    category: "proof_requirement",
    weight: 8,
    journeyStage: "evaluation",
    patterns: [
      /\b(?:soc\s?2|iso\s?27001|hipaa|gdpr|pen(?:etration)? test|audit report|certification|attestation)\b/i,
      /\b(?:need|want|show me|send (?:me|us)) (?:the )?(?:evidence|proof|documentation|architecture diagram|reference|references)\b/i,
      /\b(?:customer reference|case study|someone (?:like us|in our industry))\b/i,
    ],
  },
  {
    category: "decision_criterion",
    weight: 7,
    journeyStage: "evaluation",
    patterns: [
      /\b(?:we(?:'| wi)?ll (?:choose|pick|go with)|the deciding factor|comes down to|what matters most|we evaluate on|criteria)\b/i,
      /\b(?:top of (?:my|our) list|non-?negotiable|table stakes|weighted)\b/i,
    ],
  },
  {
    /**
     * An explicit success frame outranks every other rule, including
     * `constraint` at 9.
     *
     * "Success means the platform is deployed inside our environment" also
     * matches the constraint pattern for "inside our environment", and at equal
     * or lower weight the constraint rule won every time — which is why the
     * seeded corpus produced no success metrics at all despite containing
     * several. When a speaker says outright how they will judge the outcome,
     * that is what the sentence is about; the environment is incidental to it.
     */
    category: "success_metric",
    weight: 10,
    journeyStage: "purchase",
    patterns: [
      // Allows a short interposed phrase: "success for us looks like …".
      /\bsuccess\b(?:\s+\w+){0,3}\s+(?:looks like|means|is|would be)\b/i,
      /\bwe'?ll know it (?:worked|landed)\b/i,
      /\bI'?d call it a (?:failure|success)\b/i,
      /\b(?:the metric|the number|what) (?:my|our) \w+ (?:asks about|cares about|tracks)\b/i,
    ],
  },
  {
    category: "success_metric",
    weight: 7,
    journeyStage: "purchase",
    patterns: [
      /\b(?:measure(?:d)? (?:by|on)|target of|kpi)\b/i,
      // "70 percent of PMs" is as common in speech as "70%".
      /\b\d+\s?(?:%|per ?cent)\s+(?:of\s+)?(?:\w+\s+){0,2}(?:adoption|reduction|increase|faster|coverage|pms?|users?|teams?|engineers?)\b/i,
      /\b(?:adoption|retention|time to value|activation)\b.*\b(?:is|was|under|over|within)\b.*\b(?:metric|week|day|month|quarter|percent|%)\b/i,
      /\b(?:within|in|under)\s+\w+\s+(?:days|weeks|months)\b.*\b(?:live|deployed|adopted|onboard)/i,
    ],
  },
  {
    category: "job_to_be_done",
    weight: 6,
    journeyStage: "problem_discovery",
    patterns: [
      // "The goal is …" is as common as "our goal is" once a facilitator has
      // already established whose goal it is.
      /\b(?:we(?:'| a)?re trying to|(?:our|the|my) goal is|we need to|I(?:'| a)?m trying to|what we want is|we'?re looking to)\b/i,
      /\b(?:so that we can|in order to)\b/i,
    ],
  },
  {
    category: "implementation_requirement",
    weight: 6,
    journeyStage: "implementation",
    patterns: [
      /\b(?:integrat\w+|sso|saml|scim|terraform|api|webhook|connector|migrat\w+|rollout|provision\w*)\b/i,
      /\b(?:our (?:stack|warehouse|pipeline)|snowflake|redshift|bigquery|dbt|kafka)\b/i,
    ],
  },
  {
    category: "comparison",
    weight: 6,
    journeyStage: "consideration",
    patterns: [
      /\b(?:compared (?:to|with)|versus|vs\.?|instead of|alternative to|we also looked at|shortlist)\b/i,
    ],
  },
  {
    category: "pain_point",
    weight: 5,
    journeyStage: "problem_discovery",
    sentiment: "negative",
    patterns: [
      /\b(?:painful|frustrat\w+|wast(?:e|ing)|manual|spreadsheet|takes (?:us )?(?:days|weeks)|keeps breaking|no visibility|we have no idea)\b/i,
    ],
  },
  {
    category: "desired_outcome",
    weight: 5,
    journeyStage: "solution_exploration",
    sentiment: "positive",
    patterns: [
      /\b(?:ideally|what I(?:'| wou)?ld love|it would be great if|we want to be able to|hoping to)\b/i,
    ],
  },
  {
    category: "behavior",
    weight: 4,
    journeyStage: "unknown",
    patterns: [
      /\b(?:we (?:currently|today|already)|right now we|every (?:week|month|quarter) we|our team (?:uses|runs|checks))\b/i,
      /\b(?:impressions|clicks|sessions|queries|searched|search volume)\b/i,
    ],
  },
  {
    category: "brand_claim",
    weight: 4,
    journeyStage: "unknown",
    patterns: [
      /\b(?:we deliver|our platform (?:offers|provides)|industry-leading|trusted by|the only platform)\b/i,
    ],
  },
];

/** Terms worth preserving verbatim as customer vocabulary. */
const VOCABULARY_TERMS = [
  "data lineage",
  "column-level lineage",
  "time to value",
  "reverse etl",
  "workflow disruption",
  "private cloud",
  "self-hosted",
  "air-gapped",
  "data residency",
  "governance controls",
  "role-based access",
  "audit trail",
  "soc 2",
  "hipaa",
  "gdpr",
  "iso 27001",
  "pen test",
  "single sign-on",
  "sso",
  "saml",
  "scim",
  "data warehouse",
  "snowflake",
  "bigquery",
  "redshift",
  "dbt",
  "semantic layer",
  "row-level security",
  "pii",
  "retention policy",
  "byoc",
  "bring your own cloud",
  "vpc peering",
  "procurement",
  "security review",
  "vendor assessment",
  "onboarding",
  "adoption",
  "seat licence",
  "seat license",
  "implementation effort",
  "total cost of ownership",
  "tco",
  "shadow it",
  "self-serve",
  "dashboard sprawl",
];

export function generateEvidence(context: EvidenceMockContext): EvidenceExtraction {
  const { passage } = context;
  const sentences = splitSentences(passage);
  const records: EvidenceItem[] = [];
  const seen = new Set<string>();

  for (const sentence of sentences) {
    const text = sentence.text.trim();
    if (text.length < 25) continue;

    const match = classify(text);
    if (!match) continue;

    const normalized = normalizeClaim(text, match.category);
    const dedupeKey = normalized.toLowerCase();
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    const provenance = resolveProvenance(context, match.category);
    const specificity = scoreSpecificity(text);

    records.push({
      normalized_claim: normalized,
      quote: text,
      category: match.category,
      provenance,
      journey_stage: match.journeyStage ?? inferStage(text),
      sentiment: match.sentiment ?? inferSentiment(text),
      entities: extractEntities(text, context),
      vocabulary: extractVocabulary(text),
      speaker: context.speaker ?? null,
      char_start: sentence.start,
      char_end: sentence.start + sentence.text.length,
      // Confidence rises with rule strength and how specific the sentence is.
      extraction_confidence: round(Math.min(0.95, 0.45 + match.weight * 0.05)),
      quality_score: round(Math.min(0.98, 0.4 + specificity * 0.5)),
      uncertainty_note: detectUncertainty(text),
    });
  }

  return { records };
}

function classify(text: string): CategoryRule | null {
  let best: CategoryRule | null = null;
  for (const rule of RULES) {
    if (!rule.patterns.some((pattern) => pattern.test(text))) continue;
    if (!best || rule.weight > best.weight) best = rule;
  }
  return best;
}

function resolveProvenance(
  context: EvidenceMockContext,
  category: EvidenceItem["category"],
): EvidenceItem["provenance"] {
  if (category === "brand_claim") return "brand_assertion";
  switch (context.sourceType) {
    case "brand_page":
    case "documentation":
      return "brand_assertion";
    case "search_console":
    case "onsite_search":
    case "interview":
    case "sales_transcript":
    case "support_ticket":
    case "survey":
    case "review":
    case "community":
    case "crm_note":
      return "observed";
    default:
      return "observed";
  }
}

function normalizeClaim(text: string, category: EvidenceItem["category"]): string {
  let claim = text
    .replace(/^(?:well|so|yeah|okay|ok|right|honestly|I mean|look|and|but)\b[,\s]+/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[.!?]+$/, "");

  if (claim.length > 260) claim = `${claim.slice(0, 257).trimEnd()}…`;

  // Questions keep their interrogative form; everything else reads as a claim.
  if (category === "question" && !claim.endsWith("?")) claim += "?";
  return claim.charAt(0).toUpperCase() + claim.slice(1);
}

function extractVocabulary(text: string): string[] {
  const lower = text.toLowerCase();
  return VOCABULARY_TERMS.filter((term) => lower.includes(term)).slice(0, 8);
}

function extractEntities(text: string, context: EvidenceMockContext): string[] {
  const entities = new Set<string>();
  if (text.toLowerCase().includes(context.brandName.toLowerCase())) entities.add(context.brandName);
  for (const competitor of context.competitorNames) {
    if (text.toLowerCase().includes(competitor.toLowerCase())) entities.add(competitor);
  }
  // Capitalised multi-word phrases that are not sentence-initial.
  const proper = text.matchAll(
    /(?<![.!?]\s)(?<!^)\b([A-Z][A-Za-z0-9]+(?:\s+[A-Z][A-Za-z0-9]+)*)\b/g,
  );
  for (const match of proper) {
    const value = match[1]!;
    if (value.length < 3 || value.length > 60) continue;
    if (COMMON_CAPITALS.has(value)) continue;
    entities.add(value);
  }
  return [...entities].slice(0, 10);
}

const COMMON_CAPITALS = new Set([
  "I",
  "We",
  "The",
  "This",
  "That",
  "They",
  "It",
  "If",
  "But",
  "And",
  "Our",
  "Their",
  "You",
  "There",
  "What",
  "When",
  "How",
  "Why",
  "So",
  "Yes",
  "No",
  "OK",
]);

function inferStage(text: string): EvidenceItem["journey_stage"] {
  const lower = text.toLowerCase();
  if (/\b(?:renew|expand|optimi[sz]e|after (?:we )?rolled out)\b/.test(lower))
    return "optimization";
  if (/\b(?:broken|error|fail(?:ing|ed)?|not working|debug)\b/.test(lower))
    return "troubleshooting";
  if (/\b(?:contract|pricing|quote|procurement|sign)\b/.test(lower)) return "purchase";
  if (/\b(?:migrat|deploy|integrat|roll ?out|onboard)\b/.test(lower)) return "implementation";
  if (/\b(?:compare|versus|vs\.?|shortlist|alternative)\b/.test(lower)) return "consideration";
  if (/\b(?:what is|how does|explain|learn)\b/.test(lower)) return "education";
  return "unknown";
}

function inferSentiment(text: string): EvidenceItem["sentiment"] {
  const lower = text.toLowerCase();
  const negative =
    /\b(?:can'?t|cannot|frustrat|painful|worried|concern|risk|blocker|too (?:slow|expensive)|failed?)\b/.test(
      lower,
    );
  const positive = /\b(?:love|great|excellent|impressed|works well|exactly what)\b/.test(lower);
  if (negative && positive) return "mixed";
  if (negative) return /\b(?:worried|concern|risk)\b/.test(lower) ? "concern" : "negative";
  if (positive) return "positive";
  return "neutral";
}

function detectUncertainty(text: string): string | null {
  if (/\b(?:I think|maybe|not sure|probably|might|possibly|I guess)\b/i.test(text)) {
    return "Speaker hedged this statement; treat as a tentative signal rather than a firm requirement.";
  }
  if (/\b(?:but|although|however|on the other hand)\b/i.test(text)) {
    return "Statement contains a qualifier that may contradict a related claim.";
  }
  return null;
}

function scoreSpecificity(text: string): number {
  let score = 0.2;
  if (/\d/.test(text)) score += 0.25; // numbers, dates, thresholds
  if (/\b(?:soc\s?2|hipaa|gdpr|iso|vpc|sso|saml)\b/i.test(text)) score += 0.2;
  if (text.length > 90) score += 0.15;
  if (VOCABULARY_TERMS.some((term) => text.toLowerCase().includes(term))) score += 0.2;
  return Math.min(1, score);
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

type Sentence = { text: string; start: number };

function splitSentences(text: string): Sentence[] {
  const out: Sentence[] = [];
  const pattern = /[^.!?\n]+[.!?]+|[^.!?\n]+(?=\n|$)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const raw = match[0];
    const leading = raw.length - raw.trimStart().length;
    out.push({ text: raw.trim(), start: match.index + leading });
  }
  return out;
}
