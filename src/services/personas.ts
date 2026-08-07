import "server-only";
import { and, asc, count, desc, eq, inArray, max, sql as raw } from "drizzle-orm";
import { z } from "zod";
import { db, type Executor } from "@/db/client";
import {
  dataSources,
  evidenceRecords,
  personaFieldEvidence,
  personaFields,
  personaVersions,
  personas,
  segmentCandidates,
  users,
} from "@/db/schema";
import { getQueue } from "@/adapters/queue";
import { JOB_TYPES } from "@/jobs/registry";
import { requireCapability, type BrandContext } from "@/lib/auth/context";
import { evaluateConfidence, rollUpConfidence, type ConfidenceEvidence } from "@/lib/confidence";
import { AppError, ImmutableError, NotFoundError, ValidationError } from "@/lib/errors";
import { newId, slugify, ID_PREFIXES } from "@/lib/ids";
import { PERSONA_FIELD_TYPES, PROVENANCE } from "@/prompts/schemas";
import { recordAudit } from "./audit";

/**
 * Personas (§14, §16).
 *
 * A persona is a stable identity; everything that can be reviewed lives on an
 * immutable version. Approved versions are never modified — every route that
 * writes goes through `assertMutable`, and revisions create a new version with
 * `parent_version_id` set so the lineage is inspectable.
 *
 * Confidence is recomputed by the application from the evidence links that
 * currently exist, so attaching, detaching or deleting evidence changes the
 * score immediately and visibly.
 */

export type PersonaFieldType = (typeof PERSONA_FIELD_TYPES)[number];

/**
 * Display order and copy for every field type.
 *
 * `scored` and `structural` are deliberately separate. A validation benchmark
 * cites the evidence it proposes to test, so it is traceable and gets an evidence
 * drawer (`structural: false`) — but it is a statement about how to test the
 * hypothesis, not a claim about the buyer, so scoring it would let
 * self-referential benchmarks inflate the persona's confidence (`scored: false`).
 */
export const FIELD_TYPE_META: Record<
  PersonaFieldType,
  {
    label: string;
    description: string;
    core: boolean;
    /** Counts toward the version's confidence roll-up. */
    scored: boolean;
    /** Carries no evidence by design, so it is rendered without a drawer. */
    structural: boolean;
  }
> = {
  job_to_be_done: {
    label: "Job to be done",
    description: "What this segment is trying to accomplish, in its own terms.",
    core: true,
    scored: true,
    structural: false,
  },
  constraint: {
    label: "Constraints",
    description: "Limits that cannot be negotiated away, and that decide product fit.",
    core: true,
    scored: true,
    structural: false,
  },
  success_metric: {
    label: "Success metrics",
    description: "How the buyer will judge whether the outcome was achieved.",
    core: true,
    scored: true,
    structural: false,
  },
  decision_criterion: {
    label: "Decision criteria",
    description: "What the choice between options actually turns on.",
    core: true,
    scored: true,
    structural: false,
  },
  vocabulary: {
    label: "Vocabulary",
    description: "The customer's own words, preserved rather than rewritten in brand language.",
    core: true,
    scored: true,
    structural: false,
  },
  recurring_question: {
    label: "Recurring questions",
    description: "Questions this segment asked, kept in their original form.",
    core: false,
    scored: true,
    structural: false,
  },
  objection: {
    label: "Objections",
    description: "Objections raised in the evidence, not anticipated ones.",
    core: false,
    scored: true,
    structural: false,
  },
  proof_preference: {
    label: "Proof preferences",
    description: "The evidence this segment asks for before it will proceed.",
    core: false,
    scored: true,
    structural: false,
  },
  distinguishing_topic: {
    label: "Distinguishing topics",
    description: "Concrete systems, standards and competitors this segment names.",
    core: false,
    scored: true,
    structural: false,
  },
  information_depth: {
    label: "Information depth",
    description: "How much detail an answer needs before it is useful to this segment.",
    core: false,
    scored: true,
    structural: false,
  },
  validation_benchmark: {
    label: "Validation benchmarks",
    description: "How the hypothesis gets tested, and what would falsify it.",
    core: false,
    scored: false,
    structural: false,
  },
  coverage_gap: {
    label: "Coverage gaps",
    description: "What the evidence does not support. A gap has no evidence by definition.",
    core: false,
    scored: false,
    structural: true,
  },
  excluded_assumption: {
    label: "Excluded assumptions",
    description: "Attributes this product refuses to infer, recorded so the refusal is visible.",
    core: false,
    scored: false,
    structural: true,
  },
  regeneration_trigger: {
    label: "Regeneration triggers",
    description: "Conditions that should invalidate this version.",
    core: false,
    scored: false,
    structural: true,
  },
};

export const FIELD_TYPE_ORDER = Object.keys(FIELD_TYPE_META) as PersonaFieldType[];

/**
 * Field types that are claims about the buyer, and therefore count toward the
 * version's confidence. Gaps, exclusions, triggers and validation benchmarks are
 * statements about scope and process; scoring them would let a persona look
 * stronger for being explicit about its own limits.
 */
export const CLAIM_FIELD_TYPES: PersonaFieldType[] = FIELD_TYPE_ORDER.filter(
  (type) => FIELD_TYPE_META[type].scored,
);

export const CORE_FIELD_TYPES: PersonaFieldType[] = FIELD_TYPE_ORDER.filter(
  (type) => FIELD_TYPE_META[type].core,
);

// ── Generation ──────────────────────────────────────────────────────────────

export async function startPersonaGeneration(
  ctx: BrandContext,
  segmentId: string,
): Promise<{ jobId: string; segmentLabel: string }> {
  requireCapability(ctx, "persona:generate");

  const [segment] = await db
    .select()
    .from(segmentCandidates)
    .where(
      and(
        eq(segmentCandidates.id, segmentId),
        eq(segmentCandidates.organizationId, ctx.organizationId),
        eq(segmentCandidates.brandId, ctx.brandId),
      ),
    )
    .limit(1);

  if (!segment) throw new NotFoundError("Candidate segment");
  if (segment.status !== "approved") {
    throw new ValidationError(
      "Approve the candidate segment before generating a persona from it — a persona inherits the segment's evidence and its coverage gaps.",
    );
  }

  const [existing] = await db
    .select({ id: personas.id })
    .from(personas)
    .where(and(eq(personas.brandId, ctx.brandId), eq(personas.segmentCandidateId, segmentId)))
    .limit(1);

  const job = await getQueue().enqueue(
    JOB_TYPES.generatePersona,
    {
      brandId: ctx.brandId,
      segmentCandidateId: segmentId,
      personaId: existing?.id ?? null,
      requestedByUserId: ctx.userId,
    },
    {
      organizationId: ctx.organizationId,
      brandId: ctx.brandId,
    },
  );

  await recordAudit({
    organizationId: ctx.organizationId,
    brandId: ctx.brandId,
    actorUserId: ctx.userId,
    action: "persona.generate",
    entityType: "segment_candidate",
    entityId: segmentId,
    metadata: { jobId: job.id, personaId: existing?.id ?? null },
  });

  return { jobId: job.id, segmentLabel: segment.label };
}

