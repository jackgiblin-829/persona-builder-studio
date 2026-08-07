import "server-only";
import { and, asc, count, desc, eq, inArray, max, sql as raw } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import {
  brands,
  dataSources,
  evidenceRecords,
  jobs,
  personaFields,
  personaVersions,
  personas,
  promptEvidence,
  promptPairs,
  promptSetVersions,
  promptSets,
  prompts,
  users,
} from "@/db/schema";
import { getQueue } from "@/adapters/queue";
import { recomputeDuplicateWarnings } from "@/jobs/handlers/embed-prompts";
import { JOB_TYPES } from "@/jobs/registry";
import { requireCapability, type BrandContext } from "@/lib/auth/context";
import { AppError, ImmutableError, NotFoundError, ValidationError } from "@/lib/errors";
import { newId, ID_PREFIXES } from "@/lib/ids";
import { buildPromptMetadata } from "@/lib/profound-tags";
import { promptHash } from "@/lib/prompt-dedupe";
import {
  INTENT_ORDER,
  PROMPT_INTENT_LABELS,
  STAGE_ORDER,
  type PromptEvidenceRow,
  type PromptRow,
} from "@/lib/prompt-display";
import { PROMPT_INTENTS } from "@/prompts/schemas";
import { recordAudit } from "./audit";

/**
 * Prompt sets (§17, §18).
 *
 * A prompt set is a stable identity per persona; everything reviewable lives on
 * an immutable version. The rules mirror personas deliberately — the same
 * reviewer learns one model, and the same guarantee (an approved artefact is
 * never rewritten) holds across both.
 *
 * The traceability invariant for prompts is narrower than for personas but
 * absolute: **a prompt must cite at least one available evidence record.**
 * Personas can carry an explicit "insufficient evidence" gap because a gap is
 * informative. A prompt cannot: an uncited prompt is a keyword guess, and
 * deploying it to Profound would measure the brand's assumptions rather than the
 * segment's questions.
 */

export { INTENT_ORDER, PROMPT_INTENT_LABELS, STAGE_ORDER, type PromptEvidenceRow, type PromptRow };

// ── Generation ──────────────────────────────────────────────────────────────

export async function startPromptGeneration(
  ctx: BrandContext,
  personaId: string,
): Promise<{ jobId: string; personaName: string; personaVersion: number }> {
  requireCapability(ctx, "prompt:generate");

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

  if (!persona.approvedVersionId) {
    throw new ValidationError(
      "Approve a persona version before generating prompts from it — prompts inherit the persona's claims, and an unapproved claim would become a tracked prompt.",
    );
  }

  const [version] = await db
    .select({ id: personaVersions.id, version: personaVersions.version })
    .from(personaVersions)
    .where(eq(personaVersions.id, persona.approvedVersionId))
    .limit(1);
  if (!version) throw new NotFoundError("Approved persona version");

  const job = await getQueue().enqueue(
    JOB_TYPES.generatePrompts,
    {
      brandId: ctx.brandId,
      personaVersionId: version.id,
      requestedByUserId: ctx.userId,
    },
    { organizationId: ctx.organizationId, brandId: ctx.brandId },
  );

  await recordAudit({
    organizationId: ctx.organizationId,
    brandId: ctx.brandId,
    actorUserId: ctx.userId,
    action: "prompt_set.generate",
    entityType: "persona_version",
    entityId: version.id,
    metadata: { jobId: job.id, personaId },
  });

  return { jobId: job.id, personaName: persona.name, personaVersion: version.version };
}

export async function activePromptJobs(ctx: BrandContext) {
  return db
    .select({
      id: jobs.id,
      type: jobs.type,
      status: jobs.status,
      lastError: jobs.lastError,
      createdAt: jobs.createdAt,
    })
    .from(jobs)
    .where(
      and(
        eq(jobs.brandId, ctx.brandId),
        inArray(jobs.type, [JOB_TYPES.generatePrompts, JOB_TYPES.embedPrompts]),
        inArray(jobs.status, ["queued", "running", "retrying", "failed"]),
      ),
    )
    .orderBy(desc(jobs.createdAt))
    .limit(5);
}

/** Approved personas that have no prompt set yet — the "what's next" list. */
export async function listPersonasAwaitingPrompts(ctx: BrandContext) {
  const rows = await db
    .select({
      id: personas.id,
      name: personas.name,
      slug: personas.slug,
      approvedVersion: personaVersions.version,
      overallConfidence: personaVersions.overallConfidence,
      promptSetId: promptSets.id,
    })
    .from(personas)
    .innerJoin(personaVersions, eq(personaVersions.id, personas.approvedVersionId))
    .leftJoin(promptSets, eq(promptSets.personaId, personas.id))
    .where(and(eq(personas.organizationId, ctx.organizationId), eq(personas.brandId, ctx.brandId)))
    .orderBy(asc(personas.name));

  return rows;
}

// ── Reads ───────────────────────────────────────────────────────────────────

export type PromptSetListRow = {
  id: string;
  name: string;
  slug: string;
  personaId: string;
  personaName: string;
  personaSlug: string;
  currentVersion: number | null;
  currentVersionId: string | null;
  currentStatus: string | null;
  approvedVersion: number | null;
  versionCount: number;
  promptCount: number;
  controlCount: number;
  approvedPrompts: number;
  pendingPrompts: number;
  duplicateWarnings: number;
  updatedAt: Date;
};

