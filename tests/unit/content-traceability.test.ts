import { describe, expect, it } from "vitest";
import {
  sanitizeAuditFindings,
  sanitizeBriefBody,
  validateAuditFindingTraceability,
  validateBriefTraceability,
} from "@/lib/content-traceability";
import type { AuditFindingOutput, BriefOutput } from "@/prompts/schemas";

/**
 * §29/§30's write-boundary enforcement: a brief or an audit finding that
 * cites nothing available must either be filtered out (`sanitize*`) or
 * flagged (`validate*`) — never silently written as though it were
 * traceable. Mirrors the rigor `tests/unit/personas.test.ts` and
 * `generate-persona.ts` already apply to persona field citations.
 */

function minimalBrief(overrides: Partial<BriefOutput> = {}): BriefOutput {
  return {
    working_title: "Working title",
    target_persona: "Security-led buyer",
    job_to_be_done: "Get analytics into production without failing security review.",
    primary_information_need: "Whether this platform supports private cloud deployment.",
    intent: "evaluation",
    journey_stage: "evaluation",
    primary_query: "does this platform support private cloud deployment",
    supporting_queries: [],
    relevant_profound_prompts: [
      {
        profound_prompt_id: "prof_1",
        prompt_text: "Does it support private cloud?",
        gap: "brand absent",
      },
    ],
    profound_gap_summary: "Brand absent from this answer.",
    reader_existing_knowledge: "Already knows what product analytics is.",
    constraints: [{ statement: "Data cannot leave our cloud", evidence_ids: ["ev_1"] }],
    objections: [{ statement: "Self-hosted feels second-class", evidence_ids: ["ev_2"] }],
    decision_criteria: [{ statement: "Deployment model first", evidence_ids: ["ev_1"] }],
    expected_answer_elements: ["private cloud", "SOC 2"],
    recommended_content_type: "Long-form article",
    recommended_outline: [
      {
        heading: "Direct answer",
        purpose: "Answer immediately",
        must_cover: ["private cloud"],
        evidence_ids: ["ev_1"],
      },
    ],
    customer_vocabulary: ["VPC"],
    concepts_and_entities: ["SOC 2"],
    required_evidence: ["Constraint: data residency"],
    required_examples: ["A concrete deployment example"],
    source_requirements: ["Cite only approved evidence"],
    product_proof: ["Show private cloud support"],
    competitor_coverage: [],
    internal_links: [],
    conversion_action: "Book a technical demo",
    unsupported_claims_to_avoid: ["Do not claim category leadership"],
    final_quality_checklist: ["Every claim traces to evidence"],
    ...overrides,
  };
}

function minimalFinding(overrides: Partial<AuditFindingOutput> = {}): AuditFindingOutput {
  return {
    severity: "high",
    page_element: "Homepage hero",
    page_excerpt: null,
    persona_requirement: "States the job to be done in the persona's own words.",
    explanation: "The page never states this.",
    recommended_change: "Add a headline stating the job to be done.",
    suggested_replacement: null,
    validation_method: "Re-audit after the change.",
    evidence_ids: ["ev_1"],
    related_prompt_ids: [],
    related_profound_prompt_ids: [],
    belongs_on_supporting_page: false,
    ...overrides,
  };
}