// ── Reads ───────────────────────────────────────────────────────────────────

export type PersonaListRow = {
  id: string;
  name: string;
  slug: string;
  segmentCandidateId: string | null;
  segmentLabel: string | null;
  currentVersion: number | null;
  currentStatus: string | null;
  currentVersionId: string | null;
  approvedVersion: number | null;
  overallConfidence: number;
  versionCount: number;
  needsReviewReason: string | null;
  fieldCount: number;
  insufficientCount: number;
  updatedAt: Date;
};

export async function listPersonas(ctx: BrandContext): Promise<PersonaListRow[]> {
  const rows = await db
    .select({
      id: personas.id,
      name: personas.name,
      slug: personas.slug,
      segmentCandidateId: personas.segmentCandidateId,
      segmentLabel: segmentCandidates.label,
      currentVersionId: personas.currentVersionId,
      currentVersion: personaVersions.version,
      currentStatus: personaVersions.status,
      overallConfidence: personaVersions.overallConfidence,
      needsReviewReason: personaVersions.needsReviewReason,
      updatedAt: personas.updatedAt,
      approvedVersion: raw<
        number | null
      >`(select pv.version from persona_versions pv where pv.id = ${personas.approvedVersionId})`,
      versionCount: raw<number>`(select count(*)::int from persona_versions pv where pv.persona_id = ${personas.id})`,
      fieldCount: raw<number>`(select count(*)::int from persona_fields pf where pf.persona_version_id = ${personas.currentVersionId})`,
      insufficientCount: raw<number>`(select count(*)::int from persona_fields pf where pf.persona_version_id = ${personas.currentVersionId} and pf.insufficient_evidence)`,
    })
    .from(personas)
    .leftJoin(personaVersions, eq(personaVersions.id, personas.currentVersionId))
    .leftJoin(segmentCandidates, eq(segmentCandidates.id, personas.segmentCandidateId))
    .where(and(eq(personas.organizationId, ctx.organizationId), eq(personas.brandId, ctx.brandId)))
    .orderBy(desc(personas.updatedAt));

  return rows.map((row) => ({
    ...row,
    overallConfidence: row.overallConfidence ?? 0,
  }));
}

export type FieldEvidenceRow = {
  evidenceId: string;
  relation: "supports" | "contradicts";
  unavailable: boolean;
  normalizedClaim: string;
  redactedText: string;
  category: string;
  provenance: string;
  journeyStage: string;
  sourceLabel: string;
  sourceType: string;
  sourceLocation: string;
  speaker: string | null;
  observedAt: Date | null;
  qualityScore: number;
  availability: string;
};

export type PersonaFieldWithEvidence = typeof personaFields.$inferSelect & {
  evidence: FieldEvidenceRow[];
};

export type PersonaDetail = {
  persona: typeof personas.$inferSelect;
  version: typeof personaVersions.$inferSelect;
  /** Grouped in `FIELD_TYPE_ORDER`, empty groups omitted. */
  groups: { fieldType: PersonaFieldType; fields: PersonaFieldWithEvidence[] }[];
  versions: {
    id: string;
    version: number;
    status: string;
    overallConfidence: number;
    createdAt: Date;
    changeSummary: string | null;
    approvedAt: Date | null;
  }[];
  segment: { id: string; label: string; slug: string; status: string } | null;
  generatedByName: string | null;
  approvedByName: string | null;
  /** True when this version can be edited: draft or needs_review, never approved. */
  mutable: boolean;
  coreCoverage: { fieldType: PersonaFieldType; supported: number; insufficient: number }[];
};

export async function getPersonaDetail(
  ctx: BrandContext,
  personaId: string,
  version?: number,
): Promise<PersonaDetail> {
  const [persona] = await db
    .select()
    .from(personas)
    .where(
      and(
        eq(personas.id, personaId),
        eq(personas.organizationId, ctx.organizationId),
        eq(personas.brandId, ctx.brandId),
      ),
    )
    .limit(1);
  if (!persona) throw new NotFoundError("Persona");

  const versionRows = await db
    .select({
      id: personaVersions.id,
      version: personaVersions.version,
      status: personaVersions.status,
      overallConfidence: personaVersions.overallConfidence,
      createdAt: personaVersions.createdAt,
      changeSummary: personaVersions.changeSummary,
      approvedAt: personaVersions.approvedAt,
    })
    .from(personaVersions)
    .where(eq(personaVersions.personaId, personaId))
    .orderBy(desc(personaVersions.version));

  const target =
    version !== undefined
      ? versionRows.find((row) => row.version === version)
      : (versionRows.find((row) => row.id === persona.currentVersionId) ?? versionRows[0]);
  if (!target) throw new NotFoundError("Persona version");

  const [full] = await db
    .select()
    .from(personaVersions)
    .where(eq(personaVersions.id, target.id))
    .limit(1);
  if (!full) throw new NotFoundError("Persona version");

  const fields = await loadFieldsWithEvidence(target.id);

  const groups = FIELD_TYPE_ORDER.map((fieldType) => ({
    fieldType,
    fields: fields.filter((field) => field.fieldType === fieldType),
  })).filter((group) => group.fields.length > 0);

  const [segment] = persona.segmentCandidateId
    ? await db
        .select({
          id: segmentCandidates.id,
          label: segmentCandidates.label,
          slug: segmentCandidates.slug,
          status: segmentCandidates.status,
        })
        .from(segmentCandidates)
        .where(eq(segmentCandidates.id, persona.segmentCandidateId))
        .limit(1)
    : [undefined];

  const [generatedBy, approvedBy] = await Promise.all([
    full.generatedByUserId ? userName(full.generatedByUserId) : Promise.resolve(null),
    full.approvedByUserId ? userName(full.approvedByUserId) : Promise.resolve(null),
  ]);

  return {
    persona,
    version: full,
    groups,
    versions: versionRows,
    segment: segment ?? null,
    generatedByName: generatedBy,
    approvedByName: approvedBy,
    mutable: full.status !== "approved",
    coreCoverage: CORE_FIELD_TYPES.map((fieldType) => {
      const ofType = fields.filter((field) => field.fieldType === fieldType);
      return {
        fieldType,
        supported: ofType.filter((field) => !field.insufficientEvidence).length,
        insufficient: ofType.filter((field) => field.insufficientEvidence).length,
      };
    }),
  };
}