export async function listPromptSets(ctx: BrandContext): Promise<PromptSetListRow[]> {
  const rows = await db
    .select({
      id: promptSets.id,
      name: promptSets.name,
      slug: promptSets.slug,
      personaId: promptSets.personaId,
      personaName: personas.name,
      personaSlug: personas.slug,
      currentVersionId: promptSets.currentVersionId,
      currentVersion: promptSetVersions.version,
      currentStatus: promptSetVersions.status,
      promptCount: promptSetVersions.promptCount,
      controlCount: promptSetVersions.controlCount,
      updatedAt: promptSets.updatedAt,
      approvedVersion: raw<
        number | null
      >`(select psv.version from prompt_set_versions psv where psv.id = ${promptSets.approvedVersionId})`,
      versionCount: raw<number>`(select count(*)::int from prompt_set_versions psv where psv.prompt_set_id = ${promptSets.id})`,
      approvedPrompts: raw<number>`(select count(*)::int from prompts p where p.prompt_set_version_id = ${promptSets.currentVersionId} and p.review_status = 'approved')`,
      pendingPrompts: raw<number>`(select count(*)::int from prompts p where p.prompt_set_version_id = ${promptSets.currentVersionId} and p.review_status = 'pending_review')`,
      duplicateWarnings: raw<number>`(select count(*)::int from prompts p where p.prompt_set_version_id = ${promptSets.currentVersionId} and p.similarity_warning is not null)`,
    })
    .from(promptSets)
    .innerJoin(personas, eq(personas.id, promptSets.personaId))
    .leftJoin(promptSetVersions, eq(promptSetVersions.id, promptSets.currentVersionId))
    .where(
      and(eq(promptSets.organizationId, ctx.organizationId), eq(promptSets.brandId, ctx.brandId)),
    )
    .orderBy(desc(promptSets.updatedAt));

  // The counts come from a left join, so a set whose current version was
  // deleted reads as zero rather than null.
  return rows.map((row) => ({
    ...row,
    promptCount: row.promptCount ?? 0,
    controlCount: row.controlCount ?? 0,
  }));
}

/**
 * Approved prompt-set versions for the brand — the picker milestone 7's
 * content workflows need alongside `listApprovedPersonaVersions`.
 */
export async function listApprovedPromptSetVersions(ctx: BrandContext): Promise<
  {
    promptSetId: string;
    promptSetName: string;
    promptSetVersionId: string;
    version: number;
    personaVersionId: string;
  }[]
> {
  return db
    .select({
      promptSetId: promptSets.id,
      promptSetName: promptSets.name,
      promptSetVersionId: promptSetVersions.id,
      version: promptSetVersions.version,
      personaVersionId: promptSetVersions.personaVersionId,
    })
    .from(promptSets)
    .innerJoin(promptSetVersions, eq(promptSetVersions.id, promptSets.approvedVersionId))
    .where(
      and(eq(promptSets.organizationId, ctx.organizationId), eq(promptSets.brandId, ctx.brandId)),
    )
    .orderBy(asc(promptSets.name));
}

export type PromptSetDetail = {
  set: typeof promptSets.$inferSelect;
  version: typeof promptSetVersions.$inferSelect;
  versions: { id: string; version: number; status: string; promptCount: number }[];
  persona: { id: string; name: string; slug: string };
  personaVersion: { id: string; version: number; name: string; status: string };
  personaPrompts: PromptRow[];
  controls: PromptRow[];
  byIntent: { intent: string; label: string; prompts: PromptRow[] }[];
  byStage: { stage: string; prompts: PromptRow[] }[];
  counts: {
    total: number;
    persona: number;
    controls: number;
    approved: number;
    rejected: number;
    pending: number;
    paired: number;
    duplicateWarnings: number;
    exactDuplicates: number;
    edited: number;
  };
  generatedByName: string | null;
  approvedByName: string | null;
  editable: boolean;
};

