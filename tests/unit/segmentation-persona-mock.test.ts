import { describe, expect, it } from "vitest";
import {
  analyse,
  SEGMENTATION_THRESHOLDS,
  type SegmentationMockContext,
  type SegmentationMockEvidence,
} from "@/adapters/openai/mock/segmentation";
import {
  EXCLUDED_ASSUMPTIONS,
  generatePersona,
  type PersonaMockContext,
  type PersonaMockEvidence,
} from "@/adapters/openai/mock/persona";
import { personaSynthesisSchema, segmentationSchema } from "@/prompts/schemas";

const REFERENCE = "2026-07-01T00:00:00.000Z";

let counter = 0;
function record(
  overrides: Partial<SegmentationMockEvidence> & { claim: string },
): SegmentationMockEvidence {
  counter++;
  return {
    id: `ev_${counter}`,
    quote: overrides.claim,
    category: "constraint",
    provenance: "observed",
    sourceId: "src_a",
    sourceType: "interview",
    journeyStage: "evaluation",
    qualityScore: 0.8,
    vocabulary: [],
    hedged: false,
    observedAt: REFERENCE,
    ...overrides,
  };
}

/** Enough clustered security evidence, from three sources, to be a candidate. */
function securityCorpus(): SegmentationMockEvidence[] {
  return [
    record({
      claim: "Customer data cannot leave our approved cloud environment",
      sourceId: "src_call",
      sourceType: "sales_transcript",
    }),
    record({
      claim: "If it can't run in our own VPC we don't even take the demo",
      sourceId: "src_call",
      sourceType: "sales_transcript",
    }),
    record({
      claim: "Send me the SOC 2 Type II report and the architecture diagram",
      category: "proof_requirement",
      sourceId: "src_call",
      sourceType: "sales_transcript",
    }),
    record({
      claim: "We need a HIPAA compliant analytics platform",
      category: "proof_requirement",
      sourceId: "src_gsc",
      sourceType: "search_console",
      provenance: "externally_supported",
    }),
    record({
      claim: "The deciding factor is deployment model first, then governance",
      category: "decision_criterion",
      sourceId: "src_interview",
      sourceType: "interview",
    }),
    record({
      claim: "The architecture review killed our last procurement attempt",
      category: "objection",
      sourceId: "src_interview",
      sourceType: "interview",
    }),
  ];
}

function context(
  evidence: SegmentationMockEvidence[],
  overrides: Partial<SegmentationMockContext> = {},
): SegmentationMockContext {
  return {
    brandName: "Northwind Analytics",
    referenceDate: REFERENCE,
    evidence,
    ...overrides,
  };
}

