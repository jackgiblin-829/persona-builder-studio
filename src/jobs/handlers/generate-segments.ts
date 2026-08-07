import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import {
  brandProducts,
  competitors,
  dataSources,
  evidenceRecords,
  segmentCandidateEvidence,
  segmentCandidates,
} from "@/db/schema";
import { getOpenAIAdapter } from "@/adapters/openai";
import { AppError } from "@/lib/errors";
import { newId, slugify, ID_PREFIXES } from "@/lib/ids";
import { CANDIDATE_SEGMENTATION, renderTemplate } from "@/prompts/registry";
import { segmentationSchema, SCHEMA_VERSION } from "@/prompts/schemas";
import { toStrictJsonSchema } from "@/prompts/json-schema";
import { recomputeSegmentConfidence } from "@/services/segments";
import { recordVendorUsage } from "@/services/usage";
import { JOB_TYPES, registerJob } from "../registry";
import { loadBrandContext } from "./ingest-source";

/**
 * Candidate segmentation (§13).
 *
 * Only approved, available evidence is sent, and only evidence ids that were
 * actually supplied are accepted back — a cited id the model invented is
 * dropped and counted rather than stored, because a segment resting on a
 * fabricated citation is worse than one segment fewer.
 *
 * Each run is written under its own `run_id`; previous runs are never modified.
 */
