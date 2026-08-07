import type { AuditFindingOutput, BriefOutput } from "@/prompts/schemas";

/**
 * Traceability gates for SEO briefs (§29) and page audits (§30), pure and
 * clock-free like the rest of `src/lib`. These run after generation —
 * whichever adapter produced the body, mock or live — and their violations
 * are what `src/services/content-brief.ts` and `src/services/page-audit.ts`
 * use to decide whether a generation is written as-is, has an offending
 * section dropped, or fails outright, mirroring the rigor
 * `tests/unit/personas.test.ts` and `generate-persona.ts` apply to persona
 * field citations: a claim without a citation is not stored as a confident
 * claim.
 */

export type TraceabilityViolation = {
  section: string;
  index?: number;
  issue: string;
};

type ClaimItem = { statement: string; evidence_ids: string[] };

function checkClaimList(
  section: string,
  items: ClaimItem[],
  allowedEvidenceIds: ReadonlySet<string>,
  violations: TraceabilityViolation[],
): void {
  items.forEach((item, index) => {
    if (item.evidence_ids.length === 0) {
      violations.push({
        section,
        index,
        issue: `"${item.statement.slice(0, 80)}" is persona-specific but cites no evidence id.`,
      });
      return;
    }
    if (!item.evidence_ids.some((id) => allowedEvidenceIds.has(id))) {
      violations.push({
        section,
        index,
        issue: `"${item.statement.slice(0, 80)}" cites only evidence ids that are not available to this brief.`,
      });
    }
  });
}

/**
 * §29: "Every persona-specific recommendation must reference evidence IDs.
 * Every Profound-specific recommendation must reference Profound prompt IDs,
 * result snapshots or run IDs."
 *
 * `allowedEvidenceIds` and `allowedProfoundPromptIds` are the ids actually
 * supplied to the generation call — anything else is either a hallucinated
 * id or one that leaked from a different brand/persona, and both are
 * violations rather than differences worth distinguishing here.
 */
export function validateBriefTraceability(
  body: BriefOutput,
  allowed: { evidenceIds: ReadonlySet<string>; profoundPromptIds: ReadonlySet<string> },
): TraceabilityViolation[] {
  const violations: TraceabilityViolation[] = [];

  checkClaimList("constraints", body.constraints, allowed.evidenceIds, violations);
  checkClaimList("objections", body.objections, allowed.evidenceIds, violations);
  checkClaimList("decision_criteria", body.decision_criteria, allowed.evidenceIds, violations);

  body.recommended_outline.forEach((section, index) => {
    if (section.evidence_ids.length === 0) {
      violations.push({
        section: "recommended_outline",
        index,
        issue: `Outline section "${section.heading.slice(0, 80)}" cites no evidence id.`,
      });
    } else if (!section.evidence_ids.some((id) => allowed.evidenceIds.has(id))) {
      violations.push({
        section: "recommended_outline",
        index,
        issue: `Outline section "${section.heading.slice(0, 80)}" cites only evidence ids that are not available to this brief.`,
      });
    }
  });

  if (body.relevant_profound_prompts.length === 0) {
    violations.push({
      section: "relevant_profound_prompts",
      issue: "The brief is AI-search-facing but references no Profound prompt.",
    });
  } else {
    body.relevant_profound_prompts.forEach((prompt, index) => {
      if (!allowed.profoundPromptIds.has(prompt.profound_prompt_id)) {
        violations.push({
          section: "relevant_profound_prompts",
          index,
          issue: `References Profound prompt id "${prompt.profound_prompt_id}" that is not linked to this opportunity.`,
        });
      }
    });
  }

  return violations;
}

/**
 * §30: every finding must be traceable to *something* — an evidence-backed
 * persona requirement, an observed Profound pattern, or at minimum an
 * internal prompt this product generated. A finding with none of the three
 * is an assertion with no way to check it, which is exactly what an audit
 * must not produce.
 */
export function validateAuditFindingTraceability(
  finding: AuditFindingOutput,
  allowed: {
    evidenceIds: ReadonlySet<string>;
    promptIds: ReadonlySet<string>;
    profoundPromptIds: ReadonlySet<string>;
  },
): TraceabilityViolation[] {
  const violations: TraceabilityViolation[] = [];

  const hasEvidence = finding.evidence_ids.some((id) => allowed.evidenceIds.has(id));
  const hasPrompt = finding.related_prompt_ids.some((id) => allowed.promptIds.has(id));
  const hasProfoundPrompt = finding.related_profound_prompt_ids.some((id) =>
    allowed.profoundPromptIds.has(id),
  );

  if (!hasEvidence && !hasPrompt && !hasProfoundPrompt) {
    violations.push({
      section: "findings",
      issue: `Finding on "${finding.page_element}" cites no available evidence, prompt or Profound prompt id — it is not traceable to anything.`,
    });
  }

  if (finding.evidence_ids.length > 0 && !hasEvidence) {
    violations.push({
      section: "findings",
      issue: `Finding on "${finding.page_element}" cites only evidence ids that are not available.`,
    });
  }

  return violations;
}