async function userName(userId: string): Promise<string | null> {
  const [row] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.name ?? null;
}

/**
 * Exported for milestone 7's content workflows (`content-opportunities.ts`,
 * `content-brief.ts`, `page-audit.ts`): they need the same
 * field-plus-available-evidence assembly this module already does for the
 * persona detail screen, rather than a second query shape to keep in sync.
 */
export async function loadFieldsWithEvidence(
  personaVersionId: string,
  executor: Executor = db,
): Promise<PersonaFieldWithEvidence[]> {
  const fields = await executor
    .select()
    .from(personaFields)
    .where(eq(personaFields.personaVersionId, personaVersionId))
    .orderBy(asc(personaFields.sequence), asc(personaFields.createdAt));

  if (fields.length === 0) return [];

  const links = await executor
    .select({
      personaFieldId: personaFieldEvidence.personaFieldId,
      evidenceId: personaFieldEvidence.evidenceId,
      relation: personaFieldEvidence.relation,
      unavailable: personaFieldEvidence.unavailable,
      normalizedClaim: evidenceRecords.normalizedClaim,
      redactedText: evidenceRecords.redactedText,
      category: evidenceRecords.category,
      provenance: evidenceRecords.provenance,
      journeyStage: evidenceRecords.journeyStage,
      sourceLabel: dataSources.label,
      sourceType: evidenceRecords.sourceType,
      sourceLocation: evidenceRecords.sourceLocation,
      speaker: evidenceRecords.speaker,
      observedAt: evidenceRecords.observedAt,
      qualityScore: evidenceRecords.qualityScore,
      availability: evidenceRecords.availability,
    })
    .from(personaFieldEvidence)
    .innerJoin(evidenceRecords, eq(evidenceRecords.id, personaFieldEvidence.evidenceId))
    .innerJoin(dataSources, eq(dataSources.id, evidenceRecords.dataSourceId))
    .where(
      inArray(
        personaFieldEvidence.personaFieldId,
        fields.map((field) => field.id),
      ),
    )
    .orderBy(asc(personaFieldEvidence.relation), desc(evidenceRecords.qualityScore));

  const byField = new Map<string, FieldEvidenceRow[]>();
  for (const link of links) {
    const list = byField.get(link.personaFieldId) ?? [];
    list.push({
      evidenceId: link.evidenceId,
      relation: link.relation,
      unavailable: link.unavailable,
      normalizedClaim: link.normalizedClaim,
      redactedText: link.redactedText,
      category: link.category,
      provenance: link.provenance,
      journeyStage: link.journeyStage,
      sourceLabel: link.sourceLabel,
      sourceType: link.sourceType,
      sourceLocation: link.sourceLocation,
      speaker: link.speaker,
      observedAt: link.observedAt,
      qualityScore: link.qualityScore,
      availability: link.availability,
    });
    byField.set(link.personaFieldId, list);
  }

  return fields.map((field) => ({ ...field, evidence: byField.get(field.id) ?? [] }));
}

// ── Confidence ──────────────────────────────────────────────────────────────

/**
 * Recomputes every field's confidence in a version, then rolls the claim fields
 * up to a version score. Called after generation and after any evidence change.
 */
export async function recomputeVersionConfidence(
  personaVersionId: string,
  options: { tx?: Executor } = {},
): Promise<{ overall: number }> {
  const executor = options.tx ?? db;

  const [version] = await executor
    .select({
      id: personaVersions.id,
      brandId: personaVersions.brandId,
      evidenceCutoff: personaVersions.evidenceCutoff,
      personaId: personaVersions.personaId,
    })
    .from(personaVersions)
    .where(eq(personaVersions.id, personaVersionId))
    .limit(1);
  if (!version) throw new NotFoundError("Persona version");

  const referenceDate = version.evidenceCutoff ?? new Date(0);

  const fields = await executor
    .select({
      id: personaFields.id,
      fieldType: personaFields.fieldType,
      insufficientEvidence: personaFields.insufficientEvidence,
      markedUnsupported: personaFields.markedUnsupported,
    })
    .from(personaFields)
    .where(eq(personaFields.personaVersionId, personaVersionId));

  if (fields.length === 0) return { overall: 0 };

  const links = await executor
    .select({
      personaFieldId: personaFieldEvidence.personaFieldId,
      relation: personaFieldEvidence.relation,
      evidenceId: evidenceRecords.id,
      sourceId: evidenceRecords.dataSourceId,
      sourceLabel: dataSources.label,
      sourceType: evidenceRecords.sourceType,
      provenance: evidenceRecords.provenance,
      qualityScore: evidenceRecords.qualityScore,
      observedAt: evidenceRecords.observedAt,
      uncertaintyNote: evidenceRecords.uncertaintyNote,
      availability: evidenceRecords.availability,
    })
    .from(personaFieldEvidence)
    .innerJoin(evidenceRecords, eq(evidenceRecords.id, personaFieldEvidence.evidenceId))
    .innerJoin(dataSources, eq(dataSources.id, evidenceRecords.dataSourceId))
    .where(
      inArray(
        personaFieldEvidence.personaFieldId,
        fields.map((field) => field.id),
      ),
    );

  // Scope for the segment-coverage component: the sources the persona as a
  // whole draws on, so a field citing one of five sources scores 0.2.
  const scopeSources = new Set(
    links.filter((link) => link.availability === "available").map((link) => link.sourceId),
  ).size;

  const versionSourceMix: Record<string, number> = {};
  const scored: { confidence: number; insufficientEvidence: boolean }[] = [];

  for (const field of fields) {
    const own = links.filter((link) => link.personaFieldId === field.id);
    const available = own.filter((link) => link.availability === "available");
    const supporting = available.filter((link) => link.relation === "supports");
    const contradicting = available.filter((link) => link.relation === "contradicts");

    // A reviewer marking a claim unsupported overrides the evidence: the field
    // stays on the persona but scores zero and reads as a gap.
    const insufficient = field.insufficientEvidence || field.markedUnsupported;

    const result = evaluateConfidence({
      supporting: supporting.map(toConfidenceEvidence),
      contradicting: contradicting.map(toConfidenceEvidence),
      scopeSourceCount: scopeSources,
      insufficientEvidence: insufficient,
      referenceDate,
    });

    const sourceMix: Record<string, number> = {};
    for (const link of supporting) {
      sourceMix[link.sourceLabel] = (sourceMix[link.sourceLabel] ?? 0) + 1;
      versionSourceMix[link.sourceLabel] = (versionSourceMix[link.sourceLabel] ?? 0) + 1;
    }

    await executor
      .update(personaFields)
      .set({
        confidence: result.score,
        confidenceComponents: result.components,
        confidenceExplanation: result.explanation,
        evidenceCount: supporting.length,
        contradictionCount: contradicting.length,
        sourceMix,
        updatedAt: new Date(),
      })
      .where(eq(personaFields.id, field.id));

    if (CLAIM_FIELD_TYPES.includes(field.fieldType)) {
      scored.push({ confidence: result.score, insufficientEvidence: insufficient });
    }
  }

  const overall = rollUpConfidence(scored);

  await executor
    .update(personaVersions)
    .set({ overallConfidence: overall, sourceMix: versionSourceMix, updatedAt: new Date() })
    .where(eq(personaVersions.id, personaVersionId));

  return { overall };
}