export async function getPromptSetDetail(
  ctx: BrandContext,
  promptSetId: string,
  version?: number,
): Promise<PromptSetDetail> {
  const [set] = await db
    .select()
    .from(promptSets)
    .where(
      and(
        eq(promptSets.id, promptSetId),
        eq(promptSets.organizationId, ctx.organizationId),
        eq(promptSets.brandId, ctx.brandId),
      ),
    )
    .limit(1);
  if (!set) throw new NotFoundError("Prompt set");

  const versions = await db
    .select({
      id: promptSetVersions.id,
      version: promptSetVersions.version,
      status: promptSetVersions.status,
      promptCount: promptSetVersions.promptCount,
    })
    .from(promptSetVersions)
    .where(eq(promptSetVersions.promptSetId, promptSetId))
    .orderBy(desc(promptSetVersions.version));

  const targetId =
    version === undefined
      ? (set.currentVersionId ?? versions[0]?.id)
      : versions.find((row) => row.version === version)?.id;
  if (!targetId) throw new NotFoundError("Prompt-set version");

  const [versionRow] = await db
    .select()
    .from(promptSetVersions)
    .where(eq(promptSetVersions.id, targetId))
    .limit(1);
  if (!versionRow) throw new NotFoundError("Prompt-set version");

  const [persona] = await db
    .select({ id: personas.id, name: personas.name, slug: personas.slug })
    .from(personas)
    .where(eq(personas.id, set.personaId))
    .limit(1);
  if (!persona) throw new NotFoundError("Persona");

  const [personaVersion] = await db
    .select({
      id: personaVersions.id,
      version: personaVersions.version,
      name: personaVersions.name,
      status: personaVersions.status,
    })
    .from(personaVersions)
    .where(eq(personaVersions.id, versionRow.personaVersionId))
    .limit(1);
  if (!personaVersion) throw new NotFoundError("Persona version");

  const promptRows = await db
    .select()
    .from(prompts)
    .where(eq(prompts.promptSetVersionId, targetId))
    .orderBy(asc(prompts.intent), asc(prompts.createdAt), asc(prompts.id));

  const promptIds = promptRows.map((row) => row.id);

  const evidenceRows =
    promptIds.length === 0
      ? []
      : await db
          .select({
            promptId: promptEvidence.promptId,
            unavailable: promptEvidence.unavailable,
            evidenceId: evidenceRecords.id,
            normalizedClaim: evidenceRecords.normalizedClaim,
            redactedText: evidenceRecords.redactedText,
            category: evidenceRecords.category,
            provenance: evidenceRecords.provenance,
            journeyStage: evidenceRecords.journeyStage,
            sourceLabel: dataSources.label,
            sourceLocation: evidenceRecords.sourceLocation,
            speaker: evidenceRecords.speaker,
            observedAt: evidenceRecords.observedAt,
            availability: evidenceRecords.availability,
          })
          .from(promptEvidence)
          .innerJoin(evidenceRecords, eq(evidenceRecords.id, promptEvidence.evidenceId))
          .innerJoin(dataSources, eq(dataSources.id, evidenceRecords.dataSourceId))
          .where(inArray(promptEvidence.promptId, promptIds))
          .orderBy(asc(evidenceRecords.id));

  const evidenceByPrompt = new Map<string, PromptEvidenceRow[]>();
  for (const row of evidenceRows) {
    const list = evidenceByPrompt.get(row.promptId) ?? [];
    list.push(row);
    evidenceByPrompt.set(row.promptId, list);
  }

  const fieldIds = [...new Set(promptRows.flatMap((row) => row.personaFieldIds))];
  const fieldRows =
    fieldIds.length === 0
      ? []
      : await db
          .select({
            id: personaFields.id,
            fieldType: personaFields.fieldType,
            statement: personaFields.statement,
          })
          .from(personaFields)
          .where(inArray(personaFields.id, fieldIds));
  const fieldById = new Map(fieldRows.map((row) => [row.id, row]));

  const pairRows = await db
    .select({
      personaPromptId: promptPairs.personaPromptId,
      controlPromptId: promptPairs.controlPromptId,
    })
    .from(promptPairs)
    .where(eq(promptPairs.promptSetVersionId, targetId));

  const promptById = new Map(promptRows.map((row) => [row.id, row]));
  const controlFor = new Map<string, string>();
  const personaFor = new Map<string, string>();
  for (const pair of pairRows) {
    controlFor.set(pair.personaPromptId, pair.controlPromptId);
    personaFor.set(pair.controlPromptId, pair.personaPromptId);
  }

  const decorate = (row: (typeof promptRows)[number]): PromptRow => {
    const controlId = controlFor.get(row.id);
    const control = controlId ? promptById.get(controlId) : undefined;
    const partnerId = personaFor.get(row.id);
    const partner = partnerId ? promptById.get(partnerId) : undefined;

    return {
      ...row,
      evidence: evidenceByPrompt.get(row.id) ?? [],
      personaFieldStatements: row.personaFieldIds
        .map((id) => fieldById.get(id))
        .filter((field): field is NonNullable<typeof field> => field !== undefined),
      control: control
        ? { id: control.id, promptText: control.promptText, reviewStatus: control.reviewStatus }
        : null,
      pairedTo: partner ? { id: partner.id, promptText: partner.promptText } : null,
    };
  };

  const all = promptRows.map(decorate);
  const personaPrompts = all.filter((row) => row.promptType === "persona");
  const controls = all.filter((row) => row.promptType === "generic_control");

  const byIntent = INTENT_ORDER.map((intent) => ({
    intent,
    label: PROMPT_INTENT_LABELS[intent] ?? intent,
    prompts: personaPrompts.filter((row) => row.intent === intent),
  })).filter((group) => group.prompts.length > 0);

  const byStage = STAGE_ORDER.map((stage) => ({
    stage,
    prompts: personaPrompts.filter((row) => row.journeyStage === stage),
  })).filter((group) => group.prompts.length > 0);

  const [generatedBy, approvedBy] = await Promise.all([
    userName(versionRow.generatedByUserId),
    userName(versionRow.approvedByUserId),
  ]);

  return {
    set,
    version: versionRow,
    versions,
    persona,
    personaVersion,
    personaPrompts,
    controls,
    byIntent,
    byStage,
    counts: {
      total: all.length,
      persona: personaPrompts.length,
      controls: controls.length,
      approved: all.filter((row) => row.reviewStatus === "approved").length,
      rejected: all.filter((row) => row.reviewStatus === "rejected").length,
      pending: all.filter((row) => row.reviewStatus === "pending_review").length,
      paired: personaPrompts.filter((row) => row.control !== null).length,
      duplicateWarnings: all.filter((row) => row.similarityWarning !== null).length,
      exactDuplicates: all.filter((row) => row.similarityWarning?.kind === "exact").length,
      edited: all.filter((row) => row.editedByUser).length,
    },
    generatedByName: generatedBy,
    approvedByName: approvedBy,
    editable: versionRow.status !== "approved",
  };
}