type ClaimList = ClaimItem[];

function sanitizeClaimList(
  section: string,
  items: ClaimList,
  allowedEvidenceIds: ReadonlySet<string>,
  violations: TraceabilityViolation[],
): ClaimList {
  const kept: ClaimList = [];
  items.forEach((item, index) => {
    const filteredIds = item.evidence_ids.filter((id) => allowedEvidenceIds.has(id));
    if (filteredIds.length === 0) {
      violations.push({
        section,
        index,
        issue: `"${item.statement.slice(0, 80)}" dropped: cites no evidence id available to this brief.`,
      });
      return;
    }
    kept.push({ ...item, evidence_ids: filteredIds });
  });
  return kept;
}

/**
 * The write-boundary enforcement for §29's traceability rule: rather than
 * validate-then-reject the whole brief for one bad citation, drop exactly the
 * claims and outline sections that cite nothing available, and refuse to
 * write only when what is left can no longer stand on its own — no outline
 * at all, or no Profound prompt this brief can point back to. Every
 * dropped item is reported so the caller can log or surface it; it is never
 * silently discarded.
 */
export function sanitizeBriefBody(
  body: BriefOutput,
  allowed: { evidenceIds: ReadonlySet<string>; profoundPromptIds: ReadonlySet<string> },
): { body: BriefOutput; violations: TraceabilityViolation[]; writable: boolean } {
  const violations: TraceabilityViolation[] = [];

  const constraints = sanitizeClaimList(
    "constraints",
    body.constraints,
    allowed.evidenceIds,
    violations,
  );
  const objections = sanitizeClaimList(
    "objections",
    body.objections,
    allowed.evidenceIds,
    violations,
  );
  const decisionCriteria = sanitizeClaimList(
    "decision_criteria",
    body.decision_criteria,
    allowed.evidenceIds,
    violations,
  );

  const outline = body.recommended_outline
    .map((section, index) => {
      const filteredIds = section.evidence_ids.filter((id) => allowed.evidenceIds.has(id));
      if (filteredIds.length === 0) {
        violations.push({
          section: "recommended_outline",
          index,
          issue: `Outline section "${section.heading.slice(0, 80)}" dropped: cites no evidence id available to this brief.`,
        });
        return null;
      }
      return { ...section, evidence_ids: filteredIds };
    })
    .filter((section): section is NonNullable<typeof section> => section !== null);

  const relevantProfoundPrompts = body.relevant_profound_prompts.filter((prompt) =>
    allowed.profoundPromptIds.has(prompt.profound_prompt_id),
  );

  if (relevantProfoundPrompts.length === 0) {
    violations.push({
      section: "relevant_profound_prompts",
      issue: "No Profound prompt id in the generated brief is available to this opportunity.",
    });
  }
  if (outline.length === 0) {
    violations.push({
      section: "recommended_outline",
      issue:
        "Every outline section cited no available evidence; nothing traceable is left to write.",
    });
  }

  return {
    body: {
      ...body,
      constraints,
      objections,
      decision_criteria: decisionCriteria,
      recommended_outline: outline,
      relevant_profound_prompts: relevantProfoundPrompts,
    },
    violations,
    writable: outline.length > 0 && relevantProfoundPrompts.length > 0,
  };
}

/**
 * The audit equivalent: drop any finding that cites nothing available rather
 * than store an assertion with no way to check it. An audit can legitimately
 * end with zero findings (the page may simply be fine); it can never end with
 * an untraceable one.
 */
export function sanitizeAuditFindings(
  findings: AuditFindingOutput[],
  allowed: {
    evidenceIds: ReadonlySet<string>;
    promptIds: ReadonlySet<string>;
    profoundPromptIds: ReadonlySet<string>;
  },
): { findings: AuditFindingOutput[]; violations: TraceabilityViolation[] } {
  const violations: TraceabilityViolation[] = [];
  const kept: AuditFindingOutput[] = [];

  for (const finding of findings) {
    const filteredEvidenceIds = finding.evidence_ids.filter((id) => allowed.evidenceIds.has(id));
    const filteredPromptIds = finding.related_prompt_ids.filter((id) => allowed.promptIds.has(id));
    const filteredProfoundPromptIds = finding.related_profound_prompt_ids.filter((id) =>
      allowed.profoundPromptIds.has(id),
    );

    if (
      filteredEvidenceIds.length === 0 &&
      filteredPromptIds.length === 0 &&
      filteredProfoundPromptIds.length === 0
    ) {
      violations.push({
        section: "findings",
        issue: `Finding on "${finding.page_element}" dropped: not traceable to any available evidence, prompt or Profound prompt id.`,
      });
      continue;
    }

    kept.push({
      ...finding,
      evidence_ids: filteredEvidenceIds,
      related_prompt_ids: filteredPromptIds,
      related_profound_prompt_ids: filteredProfoundPromptIds,
    });
  }

  return { findings: kept, violations };
}
