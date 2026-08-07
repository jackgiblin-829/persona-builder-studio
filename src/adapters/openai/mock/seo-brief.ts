import { JOURNEY_STAGES, PROMPT_INTENTS, type BriefOutput } from "@/prompts/schemas";

/**
 * Deterministic mock SEO brief generation.
 *
 * Every persona-specific section (constraints, objections, decision
 * criteria, outline) cites only evidence ids actually supplied in
 * `context` — the same discipline `generatePersona` applies to field
 * citations — and every Profound-specific section cites only the supplied
 * Profound prompt ids, so a mock brief always passes
 * `validateBriefTraceability` by construction.
 */

export type BriefMockClaim = { statement: string; evidenceIds: string[] };
export type BriefMockPrompt = { profoundPromptId: string; promptText: string; gap: string };

export type BriefMockContext = {
  brandName: string;
  brandDomain: string;
  opportunityTitle: string;
  opportunityProblemStatement: string;
  recommendation: string;
  personaName: string;
  jobToBeDone: string;
  constraints: BriefMockClaim[];
  objections: BriefMockClaim[];
  decisionCriteria: BriefMockClaim[];
  vocabulary: string[];
  distinguishingTopics: string[];
  missingAnswerElements: string[];
  primaryQuery: string;
  supportingQueries: string[];
  intent: string;
  journeyStage: string;
  relevantPrompts: BriefMockPrompt[];
  profoundGapSummary: string;
  competitors: string[];
  citationSources: string[];
  existingPageUrl: string | null;
  internalLinks: { url: string; rationale: string }[];
  conversionAction: string;
  searchVolume: number | null;
  keywordDifficulty: number | null;
};

const CONTENT_TYPE_BY_RECOMMENDATION: Record<string, string> = {
  new_article: "Long-form article",
  existing_article_update: "Updated existing article",
  faq: "FAQ entry",
  comparison_page: "Comparison page",
  landing_page: "Decision-stage landing page",
  product_page: "Product page section",
  documentation: "Documentation page",
  case_study: "Case study",
  homepage_update: "Homepage section update",
  structured_information_improvement:
    "Restructured existing page (schema, headings, direct answers)",
  third_party_authority_or_pr: "Briefing document for PR/partnership outreach",
  product_or_positioning_review: "Internal positioning review memo",
};

export function generateBrief(context: BriefMockContext): BriefOutput {
  const allEvidenceIds = uniqueEvidenceIds(context);

  return {
    working_title: context.opportunityTitle.slice(0, 240),
    target_persona: context.personaName,
    job_to_be_done: context.jobToBeDone.slice(0, 800),
    primary_information_need: context.opportunityProblemStatement.slice(0, 800),
    intent: asIntent(context.intent),
    journey_stage: asJourneyStage(context.journeyStage),
    primary_query: context.primaryQuery.slice(0, 300),
    supporting_queries: context.supportingQueries.slice(0, 20),
    relevant_profound_prompts: context.relevantPrompts.slice(0, 20).map((p) => ({
      profound_prompt_id: p.profoundPromptId,
      prompt_text: p.promptText.slice(0, 600),
      gap: p.gap.slice(0, 600),
    })),
    profound_gap_summary: context.profoundGapSummary.slice(0, 2000),
    reader_existing_knowledge: buildReaderKnowledge(context),
    constraints: toStatementEvidence(context.constraints),
    objections: toStatementEvidence(context.objections),
    decision_criteria: toStatementEvidence(context.decisionCriteria),
    expected_answer_elements: context.missingAnswerElements.slice(0, 25),
    recommended_content_type:
      CONTENT_TYPE_BY_RECOMMENDATION[context.recommendation] ?? "Long-form article",
    recommended_outline: buildOutline(context),
    customer_vocabulary: context.vocabulary.slice(0, 40),
    concepts_and_entities: context.distinguishingTopics.slice(0, 40),
    required_evidence: buildRequiredEvidence(context),
    required_examples: buildRequiredExamples(context),
    source_requirements: [
      "Cite only first-party evidence already approved for this persona, or the brand's own verifiable claims.",
      "Do not cite the third-party sources dominating the Profound answer as though they endorse this brand.",
    ],
    product_proof: buildProductProof(context),
    competitor_coverage: buildCompetitorCoverage(context),
    internal_links: context.internalLinks.slice(0, 20),
    conversion_action: context.conversionAction.slice(0, 400),
    unsupported_claims_to_avoid: buildUnsupportedClaims(context),
    final_quality_checklist: buildChecklist(context, allEvidenceIds),
  };
}

function asIntent(value: string): BriefOutput["intent"] {
  return (PROMPT_INTENTS as readonly string[]).includes(value)
    ? (value as BriefOutput["intent"])
    : "education";
}

function asJourneyStage(value: string): BriefOutput["journey_stage"] {
  return (JOURNEY_STAGES as readonly string[]).includes(value)
    ? (value as BriefOutput["journey_stage"])
    : "unknown";
}

function toStatementEvidence(
  claims: BriefMockClaim[],
): { statement: string; evidence_ids: string[] }[] {
  return claims
    .filter((claim) => claim.evidenceIds.length > 0)
    .slice(0, 20)
    .map((claim) => ({
      statement: claim.statement.slice(0, 400),
      evidence_ids: claim.evidenceIds.slice(0, 20),
    }));
}

function uniqueEvidenceIds(context: BriefMockContext): string[] {
  return [
    ...new Set([
      ...context.constraints.flatMap((c) => c.evidenceIds),
      ...context.objections.flatMap((c) => c.evidenceIds),
      ...context.decisionCriteria.flatMap((c) => c.evidenceIds),
    ]),
  ];
}