async function userName(userId: string | null): Promise<string | null> {
  if (!userId) return null;
  const [row] = await db
    .select({ name: users.name })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return row?.name ?? null;
}

// ── Writes ──────────────────────────────────────────────────────────────────

/** Brand-level Profound targeting defaults, used when metadata is rebuilt. */
async function loadBrandTargeting(brandId: string): Promise<{
  languages: string[];
  regions: string[];
}> {
  const [row] = await db
    .select({ languages: brands.languages, regions: brands.regions })
    .from(brands)
    .where(eq(brands.id, brandId))
    .limit(1);
  return { languages: row?.languages ?? [], regions: row?.regions ?? [] };
}

async function loadPromptForWrite(ctx: BrandContext, promptId: string) {
  const [row] = await db
    .select({
      prompt: prompts,
      versionStatus: promptSetVersions.status,
      promptSetId: promptSetVersions.promptSetId,
      setSlug: promptSets.slug,
      setVersion: promptSetVersions.version,
      personaSlug: personas.slug,
      personaVersion: personaVersions.version,
    })
    .from(prompts)
    .innerJoin(promptSetVersions, eq(promptSetVersions.id, prompts.promptSetVersionId))
    .innerJoin(promptSets, eq(promptSets.id, promptSetVersions.promptSetId))
    .innerJoin(personas, eq(personas.id, prompts.personaId))
    .innerJoin(personaVersions, eq(personaVersions.id, prompts.personaVersionId))
    .where(
      and(
        eq(prompts.id, promptId),
        eq(prompts.organizationId, ctx.organizationId),
        eq(prompts.brandId, ctx.brandId),
      ),
    )
    .limit(1);

  if (!row) throw new NotFoundError("Prompt");
  if (row.versionStatus === "approved") {
    throw new ImmutableError("This prompt-set version");
  }
  return row;
}

export const promptUpdateSchema = z.object({
  promptText: z.string().trim().min(10, "A prompt needs to be a real question").max(600),
  topic: z.string().trim().min(2).max(160),
  intent: z.enum(PROMPT_INTENTS),
  journeyStage: z.enum(STAGE_ORDER),
  trackingPriority: z.enum(["low", "medium", "high"]),
  executionMode: z.enum(["standalone", "conversational", "both"]),
  informationNeed: z.string().trim().min(5).max(400),
  expectedAnswerElements: z.string().trim().max(2000).optional(),
});

export type PromptUpdate = z.infer<typeof promptUpdateSchema>;

/**
 * Edits one prompt.
 *
 * Rewriting the text changes its normalized hash and therefore its Profound
 * metadata and its duplicate status, so all three are recomputed here rather
 * than left to drift. `edited_by_user` is set so an export can distinguish a
 * generated prompt from a human-authored one.
 */
export async function updatePrompt(
  ctx: BrandContext,
  promptId: string,
  input: PromptUpdate,
): Promise<void> {
  requireCapability(ctx, "prompt:generate");
  const row = await loadPromptForWrite(ctx, promptId);

  const hash = promptHash(input.promptText);
  if (hash !== row.prompt.normalizedHash) {
    const [clash] = await db
      .select({ id: prompts.id })
      .from(prompts)
      .where(
        and(
          eq(prompts.promptSetVersionId, row.prompt.promptSetVersionId),
          eq(prompts.normalizedHash, hash),
        ),
      )
      .limit(1);
    if (clash && clash.id !== promptId) {
      throw new ValidationError(
        "Another prompt in this set already asks exactly this question. Edit that one instead, or reject it first.",
      );
    }
  }

  const elements = (input.expectedAnswerElements ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 10);

  const brand = await loadBrandTargeting(ctx.brandId);

  await db
    .update(prompts)
    .set({
      promptText: input.promptText,
      normalizedHash: hash,
      topic: input.topic,
      intent: input.intent,
      journeyStage: input.journeyStage,
      trackingPriority: input.trackingPriority,
      executionMode: input.executionMode,
      informationNeed: input.informationNeed,
      expectedAnswerElements: elements.length > 0 ? elements : row.prompt.expectedAnswerElements,
      profoundMetadata: buildPromptMetadata({
        personaSlug: row.personaSlug,
        personaVersion: row.personaVersion,
        promptSetSlug: row.setSlug,
        promptSetVersion: row.setVersion,
        intent: input.intent,
        journeyStage: input.journeyStage,
        promptType: row.prompt.promptType,
        promptText: input.promptText,
        topic: input.topic,
        languages: brand.languages,
        regions: brand.regions,
      }) as unknown as Record<string, unknown>,
      editedByUser: true,
      dataOrigin: "local",
      updatedAt: new Date(),
    })
    .where(eq(prompts.id, promptId));

  await recomputeDuplicateWarnings(row.prompt.promptSetVersionId);

  await recordAudit({
    organizationId: ctx.organizationId,
    brandId: ctx.brandId,
    actorUserId: ctx.userId,
    action: "prompt.update",
    entityType: "prompt",
    entityId: promptId,
    metadata: { intent: input.intent, rewritten: hash !== row.prompt.normalizedHash },
  });
}

/**
 * Bulk review (§18).
 *
 * Rejecting a persona prompt also rejects a control that exists only to serve
 * it: an orphan control measures a generic question nobody chose to track, and
 * paying Profound to run it is waste.
 */