function toConfidenceEvidence(link: {
  evidenceId: string;
  sourceId: string;
  sourceType: string;
  provenance: string;
  qualityScore: number;
  observedAt: Date | null;
  uncertaintyNote: string | null;
}): ConfidenceEvidence {
  return {
    id: link.evidenceId,
    sourceId: link.sourceId,
    sourceType: link.sourceType,
    provenance: link.provenance,
    qualityScore: link.qualityScore,
    observedAt: link.observedAt,
    hedged: link.uncertaintyNote !== null,
  };
}

// ── Mutation guards ─────────────────────────────────────────────────────────

type LoadedField = {
  field: typeof personaFields.$inferSelect;
  version: typeof personaVersions.$inferSelect;
};

/**
 * §33: an approved version is never overwritten. Every write path resolves the
 * field's version first and refuses if it is approved.
 */
async function loadFieldForWrite(
  ctx: BrandContext,
  fieldId: string,
  options: { allowLocked?: boolean } = {},
): Promise<LoadedField> {
  const [row] = await db
    .select({ field: personaFields, version: personaVersions })
    .from(personaFields)
    .innerJoin(personaVersions, eq(personaVersions.id, personaFields.personaVersionId))
    .where(
      and(
        eq(personaFields.id, fieldId),
        eq(personaFields.organizationId, ctx.organizationId),
        eq(personaVersions.brandId, ctx.brandId),
      ),
    )
    .limit(1);

  if (!row) throw new NotFoundError("Persona field");
  if (row.version.status === "approved") {
    throw new ImmutableError(`Persona version ${row.version.version}`);
  }
  if (row.field.locked && !options.allowLocked) {
    throw new AppError(
      "conflict",
      "This field is locked. Unlock it before editing, or create a new version.",
    );
  }
  return row;
}

async function loadVersionForWrite(
  ctx: BrandContext,
  personaVersionId: string,
): Promise<typeof personaVersions.$inferSelect> {
  const [version] = await db
    .select()
    .from(personaVersions)
    .where(
      and(
        eq(personaVersions.id, personaVersionId),
        eq(personaVersions.organizationId, ctx.organizationId),
        eq(personaVersions.brandId, ctx.brandId),
      ),
    )
    .limit(1);
  if (!version) throw new NotFoundError("Persona version");
  return version;
}

// ── Field mutations ─────────────────────────────────────────────────────────

export const fieldUpdateSchema = z.object({
  statement: z.string().trim().min(3).max(800),
  provenance: z.enum(PROVENANCE),
});

export async function updatePersonaField(
  ctx: BrandContext,
  fieldId: string,
  input: z.infer<typeof fieldUpdateSchema>,
): Promise<void> {
  requireCapability(ctx, "persona:generate");
  const { field, version } = await loadFieldForWrite(ctx, fieldId);

  await db
    .update(personaFields)
    .set({
      statement: input.statement,
      provenance: input.provenance,
      editedByUser: true,
      updatedAt: new Date(),
    })
    .where(eq(personaFields.id, fieldId));

  await recordAudit({
    organizationId: ctx.organizationId,
    brandId: ctx.brandId,
    actorUserId: ctx.userId,
    action: "persona.update",
    entityType: "persona_field",
    entityId: fieldId,
    metadata: { fieldType: field.fieldType, versionId: version.id },
  });
}

export async function attachFieldEvidence(
  ctx: BrandContext,
  fieldId: string,
  evidenceId: string,
  relation: "supports" | "contradicts",
): Promise<void> {
  requireCapability(ctx, "persona:generate");
  const { field, version } = await loadFieldForWrite(ctx, fieldId);

  const [evidence] = await db
    .select({ id: evidenceRecords.id, availability: evidenceRecords.availability })
    .from(evidenceRecords)
    .where(
      and(
        eq(evidenceRecords.id, evidenceId),
        eq(evidenceRecords.organizationId, ctx.organizationId),
        eq(evidenceRecords.brandId, ctx.brandId),
      ),
    )
    .limit(1);
  if (!evidence) throw new NotFoundError("Evidence record");

  await db
    .insert(personaFieldEvidence)
    .values({
      id: newId(ID_PREFIXES.personaField),
      organizationId: ctx.organizationId,
      personaFieldId: fieldId,
      evidenceId,
      relation,
      unavailable: evidence.availability !== "available",
    })
    .onConflictDoNothing();

  // Attaching evidence to a field marked insufficient is how a gap gets closed.
  if (relation === "supports" && field.insufficientEvidence) {
    await db
      .update(personaFields)
      .set({ insufficientEvidence: false, editedByUser: true, updatedAt: new Date() })
      .where(eq(personaFields.id, fieldId));
  }

  await recomputeVersionConfidence(version.id);

  await recordAudit({
    organizationId: ctx.organizationId,
    brandId: ctx.brandId,
    actorUserId: ctx.userId,
    action: "persona.update",
    entityType: "persona_field",
    entityId: fieldId,
    metadata: { attached: evidenceId, relation },
  });
}

