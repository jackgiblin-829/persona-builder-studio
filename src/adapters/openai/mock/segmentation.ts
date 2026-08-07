import { evaluateConfidence, type ConfidenceEvidence } from "@/lib/confidence";
import type { SegmentationResult, SegmentCandidateOutput } from "@/prompts/schemas";

/**
 * Deterministic rule-based candidate segmentation used in mock mode.
 *
 * Like the mock extractor, this is a real analyser rather than a fixture
 * lookup: it reads the supplied evidence, tests each record against a set of
 * segmentation dimensions, and only emits a candidate when enough records from
 * enough distinct sources actually cluster on that dimension. A pre-written
 * fixture would make the seeded workflow look convincing while proving nothing
 * about traceability.
 *
 * Two behaviours are deliberate and match §13:
 *
 * - Evidence is never forced into a segment. Records that match no dimension
 *   are reported back as unassigned so the UI can say so.
 * - One record may support several dimensions, because a security-led buyer's
 *   warehouse requirement is genuinely evidence for both.
 *
 * Same input, same output. No clock, no randomness — the reference date for
 * recency arrives in the context.
 */

export type SegmentationMockEvidence = {
  id: string;
  claim: string;
  quote: string;
  category: string;
  provenance: string;
  sourceId: string;
  sourceType: string;
  journeyStage: string;
  qualityScore: number;
  vocabulary: string[];
  hedged: boolean;
  observedAt: string | null;
};

export type SegmentationMockContext = {
  brandName: string;
  evidence: SegmentationMockEvidence[];
  /** Evidence cutoff, used as the recency reference point. */
  referenceDate: string;
};

type Dimension = {
  slug: string;
  label: string;
  /** Filled in with the observed evidence to produce the stored definition. */
  definition: string;
  distinguishingVariables: string[];
  whyItChangesPrompts: string;
  topicPatterns: RegExp[];
  /** Matches that argue against the segment's premise rather than for it. */
  counterPatterns: RegExp[];
  /** Categories a well-covered segment of this kind should contain. */
  expectedCategories: string[];
};