export async function reviewPrompts(
  ctx: BrandContext,
  promptIds: string[],
  status: "approved" | "rejected" | "pending_review",
): Promise<{ updated: number; cascadedControls: number }> {
  requireCapability(ctx, "prompt:approve");
  if (promptIds.length === 0) return { updated: 0, cascadedControls: 0 };

  const rows = await db
    .select({
      id: prompts.id,
      promptType: prompts.promptType,
      setVersionId: prompts.promptSetVersionId,
      versionStatus: promptSetVersions.status,
    })
    .from(prompts)
    .innerJoin(promptSetVersions, eq(promptSetVersions.id, prompts.promptSetVersionId))
    .where(
      and(
        inArray(prompts.id, promptIds),
        eq(prompts.organizationId, ctx.organizationId),
        eq(prompts.brandId, ctx.brandId),
      ),
    );

  if (rows.length === 0) throw new NotFoundError("Prompt");
  if (rows.some((row) => row.versionStatus === "approved")) {
    throw new ImmutableError("This prompt-set version");
  }

  const ids = rows.map((row) => row.id);
  const setVersionIds = [...new Set(rows.map((row) => row.setVersionId))];

  let cascadedControls = 0;
  if (status === "rejected") {
    const personaIds = rows.filter((row) => row.promptType === "persona").map((row) => row.id);
    if (personaIds.length > 0) {
      const partners = await db
        .select({ controlPromptId: promptPairs.controlPromptId })
        .from(promptPairs)
        .where(inArray(promptPairs.personaPromptId, personaIds));

      // Only cascade to a control whose every persona prompt is being rejected.
      for (const partner of [...new Set(partners.map((row) => row.controlPromptId))]) {
        const users = await db
          .select({ personaPromptId: promptPairs.personaPromptId })
          .from(promptPairs)
          .where(eq(promptPairs.controlPromptId, partner));
        const stillWanted = users.some((row) => !ids.includes(row.personaPromptId));
        if (stillWanted) continue;
        ids.push(partner);
        cascadedControls++;
      }
    }
  }

  await db
    .update(prompts)
    .set({ reviewStatus: status, updatedAt: new Date() })
    .where(inArray(prompts.id, ids));

  for (const setVersionId of setVersionIds) {
    await refreshVersionCounts(setVersionId);
  }

  await recordAudit({
    organizationId: ctx.organizationId,
    brandId: ctx.brandId,
    actorUserId: ctx.userId,
    action: "prompt.review",
    entityType: "prompt_set_version",
    entityId: setVersionIds[0],
    metadata: { status, count: ids.length, cascadedControls },
  });

  return { updated: ids.length, cascadedControls };
}

export async function setTrackingPriority(
  ctx: BrandContext,
  promptIds: string[],
  priority: "low" | "medium" | "high",
): Promise<number> {
  requireCapability(ctx, "prompt:generate");
  if (promptIds.length === 0) return 0;

  const rows = await db
    .select({ id: prompts.id, versionStatus: promptSetVersions.status })
    .from(prompts)
    .innerJoin(promptSetVersions, eq(promptSetVersions.id, prompts.promptSetVersionId))
    .where(
      and(
        inArray(prompts.id, promptIds),
        eq(prompts.organizationId, ctx.organizationId),
        eq(prompts.brandId, ctx.brandId),
      ),
    );
  if (rows.some((row) => row.versionStatus === "approved")) {
    throw new ImmutableError("This prompt-set version");
  }

  await db
    .update(prompts)
    .set({ trackingPriority: priority, updatedAt: new Date() })
    .where(
      inArray(
        prompts.id,
        rows.map((row) => row.id),
      ),
    );

  return rows.length;
}

/**
 * Creates or replaces a persona prompt's generic control (§18 control pairing).
 *
 * The control is stored as a real prompt row rather than a text field, because
 * it is deployed to Profound and gets its own results. It inherits the persona
 * prompt's intent and stage so the pair is comparable.
 */
