import "server-only";
import { and, asc, desc, eq, max, ne } from "drizzle-orm";
import { db } from "@/db/client";
import {
  dataSources,
  evidenceRecords,
  personaFieldEvidence,
  personaFields,
  personaVersions,
  personas,
  segmentCandidateEvidence,
  segmentCandidates,
} from "@/db/schema";
import { getOpenAIAdapter } from "@/adapters/openai";
import { AppError } from "@/lib/errors";
import { newId, slugify, ID_PREFIXES } from "@/lib/ids";
import { CONFIDENCE_RUBRIC, PERSONA_SYNTHESIS, renderTemplate } from "@/prompts/registry";
import { personaSynthesisSchema, SCHEMA_VERSION } from "@/prompts/schemas";
import { toStrictJsonSchema } from "@/prompts/json-schema";
import { FIELD_TYPE_ORDER, recomputeVersionConfidence } from "@/services/personas";
import { recordVendorUsage } from "@/services/usage";
import { JOB_TYPES, registerJob } from "../registry";
import { loadBrandContext } from "./ingest-source";

/**
 * Persona synthesis for one approved segment (§14).
 *
 * The persona identity is stable and the version is new every time, so
 * regenerating never overwrites an approved version. Cited evidence ids are
 * checked against the ids actually supplied: anything else is dropped, and a
 * field left with no supporting citation is stored with the insufficient-
 * evidence marker rather than a confident-looking claim.
 */