const DIMENSIONS: Dimension[] = [
  {
    slug: "security-led-deployment-buyer",
    label: "Security-led deployment buyer",
    definition:
      "Buyers whose evaluation is gated by where data physically lives and who must satisfy a security or architecture review before a commercial conversation can proceed. Deployment model is assessed before features.",
    distinguishingVariables: [
      "Primary constraint: data residency and deployment model",
      "Decision authority: security and architecture review hold a veto",
      "Proof requirement: certifications, architecture diagrams and pen-test summaries",
      "Journey stage: evaluation begins with an infrastructure gate",
    ],
    whyItChangesPrompts:
      "These buyers search for deployment and compliance qualifiers before they search for analytics capability, so their prompts lead with self-hosted, private-cloud, VPC and certification terms. A prompt set written for a cloud-first buyer never surfaces the answers this segment needs, and content that omits the deployment answer fails before features are read.",
    topicPatterns: [
      /\b(?:vpc|own cloud|approved cloud|our (?:own )?environment|air-?gapped)\b/i,
      /\b(?:self-?hosted|private cloud|on-?prem(?:ises)?|single-?tenant|data residency|residency)\b/i,
      /\b(?:soc\s?2|iso\s?27001|hipaa|gdpr|pen(?:etration)? test|attestation|certification)\b/i,
      /\b(?:architecture (?:review|diagram)|security (?:review|sign-?off|requirements?|team)|governance)\b/i,
      /\b(?:cannot leave|can'?t leave|must (?:stay|remain)|procurement)\b/i,
    ],
    counterPatterns: [/\bsecond-?class\b/i, /\bwould lag\b/i, /\bever change that\b/i],
    expectedCategories: ["constraint", "proof_requirement", "decision_criterion", "objection"],
  },
  {
    slug: "self-serve-adoption-owner",
    label: "Self-serve adoption owner",
    definition:
      "Owners of internal adoption who are measured on whether non-technical colleagues can answer their own questions. Their problem is not capability but the queue between a question and an answer.",
    distinguishingVariables: [
      "Job to be done: remove the data team from routine questions",
      "Primary constraint: onboarding effort and where work already happens",
      "Success metric: sustained usage by non-technical roles",
      "Responsibility: enablement rather than procurement",
    ],
    whyItChangesPrompts:
      "This segment asks how a tool gets used, not whether it can be bought. Their prompts are about onboarding time, self-service, templates and workflow integration, and the answer elements they need are training material and adoption evidence rather than certifications.",
    topicPatterns: [
      /\b(?:self-?serve|self-?service|onboard(?:ing)?|training|walkthrough|templates?)\b/i,
      /\b(?:adoption|actually using|who is (?:actually )?using|gave up)\b/i,
      /\b(?:without learning sql|learning sql|change a breakdown|filing a request|data team)\b/i,
      /\b(?:slack|where we work|lives outside|workflow)\b/i,
      // Leaving the tool you already work in is this segment's defining
      // friction, and it is usually described concretely rather than as
      // "workflow" — "another tab", "the planning tool", "a dashboard name".
      /\b(?:another tab|planning tool|context.switch\w*|remember a dashboard)\b/i,
      /\b(?:short (?:training )?videos|enablement)\b/i,
    ],
    counterPatterns: [/\bthree weeks to onboard\b/i],
    expectedCategories: ["job_to_be_done", "pain_point", "desired_outcome", "success_metric"],
  },
  {
    slug: "warehouse-integration-owner",
    label: "Warehouse and integration owner",
    definition:
      "Data engineers responsible for the pipeline the product depends on. They judge a tool by what it demands of the warehouse and by how visibly it fails when a sync breaks.",
    distinguishingVariables: [
      "Implementation environment: existing warehouse and transformation stack",
      "Primary constraint: setup work the tool imposes before value",
      "Proof requirement: failure behaviour and observability of syncs",
      "Journey stage: implementation and troubleshooting",
    ],
    whyItChangesPrompts:
      "Their prompts name concrete infrastructure — warehouse, sync, migration — and they need answers about prerequisites and failure modes. A prompt set that stops at product capability never reaches the question that decides whether implementation stalls.",
    topicPatterns: [
      /\b(?:snowflake|bigquery|redshift|dbt|warehouse|semantic layer)\b/i,
      // Deliberately narrow: a bare "integration" pulls in every workplace-app
      // question, which is a different segment's concern entirely.
      /\b(?:sync|data pipeline|reverse etl|etl|connector)\b/i,
      /\b(?:migrat(?:e|ion|ing)|stand up|provision)\b/i,
      /\b(?:fails? silently|keeps breaking|looks wrong|no visibility)\b/i,
    ],
    counterPatterns: [/\bnobody planned for\b/i],
    expectedCategories: [
      "implementation_requirement",
      "pain_point",
      "constraint",
      "proof_requirement",
    ],
  },
  {
    slug: "cost-constrained-small-team",
    label: "Cost-constrained small team",
    definition:
      "Small teams without a data function who compare total cost against setup effort at their own headcount. Read-only access and per-seat pricing are decisive rather than secondary.",
    distinguishingVariables: [
      "Customer type: small team, no dedicated data function",
      "Primary constraint: per-seat cost and setup time at low headcount",
      "Decision authority: a single buyer with a spreadsheet",
      "Maturity: first analytics purchase rather than a replacement",
    ],
    whyItChangesPrompts:
      "This segment prices and scopes before it evaluates, so their prompts combine cost, setup time and whether extra infrastructure is required. Enterprise-framed prompts and answers that assume a data team miss them entirely.",
    topicPatterns: [
      /\b(?:seat (?:price|licence|license)|per-?seat|read-?only viewers?|full seat)\b/i,
      /\b(?:headcount|monthly cost|setup time|budget|cannot justify|can'?t justify)\b/i,
      /\b(?:eleven-?person|small (?:team|company)|no data team|too small)\b/i,
      /\b(?:spreadsheet with|whether it needed a warehouse)\b/i,
    ],
    counterPatterns: [/\bnot certain\b/i],
    expectedCategories: ["constraint", "decision_criterion", "objection", "pain_point"],
  },
  {
    slug: "incumbent-replacement-buyer",
    label: "Incumbent replacement buyer",
    definition:
      "Buyers working against a renewal date on an existing reporting tool. The comparison is not against nothing but against a known incumbent whose weaknesses they can name.",
    distinguishingVariables: [
      "Journey stage: comparison against a named incumbent",
      "Primary constraint: renewal deadline",
      "Decision criterion: migration cost versus the pain of staying",
      "Desired outcome: production use before the renewal date",
    ],
    whyItChangesPrompts:
      "Their prompts are comparative and time-bound, naming the incumbent and asking about migration. Non-comparative prompts never appear in the answers this segment actually reads.",
    topicPatterns: [
      /\b(?:renew(?:s|al)?|contract renews|incumbent|another year)\b/i,
      /\b(?:replace a reporting|replace(?:ment)?|migrate from|instead of|switch(?:ing)? from)\b/i,
      /\b(?:tessellate|cobalt|perch|compared (?:to|with)|versus|\bvs\.?\b|alternative|shortlist)\b/i,
      /\b(?:deadline|within that window|five months)\b/i,
    ],
    counterPatterns: [/\bit'?s fine for\b/i],
    expectedCategories: ["comparison", "objection", "constraint", "decision_criterion"],
  },
];

/** A dimension needs this much clustered evidence before it becomes a candidate. */
const MIN_SUPPORTING = 3;
/** …from at least this many distinct sources, so one transcript cannot invent a segment. */
const MIN_DISTINCT_SOURCES = 2;
/** §13 caps candidates at seven. */
const MAX_CANDIDATES = 7;
/** Overlap below this is noise rather than a reviewable relationship. */
const OVERLAP_REPORTING_THRESHOLD = 0.08;
/** Above this the candidates are probably one segment. */
const MERGE_SUGGESTION_THRESHOLD = 0.5;

export type SegmentationMockResult = SegmentationResult & {
  /** Records that matched no dimension — never forced into a segment. */
  unassigned_evidence_ids: string[];
};

export function generateSegmentation(context: SegmentationMockContext): SegmentationResult {
  return { segments: analyse(context).segments };
}

/**
 * The full analysis, including the unassigned set. The job handler uses this so
 * it can report coverage honestly; the schema-validated adapter path uses
 * `generateSegmentation`, which returns only what the model contract allows.
 */
export function analyse(context: SegmentationMockContext): SegmentationMockResult {
  const referenceDate = new Date(context.referenceDate);
  const assigned = new Set<string>();

  type Cluster = {
    dimension: Dimension;
    supporting: SegmentationMockEvidence[];
    contradicting: SegmentationMockEvidence[];
  };

  const clusters: Cluster[] = [];

  for (const dimension of DIMENSIONS) {
    const supporting: SegmentationMockEvidence[] = [];
    const contradicting: SegmentationMockEvidence[] = [];

    for (const record of context.evidence) {
      const haystack = `${record.claim} ${record.quote} ${record.vocabulary.join(" ")}`;
      if (!dimension.topicPatterns.some((pattern) => pattern.test(haystack))) continue;

      // In scope for the dimension, but arguing against it: a hedged statement
      // or an explicit counter-signal weakens the segment rather than backing it.
      const counters =
        record.hedged || dimension.counterPatterns.some((pattern) => pattern.test(haystack));
      if (counters) contradicting.push(record);
      else supporting.push(record);
    }

    const distinctSources = new Set(supporting.map((item) => item.sourceId)).size;
    if (supporting.length < MIN_SUPPORTING || distinctSources < MIN_DISTINCT_SOURCES) continue;

    clusters.push({ dimension, supporting, contradicting });
  }

  // Strongest clusters first, then capped — a stable sort on (count, slug) keeps
  // the output deterministic when two clusters tie.
  clusters.sort(
    (a, b) =>
      b.supporting.length - a.supporting.length || a.dimension.slug.localeCompare(b.dimension.slug),
  );
  const selected = clusters.slice(0, MAX_CANDIDATES);

  for (const cluster of selected) {
    for (const record of cluster.supporting) assigned.add(record.id);
  }

  const segments: SegmentCandidateOutput[] = selected.map((cluster) => {
    const overlaps = selected
      .filter((other) => other.dimension.slug !== cluster.dimension.slug)
      .map((other) => ({
        segment_slug: other.dimension.slug,
        degree: jaccard(idsOf(cluster.supporting), idsOf(other.supporting)),
        note: sharedNote(cluster, other),
      }))
      .filter((overlap) => overlap.degree >= OVERLAP_REPORTING_THRESHOLD)
      .sort((a, b) => b.degree - a.degree || a.segment_slug.localeCompare(b.segment_slug))
      .slice(0, 10);

    const confidence = evaluateConfidence({
      supporting: cluster.supporting.map(toConfidenceEvidence),
      contradicting: cluster.contradicting.map(toConfidenceEvidence),
      scopeSourceCount: new Set(context.evidence.map((item) => item.sourceId)).size,
      referenceDate,
    });

    return {
      label: cluster.dimension.label,
      slug: cluster.dimension.slug,
      definition: cluster.dimension.definition,
      distinguishing_variables: cluster.dimension.distinguishingVariables,
      supporting_evidence_ids: idsOf(cluster.supporting),
      contradicting_evidence_ids: idsOf(cluster.contradicting),
      why_it_changes_prompts: cluster.dimension.whyItChangesPrompts,
      coverage_gaps: coverageGaps(cluster.dimension, cluster.supporting),
      overlaps,
      merge_split_recommendation: recommendation(cluster, overlaps),
      confidence_components: {
        first_party_strength: confidence.components.first_party_strength,
        cross_source_agreement: confidence.components.cross_source_agreement,
        evidence_quantity: confidence.components.evidence_quantity,
        evidence_specificity: confidence.components.evidence_specificity,
        recency: confidence.components.recency,
        segment_coverage: confidence.components.segment_coverage,
        external_support: confidence.components.external_support,
        contradiction_penalty: confidence.components.contradiction_penalty,
      },
      confidence_explanation: confidence.explanation,
    };
  });

  return {
    segments,
    unassigned_evidence_ids: context.evidence
      .filter((record) => !assigned.has(record.id))
      .map((record) => record.id),
  };
}

function coverageGaps(dimension: Dimension, supporting: SegmentationMockEvidence[]): string[] {
  const present = new Set(supporting.map((item) => item.category));
  const gaps: string[] = [];

  for (const category of dimension.expectedCategories) {
    if (!present.has(category)) {
      gaps.push(
        `No ${category.replace(/_/g, " ")} evidence: this segment is described without a record of that kind, so any claim about it would be inference.`,
      );
    }
  }

  const sources = new Set(supporting.map((item) => item.sourceId));
  if (sources.size < 3) {
    gaps.push(
      `Only ${sources.size} source${sources.size === 1 ? "" : "s"} contribute, so agreement across independent sources cannot be demonstrated.`,
    );
  }

  const firstParty = supporting.filter((item) =>
    ["interview", "sales_transcript", "support_ticket", "survey", "crm_note"].includes(
      item.sourceType,
    ),
  );
  if (firstParty.length === 0) {
    gaps.push(
      "No direct first-party evidence: the segment rests on aggregate or brand-authored material only.",
    );
  }

  return gaps.slice(0, 10);
}

function recommendation(
  cluster: { dimension: Dimension; supporting: SegmentationMockEvidence[] },
  overlaps: { segment_slug: string; degree: number }[],
): string | null {
  const strongest = overlaps[0];
  if (strongest && strongest.degree >= MERGE_SUGGESTION_THRESHOLD) {
    return `Consider merging with "${strongest.segment_slug}": ${Math.round(strongest.degree * 100)}% of the cited evidence is shared, which suggests one segment rather than two.`;
  }

  // A cluster spread across two well-populated journey stages is often two
  // segments wearing one label.
  const stageCounts = new Map<string, number>();
  for (const record of cluster.supporting) {
    stageCounts.set(record.journeyStage, (stageCounts.get(record.journeyStage) ?? 0) + 1);
  }
  const populated = [...stageCounts.entries()]
    .filter(([stage, count]) => count >= 3 && stage !== "unknown")
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));

  if (populated.length >= 2) {
    return `Consider splitting: the supporting evidence divides between the ${populated[0]![0].replace(/_/g, " ")} stage (${populated[0]![1]} records) and the ${populated[1]![0].replace(/_/g, " ")} stage (${populated[1]![1]} records), which may be two segments with different information needs.`;
  }

  return null;
}

function sharedNote(
  a: { dimension: Dimension; supporting: SegmentationMockEvidence[] },
  b: { dimension: Dimension; supporting: SegmentationMockEvidence[] },
): string {
  const shared = idsOf(a.supporting).filter((id) => idsOf(b.supporting).includes(id));
  return `${shared.length} record${shared.length === 1 ? "" : "s"} cited by both "${a.dimension.slug}" and "${b.dimension.slug}".`;
}

function idsOf(records: SegmentationMockEvidence[]): string[] {
  return records.map((record) => record.id);
}

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setB = new Set(b);
  const intersection = a.filter((id) => setB.has(id)).length;
  const union = new Set([...a, ...b]).size;
  return Math.round((intersection / union) * 1000) / 1000;
}

function toConfidenceEvidence(record: SegmentationMockEvidence): ConfidenceEvidence {
  return {
    id: record.id,
    sourceId: record.sourceId,
    sourceType: record.sourceType,
    provenance: record.provenance,
    qualityScore: record.qualityScore,
    observedAt: record.observedAt ? new Date(record.observedAt) : null,
    hedged: record.hedged,
  };
}

/** Exposed so tests can assert the thresholds rather than re-deriving them. */
export const SEGMENTATION_THRESHOLDS = {
  MIN_SUPPORTING,
  MIN_DISTINCT_SOURCES,
  MAX_CANDIDATES,
  OVERLAP_REPORTING_THRESHOLD,
  MERGE_SUGGESTION_THRESHOLD,
} as const;

export const SEGMENTATION_DIMENSION_SLUGS = DIMENSIONS.map((d) => d.slug);