describe("mock segmentation", () => {
  it("produces output that satisfies the schema the live adapter enforces", () => {
    const result = analyse(context(securityCorpus()));
    expect(segmentationSchema.safeParse({ segments: result.segments }).success).toBe(true);
  });

  it("is deterministic: the same evidence always produces the same candidates", () => {
    const evidence = securityCorpus();
    const first = analyse(context(evidence));
    const second = analyse(context(evidence));
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("does not invent a segment from one source", () => {
    const oneSource = securityCorpus().map((item) => ({ ...item, sourceId: "src_only" }));
    expect(analyse(context(oneSource)).segments).toHaveLength(0);
  });

  it("does not invent a segment from too little evidence", () => {
    const thin = securityCorpus().slice(0, SEGMENTATION_THRESHOLDS.MIN_SUPPORTING - 1);
    expect(analyse(context(thin)).segments).toHaveLength(0);
  });

  it("emits a candidate once the thresholds are met, with real citations", () => {
    const evidence = securityCorpus();
    const { segments } = analyse(context(evidence));
    expect(segments).toHaveLength(1);

    const segment = segments[0]!;
    expect(segment.slug).toBe("security-led-deployment-buyer");
    expect(segment.supporting_evidence_ids.length).toBeGreaterThanOrEqual(
      SEGMENTATION_THRESHOLDS.MIN_SUPPORTING,
    );

    const supplied = new Set(evidence.map((item) => item.id));
    for (const id of segment.supporting_evidence_ids) expect(supplied.has(id)).toBe(true);
    for (const id of segment.contradicting_evidence_ids) expect(supplied.has(id)).toBe(true);
  });

  it("never forces unrelated evidence into a segment", () => {
    const evidence = [
      ...securityCorpus(),
      record({
        claim: "It received 4310 impressions",
        category: "behavior",
        journeyStage: "unknown",
        sourceId: "src_gsc",
        sourceType: "search_console",
      }),
      record({
        claim: "Our office moved to a new building last quarter",
        category: "other",
        sourceId: "src_note",
        sourceType: "crm_note",
      }),
    ];

    const result = analyse(context(evidence));
    const assigned = new Set(result.segments.flatMap((segment) => segment.supporting_evidence_ids));
    expect(result.unassigned_evidence_ids.length).toBeGreaterThanOrEqual(2);
    for (const id of result.unassigned_evidence_ids) expect(assigned.has(id)).toBe(false);
  });

  it("records a hedged statement as contradicting, not supporting", () => {
    const evidence = [
      ...securityCorpus(),
      record({
        claim: "I think the self-hosted build might lag behind, though I'm not certain",
        sourceId: "src_review",
        sourceType: "review",
        hedged: true,
      }),
    ];

    const segment = analyse(context(evidence)).segments[0]!;
    expect(segment.contradicting_evidence_ids.length).toBeGreaterThan(0);
    expect(segment.confidence_components.contradiction_penalty).toBeGreaterThan(0);
  });

  it("explains every confidence component it reports", () => {
    const segment = analyse(context(securityCorpus())).segments[0]!;
    for (const value of Object.values(segment.confidence_components)) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
    expect(segment.confidence_explanation.length).toBeGreaterThan(10);
  });

  it("reports a coverage gap when a source class is missing entirely", () => {
    // No first-party record at all: every source here is aggregate or brand copy.
    const external = securityCorpus().map((item, index) => ({
      ...item,
      sourceId: index % 2 === 0 ? "src_gsc" : "src_brand",
      sourceType: index % 2 === 0 ? "search_console" : "brand_page",
    }));

    const segment = analyse(context(external)).segments[0]!;
    expect(segment.coverage_gaps.some((gap) => gap.includes("first-party"))).toBe(true);
  });

  it("caps candidates at seven", () => {
    const { segments } = analyse(context(securityCorpus()));
    expect(segments.length).toBeLessThanOrEqual(SEGMENTATION_THRESHOLDS.MAX_CANDIDATES);
  });

  it("returns no candidate for evidence that clusters on nothing", () => {
    const noise = Array.from({ length: 12 }, (_, i) =>
      record({
        claim: `Assorted observation number ${i} with no shared theme`,
        category: "other",
        sourceId: `src_${i}`,
      }),
    );
    expect(analyse(context(noise)).segments).toHaveLength(0);
  });
});

// ── Persona synthesis ───────────────────────────────────────────────────────

function personaEvidence(
  overrides: Partial<PersonaMockEvidence> & { claim: string },
): PersonaMockEvidence {
  counter++;
  return {
    id: `pev_${counter}`,
    quote: overrides.claim,
    category: "constraint",
    provenance: "observed",
    sourceId: "src_call",
    sourceType: "sales_transcript",
    sourceLabel: "Discovery call",
    journeyStage: "evaluation",
    vocabulary: [],
    entities: [],
    hedged: false,
    ...overrides,
  };
}

function personaContext(overrides: Partial<PersonaMockContext> = {}): PersonaMockContext {
  return {
    brandName: "Northwind Analytics",
    segmentLabel: "Security-led deployment buyer",
    segmentDefinition:
      "Buyers whose evaluation is gated by where data lives and who must clear a security review first.",
    segmentDistinguishingVariables: ["Primary constraint: data residency"],
    segmentCoverageGaps: ["No success metric evidence."],
    otherPersonaNames: [],
    supporting: [
      personaEvidence({
        claim: "We're trying to replace a reporting setup our data team maintains by hand",
        category: "job_to_be_done",
        journeyStage: "problem_discovery",
      }),
      personaEvidence({
        claim: "Customer data cannot leave our approved cloud environment",
        vocabulary: ["data residency"],
        entities: ["VPC"],
      }),
      personaEvidence({
        claim: "The deciding factor is deployment model first, then governance",
        category: "decision_criterion",
        sourceId: "src_interview",
        sourceType: "interview",
        sourceLabel: "Buyer interview",
      }),
      personaEvidence({
        claim: "Send me the SOC 2 Type II report and the architecture diagram",
        category: "proof_requirement",
        vocabulary: ["soc 2"],
        entities: ["VPC"],
      }),
      personaEvidence({
        claim: "Can you explain how the deployment works?",
        category: "question",
        journeyStage: "education",
      }),
    ],
    contradicting: [],
    ...overrides,
  };
}

describe("mock persona synthesis", () => {
  it("produces output that satisfies the schema the live adapter enforces", () => {
    const result = generatePersona(personaContext());
    expect(personaSynthesisSchema.safeParse(result).success).toBe(true);
  });

  it("is deterministic", () => {
    const ctx = personaContext();
    expect(JSON.stringify(generatePersona(ctx))).toBe(JSON.stringify(generatePersona(ctx)));
  });

  it("emits every core field, present or explicitly insufficient", () => {
    // A context with nothing that matches any core rule.
    const bare = personaContext({
      supporting: [
        personaEvidence({
          claim: "Our team checks the dashboard every Monday morning",
          category: "behavior",
          journeyStage: "unknown",
        }),
      ],
    });

    const result = generatePersona(bare);
    for (const core of [
      "job_to_be_done",
      "constraint",
      "success_metric",
      "decision_criterion",
      "vocabulary",
    ] as const) {
      const fields = result.fields.filter((field) => field.field_type === core);
      expect(fields.length).toBeGreaterThan(0);
      expect(fields.every((field) => field.insufficient_evidence)).toBe(true);
    }
  });

  it("holds the traceability invariant: every field cites evidence or is marked insufficient", () => {
    const result = generatePersona(personaContext());
    for (const field of result.fields) {
      const traceable =
        field.supporting_evidence_ids.length > 0 || field.insufficient_evidence === true;
      expect(traceable, `untraceable field: ${field.field_type} — ${field.statement}`).toBe(true);
    }
  });

  it("only cites evidence ids it was given", () => {
    const ctx = personaContext();
    const supplied = new Set([
      ...ctx.supporting.map((item) => item.id),
      ...ctx.contradicting.map((item) => item.id),
    ]);
    for (const field of generatePersona(ctx).fields) {
      for (const id of field.supporting_evidence_ids) expect(supplied.has(id)).toBe(true);
      for (const id of field.contradicting_evidence_ids) expect(supplied.has(id)).toBe(true);
    }
  });

  it("never turns aggregate search demand into the persona's own claim (§14)", () => {
    const ctx = personaContext({
      supporting: [
        personaEvidence({
          claim: 'Searchers used the query "hipaa compliant analytics platform"',
          category: "proof_requirement",
          sourceId: "src_gsc",
          sourceType: "search_console",
          sourceLabel: "Search Console export",
          provenance: "externally_supported",
        }),
        personaEvidence({
          claim: 'Searchers used the query "self-hosted product analytics"',
          sourceId: "src_gsc",
          sourceType: "search_console",
          sourceLabel: "Search Console export",
          provenance: "externally_supported",
        }),
      ],
    });

    const result = generatePersona(ctx);
    const claims = result.fields.filter(
      (field) =>
        !field.insufficient_evidence &&
        ["job_to_be_done", "constraint", "proof_preference", "decision_criterion"].includes(
          field.field_type,
        ),
    );
    expect(claims).toHaveLength(0);

    // …but the fact that it happened is stated rather than hidden.
    expect(
      result.fields.some(
        (field) => field.field_type === "coverage_gap" && field.statement.includes("aggregate"),
      ),
    ).toBe(true);
  });

  it("records the full excluded-assumption list on every persona", () => {
    const result = generatePersona(personaContext());
    expect(result.excluded_assumptions).toEqual(EXCLUDED_ASSUMPTIONS);

    const joined = result.excluded_assumptions.join(" ").toLowerCase();
    for (const forbidden of ["age", "gender", "income", "hobbies", "family", "personality"]) {
      expect(joined).toContain(forbidden);
    }
  });

  it("never claims a demographic or personality attribute", () => {
    const result = generatePersona(personaContext());
    const claims = result.fields
      .filter((field) => !field.insufficient_evidence && field.field_type !== "excluded_assumption")
      .map((field) => field.statement.toLowerCase())
      .join(" ");

    for (const forbidden of [
      "years old",
      "aged ",
      "married",
      "his hobbies",
      "her hobbies",
      "extrovert",
      "introvert",
      "salary",
      "household income",
    ]) {
      expect(claims).not.toContain(forbidden);
    }
  });

  it("preserves the customer's vocabulary verbatim", () => {
    const vocabulary = generatePersona(personaContext())
      .fields.filter((field) => field.field_type === "vocabulary")
      .map((field) => field.statement);
    expect(vocabulary).toContain("data residency");
    expect(vocabulary).toContain("soc 2");
  });

  it("marks structural fields insufficient because they carry no evidence by design", () => {
    const result = generatePersona(personaContext());
    for (const field of result.fields) {
      if (
        ["coverage_gap", "excluded_assumption", "regeneration_trigger"].includes(field.field_type)
      ) {
        expect(field.insufficient_evidence).toBe(true);
        expect(field.supporting_evidence_ids).toHaveLength(0);
      }
    }
  });

  it("derives journey stages from the evidence rather than listing all of them", () => {
    const result = generatePersona(personaContext());
    expect(result.journey_stages).toContain("evaluation");
    expect(result.journey_stages).toContain("problem_discovery");
    expect(result.journey_stages).not.toContain("retention");
  });

  it("attaches contradicting evidence to the claim it argues against", () => {
    const ctx = personaContext({
      contradicting: [
        personaEvidence({
          claim: "Customer data cannot leave our approved cloud environment in most cases",
          hedged: true,
          sourceId: "src_review",
          sourceType: "review",
          sourceLabel: "Reviews",
        }),
      ],
    });

    const result = generatePersona(ctx);
    expect(result.fields.some((field) => field.contradicting_evidence_ids.length > 0)).toBe(true);
  });
});
