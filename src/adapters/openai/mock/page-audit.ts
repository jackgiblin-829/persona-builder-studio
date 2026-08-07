import {
  detectExtractability,
  evaluateStatementCoverage,
  isVagueCta,
  tokenize,
  type CoverageItem,
} from "@/lib/page-audit";
import type { AuditFindingOutput, PageAuditOutput } from "@/prompts/schemas";

/**
 * Deterministic mock page audit.
 *
 * "Does the page already cover this persona requirement" comes from
 * `evaluateStatementCoverage` (token overlap, not real reading
 * comprehension — see `src/lib/page-audit.ts`). Every finding cites the
 * evidence id(s) behind the persona requirement it is about, and
 * `belongsOnSupportingPage` on job-to-be-done and vocabulary findings is
 * always `false`: §30 is explicit that the homepage's own framing is a
 * homepage requirement, not something to defer.
 */

export type PageAuditMockClaim = { id: string; statement: string; evidenceIds: string[] };

export type PageAuditMockContext = {
  brandName: string;
  scope: "homepage" | "landing_page" | "product_page";
  pageContent: string;
  jobToBeDone: PageAuditMockClaim | null;
  constraints: PageAuditMockClaim[];
  objections: PageAuditMockClaim[];
  decisionCriteria: PageAuditMockClaim[];
  proofPreferences: PageAuditMockClaim[];
  vocabulary: string[];
  relatedPromptIds: string[];
  relatedProfoundPromptIds: string[];
  missingAnswerElements: string[];
};

const VAGUE_CTA_CANDIDATES = [
  "learn more",
  "get started",
  "contact us",
  "click here",
  "read more",
  "sign up",
  "find out more",
];