export async function setGenericControl(
  ctx: BrandContext,
  personaPromptId: string,
  controlText: string,
): Promise<{ controlId: string; replaced: boolean }> {
  requireCapability(ctx, "prompt:generate");
  const row = await loadPromptForWrite(ctx, personaPromptId);

  if (row.prompt.promptType !== "persona") {
    throw new ValidationError("Only a persona prompt can have a generic control.");
  }

  const text = controlText.trim();
  if (text.length < 5) throw new ValidationError("The control prompt is too short to track.");

  const hash = promptHash(text);
  if (hash === row.prompt.normalizedHash) {
    throw new ValidationError(
      "The control is identical to the persona prompt once normalized, so the pair could never show a difference. Remove the persona's qualifier from the control.",
    );
  }

  const existingPair = await db
    .select({ controlPromptId: promptPairs.controlPromptId, id: promptPairs.id })
    .from(promptPairs)
    .where(eq(promptPairs.personaPromptId, personaPromptId))
    .limit(1);

  const brand = await loadBrandTargeting(ctx.brandId);

  let controlId = "";
  let replaced = false;

  await db.transaction(async (tx) => {
    // Reuse an existing control row in the set with the same text, so two
    // persona prompts that share a control share one measured row.
    const [reusable] = await tx
      .select({ id: prompts.id })
      .from(prompts)
      .where(
        and(
          eq(prompts.promptSetVersionId, row.prompt.promptSetVersionId),
          eq(prompts.normalizedHash, hash),
          eq(prompts.promptType, "generic_control"),
        ),
      )
      .limit(1);

    if (reusable) {
      controlId = reusable.id;
    } else {
      controlId = newId(ID_PREFIXES.prompt);
      await tx.insert(prompts).values({
        id: controlId,
        organizationId: ctx.organizationId,
        brandId: ctx.brandId,
        promptSetVersionId: row.prompt.promptSetVersionId,
        personaId: row.prompt.personaId,
        personaVersionId: row.prompt.personaVersionId,
        promptType: "generic_control",
        topic: row.prompt.topic,
        promptText: text,
        normalizedHash: hash,
        informationNeed: `Generic control for: ${row.prompt.informationNeed}`,
        intent: row.prompt.intent,
        journeyStage: row.prompt.journeyStage,
        expectedAnswerElements: row.prompt.expectedAnswerElements,
        inclusionRationale:
          "Reviewer-authored generic control. It isolates the persona framing: the difference between the pair is the persona's qualifier and nothing else.",
        confidence: row.prompt.confidence,
        trackingPriority: row.prompt.trackingPriority,
        executionMode: row.prompt.executionMode,
        reviewStatus: "pending_review",
        profoundMetadata: buildPromptMetadata({
          personaSlug: row.personaSlug,
          personaVersion: row.personaVersion,
          promptSetSlug: row.setSlug,
          promptSetVersion: row.setVersion,
          intent: row.prompt.intent,
          journeyStage: row.prompt.journeyStage,
          promptType: "generic_control",
          promptText: text,
          topic: row.prompt.topic,
          languages: brand.languages,
          regions: brand.regions,
        }) as unknown as Record<string, unknown>,
        editedByUser: true,
        dataOrigin: "local",
      });
    }

    const previous = existingPair[0];
    if (previous) {
      replaced = previous.controlPromptId !== controlId;
      await tx.delete(promptPairs).where(eq(promptPairs.id, previous.id));

      // Drop a control nothing points at any more, rather than leaving an
      // unpaired row that would still be deployed.
      if (replaced) {
        const [stillUsed] = await tx
          .select({ n: count() })
          .from(promptPairs)
          .where(eq(promptPairs.controlPromptId, previous.controlPromptId));
        if ((stillUsed?.n ?? 0) === 0) {
          await tx.delete(prompts).where(eq(prompts.id, previous.controlPromptId));
        }
      }
    }

    await tx
      .insert(promptPairs)
      .values({
        id: newId(ID_PREFIXES.promptPair),
        organizationId: ctx.organizationId,
        promptSetVersionId: row.prompt.promptSetVersionId,
        personaPromptId,
        controlPromptId: controlId,
        rationale: "Reviewer-paired control.",
      })
      .onConflictDoNothing();
  });

  await refreshVersionCounts(row.prompt.promptSetVersionId);
  await recomputeDuplicateWarnings(row.prompt.promptSetVersionId);

  await recordAudit({
    organizationId: ctx.organizationId,
    brandId: ctx.brandId,
    actorUserId: ctx.userId,
    action: "prompt.pair",
    entityType: "prompt",
    entityId: personaPromptId,
    metadata: { controlId, replaced },
  });

  return { controlId, replaced };
}

export async function removeGenericControl(
  ctx: BrandContext,
  personaPromptId: string,
): Promise<void> {
  requireCapability(ctx, "prompt:generate");
  const row = await loadPromptForWrite(ctx, personaPromptId);

  const [pair] = await db
    .select()
    .from(promptPairs)
    .where(eq(promptPairs.personaPromptId, personaPromptId))
    .limit(1);
  if (!pair) throw new ValidationError("This prompt has no control to remove.");

  await db.transaction(async (tx) => {
    await tx.delete(promptPairs).where(eq(promptPairs.id, pair.id));
    const [stillUsed] = await tx
      .select({ n: count() })
      .from(promptPairs)
      .where(eq(promptPairs.controlPromptId, pair.controlPromptId));
    if ((stillUsed?.n ?? 0) === 0) {
      await tx.delete(prompts).where(eq(prompts.id, pair.controlPromptId));
    }
  });

  await refreshVersionCounts(row.prompt.promptSetVersionId);

  await recordAudit({
    organizationId: ctx.organizationId,
    brandId: ctx.brandId,
    actorUserId: ctx.userId,
    action: "prompt.pair",
    entityType: "prompt",
    entityId: personaPromptId,
    metadata: { removed: pair.controlPromptId },
  });
}

// ── Approval and versioning ─────────────────────────────────────────────────

async function loadVersionForWrite(ctx: BrandContext, promptSetVersionId: string) {
  const [row] = await db
    .select()
    .from(promptSetVersions)
    .where(
      and(
        eq(promptSetVersions.id, promptSetVersionId),
        eq(promptSetVersions.organizationId, ctx.organizationId),
        eq(promptSetVersions.brandId, ctx.brandId),
      ),
    )
    .limit(1);
  if (!row) throw new NotFoundError("Prompt-set version");
  return row;
}

/**
 * Approving freezes the version (§33).
 *
 * The blockers are the things that would make a deployment meaningless or
 * wrong, listed rather than silently failing:
 *
 * - an unreviewed prompt, because approving a set is a statement about every
 *   prompt in it;
 * - an approved prompt citing no available evidence, which is the traceability
 *   invariant;
 * - an exact duplicate among approved prompts, which would split one question's
 *   measurement across two Profound rows.
 *
 * A *near*-duplicate warning does not block. It is a judgement call, and the
 * reviewer has the pair in front of them.
 */