export async function detachFieldEvidence(
  ctx: BrandContext,
  fieldId: string,
  evidenceId: string,
  relation: "supports" | "contradicts",
): Promise<void> {
  requireCapability(ctx, "persona:generate");
  const { version } = await loadFieldForWrite(ctx, fieldId);

  await db
    .delete(personaFieldEvidence)
    .where(
      and(
        eq(personaFieldEvidence.personaFieldId, fieldId),
        eq(personaFieldEvidence.evidenceId, evidenceId),
        eq(personaFieldEvidence.relation, relation),
      ),
    );

  const [remaining] = await db
    .select({ n: count() })
    .from(personaFieldEvidence)
    .where(
      and(
        eq(personaFieldEvidence.personaFieldId, fieldId),
        eq(personaFieldEvidence.relation, "supports"),
      ),
    );

  // A claim with no supporting evidence left must not keep a confident-looking
  // score: it becomes a declared gap.
  if ((remaining?.n ?? 0) === 0) {
    await db
      .update(personaFields)
      .set({ insufficientEvidence: true, editedByUser: true, updatedAt: new Date() })
      .where(eq(personaFields.id, fieldId));
  }

  await recomputeVersionConfidence(version.id);

  await recordAudit({
    organizationId: ctx.organizationId,
    brandId: ctx.brandId,
    actorUserId: ctx.userId,
    action: "persona.update",
    entityType: "persona_field",
    entityId: fieldId,
    metadata: { detached: evidenceId, relation },
  });
}

export async function markFieldUnsupported(
  ctx: BrandContext,
  fieldId: string,
  unsupported: boolean,
): Promise<void> {
  requireCapability(ctx, "persona:generate");
  const { version } = await loadFieldForWrite(ctx, fieldId);

  await db
    .update(personaFields)
    .set({ markedUnsupported: unsupported, editedByUser: true, updatedAt: new Date() })
    .where(eq(personaFields.id, fieldId));

  await recomputeVersionConfidence(version.id);

  await recordAudit({
    organizationId: ctx.organizationId,
    brandId: ctx.brandId,
    actorUserId: ctx.userId,
    action: "persona.update",
    entityType: "persona_field",
    entityId: fieldId,
    metadata: { markedUnsupported: unsupported },
  });
}

export async function setFieldLocked(
  ctx: BrandContext,
  fieldId: string,
  locked: boolean,
): Promise<void> {
  requireCapability(ctx, "persona:approve");
  // Locking is itself allowed on a locked field — otherwise it could never be
  // unlocked.
  await loadFieldForWrite(ctx, fieldId, { allowLocked: true });

  await db
    .update(personaFields)
    .set({ locked, updatedAt: new Date() })
    .where(eq(personaFields.id, fieldId));

  await recordAudit({
    organizationId: ctx.organizationId,
    brandId: ctx.brandId,
    actorUserId: ctx.userId,
    action: "persona.update",
    entityType: "persona_field",
    entityId: fieldId,
    metadata: { locked },
  });
}

// ── Version lifecycle ───────────────────────────────────────────────────────

/**
 * A version cannot be approved while a core field has no evidence: that is the
 * traceability guarantee the whole product rests on (§14, §41).
 */
export async function approvePersonaVersion(
  ctx: BrandContext,
  personaVersionId: string,
): Promise<{ blockers: string[] }> {
  requireCapability(ctx, "persona:approve");
  const version = await loadVersionForWrite(ctx, personaVersionId);
  if (version.status === "approved") {
    throw new ImmutableError(`Persona version ${version.version}`);
  }

  const fields = await db
    .select({
      fieldType: personaFields.fieldType,
      insufficientEvidence: personaFields.insufficientEvidence,
      markedUnsupported: personaFields.markedUnsupported,
      evidenceCount: personaFields.evidenceCount,
      statement: personaFields.statement,
    })
    .from(personaFields)
    .where(eq(personaFields.personaVersionId, personaVersionId));

  const blockers: string[] = [];

  for (const fieldType of CORE_FIELD_TYPES) {
    const ofType = fields.filter((field) => field.fieldType === fieldType);
    if (ofType.length === 0) {
      blockers.push(`${FIELD_TYPE_META[fieldType].label} is missing entirely.`);
      continue;
    }
    if (ofType.every((field) => field.insufficientEvidence || field.markedUnsupported)) {
      blockers.push(
        `${FIELD_TYPE_META[fieldType].label} has no supported entry — attach evidence or accept the gap by editing the statement.`,
      );
    }
  }

  const untraceable = fields.filter(
    (field) =>
      !FIELD_TYPE_META[field.fieldType].structural &&
      !field.insufficientEvidence &&
      !field.markedUnsupported &&
      field.evidenceCount === 0,
  );
  for (const field of untraceable.slice(0, 5)) {
    blockers.push(
      `"${field.statement.slice(0, 60)}" claims support but cites no available evidence. Attach evidence or mark it unsupported.`,
    );
  }

  if (blockers.length > 0) return { blockers };

  await db.transaction(async (tx) => {
    await tx
      .update(personaVersions)
      .set({
        status: "approved",
        approvedByUserId: ctx.userId,
        approvedAt: new Date(),
        rejectedReason: null,
        needsReviewReason: null,
        updatedAt: new Date(),
      })
      .where(eq(personaVersions.id, personaVersionId));

    await tx
      .update(personas)
      .set({
        approvedVersionId: personaVersionId,
        currentVersionId: personaVersionId,
        updatedAt: new Date(),
      })
      .where(eq(personas.id, version.personaId));
  });

  await recordAudit({
    organizationId: ctx.organizationId,
    brandId: ctx.brandId,
    actorUserId: ctx.userId,
    action: "persona.approve",
    entityType: "persona_version",
    entityId: personaVersionId,
    metadata: { version: version.version, personaId: version.personaId },
  });

  return { blockers: [] };
}