registerJob(JOB_TYPES.generateSegments, async ({ job }) => {
  const brandId = String(job.payload.brandId ?? "");
  const runId = String(job.payload.runId ?? "");
  const requestedByUserId = job.payload.requestedByUserId
    ? String(job.payload.requestedByUserId)
    : null;

  if (!brandId || !runId) {
    throw new AppError("validation", "generate_segments requires brandId and runId");
  }

  const brand = await loadBrandContext(brandId);

  const [existing] = await db
    .select({ id: segmentCandidates.id })
    .from(segmentCandidates)
    .where(eq(segmentCandidates.runId, runId))
    .limit(1);
  if (existing) {
    return { status: "succeeded", result: { skipped: "run already produced candidates" } };
  }

  const evidence = await db
    .select({
      id: evidenceRecords.id,
      claim: evidenceRecords.normalizedClaim,
      quote: evidenceRecords.redactedText,
      category: evidenceRecords.category,
      provenance: evidenceRecords.provenance,
      journeyStage: evidenceRecords.journeyStage,
      sourceId: evidenceRecords.dataSourceId,
      sourceLabel: dataSources.label,
      sourceType: evidenceRecords.sourceType,
      vocabulary: evidenceRecords.vocabulary,
      entities: evidenceRecords.entities,
      qualityScore: evidenceRecords.qualityScore,
      uncertaintyNote: evidenceRecords.uncertaintyNote,
      observedAt: evidenceRecords.observedAt,
      ingestedAt: evidenceRecords.ingestedAt,
    })
    .from(evidenceRecords)
    .innerJoin(dataSources, eq(dataSources.id, evidenceRecords.dataSourceId))
    .where(
      and(
        eq(evidenceRecords.brandId, brandId),
        eq(evidenceRecords.reviewStatus, "approved"),
        eq(evidenceRecords.availability, "available"),
      ),
    )
    .orderBy(evidenceRecords.id);

  if (evidence.length === 0) {
    throw new AppError(
      "validation",
      "No approved, available evidence exists for this brand, so no segment could be proposed.",
    );
  }

  // The cutoff is the newest observation the run could see. Stored on every
  // candidate so a later run is comparable (§33).
  const evidenceCutoff = evidence.reduce<Date>((latest, record) => {
    const stamp = record.observedAt ?? record.ingestedAt;
    return stamp > latest ? stamp : latest;
  }, new Date(0));

  const suppliedIds = new Set(evidence.map((record) => record.id));

  const [products, competitorRows] = await Promise.all([
    db
      .select({ name: brandProducts.name, description: brandProducts.description })
      .from(brandProducts)
      .where(eq(brandProducts.brandId, brandId)),
    db
      .select({ name: competitors.name, notes: competitors.notes })
      .from(competitors)
      .where(eq(competitors.brandId, brandId)),
  ]);

  const { adapter, mode } = await getOpenAIAdapter(brand.organizationId);
  const jsonSchema = toStrictJsonSchema(segmentationSchema, "Segmentation");
  const started = Date.now();

  const result = await adapter.generateStructured({
    templateId: CANDIDATE_SEGMENTATION.id,
    templateVersion: CANDIDATE_SEGMENTATION.version,
    schemaVersion: SCHEMA_VERSION,
    system: CANDIDATE_SEGMENTATION.system,
    user: renderTemplate(CANDIDATE_SEGMENTATION, {
      brand_context: [
        `Brand: ${brand.name} (${brand.canonicalDomain})`,
        `Description: ${brand.description}`,
        products.length > 0
          ? `Products: ${products.map((p) => `${p.name} — ${p.description ?? ""}`.trim()).join("; ")}`
          : "",
        competitorRows.length > 0
          ? `Competitors: ${competitorRows.map((c) => c.name).join(", ")}`
          : "",
        brand.strategicQuestions.length > 0
          ? `Strategic questions: ${brand.strategicQuestions.join(" | ")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
      evidence_summary: summariseEvidence(evidence),
      evidence_records: evidence
        .map(
          (record) =>
            `[${record.id}] (${record.category}/${record.provenance}/${record.journeyStage}, source: ${record.sourceLabel}) ${record.claim}`,
        )
        .join("\n"),
      // SparkToro and DataForSEO are not part of this milestone; the template
      // renders "(none supplied)" rather than pretending signals exist.
      sparktoro_signals: "",
      dataforseo_signals: "",
    }),
    schema: segmentationSchema,
    schemaName: "Segmentation",
    jsonSchema,
    modelTier: CANDIDATE_SEGMENTATION.modelTier,
    mockContext: {
      brandName: brand.name,
      referenceDate: evidenceCutoff.toISOString(),
      evidence: evidence.map((record) => ({
        id: record.id,
        claim: record.claim,
        quote: record.quote,
        category: record.category,
        provenance: record.provenance,
        sourceId: record.sourceId,
        sourceType: record.sourceType,
        journeyStage: record.journeyStage,
        qualityScore: record.qualityScore,
        vocabulary: record.vocabulary,
        hedged: record.uncertaintyNote !== null,
        observedAt: (record.observedAt ?? record.ingestedAt).toISOString(),
      })),
    },
  });

  await recordVendorUsage({
    organizationId: brand.organizationId,
    brandId,
    vendor: "openai",
    operation: "candidate_segmentation",
    mode,
    jobId: job.id,
    durationMs: Date.now() - started,
    retryCount: result.attempts - 1,
    outcome: "success",
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    costCents: result.costCents,
  });

  const usedSlugs = new Set<string>();
  const assigned = new Set<string>();
  let droppedCitations = 0;
  const createdIds: string[] = [];

  for (const candidate of result.data.segments) {
    const supporting = candidate.supporting_evidence_ids.filter((id) => suppliedIds.has(id));
    const contradicting = candidate.contradicting_evidence_ids.filter((id) => suppliedIds.has(id));
    droppedCitations +=
      candidate.supporting_evidence_ids.length -
      supporting.length +
      (candidate.contradicting_evidence_ids.length - contradicting.length);

    // A candidate with no verifiable supporting citation is not a candidate.
    if (supporting.length === 0) continue;

    const slug = uniqueSlug(slugify(candidate.slug || candidate.label), usedSlugs);
    const id = newId(ID_PREFIXES.segmentCandidate);
    createdIds.push(id);

    await db.insert(segmentCandidates).values({
      id,
      organizationId: brand.organizationId,
      brandId,
      runId,
      label: candidate.label,
      slug,
      definition: candidate.definition,
      distinguishingVariables: candidate.distinguishing_variables,
      whyItChangesPrompts: candidate.why_it_changes_prompts,
      coverageGaps: candidate.coverage_gaps,
      overlaps: candidate.overlaps.map((overlap) => ({
        segmentSlug: overlap.segment_slug,
        degree: overlap.degree,
        note: overlap.note,
      })),
      mergeSplitRecommendation: candidate.merge_split_recommendation,
      status: "candidate",
      modelProvider: result.modelProvider,
      modelId: result.modelId,
      promptTemplateVersion: CANDIDATE_SEGMENTATION.version,
      schemaVersion: SCHEMA_VERSION,
      dataOrigin: result.dataOrigin,
      evidenceCutoff,
      generatedByUserId: requestedByUserId,
    });

    for (const [relation, ids] of [
      ["supports", supporting] as const,
      ["contradicts", contradicting] as const,
    ]) {
      for (const evidenceId of new Set(ids)) {
        await db
          .insert(segmentCandidateEvidence)
          .values({
            id: newId(ID_PREFIXES.segmentCandidate),
            organizationId: brand.organizationId,
            segmentCandidateId: id,
            evidenceId,
            relation,
          })
          .onConflictDoNothing();
      }
    }

    for (const evidenceId of supporting) assigned.add(evidenceId);
  }

  if (createdIds.length === 0) {
    throw new AppError(
      "validation",
      "The segmentation produced no candidate backed by supplied evidence. Nothing was stored.",
    );
  }

  for (const id of createdIds) {
    await recomputeSegmentConfidence(id, { referenceDate: evidenceCutoff });
  }

  const labelled = await applySegmentLabels(brandId, createdIds);

  return {
    status: droppedCitations > 0 ? "partially_succeeded" : "succeeded",
    result: {
      runId,
      candidates: createdIds.length,
      evidenceConsidered: evidence.length,
      evidenceAssigned: assigned.size,
      evidenceUnassigned: evidence.length - assigned.size,
      droppedCitations,
      labelledRecords: labelled,
      modelId: result.modelId,
      dataOrigin: result.dataOrigin,
    },
  };
});

/**
 * Mirrors the run's segment slugs onto the evidence records they support, so the
 * evidence explorer's segment-label filter reflects the current run.
 *
 * Labels written by earlier runs are removed; labels a reviewer added by hand
 * are left alone, which is why the removal set is every slug this brand has ever
 * generated rather than "everything".
 */
async function applySegmentLabels(brandId: string, segmentIds: string[]): Promise<number> {
  const allSlugs = await db
    .select({ slug: segmentCandidates.slug })
    .from(segmentCandidates)
    .where(eq(segmentCandidates.brandId, brandId));
  const generated = new Set(allSlugs.map((row) => row.slug));
  if (generated.size === 0) return 0;

  const links = await db
    .select({ evidenceId: segmentCandidateEvidence.evidenceId, slug: segmentCandidates.slug })
    .from(segmentCandidateEvidence)
    .innerJoin(
      segmentCandidates,
      eq(segmentCandidates.id, segmentCandidateEvidence.segmentCandidateId),
    )
    .where(
      and(
        inArray(segmentCandidateEvidence.segmentCandidateId, segmentIds),
        eq(segmentCandidateEvidence.relation, "supports"),
      ),
    );

  const slugsByEvidence = new Map<string, Set<string>>();
  for (const link of links) {
    const set = slugsByEvidence.get(link.evidenceId) ?? new Set<string>();
    set.add(link.slug);
    slugsByEvidence.set(link.evidenceId, set);
  }

  // The set arithmetic runs here rather than in SQL: postgres-js binds a JS
  // array as separate positional parameters, so `= ANY(${array})` and
  // `unnest(${array})` both fail at runtime (the same trap that bit
  // `previewSourceDeletion` in milestone 2).
  const existing = await db
    .select({ id: evidenceRecords.id, labels: evidenceRecords.candidateSegmentLabels })
    .from(evidenceRecords)
    .where(eq(evidenceRecords.brandId, brandId));

  let updated = 0;
  for (const record of existing) {
    const manual = record.labels.filter((label) => !generated.has(label));
    const fromRun = slugsByEvidence.get(record.id) ?? new Set<string>();
    const next = [...new Set([...manual, ...fromRun])].sort();

    const current = [...record.labels].sort();
    if (next.length === current.length && next.every((label, i) => label === current[i])) continue;

    await db
      .update(evidenceRecords)
      .set({ candidateSegmentLabels: next })
      .where(eq(evidenceRecords.id, record.id));
    updated++;
  }

  return updated;
}

function summariseEvidence(
  evidence: { category: string; provenance: string; sourceLabel: string }[],
): string {
  const byCategory = new Map<string, number>();
  const byProvenance = new Map<string, number>();
  const bySource = new Map<string, number>();

  for (const record of evidence) {
    byCategory.set(record.category, (byCategory.get(record.category) ?? 0) + 1);
    byProvenance.set(record.provenance, (byProvenance.get(record.provenance) ?? 0) + 1);
    bySource.set(record.sourceLabel, (bySource.get(record.sourceLabel) ?? 0) + 1);
  }

  const render = (map: Map<string, number>) =>
    [...map.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .map(([key, value]) => `${key}: ${value}`)
      .join(", ");

  return [
    `${evidence.length} approved records`,
    `By category — ${render(byCategory)}`,
    `By provenance — ${render(byProvenance)}`,
    `By source — ${render(bySource)}`,
  ].join("\n");
}

function uniqueSlug(base: string, taken: Set<string>): string {
  let slug = base.slice(0, 80);
  let suffix = 2;
  while (taken.has(slug)) slug = `${base}-${suffix++}`.slice(0, 80);
  taken.add(slug);
  return slug;
}