export async function approvePromptSetVersion(
  ctx: BrandContext,
  promptSetVersionId: string,
): Promise<{ blockers: string[] }> {
  requireCapability(ctx, "prompt:approve");
  const version = await loadVersionForWrite(ctx, promptSetVersionId);
  if (version.status === "approved")
    throw new ImmutableError(`Prompt-set version ${version.version}`);

  const rows = await db
    .select({
      id: prompts.id,
      text: prompts.promptText,
      type: prompts.promptType,
      reviewStatus: prompts.reviewStatus,
      similarityWarning: prompts.similarityWarning,
      // `prompts.id` is written out rather than interpolated: Drizzle renders an
      // interpolated column unqualified, which inside this correlated subquery
      // binds to `prompt_evidence` instead of the outer row.
      evidenceCount: raw<number>`(select count(*)::int from prompt_evidence pe
        join evidence_records er on er.id = pe.evidence_id
        where pe.prompt_id = prompts.id and pe.unavailable = false and er.availability = 'available')`,
    })
    .from(prompts)
    .where(eq(prompts.promptSetVersionId, promptSetVersionId));

  const blockers: string[] = [];

  const pending = rows.filter((row) => row.reviewStatus === "pending_review");
  if (pending.length > 0) {
    blockers.push(
      `${pending.length} prompt${pending.length === 1 ? " is" : "s are"} still awaiting review. Approve or reject every prompt before approving the set.`,
    );
  }

  const approved = rows.filter((row) => row.reviewStatus === "approved");
  if (approved.length === 0) {
    blockers.push("No prompt in this set is approved, so there would be nothing to deploy.");
  }

  const untraceable = approved.filter((row) => row.type === "persona" && row.evidenceCount === 0);
  for (const row of untraceable.slice(0, 5)) {
    blockers.push(
      `"${row.text.slice(0, 60)}" cites no available evidence. Reject it, or restore the source it came from.`,
    );
  }

  const exactDuplicates = approved.filter((row) => row.similarityWarning?.kind === "exact");
  for (const row of exactDuplicates.slice(0, 5)) {
    blockers.push(
      `"${row.text.slice(0, 60)}" is an exact duplicate of another tracked prompt. Reject one of the pair — deploying both would split the same question's results across two rows.`,
    );
  }

  if (blockers.length > 0) return { blockers };

  await db.transaction(async (tx) => {
    await tx
      .update(promptSetVersions)
      .set({
        status: "approved",
        approvedByUserId: ctx.userId,
        approvedAt: new Date(),
        rejectedReason: null,
        updatedAt: new Date(),
      })
      .where(eq(promptSetVersions.id, promptSetVersionId));

    await tx
      .update(promptSets)
      .set({
        approvedVersionId: promptSetVersionId,
        currentVersionId: promptSetVersionId,
        updatedAt: new Date(),
      })
      .where(eq(promptSets.id, version.promptSetId));

    // Approved prompts are ready for the milestone-5 deployment path; rejected
    // ones never enter it.
    await tx
      .update(prompts)
      .set({ profoundSyncState: "ready", updatedAt: new Date() })
      .where(
        and(
          eq(prompts.promptSetVersionId, promptSetVersionId),
          eq(prompts.reviewStatus, "approved"),
        ),
      );
  });

  await recordAudit({
    organizationId: ctx.organizationId,
    brandId: ctx.brandId,
    actorUserId: ctx.userId,
    action: "prompt_set.approve",
    entityType: "prompt_set_version",
    entityId: promptSetVersionId,
    metadata: { version: version.version, approvedPrompts: approved.length },
  });

  return { blockers: [] };
}

export async function rejectPromptSetVersion(
  ctx: BrandContext,
  promptSetVersionId: string,
  reason: string,
): Promise<void> {
  requireCapability(ctx, "prompt:approve");
  const version = await loadVersionForWrite(ctx, promptSetVersionId);
  if (version.status === "approved")
    throw new ImmutableError(`Prompt-set version ${version.version}`);

  await db
    .update(promptSetVersions)
    .set({
      status: "rejected",
      rejectedReason: reason.trim().slice(0, 2000),
      updatedAt: new Date(),
    })
    .where(eq(promptSetVersions.id, promptSetVersionId));

  await recordAudit({
    organizationId: ctx.organizationId,
    brandId: ctx.brandId,
    actorUserId: ctx.userId,
    action: "prompt_set.reject",
    entityType: "prompt_set_version",
    entityId: promptSetVersionId,
    metadata: { version: version.version },
  });
}

/**
 * Copies a version into a new draft — the only way to revise an approved set.
 *
 * Rejected prompts are copied too, with their status, so the reviewer sees what
 * a previous round already turned down instead of re-litigating it.
 */