registerJob(JOB_TYPES.generatePersona, async ({ job }) => {
  const brandId = String(job.payload.brandId ?? "");
  const segmentCandidateId = String(job.payload.segmentCandidateId ?? "");
  const requestedByUserId = job.payload.requestedByUserId
    ? String(job.payload.requestedByUserId)
    : null;

  if (!brandId || !segmentCandidateId) {
    throw new AppError("validation", "generate_persona requires brandId and segmentCandidateId");
  }

  const brand = await loadBrandContext(brandId);

  const [segment] = await db
    .select()
    .from(segmentCandidates)
    .where(eq(segmentCandidates.id, segmentCandidateId))
    .limit(1);
  if (!segment) throw new AppError("not_found", "The candidate segment no longer exists.");
  if (segment.status !== "approved") {
    throw new AppError(
      "validation",
      "The candidate segment is no longer approved, so no persona was generated.",
    );
  }

  const links = await db
    .select({
      relation: segmentCandidateEvidence.relation,
      id: evidenceRecords.id,
      claim: evidenceRecords.normalizedClaim,
      quote: evidenceRecords.redactedText,
      category: evidenceRecords.category,
      provenance: evidenceRecords.provenance,
      sourceId: evidenceRecords.dataSourceId,
      sourceLabel: dataSources.label,
      sourceType: evidenceRecords.sourceType,
      journeyStage: evidenceRecords.journeyStage,
      vocabulary: evidenceRecords.vocabulary,
      entities: evidenceRecords.entities,
      uncertaintyNote: evidenceRecords.uncertaintyNote,
      observedAt: evidenceRecords.observedAt,
      ingestedAt: evidenceRecords.ingestedAt,
      reviewStatus: evidenceRecords.reviewStatus,
    })
    .from(segmentCandidateEvidence)
    .innerJoin(evidenceRecords, eq(evidenceRecords.id, segmentCandidateEvidence.evidenceId))
    .innerJoin(dataSources, eq(dataSources.id, evidenceRecords.dataSourceId))
    .where(
      and(
        eq(segmentCandidateEvidence.segmentCandidateId, segmentCandidateId),
        eq(evidenceRecords.availability, "available"),
        eq(evidenceRecords.reviewStatus, "approved"),
      ),
    )
    .orderBy(asc(evidenceRecords.id));

  const supporting = links.filter((link) => link.relation === "supports");
  const contradicting = links.filter((link) => link.relation === "contradicts");

  if (supporting.length === 0) {
    throw new AppError(
      "validation",
      "This segment has no approved, available supporting evidence left. Re-run segmentation before generating a persona.",
    );
  }

  const suppliedIds = new Set(links.map((link) => link.id));
  const evidenceCutoff = links.reduce<Date>((latest, link) => {
    const stamp = link.observedAt ?? link.ingestedAt;
    return stamp > latest ? stamp : latest;
  }, new Date(0));

  const otherPersonas = await db
    .select({ id: personas.id, name: personas.name })
    .from(personas)
    .where(and(eq(personas.brandId, brandId), ne(personas.segmentCandidateId, segmentCandidateId)))
    .limit(10);

  const { adapter, mode } = await getOpenAIAdapter(brand.organizationId);
  const jsonSchema = toStrictJsonSchema(personaSynthesisSchema, "PersonaSynthesis");
  const started = Date.now();

  const result = await adapter.generateStructured({
    templateId: PERSONA_SYNTHESIS.id,
    templateVersion: PERSONA_SYNTHESIS.version,
    schemaVersion: SCHEMA_VERSION,
    system: PERSONA_SYNTHESIS.system,
    user: renderTemplate(PERSONA_SYNTHESIS, {
      brand_context: [
        `Brand: ${brand.name} (${brand.canonicalDomain})`,
        `Description: ${brand.description}`,
        brand.regulatedDomain
          ? "This brand operates in a regulated domain: never infer health, financial or other sensitive attributes."
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
      segment_candidate: [
        `Label: ${segment.label}`,
        `Definition: ${segment.definition}`,
        `Distinguishing variables: ${segment.distinguishingVariables.join("; ")}`,
        `Why it changes prompts: ${segment.whyItChangesPrompts}`,
        segment.coverageGaps.length > 0
          ? `Known coverage gaps: ${segment.coverageGaps.join(" | ")}`
          : "",
      ]
        .filter(Boolean)
        .join("\n"),
      first_party_evidence: renderEvidence(supporting),
      sparktoro_evidence: "",
      dataforseo_evidence: "",
      other_personas: otherPersonas.length > 0 ? otherPersonas.map((p) => p.name).join(", ") : "",
      confidence_rubric: CONFIDENCE_RUBRIC,
    }),
    schema: personaSynthesisSchema,
    schemaName: "PersonaSynthesis",
    jsonSchema,
    modelTier: PERSONA_SYNTHESIS.modelTier,
    mockContext: {
      brandName: brand.name,
      segmentLabel: segment.label,
      segmentDefinition: segment.definition,
      segmentDistinguishingVariables: segment.distinguishingVariables,
      segmentCoverageGaps: segment.coverageGaps,
      otherPersonaNames: otherPersonas.map((p) => p.name),
      supporting: supporting.map(toMockEvidence),
      contradicting: contradicting.map(toMockEvidence),
    },
  });

  await recordVendorUsage({
    organizationId: brand.organizationId,
    brandId,
    vendor: "openai",
    operation: "persona_synthesis",
    mode,
    jobId: job.id,
    durationMs: Date.now() - started,
    retryCount: result.attempts - 1,
    outcome: "success",
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    costCents: result.costCents,
  });

  const synthesis = result.data;

  // Resolve or create the persona identity. The slug is stable across versions
  // because `persona:<slug>` tags are deployed to Profound (§21).
  let personaId = job.payload.personaId ? String(job.payload.personaId) : "";
  if (personaId) {
    const [existing] = await db
      .select({ id: personas.id })
      .from(personas)
      .where(and(eq(personas.id, personaId), eq(personas.brandId, brandId)))
      .limit(1);
    if (!existing) personaId = "";
  }
  if (!personaId) {
    const [bySegment] = await db
      .select({ id: personas.id })
      .from(personas)
      .where(
        and(eq(personas.brandId, brandId), eq(personas.segmentCandidateId, segmentCandidateId)),
      )
      .limit(1);
    personaId = bySegment?.id ?? "";
  }

  if (!personaId) {
    const existingSlugs = await db
      .select({ slug: personas.slug })
      .from(personas)
      .where(eq(personas.brandId, brandId));
    const taken = new Set(existingSlugs.map((row) => row.slug));
    let slug = slugify(synthesis.name);
    let suffix = 2;
    while (taken.has(slug)) slug = `${slugify(synthesis.name)}-${suffix++}`.slice(0, 60);

    personaId = newId(ID_PREFIXES.persona);
    await db.insert(personas).values({
      id: personaId,
      organizationId: brand.organizationId,
      brandId,
      name: synthesis.name,
      slug,
      segmentCandidateId,
    });
  }

  const [maxRow] = await db
    .select({ n: max(personaVersions.version) })
    .from(personaVersions)
    .where(eq(personaVersions.personaId, personaId));
  const nextVersion = (maxRow?.n ?? 0) + 1;

  const [previous] = await db
    .select({ id: personaVersions.id, version: personaVersions.version })
    .from(personaVersions)
    .where(eq(personaVersions.personaId, personaId))
    .orderBy(desc(personaVersions.version))
    .limit(1);

  const versionId = newId(ID_PREFIXES.personaVersion);
  let droppedCitations = 0;
  let insufficientFields = 0;

  await db.transaction(async (tx) => {
    await tx.insert(personaVersions).values({
      id: versionId,
      organizationId: brand.organizationId,
      brandId,
      personaId,
      version: nextVersion,
      name: synthesis.name,
      segmentDefinition: synthesis.segment_definition,
      journeyStages: synthesis.journey_stages,
      informationDepth: synthesis.information_depth,
      summary: synthesis.summary,
      excludedAssumptions: synthesis.excluded_assumptions,
      status: "draft",
      evidenceCutoff,
      modelProvider: result.modelProvider,
      modelId: result.modelId,
      promptTemplateVersion: PERSONA_SYNTHESIS.version,
      schemaVersion: SCHEMA_VERSION,
      dataOrigin: result.dataOrigin,
      generatedByUserId: requestedByUserId,
      parentVersionId: previous?.id ?? null,
      changeSummary: previous
        ? `Regenerated from segment "${segment.label}" against ${supporting.length} supporting record(s); previous version ${previous.version} kept.`
        : `First synthesis from segment "${segment.label}" (${supporting.length} supporting record(s)).`,
    });

    // Fields are stored in the product's display order rather than the order
    // the model happened to emit, so two versions are comparable line by line.
    const ordered = [...synthesis.fields].sort(
      (a, b) => FIELD_TYPE_ORDER.indexOf(a.field_type) - FIELD_TYPE_ORDER.indexOf(b.field_type),
    );

    let sequence = 0;
    for (const field of ordered) {
      const supportingIds = [
        ...new Set(field.supporting_evidence_ids.filter((id) => suppliedIds.has(id))),
      ];
      const contradictingIds = [
        ...new Set(field.contradicting_evidence_ids.filter((id) => suppliedIds.has(id))),
      ];
      droppedCitations +=
        field.supporting_evidence_ids.length -
        supportingIds.length +
        (field.contradicting_evidence_ids.length - contradictingIds.length);

      // The invariant: a field either cites available evidence or carries the
      // insufficient marker. There is no third state.
      const insufficient = field.insufficient_evidence || supportingIds.length === 0;
      if (insufficient) insufficientFields++;

      const fieldId = newId(ID_PREFIXES.personaField);
      await tx.insert(personaFields).values({
        id: fieldId,
        organizationId: brand.organizationId,
        personaVersionId: versionId,
        fieldType: field.field_type,
        sequence: sequence++,
        statement: field.statement,
        provenance: insufficient ? "inferred" : field.provenance,
        insufficientEvidence: insufficient,
        confidenceExplanation: field.confidence_explanation,
      });

      for (const [relation, ids] of [
        ["supports", supportingIds] as const,
        ["contradicts", contradictingIds] as const,
      ]) {
        for (const evidenceId of ids) {
          await tx
            .insert(personaFieldEvidence)
            .values({
              id: newId(ID_PREFIXES.personaField),
              organizationId: brand.organizationId,
              personaFieldId: fieldId,
              evidenceId,
              relation,
            })
            .onConflictDoNothing();
        }
      }
    }

    await tx
      .update(personas)
      .set({ currentVersionId: versionId, updatedAt: new Date() })
      .where(eq(personas.id, personaId));
  });

  const { overall } = await recomputeVersionConfidence(versionId);

  return {
    status: droppedCitations > 0 ? "partially_succeeded" : "succeeded",
    result: {
      personaId,
      versionId,
      version: nextVersion,
      fields: synthesis.fields.length,
      insufficientFields,
      droppedCitations,
      overallConfidence: overall,
      supportingEvidence: supporting.length,
      contradictingEvidence: contradicting.length,
      modelId: result.modelId,
      dataOrigin: result.dataOrigin,
    },
  };
});

type EvidenceLink = {
  id: string;
  claim: string;
  quote: string;
  category: string;
  provenance: string;
  sourceId: string;
  sourceLabel: string;
  sourceType: string;
  journeyStage: string;
  vocabulary: string[];
  entities: string[];
  uncertaintyNote: string | null;
};

function toMockEvidence(link: EvidenceLink) {
  return {
    id: link.id,
    claim: link.claim,
    quote: link.quote,
    category: link.category,
    provenance: link.provenance,
    sourceId: link.sourceId,
    sourceType: link.sourceType,
    sourceLabel: link.sourceLabel,
    journeyStage: link.journeyStage,
    vocabulary: link.vocabulary,
    entities: link.entities,
    hedged: link.uncertaintyNote !== null,
  };
}

function renderEvidence(records: EvidenceLink[]): string {
  return records
    .map(
      (record) =>
        `[${record.id}] (${record.category}/${record.provenance}, ${record.sourceLabel}) ${record.claim}` +
        (record.uncertaintyNote ? ` — note: ${record.uncertaintyNote}` : ""),
    )
    .join("\n");
}