export async function rejectPersonaVersion(
  ctx: BrandContext,
  personaVersionId: string,
  reason: string,
): Promise<void> {
  requireCapability(ctx, "persona:approve");
  const version = await loadVersionForWrite(ctx, personaVersionId);
  if (version.status === "approved") {
    throw new ImmutableError(`Persona version ${version.version}`);
  }

  await db
    .update(personaVersions)
    .set({
      status: "rejected",
      rejectedReason: reason.trim().slice(0, 2000),
      updatedAt: new Date(),
    })
    .where(eq(personaVersions.id, personaVersionId));

  await recordAudit({
    organizationId: ctx.organizationId,
    brandId: ctx.brandId,
    actorUserId: ctx.userId,
    action: "persona.reject",
    entityType: "persona_version",
    entityId: personaVersionId,
    metadata: { version: version.version },
  });
}

/**
 * Creates the next version as a mutable copy of an existing one.
 *
 * The source version is left untouched — this is the only way to revise an
 * approved persona (§33). Locked fields stay locked in the copy, so a reviewer's
 * decision to freeze wording survives the revision.
 */
export async function createNewVersion(
  ctx: BrandContext,
  personaId: string,
  options: { fromVersionId?: string; changeSummary: string },
): Promise<{ versionId: string; version: number }> {
  requireCapability(ctx, "persona:generate");

  const [persona] = await db
    .select()
    .from(personas)
    .where(
      and(
        eq(personas.id, personaId),
        eq(personas.organizationId, ctx.organizationId),
        eq(personas.brandId, ctx.brandId),
      ),
    )
    .limit(1);
  if (!persona) throw new NotFoundError("Persona");

  const sourceId = options.fromVersionId ?? persona.currentVersionId;
  if (!sourceId) throw new ValidationError("This persona has no version to copy.");

  const source = await loadVersionForWrite(ctx, sourceId);

  const [existingDraft] = await db
    .select({ id: personaVersions.id, version: personaVersions.version })
    .from(personaVersions)
    .where(and(eq(personaVersions.personaId, personaId), eq(personaVersions.status, "draft")))
    .orderBy(desc(personaVersions.version))
    .limit(1);

  if (existingDraft) {
    throw new AppError(
      "conflict",
      `Version ${existingDraft.version} is already a draft. Approve or reject it before creating another version.`,
    );
  }

  const [maxRow] = await db
    .select({ n: max(personaVersions.version) })
    .from(personaVersions)
    .where(eq(personaVersions.personaId, personaId));
  const nextVersion = (maxRow?.n ?? 0) + 1;
  const newVersionId = newId(ID_PREFIXES.personaVersion);

  await db.transaction(async (tx) => {
    await tx.insert(personaVersions).values({
      id: newVersionId,
      organizationId: ctx.organizationId,
      brandId: ctx.brandId,
      personaId,
      version: nextVersion,
      name: source.name,
      segmentDefinition: source.segmentDefinition,
      journeyStages: source.journeyStages,
      informationDepth: source.informationDepth,
      summary: source.summary,
      excludedAssumptions: source.excludedAssumptions,
      status: "draft",
      overallConfidence: source.overallConfidence,
      evidenceCutoff: source.evidenceCutoff,
      sourceMix: source.sourceMix,
      modelProvider: source.modelProvider,
      modelId: source.modelId,
      promptTemplateVersion: source.promptTemplateVersion,
      schemaVersion: source.schemaVersion,
      dataOrigin: source.dataOrigin,
      generatedByUserId: ctx.userId,
      parentVersionId: source.id,
      changeSummary: options.changeSummary.trim().slice(0, 2000),
    });

    const sourceFields = await tx
      .select()
      .from(personaFields)
      .where(eq(personaFields.personaVersionId, source.id))
      .orderBy(asc(personaFields.sequence));

    for (const field of sourceFields) {
      const newFieldId = newId(ID_PREFIXES.personaField);
      await tx.insert(personaFields).values({
        id: newFieldId,
        organizationId: ctx.organizationId,
        personaVersionId: newVersionId,
        fieldType: field.fieldType,
        sequence: field.sequence,
        statement: field.statement,
        provenance: field.provenance,
        insufficientEvidence: field.insufficientEvidence,
        evidenceCount: field.evidenceCount,
        contradictionCount: field.contradictionCount,
        sourceMix: field.sourceMix,
        confidence: field.confidence,
        confidenceComponents: field.confidenceComponents,
        confidenceExplanation: field.confidenceExplanation,
        locked: field.locked,
        markedUnsupported: field.markedUnsupported,
        editedByUser: field.editedByUser,
      });

      const links = await tx
        .select()
        .from(personaFieldEvidence)
        .where(eq(personaFieldEvidence.personaFieldId, field.id));

      for (const link of links) {
        await tx.insert(personaFieldEvidence).values({
          id: newId(ID_PREFIXES.personaField),
          organizationId: ctx.organizationId,
          personaFieldId: newFieldId,
          evidenceId: link.evidenceId,
          relation: link.relation,
          unavailable: link.unavailable,
        });
      }
    }

    await tx
      .update(personas)
      .set({ currentVersionId: newVersionId, updatedAt: new Date() })
      .where(eq(personas.id, personaId));
  });

  await recomputeVersionConfidence(newVersionId);

  await recordAudit({
    organizationId: ctx.organizationId,
    brandId: ctx.brandId,
    actorUserId: ctx.userId,
    action: "persona.new_version",
    entityType: "persona_version",
    entityId: newVersionId,
    metadata: { personaId, version: nextVersion, parentVersionId: source.id },
  });

  return { versionId: newVersionId, version: nextVersion };
}