export async function createNewPromptSetVersion(
  ctx: BrandContext,
  promptSetId: string,
  options: { fromVersionId?: string; changeSummary: string },
): Promise<{ versionId: string; version: number }> {
  requireCapability(ctx, "prompt:generate");

  const [set] = await db
    .select()
    .from(promptSets)
    .where(
      and(
        eq(promptSets.id, promptSetId),
        eq(promptSets.organizationId, ctx.organizationId),
        eq(promptSets.brandId, ctx.brandId),
      ),
    )
    .limit(1);
  if (!set) throw new NotFoundError("Prompt set");

  const sourceId = options.fromVersionId ?? set.currentVersionId;
  if (!sourceId) throw new ValidationError("This prompt set has no version to copy.");
  const source = await loadVersionForWrite(ctx, sourceId);

  const [existingDraft] = await db
    .select({ id: promptSetVersions.id, version: promptSetVersions.version })
    .from(promptSetVersions)
    .where(
      and(eq(promptSetVersions.promptSetId, promptSetId), eq(promptSetVersions.status, "draft")),
    )
    .orderBy(desc(promptSetVersions.version))
    .limit(1);
  if (existingDraft) {
    throw new AppError(
      "conflict",
      `Version ${existingDraft.version} is already a draft. Approve or reject it before creating another version.`,
    );
  }

  const [maxRow] = await db
    .select({ n: max(promptSetVersions.version) })
    .from(promptSetVersions)
    .where(eq(promptSetVersions.promptSetId, promptSetId));
  const nextVersion = (maxRow?.n ?? 0) + 1;
  const newVersionId = newId(ID_PREFIXES.promptSetVersion);

  await db.transaction(async (tx) => {
    await tx.insert(promptSetVersions).values({
      id: newVersionId,
      organizationId: ctx.organizationId,
      brandId: ctx.brandId,
      promptSetId,
      personaVersionId: source.personaVersionId,
      version: nextVersion,
      status: "draft",
      promptCount: 0,
      controlCount: 0,
      modelProvider: source.modelProvider,
      modelId: source.modelId,
      promptTemplateVersion: source.promptTemplateVersion,
      schemaVersion: source.schemaVersion,
      dataOrigin: source.dataOrigin,
      evidenceCutoff: source.evidenceCutoff,
      generatedByUserId: ctx.userId,
      parentVersionId: source.id,
      changeSummary: options.changeSummary.trim().slice(0, 2000),
    });

    const sourcePrompts = await tx
      .select()
      .from(prompts)
      .where(eq(prompts.promptSetVersionId, sourceId))
      .orderBy(asc(prompts.createdAt), asc(prompts.id));

    const idMap = new Map<string, string>();

    for (const original of sourcePrompts) {
      const copyId = newId(ID_PREFIXES.prompt);
      idMap.set(original.id, copyId);

      await tx.insert(prompts).values({
        ...original,
        id: copyId,
        promptSetVersionId: newVersionId,
        // A copy has not been deployed; sync state restarts from draft.
        profoundSyncState: "draft",
        similarityWarning: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const links = await tx
        .select({ evidenceId: promptEvidence.evidenceId, unavailable: promptEvidence.unavailable })
        .from(promptEvidence)
        .where(eq(promptEvidence.promptId, original.id));

      for (const link of links) {
        await tx
          .insert(promptEvidence)
          .values({
            id: newId(ID_PREFIXES.prompt),
            organizationId: ctx.organizationId,
            promptId: copyId,
            evidenceId: link.evidenceId,
            unavailable: link.unavailable,
          })
          .onConflictDoNothing();
      }
    }

    const pairs = await tx
      .select()
      .from(promptPairs)
      .where(eq(promptPairs.promptSetVersionId, sourceId));

    for (const pair of pairs) {
      const personaCopy = idMap.get(pair.personaPromptId);
      const controlCopy = idMap.get(pair.controlPromptId);
      if (!personaCopy || !controlCopy) continue;
      await tx
        .insert(promptPairs)
        .values({
          id: newId(ID_PREFIXES.promptPair),
          organizationId: ctx.organizationId,
          promptSetVersionId: newVersionId,
          personaPromptId: personaCopy,
          controlPromptId: controlCopy,
          rationale: pair.rationale,
        })
        .onConflictDoNothing();
    }

    await tx
      .update(promptSets)
      .set({ currentVersionId: newVersionId, updatedAt: new Date() })
      .where(eq(promptSets.id, promptSetId));
  });

  await refreshVersionCounts(newVersionId);

  // Embeddings are per prompt id, so the copies need their own before duplicate
  // detection can say anything about them.
  await getQueue().enqueue(
    JOB_TYPES.embedPrompts,
    { brandId: ctx.brandId, promptSetVersionId: newVersionId },
    { organizationId: ctx.organizationId, brandId: ctx.brandId },
  );

  await recordAudit({
    organizationId: ctx.organizationId,
    brandId: ctx.brandId,
    actorUserId: ctx.userId,
    action: "prompt_set.new_version",
    entityType: "prompt_set_version",
    entityId: newVersionId,
    metadata: { version: nextVersion, parentVersionId: source.id },
  });

  return { versionId: newVersionId, version: nextVersion };
}

/** Keeps the denormalised counts on a version honest after any structural change. */
export async function refreshVersionCounts(promptSetVersionId: string): Promise<void> {
  const [row] = await db
    .select({
      persona: raw<number>`count(*) filter (where ${prompts.promptType} = 'persona')::int`,
      controls: raw<number>`count(*) filter (where ${prompts.promptType} = 'generic_control')::int`,
    })
    .from(prompts)
    .where(eq(prompts.promptSetVersionId, promptSetVersionId));

  await db
    .update(promptSetVersions)
    .set({
      promptCount: row?.persona ?? 0,
      controlCount: row?.controls ?? 0,
      updatedAt: new Date(),
    })
    .where(eq(promptSetVersions.id, promptSetVersionId));
}