describe("validateBriefTraceability", () => {
  it("passes a brief where every claim and outline section cites available ids", () => {
    const violations = validateBriefTraceability(minimalBrief(), {
      evidenceIds: new Set(["ev_1", "ev_2"]),
      profoundPromptIds: new Set(["prof_1"]),
    });
    expect(violations).toEqual([]);
  });

  it("flags a constraint with no evidence ids", () => {
    const brief = minimalBrief({
      constraints: [{ statement: "Unsupported constraint", evidence_ids: [] }],
    });
    const violations = validateBriefTraceability(brief, {
      evidenceIds: new Set(["ev_1", "ev_2"]),
      profoundPromptIds: new Set(["prof_1"]),
    });
    expect(violations.some((v) => v.section === "constraints")).toBe(true);
  });

  it("flags a claim whose evidence ids are not in the allowed set", () => {
    const brief = minimalBrief({
      objections: [
        { statement: "Cites a stranger's evidence", evidence_ids: ["ev_from_another_brand"] },
      ],
    });
    const violations = validateBriefTraceability(brief, {
      evidenceIds: new Set(["ev_1", "ev_2"]),
      profoundPromptIds: new Set(["prof_1"]),
    });
    expect(violations.some((v) => v.section === "objections")).toBe(true);
  });

  it("flags an outline section with no evidence ids", () => {
    const brief = minimalBrief({
      recommended_outline: [
        { heading: "Untraceable section", purpose: "x", must_cover: [], evidence_ids: [] },
      ],
    });
    const violations = validateBriefTraceability(brief, {
      evidenceIds: new Set(["ev_1"]),
      profoundPromptIds: new Set(["prof_1"]),
    });
    expect(violations.some((v) => v.section === "recommended_outline")).toBe(true);
  });

  it("flags a brief with no relevant Profound prompts at all", () => {
    const brief = minimalBrief({ relevant_profound_prompts: [] });
    const violations = validateBriefTraceability(brief, {
      evidenceIds: new Set(["ev_1", "ev_2"]),
      profoundPromptIds: new Set(["prof_1"]),
    });
    expect(violations.some((v) => v.section === "relevant_profound_prompts")).toBe(true);
  });

  it("flags a Profound prompt id that is not in the allowed set", () => {
    const brief = minimalBrief({
      relevant_profound_prompts: [
        { profound_prompt_id: "prof_unknown", prompt_text: "x", gap: "x" },
      ],
    });
    const violations = validateBriefTraceability(brief, {
      evidenceIds: new Set(["ev_1", "ev_2"]),
      profoundPromptIds: new Set(["prof_1"]),
    });
    expect(violations.some((v) => v.section === "relevant_profound_prompts")).toBe(true);
  });
});

describe("sanitizeBriefBody", () => {
  it("is a no-op and writable when everything is already traceable", () => {
    const allowed = {
      evidenceIds: new Set(["ev_1", "ev_2"]),
      profoundPromptIds: new Set(["prof_1"]),
    };
    const { body, violations, writable } = sanitizeBriefBody(minimalBrief(), allowed);
    expect(writable).toBe(true);
    expect(violations).toEqual([]);
    expect(body.constraints).toHaveLength(1);
  });

  it("drops a claim citing an unavailable evidence id but keeps the rest writable", () => {
    const brief = minimalBrief({
      objections: [{ statement: "Cites unavailable evidence", evidence_ids: ["ev_gone"] }],
    });
    const allowed = {
      evidenceIds: new Set(["ev_1", "ev_2"]),
      profoundPromptIds: new Set(["prof_1"]),
    };
    const { body, violations, writable } = sanitizeBriefBody(brief, allowed);
    expect(writable).toBe(true);
    expect(body.objections).toEqual([]);
    expect(violations.length).toBeGreaterThan(0);
  });

  it("refuses to write when every outline section is dropped", () => {
    const brief = minimalBrief({
      recommended_outline: [
        { heading: "Only section", purpose: "x", must_cover: [], evidence_ids: ["ev_gone"] },
      ],
    });
    const allowed = { evidenceIds: new Set(["ev_1"]), profoundPromptIds: new Set(["prof_1"]) };
    const { writable, violations } = sanitizeBriefBody(brief, allowed);
    expect(writable).toBe(false);
    expect(violations.some((v) => v.section === "recommended_outline")).toBe(true);
  });

  it("refuses to write when no Profound prompt id resolves", () => {
    const brief = minimalBrief({
      relevant_profound_prompts: [
        { profound_prompt_id: "prof_unknown", prompt_text: "x", gap: "x" },
      ],
    });
    const allowed = { evidenceIds: new Set(["ev_1"]), profoundPromptIds: new Set(["prof_1"]) };
    const { writable } = sanitizeBriefBody(brief, allowed);
    expect(writable).toBe(false);
  });
});

