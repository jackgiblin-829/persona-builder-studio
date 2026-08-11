import "server-only";
import { and, desc, eq, inArray, isNull, max } from "drizzle-orm";
import { z } from "zod";
import { getQueue } from "@/adapters/queue";
import { getSparktoroAdapter, SPARKTORO_MAX_REPORT_COST } from "@/adapters/sparktoro";
import { buildCoverageBlueprint, strategyReadiness } from "@/contracts/prompt-strategy";
import { db } from "@/db/client";
import {
  dataSources,
  generationRuns,
  personas,
  personaVersions,
  promptSets,
  type PersonaInsight,
  type PersonaProfile,
} from "@/db/schema";
import { requireCapability, type ProjectContext } from "@/lib/auth/context";
import { sha256 } from "@/lib/crypto";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { ID_PREFIXES, newId } from "@/lib/ids";
import { JOB_TYPES } from "@/jobs/registry";
import { getProject } from "./projects";
import { getApprovedMarketResearchBrief } from "./market-research";
import { recordAudit } from "./audit";
import { withVendorUsage } from "./usage";

export function sparkReportHash(audience: string, market: string, locale: string) {
  return sha256(JSON.stringify({ audience: audience.trim().toLowerCase(), market, locale }));
}

export async function getPersonaGenerationPreflight(ctx: ProjectContext) {
  const project = await getProject(ctx);
  const { adapter, mode } = await getSparktoroAdapter(ctx.organizationId);
  const balance = await withVendorUsage(
    {
      organizationId: ctx.organizationId,
      projectId: ctx.projectId,
      vendor: "sparktoro",
      operation: "credit_preflight",
      mode,
    },
    () => adapter.getCreditBalance(),
    (result) => ({ credits: result.creditsUsed }),
  );
  const inputHash = sparkReportHash(
    project.sparktoroAudienceDescription,
    project.primaryMarket,
    project.languageLocale,
  );
  const { sparkReports } = await import("@/db/schema");
  const [cached] = await db
    .select({ id: sparkReports.id })
    .from(sparkReports)
    .where(
      and(
        eq(sparkReports.organizationId, ctx.organizationId),
        eq(sparkReports.inputHash, inputHash),
        inArray(sparkReports.status, ["completed", "completed_with_warnings"]),
      ),
    )
    .limit(1);
  return {
    mode,
    balance: balance.data.creditsRemaining,
    maximumSpend: cached ? 0 : SPARKTORO_MAX_REPORT_COST,
    cached: Boolean(cached),
    sufficient: cached || balance.data.creditsRemaining >= SPARKTORO_MAX_REPORT_COST,
  };
}

export async function startPersonaGeneration(ctx: ProjectContext) {
  requireCapability(ctx, "persona:generate");
  const project = await getProject(ctx);
  const [completed] = await db
    .select({ id: dataSources.id })
    .from(dataSources)
    .where(
      and(
        eq(dataSources.projectId, ctx.projectId),
        inArray(dataSources.status, ["completed", "completed_with_warnings"]),
      ),
    )
    .limit(1);
  if (!completed) throw new ValidationError("Wait for at least one source to finish processing.");
  const activeRuns = await db
    .select()
    .from(generationRuns)
    .where(
      and(
        eq(generationRuns.projectId, ctx.projectId),
        eq(generationRuns.workflowType, "persona_generation"),
        inArray(generationRuns.status, ["queued", "running"]),
      ),
    )
    .orderBy(desc(generationRuns.createdAt));
  const matchingRun = activeRuns.find(
    (run) =>
      run.inputSnapshot.sourceRevision === project.sourceRevision &&
      run.inputSnapshot.audienceDescription === project.sparktoroAudienceDescription &&
      run.inputSnapshot.market === project.primaryMarket &&
      run.inputSnapshot.locale === project.languageLocale,
  );
  if (matchingRun) return matchingRun.id;

  const preflight = await getPersonaGenerationPreflight(ctx);
  if (!preflight.sufficient) {
    throw new ValidationError(
      `SparkToro has ${preflight.balance} credits; this full report may use up to ${preflight.maximumSpend}.`,
    );
  }
  const runId = newId(ID_PREFIXES.generationRun);
  await db.transaction(async (tx) => {
    await tx.insert(generationRuns).values({
      id: runId,
      organizationId: ctx.organizationId,
      projectId: ctx.projectId,
      workflowType: "persona_generation",
      status: "queued",
      stage: "processing_sources",
      progress: 0,
      inputSnapshot: {
        sourceRevision: project.sourceRevision,
        audienceDescription: project.sparktoroAudienceDescription,
        market: project.primaryMarket,
        locale: project.languageLocale,
        maximumSparkCredits: preflight.maximumSpend,
        cachedSparkReport: preflight.cached,
      },
      initiatedByUserId: ctx.userId,
    });
    await getQueue().enqueue(
      JOB_TYPES.generatePersonas,
      { runId },
      {
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        idempotencyKey: `personas:${runId}`,
        tx,
      },
    );
  });
  await recordAudit({
    organizationId: ctx.organizationId,
    projectId: ctx.projectId,
    actorUserId: ctx.userId,
    action: "persona.generate",
    entityType: "generation_run",
    entityId: runId,
  });
  return runId;
}