/** Duplicates a persona into a new identity, copying one version as its v1. */
export async function duplicatePersona(
  ctx: BrandContext,
  personaId: string,
  options: { fromVersionId?: string; name?: string } = {},
): Promise<{ personaId: string }> {
  requireCapability(ctx, "persona:generate");

  const [persona] = await db
    .select()
    .from(personas)
    .where(
      and(
        eq(personas.id, personaId),
        eq(personas.organizationId, ctx.organizationId),
        eq(personas.brandId, ctx.brandId),
      ),
    )
    .limit(1);
  if (!persona) throw new NotFoundError("Persona");

  const sourceId = options.fromVersionId ?? persona.currentVersionId;
  if (!sourceId) throw new ValidationError("This persona has no version to copy.");
  const source = await loadVersionForWrite(ctx, sourceId);

  const name = (options.name?.trim() || `${persona.name} (copy)`).slice(0, 120);
  const existingSlugs = await db
    .select({ slug: personas.slug })
    .from(personas)
    .where(eq(personas.brandId, ctx.brandId));
  const taken = new Set(existingSlugs.map((row) => row.slug));

  let slug = slugify(name);
  let suffix = 2;
  while (taken.has(slug)) slug = `${slugify(name)}-${suffix++}`.slice(0, 60);

  const newPersonaId = newId(ID_PREFIXES.persona);
  const newVersionId = newId(ID_PREFIXES.personaVersion);

  await db.transaction(async (tx) => {
    await tx.insert(personas).values({
      id: newPersonaId,
      organizationId: ctx.organizationId,
      brandId: ctx.brandId,
      name,
      slug,
      // The copy is not tied to the original segment: it is a new hypothesis a
      // reviewer intends to change.
      segmentCandidateId: null,
      currentVersionId: newVersionId,
    });

    await tx.insert(personaVersions).values({
      id: newVersionId,
      organizationId: ctx.organizationId,
      brandId: ctx.brandId,
      personaId: newPersonaId,
      version: 1,
      name,
      segmentDefinition: source.segmentDefinition,
      journeyStages: source.journeyStages,
      informationDepth: source.informationDepth,
      summary: source.summary,
      excludedAssumptions: source.excludedAssumptions,
      status: "draft",
      overallConfidence: source.overallConfidence,
      evidenceCutoff: source.evidenceCutoff,
      sourceMix: source.sourceMix,
      modelProvider: source.modelProvider,
      modelId: source.modelId,
      promptTemplateVersion: source.promptTemplateVersion,
      schemaVersion: source.schemaVersion,
      dataOrigin: source.dataOrigin,
      generatedByUserId: ctx.userId,
      changeSummary: `Duplicated from "${persona.name}" version ${source.version}.`,
    });

    const sourceFields = await tx
      .select()
      .from(personaFields)
      .where(eq(personaFields.personaVersionId, source.id))
      .orderBy(asc(personaFields.sequence));

    for (const field of sourceFields) {
      const newFieldId = newId(ID_PREFIXES.personaField);
      await tx.insert(personaFields).values({
        id: newFieldId,
        organizationId: ctx.organizationId,
        personaVersionId: newVersionId,
        fieldType: field.fieldType,
        sequence: field.sequence,
        statement: field.statement,
        provenance: field.provenance,
        insufficientEvidence: field.insufficientEvidence,
        evidenceCount: field.evidenceCount,
        contradictionCount: field.contradictionCount,
        sourceMix: field.sourceMix,
        confidence: field.confidence,
        confidenceComponents: field.confidenceComponents,
        confidenceExplanation: field.confidenceExplanation,
        // A duplicate is meant to be edited, so locks do not carry over.
        locked: false,
        markedUnsupported: field.markedUnsupported,
        editedByUser: field.editedByUser,
      });

      const links = await tx
        .select()
        .from(personaFieldEvidence)
        .where(eq(personaFieldEvidence.personaFieldId, field.id));

      for (const link of links) {
        await tx.insert(personaFieldEvidence).values({
          id: newId(ID_PREFIXES.personaField),
          organizationId: ctx.organizationId,
          personaFieldId: newFieldId,
          evidenceId: link.evidenceId,
          relation: link.relation,
          unavailable: link.unavailable,
        });
      }
    }
  });

  await recomputeVersionConfidence(newVersionId);

  await recordAudit({
    organizationId: ctx.organizationId,
    brandId: ctx.brandId,
    actorUserId: ctx.userId,
    action: "persona.new_version",
    entityType: "persona",
    entityId: newPersonaId,
    metadata: { duplicatedFrom: personaId, sourceVersion: source.version },
  });

  return { personaId: newPersonaId };
}

export async function renamePersona(
  ctx: BrandContext,
  personaId: string,
  name: string,
): Promise<void> {
  requireCapability(ctx, "persona:generate");
  const [persona] = await db
    .select()
    .from(personas)
    .where(
      and(
        eq(personas.id, personaId),
        eq(personas.organizationId, ctx.organizationId),
        eq(personas.brandId, ctx.brandId),
      ),
    )
    .limit(1);
  if (!persona) throw new NotFoundError("Persona");

  const clean = name.trim().slice(0, 120);
  if (clean.length < 3)
    throw new ValidationError("A persona name needs at least three characters.");

  // The slug is deliberately not changed: `persona:<slug>` tags are already
  // deployed to Profound and must stay stable across renames (§21).
  await db
    .update(personas)
    .set({ name: clean, updatedAt: new Date() })
    .where(eq(personas.id, personaId));

  if (persona.currentVersionId) {
    const [current] = await db
      .select({ status: personaVersions.status })
      .from(personaVersions)
      .where(eq(personaVersions.id, persona.currentVersionId))
      .limit(1);
    if (current && current.status !== "approved") {
      await db
        .update(personaVersions)
        .set({ name: clean, updatedAt: new Date() })
        .where(eq(personaVersions.id, persona.currentVersionId));
    }
  }

  await recordAudit({
    organizationId: ctx.organizationId,
    brandId: ctx.brandId,
    actorUserId: ctx.userId,
    action: "persona.update",
    entityType: "persona",
    entityId: personaId,
    metadata: { renamedTo: clean },
  });
}

// ── Version comparison ──────────────────────────────────────────────────────

export type FieldDiff = {
  fieldType: PersonaFieldType;
  change: "added" | "removed" | "changed" | "unchanged";
  before: {
    statement: string;
    confidence: number;
    evidenceCount: number;
    insufficientEvidence: boolean;
  } | null;
  after: {
    statement: string;
    confidence: number;
    evidenceCount: number;
    insufficientEvidence: boolean;
  } | null;
  /** Which aspects differ, for the UI to label precisely. */
  changedAspects: string[];
};

export type VersionComparison = {
  persona: typeof personas.$inferSelect;
  a: typeof personaVersions.$inferSelect;
  b: typeof personaVersions.$inferSelect;
  headerDiffs: { label: string; before: string; after: string }[];
  diffs: FieldDiff[];
  summary: { added: number; removed: number; changed: number; unchanged: number };
};