const SUPERLATIVE_PATTERN =
  /\b(leading|best|#1|number one|world'?s most|industry'?s (?:best|leading)|unmatched|unrivalled|unrivaled)\b/i;

export function generateAudit(context: PageAuditMockContext): PageAuditOutput {
  const findings: AuditFindingOutput[] = [];
  const supportingPageRecommendations: PageAuditOutput["supporting_page_recommendations"] = [];

  // 1. Job to be done — always a homepage/page-level requirement, never
  //    deferred to a supporting page (§30).
  if (context.jobToBeDone) {
    const [coverage] = evaluateStatementCoverage(context.pageContent, [
      asCoverageItem(context.jobToBeDone),
    ]);
    if (!coverage || !coverage.covered) {
      findings.push(
        buildFinding({
          severity: context.scope === "homepage" ? "critical" : "high",
          pageElement:
            context.scope === "homepage" ? "Homepage hero / headline" : "Page introduction",
          personaRequirement: context.jobToBeDone.statement,
          explanation:
            "The page does not state, in language this persona would recognize, what job they are trying to get done. An AI answer summarizing this page has nothing to extract as the persona's need.",
          recommendedChange:
            "State the persona's job to be done in the first heading or opening sentence, in their own words.",
          evidenceIds: context.jobToBeDone.evidenceIds,
          relatedPromptIds: context.relatedPromptIds,
          relatedProfoundPromptIds: context.relatedProfoundPromptIds,
          belongsOnSupportingPage: false,
        }),
      );
    }
  }

  // 2. Constraints — homepage-appropriate only when this is the primary
  //    landing surface; on a plain homepage, deep constraint detail belongs
  //    on a supporting page (§30: "do not put every persona concern on the
  //    homepage").
  addCoverageFindings(context, context.constraints, {
    fieldLabel: "constraint",
    severity: "high",
    pageElement: "Constraint coverage",
    explanationVerb: "does not address the constraint",
    recommendedChange: "State plainly whether this constraint is supported, and how.",
    belongsOnSupportingPage: context.scope === "homepage",
    supportingPageType: "documentation",
    findings,
    supportingPageRecommendations,
  });

  // 3. Objections — almost always belong on a supporting FAQ/comparison
  //    page rather than the homepage itself.
  addCoverageFindings(context, context.objections, {
    fieldLabel: "objection",
    severity: "medium",
    pageElement: "Objection handling",
    explanationVerb: "does not answer the objection",
    recommendedChange: "Address this objection directly rather than leaving it implicit.",
    belongsOnSupportingPage: context.scope === "homepage",
    supportingPageType: "faq",
    findings,
    supportingPageRecommendations,
  });

  // 4. Decision criteria — homepage should gesture at these; the detail a
  //    comparison needs belongs on a supporting page.
  addCoverageFindings(context, context.decisionCriteria, {
    fieldLabel: "decision criterion",
    severity: "high",
    pageElement: "Decision-criteria coverage",
    explanationVerb: "does not cover the decision criterion",
    recommendedChange: "Show, not just claim, how this brand meets the criterion.",
    belongsOnSupportingPage: context.scope === "homepage",
    supportingPageType: "comparison_page",
    findings,
    supportingPageRecommendations,
  });

  // 5. Proof preferences — almost always belong on a case study or
  //    documentation page, never crammed onto the homepage.
  addCoverageFindings(context, context.proofPreferences, {
    fieldLabel: "proof preference",
    severity: "medium",
    pageElement: "Proof quality",
    explanationVerb: "does not supply the proof this persona asks for",
    recommendedChange:
      "Add the specific kind of proof this persona has asked for before it will proceed.",
    belongsOnSupportingPage: true,
    supportingPageType: "case_study",
    findings,
    supportingPageRecommendations,
  });

  // 6. Vocabulary alignment.
  const vocabScore = vocabularyAlignment(context);
  if (context.vocabulary.length > 0 && vocabScore < 0.34) {
    findings.push(
      buildFinding({
        severity: "medium",
        pageElement: "On-page vocabulary",
        personaRequirement: `Uses this persona's own vocabulary: ${context.vocabulary.slice(0, 6).join(", ")}`,
        explanation:
          "The page's language does not overlap meaningfully with the terms this persona actually uses. A vocabulary mismatch makes the page harder for an AI answer to match to the persona's phrasing of the question.",
        recommendedChange: `Rewrite key sections using this persona's own terms (${context.vocabulary.slice(0, 4).join(", ")}) rather than internal or marketing language.`,
        evidenceIds: [],
        relatedPromptIds: context.relatedPromptIds,
        relatedProfoundPromptIds: context.relatedProfoundPromptIds,
        belongsOnSupportingPage: false,
      }),
    );
  }

  // 7. Extractability.
  const extractability = detectExtractability(context.pageContent);
  if (!extractability.extractable) {
    findings.push(
      buildFinding({
        severity: "medium",
        pageElement: "Information hierarchy / extractability",
        personaRequirement:
          "Content structured so an AI answer can quote or summarize it directly.",
        explanation:
          "The page reads as unstructured prose: no headings, no lists, no direct-answer sentences, and no structured data were detected. AI answers extract headings, lists and direct statements far more reliably than paragraphs.",
        recommendedChange:
          "Add descriptive headings above each major section, use a short list for anything enumerable, and open each section with a one-sentence direct answer.",
        evidenceIds: [],
        relatedPromptIds: context.relatedPromptIds,
        relatedProfoundPromptIds: context.relatedProfoundPromptIds,
        belongsOnSupportingPage: false,
      }),
    );
  }

  // 8. Unsupported claims.
  const superlativeMatch = context.pageContent.match(SUPERLATIVE_PATTERN);
  if (superlativeMatch) {
    findings.push(
      buildFinding({
        severity: "high",
        pageElement: "Claims",
        pageExcerpt: excerptAround(context.pageContent, superlativeMatch.index ?? 0),
        personaRequirement:
          "Claims a citable, dated source can verify rather than an unsupported superlative.",
        explanation: `The page uses the unsupported superlative "${superlativeMatch[0]}" with no citation. This persona weighs decision criteria on verifiable evidence, and an unsupported superlative is exactly the kind of claim that should not be made without a source.`,
        recommendedChange:
          "Either cite a specific, dated, third-party source for this claim or remove it.",
        evidenceIds: [],
        relatedPromptIds: context.relatedPromptIds,
        relatedProfoundPromptIds: context.relatedProfoundPromptIds,
        belongsOnSupportingPage: false,
      }),
    );
  }

  // 9. CTA fit.
  const vagueCta = VAGUE_CTA_CANDIDATES.find((phrase) =>
    context.pageContent.toLowerCase().includes(phrase),
  );
  if (vagueCta && isVagueCta(vagueCta)) {
    findings.push(
      buildFinding({
        severity: "low",
        pageElement: "Call to action",
        pageExcerpt: vagueCta,
        personaRequirement: "A specific next step matched to this persona's decision stage.",
        explanation: `The call to action "${vagueCta}" does not say what happens next or why this persona would take it.`,
        recommendedChange:
          'Replace it with a specific action (e.g. "See pricing for teams under 50" rather than "Learn more").',
        evidenceIds: [],
        relatedPromptIds: context.relatedPromptIds,
        relatedProfoundPromptIds: context.relatedProfoundPromptIds,
        belongsOnSupportingPage: false,
      }),
    );
  }

  // 10. Missing answer elements Profound already reports as absent from AI
  //     answers about this brand — a page-level gap this audit can confirm
  //     or refute against the actual page text.
  for (const element of context.missingAnswerElements.slice(0, 5)) {
    const [coverage] = evaluateStatementCoverage(context.pageContent, [
      { id: "element", statement: element },
    ]);
    if (!coverage || !coverage.covered) {
      findings.push(
        buildFinding({
          severity: "medium",
          pageElement: "Content coverage (Profound-reported gap)",
          personaRequirement: `AI answers about this brand are missing: ${element}`,
          explanation:
            "Profound's most recent retrieval reports this element missing from AI answers, and it is also absent from this page — the page cannot be the source an AI answer is drawing from for this element because the element is not there to draw from.",
          recommendedChange: `Add explicit, extractable coverage of: ${element}`,
          evidenceIds: [],
          relatedPromptIds: context.relatedPromptIds,
          relatedProfoundPromptIds: context.relatedProfoundPromptIds,
          belongsOnSupportingPage: false,
        }),
      );
    }
  }

  const scores = buildScores(context, vocabScore, extractability.extractable, findings);

  return {
    summary: buildSummary(context, findings),
    scores,
    findings: orderBySeverity(findings).slice(0, 40),
    supporting_page_recommendations: supportingPageRecommendations.slice(0, 15),
  };
}

const SEVERITY_ORDER: Record<AuditFindingOutput["severity"], number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  info: 4,
};