export async function startPromptGeneration(
  ctx: ProjectContext,
  personaIds?: string[],
  reason: "manual" | "persona_edit" | "persona_regeneration" = "manual",
) {
  requireCapability(ctx, "prompt:generate");
  const project = await getProject(ctx);
  const active = await db
    .select({
      id: personas.id,
      versionId: personas.currentVersionId,
      slug: personas.slug,
      name: personas.name,
    })
    .from(personas)
    .where(and(eq(personas.projectId, ctx.projectId), isNull(personas.archivedAt)));
  const selected = personaIds?.length
    ? active.filter((item) => personaIds.includes(item.id))
    : active;
  if (!selected.length || selected.some((item) => !item.versionId)) {
    throw new ValidationError("Generate personas before generating prompts.");
  }
  const readiness = strategyReadiness(project.promptStrategy);
  if (!readiness.ready) {
    throw new ValidationError(`Complete the prompt strategy: ${readiness.blockers.join(" ")}`);
  }
  const brief = await getApprovedMarketResearchBrief(ctx);
  if (!brief) {
    throw new ValidationError(
      "Refresh and approve the market research brief before generating prompts.",
    );
  }
  if (project.promptStrategyEdited) {
    throw new ValidationError(
      "The strategy changed after research approval. Refresh and approve the market brief again.",
    );
  }
  try {
    buildCoverageBlueprint(
      project.promptStrategy,
      selected.map((item) => ({ slug: item.slug, name: item.name })),
    );
  } catch (error) {
    throw new ValidationError(
      error instanceof Error ? error.message : "The prompt coverage blueprint is invalid.",
    );
  }
  const runId = newId(ID_PREFIXES.generationRun);
  await db.transaction(async (tx) => {
    await tx.insert(generationRuns).values({
      id: runId,
      organizationId: ctx.organizationId,
      projectId: ctx.projectId,
      workflowType: "prompt_generation",
      status: "queued",
      stage: "creating_clusters",
      progress: 0,
      inputSnapshot: {
        personaIds: selected.map((item) => item.id),
        personaVersionIds: selected.map((item) => item.versionId),
        promptStrategy: project.promptStrategy,
        marketResearchBriefId: brief.id,
        marketResearchBriefVersion: brief.version,
        reason,
      },
      initiatedByUserId: ctx.userId,
    });
    await getQueue().enqueue(
      JOB_TYPES.generatePrompts,
      { runId, personaIds: selected.map((item) => item.id) },
      {
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        idempotencyKey: `prompts:${runId}`,
        tx,
      },
    );
  });
  await recordAudit({
    organizationId: ctx.organizationId,
    projectId: ctx.projectId,
    actorUserId: ctx.userId,
    action: "prompt.generate",
    entityType: "generation_run",
    entityId: runId,
    metadata: { reason, personaCount: selected.length },
  });
  return runId;
}

const textList = z
  .string()
  .max(6000)
  .transform((value) =>
    value
      .split(/\n+/)
      .map((item) => item.trim())
      .filter(Boolean)
      .slice(0, 20),
  )
  .refine((items) => items.length > 0, "Keep at least one insight in every section.");
export const personaEditSchema = z.object({
  personaId: z.string().min(1),
  expectedVersion: z.coerce.number().int().positive(),
  name: z.string().trim().min(5).max(100),
  description: z.string().trim().min(20).max(1000),
  summary: z.string().trim().min(20).max(1600),
  roles: textList,
  seniority: textList,
  departments: textList,
  industries: textList,
  companySize: textList,
  experience: textList,
  jobsToBeDone: textList,
  motivations: textList,
  goals: textList,
  painPoints: textList,
  constraints: textList,
  successMeasures: textList,
  decisionCriteria: textList,
  objections: textList,
  commonQuestions: textList,
  proofNeeds: textList,
  vocabulary: textList,
  buyingTriggers: textList,
  channels: textList,
  communities: textList,
  websites: textList,
  contentPreferences: textList,
  keywords: textList,
  aiPromptTopics: textList,
});

function replaceInsights(existing: PersonaInsight[], values: string[]): PersonaInsight[] {
  const fallback = existing[0] ?? { text: "", signalIds: [], confidence: 0.5 };
  return values.map((text, index) => ({
    text,
    signalIds: existing[index]?.signalIds ?? fallback.signalIds,
    confidence: existing[index]?.confidence ?? Math.min(fallback.confidence, 0.65),
  }));
}