export async function comparePersonaVersions(
  ctx: BrandContext,
  personaId: string,
  versionA: number,
  versionB: number,
): Promise<VersionComparison> {
  const [persona] = await db
    .select()
    .from(personas)
    .where(
      and(
        eq(personas.id, personaId),
        eq(personas.organizationId, ctx.organizationId),
        eq(personas.brandId, ctx.brandId),
      ),
    )
    .limit(1);
  if (!persona) throw new NotFoundError("Persona");

  const rows = await db
    .select()
    .from(personaVersions)
    .where(
      and(
        eq(personaVersions.personaId, personaId),
        inArray(personaVersions.version, [versionA, versionB]),
      ),
    );

  const a = rows.find((row) => row.version === versionA);
  const b = rows.find((row) => row.version === versionB);
  if (!a || !b) throw new NotFoundError("Persona version");

  const [fieldsA, fieldsB] = await Promise.all([
    loadFieldsWithEvidence(a.id),
    loadFieldsWithEvidence(b.id),
  ]);

  const diffs: FieldDiff[] = [];

  for (const fieldType of FIELD_TYPE_ORDER) {
    const ofA = fieldsA.filter((field) => field.fieldType === fieldType);
    const ofB = fieldsB.filter((field) => field.fieldType === fieldType);
    const usedB = new Set<string>();

    for (const fieldA of ofA) {
      const key = normalizeStatement(fieldA.statement);
      const matched = ofB.find(
        (candidate) => !usedB.has(candidate.id) && normalizeStatement(candidate.statement) === key,
      );

      if (!matched) {
        diffs.push({
          fieldType,
          change: "removed",
          before: snapshot(fieldA),
          after: null,
          changedAspects: [],
        });
        continue;
      }

      usedB.add(matched.id);
      const aspects: string[] = [];
      if (Math.abs(matched.confidence - fieldA.confidence) >= 0.01) aspects.push("confidence");
      if (matched.evidenceCount !== fieldA.evidenceCount) aspects.push("evidence count");
      if (matched.contradictionCount !== fieldA.contradictionCount) aspects.push("contradictions");
      if (matched.insufficientEvidence !== fieldA.insufficientEvidence)
        aspects.push("insufficient marker");
      if (matched.provenance !== fieldA.provenance) aspects.push("provenance");
      if (matched.locked !== fieldA.locked) aspects.push("lock");

      diffs.push({
        fieldType,
        change: aspects.length > 0 ? "changed" : "unchanged",
        before: snapshot(fieldA),
        after: snapshot(matched),
        changedAspects: aspects,
      });
    }

    for (const fieldB of ofB) {
      if (usedB.has(fieldB.id)) continue;
      diffs.push({
        fieldType,
        change: "added",
        before: null,
        after: snapshot(fieldB),
        changedAspects: [],
      });
    }
  }

  const headerDiffs = [
    { label: "Name", before: a.name, after: b.name },
    { label: "Status", before: a.status, after: b.status },
    {
      label: "Overall confidence",
      before: a.overallConfidence.toFixed(2),
      after: b.overallConfidence.toFixed(2),
    },
    {
      label: "Segment definition",
      before: a.segmentDefinition,
      after: b.segmentDefinition,
    },
    {
      label: "Information depth",
      before: a.informationDepth ?? "—",
      after: b.informationDepth ?? "—",
    },
    {
      label: "Journey stages",
      before: a.journeyStages.join(", ") || "—",
      after: b.journeyStages.join(", ") || "—",
    },
    {
      label: "Evidence cutoff",
      before: a.evidenceCutoff?.toISOString().slice(0, 10) ?? "—",
      after: b.evidenceCutoff?.toISOString().slice(0, 10) ?? "—",
    },
    {
      label: "Prompt template",
      before: a.promptTemplateVersion ?? "—",
      after: b.promptTemplateVersion ?? "—",
    },
    { label: "Model", before: a.modelId ?? "—", after: b.modelId ?? "—" },
  ].filter((row) => row.before !== row.after);

  return {
    persona,
    a,
    b,
    headerDiffs,
    diffs,
    summary: {
      added: diffs.filter((diff) => diff.change === "added").length,
      removed: diffs.filter((diff) => diff.change === "removed").length,
      changed: diffs.filter((diff) => diff.change === "changed").length,
      unchanged: diffs.filter((diff) => diff.change === "unchanged").length,
    },
  };
}

function snapshot(field: typeof personaFields.$inferSelect) {
  return {
    statement: field.statement,
    confidence: field.confidence,
    evidenceCount: field.evidenceCount,
    insufficientEvidence: field.insufficientEvidence,
  };
}

function normalizeStatement(statement: string): string {
  return statement.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Approved persona versions for the brand — the picker milestone 7's content
 * workflows (opportunities, briefs, page audits) all need, since every one of
 * them requires an approved version rather than a persona's current draft.
 */
export async function listApprovedPersonaVersions(
  ctx: BrandContext,
): Promise<
  { personaId: string; personaName: string; personaVersionId: string; version: number }[]
> {
  const rows = await db
    .select({
      personaId: personas.id,
      personaName: personas.name,
      personaVersionId: personaVersions.id,
      version: personaVersions.version,
    })
    .from(personas)
    .innerJoin(personaVersions, eq(personaVersions.id, personas.approvedVersionId))
    .where(and(eq(personas.organizationId, ctx.organizationId), eq(personas.brandId, ctx.brandId)))
    .orderBy(asc(personas.name));
  return rows;
}

/**
 * Approved, available evidence a reviewer can attach to a field.
 *
 * Fetched once per page and filtered per field in the caller: a persona has
 * dozens of fields, and one query each would turn a page render into dozens of
 * round trips.
 */
export async function listApprovedEvidenceForAttachment(ctx: BrandContext, limit = 200) {
  return db
    .select({
      id: evidenceRecords.id,
      normalizedClaim: evidenceRecords.normalizedClaim,
      category: evidenceRecords.category,
      provenance: evidenceRecords.provenance,
      sourceLabel: dataSources.label,
    })
    .from(evidenceRecords)
    .innerJoin(dataSources, eq(dataSources.id, evidenceRecords.dataSourceId))
    .where(
      and(
        eq(evidenceRecords.organizationId, ctx.organizationId),
        eq(evidenceRecords.brandId, ctx.brandId),
        eq(evidenceRecords.reviewStatus, "approved"),
        eq(evidenceRecords.availability, "available"),
      ),
    )
    .orderBy(desc(evidenceRecords.qualityScore))
    .limit(limit);
}