function orderBySeverity(findings: AuditFindingOutput[]): AuditFindingOutput[] {
  return [...findings].sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

function asCoverageItem(claim: PageAuditMockClaim): CoverageItem {
  return { id: claim.id, statement: claim.statement };
}

function addCoverageFindings(
  context: PageAuditMockContext,
  claims: PageAuditMockClaim[],
  options: {
    fieldLabel: string;
    severity: AuditFindingOutput["severity"];
    pageElement: string;
    explanationVerb: string;
    recommendedChange: string;
    belongsOnSupportingPage: boolean;
    supportingPageType: string;
    findings: AuditFindingOutput[];
    supportingPageRecommendations: PageAuditOutput["supporting_page_recommendations"];
  },
): void {
  if (claims.length === 0) return;
  const coverage = evaluateStatementCoverage(context.pageContent, claims.map(asCoverageItem));

  for (const claim of claims) {
    const result = coverage.find((row) => row.id === claim.id);
    if (result?.covered) continue;

    options.findings.push(
      buildFinding({
        severity: options.severity,
        pageElement: options.pageElement,
        personaRequirement: claim.statement,
        explanation: `The page ${options.explanationVerb}: "${claim.statement.slice(0, 200)}"`,
        recommendedChange: options.recommendedChange,
        evidenceIds: claim.evidenceIds,
        relatedPromptIds: context.relatedPromptIds,
        relatedProfoundPromptIds: context.relatedProfoundPromptIds,
        belongsOnSupportingPage: options.belongsOnSupportingPage,
      }),
    );

    if (options.belongsOnSupportingPage) {
      options.supportingPageRecommendations.push({
        need: claim.statement.slice(0, 400),
        suggested_page_type: options.supportingPageType,
        rationale: `This ${options.fieldLabel} needs more depth than a ${context.scope.replace("_", " ")} should carry; it belongs on a dedicated ${options.supportingPageType.replace("_", " ")}.`,
      });
    }
  }
}

function buildFinding(input: {
  severity: AuditFindingOutput["severity"];
  pageElement: string;
  pageExcerpt?: string | null;
  personaRequirement: string;
  explanation: string;
  recommendedChange: string;
  evidenceIds: string[];
  relatedPromptIds: string[];
  relatedProfoundPromptIds: string[];
  belongsOnSupportingPage: boolean;
}): AuditFindingOutput {
  return {
    severity: input.severity,
    page_element: input.pageElement.slice(0, 240),
    page_excerpt: input.pageExcerpt?.slice(0, 1200) ?? null,
    persona_requirement: input.personaRequirement.slice(0, 800),
    explanation: input.explanation.slice(0, 1500),
    recommended_change: input.recommendedChange.slice(0, 1500),
    suggested_replacement: null,
    validation_method:
      "Re-audit this page after the change and confirm the requirement now scores as covered; separately, watch this persona's Profound prompts for the missing element to stop being reported absent.",
    evidence_ids: input.evidenceIds,
    related_prompt_ids: input.relatedPromptIds,
    related_profound_prompt_ids: input.relatedProfoundPromptIds,
    belongs_on_supporting_page: input.belongsOnSupportingPage,
  };
}

function excerptAround(text: string, index: number): string {
  const start = Math.max(0, index - 60);
  const end = Math.min(text.length, index + 100);
  return text.slice(start, end).trim();
}

function vocabularyAlignment(context: PageAuditMockContext): number {
  if (context.vocabulary.length === 0) return 1;
  const pageTokens = tokenize(context.pageContent);
  const vocabTokens = tokenize(context.vocabulary.join(" "));
  if (vocabTokens.size === 0) return 1;
  let hits = 0;
  for (const token of vocabTokens) if (pageTokens.has(token)) hits++;
  return hits / vocabTokens.size;
}

function buildScores(
  context: PageAuditMockContext,
  vocabScore: number,
  extractable: boolean,
  findings: AuditFindingOutput[],
): Record<string, number> {
  const criticalOrHigh = findings.filter(
    (f) => f.severity === "critical" || f.severity === "high",
  ).length;
  return {
    job_to_be_done_clarity: context.jobToBeDone
      ? (evaluateStatementCoverage(context.pageContent, [asCoverageItem(context.jobToBeDone)])[0]
          ?.score ?? 0)
      : 1,
    vocabulary_alignment: Math.min(1, vocabScore),
    constraint_coverage: coverageRate(context.pageContent, context.constraints),
    objection_coverage: coverageRate(context.pageContent, context.objections),
    decision_criteria_coverage: coverageRate(context.pageContent, context.decisionCriteria),
    proof_quality: coverageRate(context.pageContent, context.proofPreferences),
    extractability: extractable ? 1 : 0,
    overall: Math.max(0, 1 - criticalOrHigh * 0.15),
  };
}

function coverageRate(pageText: string, claims: PageAuditMockClaim[]): number {
  if (claims.length === 0) return 1;
  const coverage = evaluateStatementCoverage(pageText, claims.map(asCoverageItem));
  return coverage.filter((row) => row.covered).length / coverage.length;
}

function buildSummary(context: PageAuditMockContext, findings: AuditFindingOutput[]): string {
  const critical = findings.filter((f) => f.severity === "critical").length;
  const high = findings.filter((f) => f.severity === "high").length;
  const parts = [
    `Audited as a ${context.scope.replace("_", " ")} against this persona's approved requirements.`,
  ];
  if (findings.length === 0) {
    parts.push("No gaps were found against the requirements checked.");
  } else {
    parts.push(
      `${findings.length} finding${findings.length === 1 ? "" : "s"} recorded (${critical} critical, ${high} high).`,
    );
  }
  return parts.join(" ").slice(0, 2000);
}