describe("validateAuditFindingTraceability", () => {
  it("passes a finding backed by available evidence", () => {
    const violations = validateAuditFindingTraceability(minimalFinding(), {
      evidenceIds: new Set(["ev_1"]),
      promptIds: new Set(),
      profoundPromptIds: new Set(),
    });
    expect(violations).toEqual([]);
  });

  it("passes a finding backed only by a related Profound prompt, no evidence", () => {
    const finding = minimalFinding({ evidence_ids: [], related_profound_prompt_ids: ["prof_1"] });
    const violations = validateAuditFindingTraceability(finding, {
      evidenceIds: new Set(),
      promptIds: new Set(),
      profoundPromptIds: new Set(["prof_1"]),
    });
    expect(violations).toEqual([]);
  });

  it("flags a finding traceable to nothing at all", () => {
    const finding = minimalFinding({ evidence_ids: [] });
    const violations = validateAuditFindingTraceability(finding, {
      evidenceIds: new Set(["ev_1"]),
      promptIds: new Set(),
      profoundPromptIds: new Set(),
    });
    expect(violations.length).toBeGreaterThan(0);
  });

  it("flags a finding whose evidence ids are all unavailable", () => {
    const finding = minimalFinding({ evidence_ids: ["ev_unknown"] });
    const violations = validateAuditFindingTraceability(finding, {
      evidenceIds: new Set(["ev_1"]),
      promptIds: new Set(),
      profoundPromptIds: new Set(),
    });
    expect(violations.length).toBeGreaterThan(0);
  });
});

describe("sanitizeAuditFindings", () => {
  it("keeps traceable findings and drops untraceable ones", () => {
    const findings = [
      minimalFinding({ page_element: "Keep — has evidence", evidence_ids: ["ev_1"] }),
      minimalFinding({
        page_element: "Drop — cites nothing available",
        evidence_ids: ["ev_unknown"],
      }),
      minimalFinding({
        page_element: "Keep — has a Profound reference only",
        evidence_ids: [],
        related_profound_prompt_ids: ["prof_1"],
      }),
    ];
    const { findings: kept, violations } = sanitizeAuditFindings(findings, {
      evidenceIds: new Set(["ev_1"]),
      promptIds: new Set(),
      profoundPromptIds: new Set(["prof_1"]),
    });
    expect(kept.map((f) => f.page_element)).toEqual([
      "Keep — has evidence",
      "Keep — has a Profound reference only",
    ]);
    expect(violations).toHaveLength(1);
  });

  it("strips unavailable ids from a kept finding rather than only from dropped ones", () => {
    const findings = [
      minimalFinding({
        evidence_ids: ["ev_1", "ev_unknown"],
        related_prompt_ids: ["prompt_unknown"],
      }),
    ];
    const { findings: kept } = sanitizeAuditFindings(findings, {
      evidenceIds: new Set(["ev_1"]),
      promptIds: new Set(),
      profoundPromptIds: new Set(),
    });
    expect(kept[0]?.evidence_ids).toEqual(["ev_1"]);
    expect(kept[0]?.related_prompt_ids).toEqual([]);
  });

  it("can legitimately end with zero findings without that being an error", () => {
    const findings = [minimalFinding({ evidence_ids: ["ev_unknown"] })];
    const { findings: kept, violations } = sanitizeAuditFindings(findings, {
      evidenceIds: new Set(["ev_1"]),
      promptIds: new Set(),
      profoundPromptIds: new Set(),
    });
    expect(kept).toEqual([]);
    expect(violations).toHaveLength(1);
  });
});