export async function savePersonaVersion(
  ctx: ProjectContext,
  input: z.infer<typeof personaEditSchema>,
) {
  requireCapability(ctx, "persona:edit");
  const [current] = await db
    .select({ persona: personas, version: personaVersions })
    .from(personas)
    .innerJoin(personaVersions, eq(personaVersions.id, personas.currentVersionId))
    .where(
      and(
        eq(personas.id, input.personaId),
        eq(personas.projectId, ctx.projectId),
        eq(personas.organizationId, ctx.organizationId),
      ),
    )
    .limit(1);
  if (!current) throw new NotFoundError("Persona");
  if (current.version.version !== input.expectedVersion)
    throw new ValidationError("This persona changed after you opened it. Reload before saving.");
  const existing = current.version.profile;
  const profile: PersonaProfile = {
    ...existing,
    summary: input.summary,
    firmographics: {
      roles: replaceInsights(existing.firmographics.roles, input.roles),
      seniority: replaceInsights(existing.firmographics.seniority, input.seniority),
      departments: replaceInsights(existing.firmographics.departments, input.departments),
      industries: replaceInsights(existing.firmographics.industries, input.industries),
      companySize: replaceInsights(existing.firmographics.companySize, input.companySize),
      experience: replaceInsights(existing.firmographics.experience, input.experience),
    },
    jobsToBeDone: replaceInsights(existing.jobsToBeDone, input.jobsToBeDone),
    motivations: replaceInsights(existing.motivations, input.motivations),
    goals: replaceInsights(existing.goals, input.goals),
    painPoints: replaceInsights(existing.painPoints, input.painPoints),
    constraints: replaceInsights(existing.constraints, input.constraints),
    successMeasures: replaceInsights(existing.successMeasures, input.successMeasures),
    decisionCriteria: replaceInsights(existing.decisionCriteria, input.decisionCriteria),
    objections: replaceInsights(existing.objections, input.objections),
    commonQuestions: replaceInsights(existing.commonQuestions, input.commonQuestions),
    proofNeeds: replaceInsights(existing.proofNeeds, input.proofNeeds),
    vocabulary: replaceInsights(existing.vocabulary, input.vocabulary),
    buyingTriggers: replaceInsights(existing.buyingTriggers, input.buyingTriggers),
    channels: replaceInsights(existing.channels, input.channels),
    communities: replaceInsights(existing.communities, input.communities),
    websites: replaceInsights(existing.websites, input.websites),
    contentPreferences: replaceInsights(existing.contentPreferences, input.contentPreferences),
    keywords: replaceInsights(existing.keywords, input.keywords),
    aiPromptTopics: replaceInsights(existing.aiPromptTopics, input.aiPromptTopics),
  };
  const versionId = newId(ID_PREFIXES.personaVersion);
  await db.transaction(async (tx) => {
    await tx.insert(personaVersions).values({
      id: versionId,
      organizationId: ctx.organizationId,
      projectId: ctx.projectId,
      personaId: current.persona.id,
      version: current.version.version + 1,
      name: input.name,
      description: input.description,
      profile,
      sourceRevision: current.version.sourceRevision,
      overallConfidence: current.version.overallConfidence,
      modelProvider: current.version.modelProvider,
      modelId: current.version.modelId,
      promptTemplateVersion: current.version.promptTemplateVersion,
      schemaVersion: current.version.schemaVersion,
      dataOrigin: "local",
      parentVersionId: current.version.id,
      changeSummary: "Edited in Persona Builder Studio",
      createdByUserId: ctx.userId,
    });
    await tx
      .update(personas)
      .set({ name: input.name, currentVersionId: versionId, updatedAt: new Date() })
      .where(eq(personas.id, current.persona.id));
  });
  const [existingPromptSet] = await db
    .select({ id: promptSets.id })
    .from(promptSets)
    .where(eq(promptSets.personaId, current.persona.id))
    .limit(1);
  if (existingPromptSet) await startPromptGeneration(ctx, undefined, "persona_edit");
  await recordAudit({
    organizationId: ctx.organizationId,
    projectId: ctx.projectId,
    actorUserId: ctx.userId,
    action: "persona.edit",
    entityType: "persona_version",
    entityId: versionId,
    metadata: { parentVersionId: current.version.id },
  });
  return versionId;
}

export async function nextPromptSetVersion(promptSetId: string) {
  const { promptSetVersions } = await import("@/db/schema");
  const [row] = await db
    .select({ value: max(promptSetVersions.version) })
    .from(promptSetVersions)
    .where(eq(promptSetVersions.promptSetId, promptSetId));
  return (row?.value ?? 0) + 1;
}