function buildReaderKnowledge(context: BriefMockContext): string {
  return `This reader already understands ${context.jobToBeDone.slice(0, 150)}. Do not re-explain that; open with what is new for "${context.primaryQuery}".`.slice(
    0,
    1200,
  );
}

function buildOutline(
  context: BriefMockContext,
): { heading: string; purpose: string; must_cover: string[]; evidence_ids: string[] }[] {
  const outline: {
    heading: string;
    purpose: string;
    must_cover: string[];
    evidence_ids: string[];
  }[] = [];

  const introEvidence =
    context.constraints[0]?.evidenceIds ?? context.objections[0]?.evidenceIds ?? [];
  outline.push({
    heading: `Direct answer to "${context.primaryQuery}"`,
    purpose:
      "Answer the primary query in the first two sentences so an AI answer can extract it directly.",
    must_cover: context.missingAnswerElements.slice(0, 5),
    evidence_ids: introEvidence.slice(0, 10),
  });

  if (context.constraints.length > 0) {
    outline.push({
      heading: "Constraints this persona is working within",
      purpose: "Cover the limits that decide fit before making any claim about suitability.",
      must_cover: context.constraints.map((c) => c.statement.slice(0, 200)).slice(0, 10),
      evidence_ids: context.constraints.flatMap((c) => c.evidenceIds).slice(0, 20),
    });
  }

  if (context.objections.length > 0) {
    outline.push({
      heading: "Addressing the objections this persona actually raises",
      purpose: "Answer real objections from evidence rather than anticipated ones.",
      must_cover: context.objections.map((c) => c.statement.slice(0, 200)).slice(0, 10),
      evidence_ids: context.objections.flatMap((c) => c.evidenceIds).slice(0, 20),
    });
  }

  if (context.decisionCriteria.length > 0) {
    outline.push({
      heading: "What this persona's decision actually turns on",
      purpose: "Map the content directly to the decision criteria evidence supports.",
      must_cover: context.decisionCriteria.map((c) => c.statement.slice(0, 200)).slice(0, 10),
      evidence_ids: context.decisionCriteria.flatMap((c) => c.evidenceIds).slice(0, 20),
    });
  }

  const closingEvidence =
    context.decisionCriteria[0]?.evidenceIds ??
    context.constraints[0]?.evidenceIds ??
    context.objections[0]?.evidenceIds ??
    [];
  outline.push({
    heading: "Next step",
    purpose: `Point to the conversion action: ${context.conversionAction.slice(0, 120)}.`,
    must_cover: ["A single, specific next step — not a generic contact-us close."],
    evidence_ids: closingEvidence.slice(0, 5),
  });

  return outline;
}

function buildRequiredEvidence(context: BriefMockContext): string[] {
  const items = [
    ...context.constraints.map((c) => `Constraint: ${c.statement.slice(0, 200)}`),
    ...context.objections.map((c) => `Objection: ${c.statement.slice(0, 200)}`),
    ...context.decisionCriteria.map((c) => `Decision criterion: ${c.statement.slice(0, 200)}`),
  ];
  return items.slice(0, 20);
}

function buildRequiredExamples(context: BriefMockContext): string[] {
  if (context.missingAnswerElements.length === 0) {
    return ["A concrete, verifiable example that matches this persona's stated job to be done."];
  }
  return context.missingAnswerElements
    .slice(0, 10)
    .map((element) => `A concrete example demonstrating: ${element.slice(0, 200)}`);
}

function buildProductProof(context: BriefMockContext): string[] {
  if (context.decisionCriteria.length === 0) {
    return [
      "No decision-criteria evidence is available to ground product proof; do not add a proof point that is not already documented product behavior.",
    ];
  }
  return context.decisionCriteria
    .slice(0, 10)
    .map(
      (criterion) =>
        `Show, don't just claim, how ${context.brandName} meets: ${criterion.statement.slice(0, 200)}`,
    );
}

function buildCompetitorCoverage(context: BriefMockContext): string[] {
  if (context.competitors.length === 0) {
    return [
      "No competitor currently dominates this answer; do not introduce a comparison unprompted.",
    ];
  }
  return context.competitors
    .slice(0, 10)
    .map(
      (competitor) =>
        `Acknowledge ${competitor} factually where the evidence supports it; do not disparage it.`,
    );
}

function buildUnsupportedClaims(context: BriefMockContext): string[] {
  const claims = [
    "Do not claim category leadership without a citable, dated third-party source.",
    "Do not state a specific customer outcome (percentage, dollar figure, time saved) unless it is in the required evidence list above.",
  ];
  if (context.citationSources.length > 0) {
    claims.push(
      `Do not imply endorsement from ${context.citationSources.slice(0, 3).join(", ")}; they are cited independently in AI answers, not partners.`,
    );
  }
  return claims;
}

function buildChecklist(context: BriefMockContext, evidenceIds: string[]): string[] {
  const checklist = [
    "Every persona-facing claim in the draft traces to an evidence id from this brief's required-evidence list.",
    `Every Profound prompt referenced (${context.relevantPrompts.map((p) => p.profoundPromptId).join(", ") || "none"}) is addressed by a specific section, not just mentioned.`,
    "Every missing answer element listed is answered in the first two sections, not buried below the fold.",
    "No claim from the unsupported-claims list above appears in the draft.",
  ];
  if (evidenceIds.length === 0) {
    checklist.push(
      "This opportunity has no directly cited persona evidence; the draft should lean on the brand's own verifiable product documentation instead of implying customer research it does not have.",
    );
  }
  return checklist;
}
