import "server-only";
import { and, count, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import {
  contentBriefs,
  contentOpportunities,
  dataSources,
  evidenceRecords,
  jobs,
  pageAudits,
  personaVersions,
  personas,
  profoundCategoryMappings,
  profoundPromptLinks,
  profoundResultBuckets,
  promptSetVersions,
  prompts,
  segmentCandidates,
} from "@/db/schema";
import type { BrandContext } from "@/lib/auth/context";

export type WorkflowStep = {
  key: string;
  label: string;
  href: string;
  done: boolean;
  detail: string;
};

/**
 * The 16-step demo workflow, rendered on the brand overview so a reviewer can
 * see exactly how far a brand has progressed and what is next.
 */
export type WorkflowCounts = {
  sources: number;
  evidence: number;
  reviewedEvidence: number;
  segments: number;
  approvedSegments: number;
  personas: number;
  approvedPersonas: number;
  personaPrompts: number;
  controlPrompts: number;
  approvedPromptSets: number;
  profoundLinks: number;
  categoryMapped: number;
  resultSnapshots: number;
  opportunities: number;
  briefs: number;
  audits: number;
  activeJobs: number;
};

export async function getWorkflowStatus(ctx: BrandContext): Promise<{
  steps: WorkflowStep[];
  counts: WorkflowCounts;
}> {
  const brandId = ctx.brandId;
  const base = `/brands/${brandId}`;
  const [
    sourceRows,
    evidenceRows,
    reviewedEvidenceRows,
    segmentRows,
    approvedSegmentRows,
    personaRows,
    approvedPersonaRows,
    promptRows,
    controlRows,
    approvedSetRows,
    linkRows,
    categoryMappingRows,
    snapshotRows,
    opportunityRows,
    briefRows,
    auditRows,
    activeJobRows,
  ] = await Promise.all([
    db.select({ n: count() }).from(dataSources).where(eq(dataSources.brandId, brandId)),
    db.select({ n: count() }).from(evidenceRecords).where(eq(evidenceRecords.brandId, brandId)),
    db
      .select({ n: count() })
      .from(evidenceRecords)
      .where(
        and(eq(evidenceRecords.brandId, brandId), eq(evidenceRecords.reviewStatus, "approved")),
      ),
    db.select({ n: count() }).from(segmentCandidates).where(eq(segmentCandidates.brandId, brandId)),
    db
      .select({ n: count() })
      .from(segmentCandidates)
      .where(and(eq(segmentCandidates.brandId, brandId), eq(segmentCandidates.status, "approved"))),
    db.select({ n: count() }).from(personas).where(eq(personas.brandId, brandId)),
    db
      .select({ n: count() })
      .from(personaVersions)
      .where(and(eq(personaVersions.brandId, brandId), eq(personaVersions.status, "approved"))),
    db
      .select({ n: count() })
      .from(prompts)
      .where(and(eq(prompts.brandId, brandId), eq(prompts.promptType, "persona"))),
    db
      .select({ n: count() })
      .from(prompts)
      .where(and(eq(prompts.brandId, brandId), eq(prompts.promptType, "generic_control"))),
    db
      .select({ n: count() })
      .from(promptSetVersions)
      .where(and(eq(promptSetVersions.brandId, brandId), eq(promptSetVersions.status, "approved"))),
    db
      .select({ n: count() })
      .from(profoundPromptLinks)
      .where(eq(profoundPromptLinks.brandId, brandId)),
    db
      .select({ n: count() })
      .from(profoundCategoryMappings)
      .where(eq(profoundCategoryMappings.brandId, brandId)),
    db
      .select({ n: count() })
      .from(profoundResultBuckets)
      .where(eq(profoundResultBuckets.brandId, brandId)),
    db
      .select({ n: count() })
      .from(contentOpportunities)
      .where(eq(contentOpportunities.brandId, brandId)),
    db.select({ n: count() }).from(contentBriefs).where(eq(contentBriefs.brandId, brandId)),
    db.select({ n: count() }).from(pageAudits).where(eq(pageAudits.brandId, brandId)),
    db
      .select({ n: count() })
      .from(jobs)
      .where(
        and(eq(jobs.brandId, brandId), inArray(jobs.status, ["queued", "running", "retrying"])),
      ),
  ]);

  const counts: WorkflowCounts = {
    sources: sourceRows[0]?.n ?? 0,
    evidence: evidenceRows[0]?.n ?? 0,
    reviewedEvidence: reviewedEvidenceRows[0]?.n ?? 0,
    segments: segmentRows[0]?.n ?? 0,
    approvedSegments: approvedSegmentRows[0]?.n ?? 0,
    personas: personaRows[0]?.n ?? 0,
    approvedPersonas: approvedPersonaRows[0]?.n ?? 0,
    personaPrompts: promptRows[0]?.n ?? 0,
    controlPrompts: controlRows[0]?.n ?? 0,
    approvedPromptSets: approvedSetRows[0]?.n ?? 0,
    profoundLinks: linkRows[0]?.n ?? 0,
    categoryMapped: categoryMappingRows[0]?.n ?? 0,
    resultSnapshots: snapshotRows[0]?.n ?? 0,
    opportunities: opportunityRows[0]?.n ?? 0,
    briefs: briefRows[0]?.n ?? 0,
    audits: auditRows[0]?.n ?? 0,
    activeJobs: activeJobRows[0]?.n ?? 0,
  };

  const steps: WorkflowStep[] = [
    {
      key: "sources",
      label: "Ingest evidence sources",
      href: `${base}/sources`,
      done: counts.sources > 0,
      detail: `${counts.sources} source${counts.sources === 1 ? "" : "s"}`,
    },
    {
      key: "evidence",
      label: "Inspect extracted evidence",
      href: `${base}/evidence`,
      done: counts.evidence > 0,
      detail: `${counts.evidence} records, ${counts.reviewedEvidence} approved`,
    },
    {
      key: "segments",
      label: "Generate candidate segments",
      href: `${base}/segments`,
      done: counts.segments > 0,
      detail: `${counts.segments} candidates, ${counts.approvedSegments} approved`,
    },
    {
      key: "personas",
      label: "Approve an evidence-backed persona",
      href: `${base}/personas`,
      done: counts.approvedPersonas > 0,
      detail: `${counts.approvedPersonas} approved of ${counts.personas} persona${counts.personas === 1 ? "" : "s"}`,
    },
    {
      key: "prompts",
      label: "Generate prompts and pair controls",
      href: `${base}/prompt-sets`,
      done: counts.personaPrompts > 0,
      detail: `${counts.personaPrompts} persona prompts, ${counts.controlPrompts} controls`,
    },
    {
      key: "mapping",
      label: "Map Profound category",
      href: `${base}/profound/export`,
      done: counts.categoryMapped > 0,
      detail: counts.categoryMapped > 0 ? "mapping configured" : "not configured",
    },
    {
      key: "export",
      label: "Export prompts and reconcile with Profound",
      href: `${base}/profound/export`,
      done: counts.profoundLinks > 0,
      detail: `${counts.profoundLinks} linked Profound prompt${counts.profoundLinks === 1 ? "" : "s"}`,
    },
    {
      key: "results",
      label: "Retrieve Profound results",
      href: `${base}/profound/performance`,
      done: counts.resultSnapshots > 0,
      detail: `${counts.resultSnapshots} result snapshots`,
    },
    {
      key: "opportunities",
      label: "Generate content opportunities",
      href: `${base}/opportunities`,
      done: counts.opportunities > 0,
      detail: `${counts.opportunities} opportunities`,
    },
    {
      key: "briefs",
      label: "Generate and export an SEO brief",
      href: `${base}/briefs`,
      done: counts.briefs > 0,
      detail: `${counts.briefs} briefs`,
    },
    {
      key: "audits",
      label: "Audit a homepage or landing page",
      href: `${base}/audits`,
      done: counts.audits > 0,
      detail: `${counts.audits} audits`,
    },
  ];

  return { steps, counts };
}

export async function getRecentJobs(brandId: string, limit = 8) {
  return db
    .select()
    .from(jobs)
    .where(eq(jobs.brandId, brandId))
    .orderBy(desc(jobs.createdAt))
    .limit(limit);
}
