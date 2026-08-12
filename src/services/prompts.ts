import "server-only";
import { and, asc, desc, eq, gte, inArray, isNotNull, isNull, max, ne } from "drizzle-orm";
import { getOpenAIAdapter } from "@/adapters/openai";
import type {
  FunnelStage,
  PromptType,
  QuestionArchetype,
  TopicClass,
} from "@/contracts/prompt-strategy";
import {
  hasPromptEvidence,
  qualityIssue,
  type PromptPlanCell,
} from "@/contracts/prompt-generation";
import type { GeoCategory } from "@/contracts/studio";
import { db } from "@/db/client";
import {
  generatedPrompts,
  marketResearchBriefs,
  personas,
  personaVersions,
  projects,
  promptClusters,
  promptSets,
  promptSetVersions,
  promptSignalLinks,
  researchSignals,
} from "@/db/schema";
import { requireCapability, type ProjectContext } from "@/lib/auth/context";
import { ValidationError } from "@/lib/errors";
import { sha256 } from "@/lib/crypto";
import { ID_PREFIXES, newId } from "@/lib/ids";
import {
  applyLibraryFailures,
  createPromptGenerationTrace,
  generateAndEvaluate,
  normalizePromptText,
  passesQuality,
  selectBestByCell,
  type EvaluatedPrompt,
} from "@/jobs/handlers/generate-prompts";
import { recordAudit } from "./audit";

export async function listLatestPromptSets(ctx: ProjectContext) {
  const sets = await db
    .select({ set: promptSets, version: promptSetVersions, persona: personas })
    .from(promptSets)
    .innerJoin(promptSetVersions, eq(promptSetVersions.id, promptSets.currentVersionId))
    .innerJoin(personas, eq(personas.id, promptSets.personaId))
    .where(
      and(
        eq(promptSets.organizationId, ctx.organizationId),
        eq(promptSets.projectId, ctx.projectId),
        isNull(personas.archivedAt),
        isNotNull(promptSets.currentVersionId),
      ),
    )
    .orderBy(asc(personas.name));
  return hydratePromptSets(sets);
}

export async function listLatestPromptDraftSets(ctx: ProjectContext) {
  const rows = await db
    .select({ set: promptSets, version: promptSetVersions, persona: personas })
    .from(promptSetVersions)
    .innerJoin(promptSets, eq(promptSets.id, promptSetVersions.promptSetId))
    .innerJoin(personas, eq(personas.id, promptSets.personaId))
    .where(
      and(
        eq(promptSetVersions.organizationId, ctx.organizationId),
        eq(promptSetVersions.projectId, ctx.projectId),
        eq(promptSetVersions.lifecycleStatus, "draft"),
        isNull(personas.archivedAt),
      ),
    )
    .orderBy(desc(promptSetVersions.createdAt));
  const latestBySet = new Map<string, (typeof rows)[number]>();
  for (const row of rows) if (!latestBySet.has(row.set.id)) latestBySet.set(row.set.id, row);
  return hydratePromptSets(
    [...latestBySet.values()].sort((a, b) => a.persona.name.localeCompare(b.persona.name)),
  );
}

async function hydratePromptSets(
  sets: Array<{
    set: typeof promptSets.$inferSelect;
    version: typeof promptSetVersions.$inferSelect;
    persona: typeof personas.$inferSelect;
  }>,
) {
  return Promise.all(
    sets.map(async (item) => {
      const clusters = await db
        .select()
        .from(promptClusters)
        .where(eq(promptClusters.promptSetVersionId, item.version.id))
        .orderBy(asc(promptClusters.sequence));
      const grouped = await Promise.all(
        clusters.map(async (cluster) => ({
          cluster,
          prompts: await db
            .select()
            .from(generatedPrompts)
            .where(eq(generatedPrompts.clusterId, cluster.id))
            .orderBy(asc(generatedPrompts.sequence)),
        })),
      );
      return { ...item, clusters: grouped };
    }),
  );
}

export function protectSpreadsheetFormula(value: string) {
  return /^[\t\r\n ]*[=+\-@]/.test(value) ? `'${value}` : value;
}

export function quoteCsv(value: string) {
  return `"${protectSpreadsheetFormula(value).replaceAll('"', '""')}"`;
}

export async function buildPromptBaselineCsv(
  ctx: ProjectContext,
  options: { allowMock?: boolean } = {},
) {
  requireCapability(ctx, "export:read");
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, ctx.projectId), eq(projects.organizationId, ctx.organizationId)))
    .limit(1);
  if (!project) throw new ValidationError("Project was not found.");
  const sets = await listLatestPromptSets(ctx);
  const containsMock = sets.some((set) => set.version.dataOrigin === "mock");
  if (containsMock && !options.allowMock) {
    throw new ValidationError(
      "Production baseline export is unavailable because the active baseline contains demo-mode prompts.",
    );
  }
  if (!containsMock) {
    for (const set of sets) {
      const prompts = set.clusters.flatMap((cluster) => cluster.prompts);
      const expected = set.version.strategySnapshot.targetPromptCount;
      if (prompts.length !== expected) {
        throw new ValidationError(
          `${set.persona.name} requires ${expected} prompts; its active baseline has ${prompts.length}.`,
        );
      }
      const blocked = prompts.filter(
        (prompt) => prompt.qualityScore < 80 || prompt.reviewStatus !== "approved",
      );
      if (blocked.length) {
        throw new ValidationError(
          `${blocked.length} prompts for ${set.persona.name} still need a passing score and human approval.`,
        );
      }
      if (new Set(prompts.map((prompt) => prompt.coverageKey)).size !== expected) {
        throw new ValidationError(`${set.persona.name} is missing one or more Query Funnel cells.`);
      }
    }
  }
  const rows = [
    [
      "Baseline ID",
      "Baseline Version",
      "Persona",
      "Pathway",
      "Prompt ID",
      "Parent Prompt ID",
      "Funnel Stage",
      "Intent",
      "Prompt",
      "Brand Mode",
      "Topic Class",
      "Question Archetype",
      "Business Line",
      "Buyer Context",
      "Quality Score",
      "Review Status",
      "Market",
      "Language",
      "Evidence References",
      "Research Snapshot",
      "Generated At",
      "Generation Mode",
    ],
  ];
  for (const set of sets) {
    for (const { cluster, prompts } of set.clusters) {
      for (const prompt of prompts) {
        if (prompt.reviewStatus === "excluded") continue;
        if (!containsMock && prompt.reviewStatus !== "approved") continue;
        rows.push([
          set.version.id,
          String(set.version.version),
          set.persona.name,
          cluster.title,
          prompt.coverageKey,
          prompt.parentCoverageKey ?? "",
          funnelStageLabel(prompt.journeyStage),
          prompt.intent,
          prompt.promptText,
          prompt.promptType,
          prompt.topicClass,
          prompt.questionArchetype,
          prompt.businessLine,
          prompt.buyerQualifier,
          String(Math.round(prompt.qualityScore)),
          prompt.reviewStatus,
          project.primaryMarket,
          project.languageLocale,
          [...prompt.signalIds, ...prompt.researchFactIds].join(" | "),
          set.version.researchBriefId ?? "",
          set.version.createdAt.toISOString(),
          set.version.dataOrigin,
        ]);
      }
    }
  }
  if (rows.length === 1) throw new ValidationError("Generate prompts before exporting.");
  await recordAudit({
    organizationId: ctx.organizationId,
    projectId: ctx.projectId,
    actorUserId: ctx.userId,
    action: "prompt.baseline_export",
    entityType: "project",
    entityId: ctx.projectId,
    metadata: { rows: rows.length - 1, demo: containsMock },
  });
  return `\uFEFF${rows.map((row) => row.map(quoteCsv).join(",")).join("\r\n")}\r\n`;
}

function funnelStageLabel(value: string) {
  return value === "decision" ? "BOFU" : value === "consideration" ? "MOFU" : "TOFU";
}

export async function setPromptReviewStatus(
  ctx: ProjectContext,
  promptId: string,
  status: "approved" | "excluded" | "ready",
) {
  requireCapability(ctx, "prompt:generate");
  const [prompt] = await db
    .select({
      id: generatedPrompts.id,
      qualityScore: generatedPrompts.qualityScore,
      reviewStatus: generatedPrompts.reviewStatus,
    })
    .from(generatedPrompts)
    .where(
      and(
        eq(generatedPrompts.id, promptId),
        eq(generatedPrompts.projectId, ctx.projectId),
        eq(generatedPrompts.organizationId, ctx.organizationId),
      ),
    )
    .limit(1);
  if (!prompt) throw new ValidationError("Prompt was not found.");
  if (
    status === "approved" &&
    (prompt.qualityScore < 80 || prompt.reviewStatus === "needs_revision")
  ) {
    throw new ValidationError("Only quality-passed prompts can be approved.");
  }
  const nextStatus = status === "ready" && prompt.qualityScore < 80 ? "needs_revision" : status;
  await db
    .update(generatedPrompts)
    .set({ reviewStatus: nextStatus, updatedAt: new Date() })
    .where(eq(generatedPrompts.id, promptId));
  await recordAudit({
    organizationId: ctx.organizationId,
    projectId: ctx.projectId,
    actorUserId: ctx.userId,
    action: "prompt.review",
    entityType: "generated_prompt",
    entityId: promptId,
    metadata: { status: nextStatus },
  });
}

async function ensureDraftPrompt(ctx: ProjectContext, promptId: string) {
  const [source] = await db
    .select({ prompt: generatedPrompts, version: promptSetVersions, set: promptSets })
    .from(generatedPrompts)
    .innerJoin(promptSetVersions, eq(promptSetVersions.id, generatedPrompts.promptSetVersionId))
    .innerJoin(promptSets, eq(promptSets.id, promptSetVersions.promptSetId))
    .where(
      and(
        eq(generatedPrompts.id, promptId),
        eq(generatedPrompts.projectId, ctx.projectId),
        eq(generatedPrompts.organizationId, ctx.organizationId),
      ),
    )
    .limit(1);
  if (!source) throw new ValidationError("Prompt was not found.");
  if (source.version.lifecycleStatus === "draft") return source.prompt.id;

  const [existingDraft] = await db
    .select({ id: promptSetVersions.id })
    .from(promptSetVersions)
    .where(
      and(
        eq(promptSetVersions.promptSetId, source.set.id),
        eq(promptSetVersions.lifecycleStatus, "draft"),
      ),
    )
    .orderBy(desc(promptSetVersions.createdAt))
    .limit(1);
  if (existingDraft) {
    const [draftPrompt] = await db
      .select({ id: generatedPrompts.id })
      .from(generatedPrompts)
      .where(
        and(
          eq(generatedPrompts.promptSetVersionId, existingDraft.id),
          eq(generatedPrompts.coverageKey, source.prompt.coverageKey),
        ),
      )
      .limit(1);
    if (draftPrompt) return draftPrompt.id;
  }

  const sourceClusters = await db
    .select()
    .from(promptClusters)
    .where(eq(promptClusters.promptSetVersionId, source.version.id))
    .orderBy(asc(promptClusters.sequence));
  const sourcePrompts = await db
    .select()
    .from(generatedPrompts)
    .where(eq(generatedPrompts.promptSetVersionId, source.version.id));
  const [latest] = await db
    .select({ value: max(promptSetVersions.version) })
    .from(promptSetVersions)
    .where(eq(promptSetVersions.promptSetId, source.set.id));
  const draftVersionId = newId(ID_PREFIXES.promptSetVersion);
  const clonedPromptIds = new Map<string, string>();

  await db.transaction(async (tx) => {
    await tx.insert(promptSetVersions).values({
      id: draftVersionId,
      organizationId: source.version.organizationId,
      projectId: source.version.projectId,
      promptSetId: source.version.promptSetId,
      personaVersionId: source.version.personaVersionId,
      generationRunId: null,
      version: (latest?.value ?? source.version.version) + 1,
      clusterCount: source.version.clusterCount,
      promptCount: source.version.promptCount,
      modelProvider: source.version.modelProvider,
      modelId: source.version.modelId,
      dataOrigin: source.version.dataOrigin,
      lifecycleStatus: "draft",
      researchBriefId: source.version.researchBriefId,
      plannerPromptVersion: source.version.plannerPromptVersion,
      writerPromptVersion: source.version.writerPromptVersion,
      evaluatorPromptVersion: source.version.evaluatorPromptVersion,
      repairPromptVersion: source.version.repairPromptVersion,
      schemaVersion: source.version.schemaVersion,
      generationMetrics: source.version.generationMetrics,
      strategySnapshot: source.version.strategySnapshot,
      qualitySummary: source.version.qualitySummary,
    });
    for (const cluster of sourceClusters) {
      const clusterId = newId(ID_PREFIXES.promptCluster);
      await tx.insert(promptClusters).values({
        id: clusterId,
        organizationId: cluster.organizationId,
        projectId: cluster.projectId,
        promptSetVersionId: draftVersionId,
        personaVersionId: cluster.personaVersionId,
        sequence: cluster.sequence,
        title: cluster.title,
        slug: cluster.slug,
        seedTopic: cluster.seedTopic,
        informationNeed: cluster.informationNeed,
        rationale: cluster.rationale,
        signalIds: cluster.signalIds,
      });
      for (const prompt of sourcePrompts.filter((item) => item.clusterId === cluster.id)) {
        const clonedId = newId(ID_PREFIXES.prompt);
        clonedPromptIds.set(prompt.coverageKey, clonedId);
        await tx.insert(generatedPrompts).values({
          id: clonedId,
          organizationId: prompt.organizationId,
          projectId: prompt.projectId,
          promptSetVersionId: draftVersionId,
          clusterId,
          personaVersionId: prompt.personaVersionId,
          sequence: prompt.sequence,
          coverageKey: prompt.coverageKey,
          parentCoverageKey: prompt.parentCoverageKey,
          promptText: prompt.promptText,
          normalizedHash: prompt.normalizedHash,
          geoCategory: prompt.geoCategory,
          topicClass: prompt.topicClass,
          promptType: prompt.promptType,
          questionArchetype: prompt.questionArchetype,
          intent: prompt.intent,
          journeyStage: prompt.journeyStage,
          businessLine: prompt.businessLine,
          signalTracked: prompt.signalTracked,
          buyerQualifier: prompt.buyerQualifier,
          namedEntities: prompt.namedEntities,
          qualityScore: prompt.qualityScore,
          rubricScores: prompt.rubricScores,
          evaluatorExplanation: prompt.evaluatorExplanation,
          qualityIssues: prompt.qualityIssues,
          researchFactIds: prompt.researchFactIds,
          maximumSimilarity: prompt.maximumSimilarity,
          reviewStatus: prompt.reviewStatus,
          expectedAnswerElements: prompt.expectedAnswerElements,
          signalIds: prompt.signalIds,
        });
        for (const signalId of prompt.signalIds) {
          await tx.insert(promptSignalLinks).values({
            id: newId(ID_PREFIXES.promptSignalLink),
            organizationId: ctx.organizationId,
            promptId: clonedId,
            signalId,
          });
        }
      }
    }
  });
  const clonedId = clonedPromptIds.get(source.prompt.coverageKey);
  if (!clonedId) throw new ValidationError("Could not create an editable prompt draft.");
  return clonedId;
}

async function invalidatePromptDescendants(versionId: string, parentCoverageKey: string) {
  const prompts = await db
    .select({
      id: generatedPrompts.id,
      coverageKey: generatedPrompts.coverageKey,
      parentCoverageKey: generatedPrompts.parentCoverageKey,
    })
    .from(generatedPrompts)
    .where(eq(generatedPrompts.promptSetVersionId, versionId));
  const directChildren = prompts.filter((prompt) => prompt.parentCoverageKey === parentCoverageKey);
  const descendantIds: string[] = [];
  const pendingKeys = directChildren.map((prompt) => prompt.coverageKey);
  while (pendingKeys.length) {
    const coverageKey = pendingKeys.shift()!;
    const descendant = prompts.find((prompt) => prompt.coverageKey === coverageKey);
    if (!descendant) continue;
    descendantIds.push(descendant.id);
    pendingKeys.push(
      ...prompts
        .filter((prompt) => prompt.parentCoverageKey === coverageKey)
        .map((prompt) => prompt.coverageKey),
    );
  }
  if (descendantIds.length) {
    await db
      .update(generatedPrompts)
      .set({
        reviewStatus: "needs_revision",
        qualityIssues: [
          qualityIssue(
            "parent_child_incoherent",
            "The selected parent changed; regenerate this descendant against the new parent.",
          ),
        ],
        evaluatorExplanation:
          "The selected parent changed. This descendant must be regenerated before promotion.",
        updatedAt: new Date(),
      })
      .where(inArray(generatedPrompts.id, descendantIds));
  }
  return directChildren.map((prompt) => prompt.id);
}

export async function editPromptText(ctx: ProjectContext, promptId: string, value: string) {
  requireCapability(ctx, "prompt:generate");
  const promptText = value.trim();
  if (promptText.length < 12 || promptText.length > 500) {
    throw new ValidationError("Keep prompt text between 12 and 500 characters.");
  }
  const editablePromptId = await ensureDraftPrompt(ctx, promptId);
  const [prompt] = await db
    .select()
    .from(generatedPrompts)
    .where(
      and(
        eq(generatedPrompts.id, editablePromptId),
        eq(generatedPrompts.projectId, ctx.projectId),
        eq(generatedPrompts.organizationId, ctx.organizationId),
      ),
    )
    .limit(1);
  if (!prompt) throw new ValidationError("Prompt was not found.");
  const normalizedHash = sha256(normalizePromptText(promptText));
  const [duplicate] = await db
    .select({ id: generatedPrompts.id })
    .from(generatedPrompts)
    .where(
      and(
        eq(generatedPrompts.promptSetVersionId, prompt.promptSetVersionId),
        eq(generatedPrompts.normalizedHash, normalizedHash),
        ne(generatedPrompts.id, prompt.id),
      ),
    )
    .limit(1);
  if (duplicate) throw new ValidationError("That edit duplicates another prompt in this set.");
  await db
    .update(generatedPrompts)
    .set({
      promptText,
      normalizedHash,
      qualityScore: 0,
      rubricScores: emptyRubric(),
      evaluatorExplanation: "Edited by a reviewer; regenerate this row to score the replacement.",
      qualityIssues: [],
      maximumSimilarity: 0,
      reviewStatus: "needs_revision",
      updatedAt: new Date(),
    })
    .where(eq(generatedPrompts.id, prompt.id));
  await invalidatePromptDescendants(prompt.promptSetVersionId, prompt.coverageKey);
  await recordAudit({
    organizationId: ctx.organizationId,
    projectId: ctx.projectId,
    actorUserId: ctx.userId,
    action: "prompt.edit",
    entityType: "generated_prompt",
    entityId: prompt.id,
  });
}

export async function regenerateSinglePrompt(ctx: ProjectContext, promptId: string): Promise<void> {
  requireCapability(ctx, "prompt:generate");
  const editablePromptId = await ensureDraftPrompt(ctx, promptId);
  const [row] = await db
    .select({
      prompt: generatedPrompts,
      version: promptSetVersions,
      personaVersion: personaVersions,
      persona: personas,
      cluster: promptClusters,
    })
    .from(generatedPrompts)
    .innerJoin(promptSetVersions, eq(promptSetVersions.id, generatedPrompts.promptSetVersionId))
    .innerJoin(personaVersions, eq(personaVersions.id, generatedPrompts.personaVersionId))
    .innerJoin(personas, eq(personas.id, personaVersions.personaId))
    .innerJoin(promptClusters, eq(promptClusters.id, generatedPrompts.clusterId))
    .where(
      and(
        eq(generatedPrompts.id, editablePromptId),
        eq(generatedPrompts.projectId, ctx.projectId),
        eq(generatedPrompts.organizationId, ctx.organizationId),
      ),
    )
    .limit(1);
  if (!row) throw new ValidationError("Prompt was not found.");
  if (!row.version.researchBriefId) {
    throw new ValidationError(
      "This legacy prompt has no research snapshot. Refresh the full baseline.",
    );
  }
  const [brief, project, signals] = await Promise.all([
    db
      .select()
      .from(marketResearchBriefs)
      .where(eq(marketResearchBriefs.id, row.version.researchBriefId))
      .limit(1)
      .then((rows) => rows[0]),
    db
      .select()
      .from(projects)
      .where(and(eq(projects.id, ctx.projectId), eq(projects.organizationId, ctx.organizationId)))
      .limit(1)
      .then((rows) => rows[0]),
    db.select().from(researchSignals).where(eq(researchSignals.projectId, ctx.projectId)),
  ]);
  if (!brief || !project) throw new ValidationError("The research snapshot is unavailable.");
  const directChildIds = await invalidatePromptDescendants(
    row.prompt.promptSetVersionId,
    row.prompt.coverageKey,
  );
  const competitor = row.prompt.namedEntities.find(
    (entity) => entity !== brief.content.strategy.canonicalBrand,
  );
  const cell: PromptPlanCell = {
    key: row.prompt.coverageKey,
    sequence: Number(row.prompt.coverageKey.replace("cell-", "")) - 1,
    personaSlug: row.persona.slug,
    topicClass: row.prompt.topicClass as TopicClass,
    promptType: row.prompt.promptType as PromptType,
    questionArchetype: row.prompt.questionArchetype as QuestionArchetype,
    funnelStage: row.prompt.journeyStage as FunnelStage,
    pathwayKey: row.cluster.slug,
    pathwayLabel: row.cluster.title,
    parentKey: row.prompt.parentCoverageKey,
    geoCategory: row.prompt.geoCategory as GeoCategory,
    businessLine: row.prompt.businessLine,
    signalTracked: row.prompt.signalTracked,
    buyerQualifier: row.prompt.buyerQualifier,
    competitor: competitor ?? "",
    buyerMoment: row.prompt.buyerQualifier || `${row.personaVersion.name} evaluating this option`,
    informationNeed: row.prompt.intent,
    stageObjective:
      row.prompt.journeyStage === "decision"
        ? "Support a final selection."
        : row.prompt.journeyStage === "consideration"
          ? "Evaluate what is needed before the parent decision."
          : "Explain an earlier problem that leads to the parent evaluation.",
    requiredConcepts: [row.prompt.businessLine, row.prompt.signalTracked],
    permittedEntities: row.prompt.namedEntities,
    signalIds: row.prompt.signalIds,
    researchFactIds: row.prompt.researchFactIds,
    parentReason: row.prompt.parentCoverageKey
      ? `This cell prepares the buyer for ${row.prompt.parentCoverageKey}.`
      : "This is a conversion-adjacent decision anchor.",
    evidenceStatus: hasPromptEvidence(row.prompt.signalIds, row.prompt.researchFactIds)
      ? "supported"
      : "insufficient_evidence",
  };
  const [latestSets, latestDrafts] = await Promise.all([
    listLatestPromptSets(ctx),
    listLatestPromptDraftSets(ctx),
  ]);
  const draftSetIds = new Set(latestDrafts.map((set) => set.set.id));
  const comparisonSets = [
    ...latestSets.filter((set) => !draftSetIds.has(set.set.id)),
    ...latestDrafts,
  ];
  const fixed: EvaluatedPrompt[] = comparisonSets.flatMap((set) =>
    set.clusters.flatMap((cluster) =>
      cluster.prompts
        .filter((prompt) => prompt.coverageKey !== row.prompt.coverageKey)
        .map((prompt) => {
          const fixedCell: PromptPlanCell = {
            key: prompt.coverageKey,
            sequence: Number(prompt.coverageKey.replace("cell-", "")) - 1,
            personaSlug: set.persona.slug,
            topicClass: prompt.topicClass as TopicClass,
            promptType: prompt.promptType as PromptType,
            questionArchetype: prompt.questionArchetype as QuestionArchetype,
            funnelStage: prompt.journeyStage as FunnelStage,
            pathwayKey: cluster.cluster.slug,
            pathwayLabel: cluster.cluster.title,
            parentKey: prompt.parentCoverageKey,
            geoCategory: prompt.geoCategory as GeoCategory,
            businessLine: prompt.businessLine,
            signalTracked: prompt.signalTracked,
            buyerQualifier: prompt.buyerQualifier,
            competitor:
              prompt.namedEntities.find(
                (entity) => entity !== brief.content.strategy.canonicalBrand,
              ) ?? "",
            buyerMoment: prompt.buyerQualifier || `${set.persona.name} evaluating this option`,
            informationNeed: prompt.intent,
            stageObjective: prompt.intent,
            requiredConcepts: [prompt.businessLine, prompt.signalTracked],
            permittedEntities: prompt.namedEntities,
            signalIds: prompt.signalIds,
            researchFactIds: prompt.researchFactIds,
            parentReason: prompt.parentCoverageKey
              ? `This cell prepares the buyer for ${prompt.parentCoverageKey}.`
              : "This is a conversion-adjacent decision anchor.",
            evidenceStatus: hasPromptEvidence(prompt.signalIds, prompt.researchFactIds)
              ? "supported"
              : "insufficient_evidence",
          };
          return {
            candidate: {
              plan_key: prompt.coverageKey,
              candidate_key: `${prompt.coverageKey}-a`,
              prompt_text: prompt.promptText,
              intent: prompt.intent,
              expected_answer_elements: prompt.expectedAnswerElements,
              signal_ids: prompt.signalIds,
              research_fact_ids: prompt.researchFactIds,
            },
            cell: fixedCell,
            scores: prompt.rubricScores,
            explanation: prompt.evaluatorExplanation,
            repairInstruction: "",
            qualityIssues: prompt.qualityIssues,
            hardFailures: prompt.qualityIssues
              .filter((issue) => issue.blocking)
              .map((issue) => issue.message),
            maximumSimilarity: prompt.maximumSimilarity,
          };
        }),
    ),
  );
  const { adapter, mode } = await getOpenAIAdapter(ctx.organizationId);
  const selected = selectBestByCell(
    await generateAndEvaluate(
      {
        project,
        strategy: brief.content.strategy,
        brief,
        active: [{ persona: row.persona, version: row.personaVersion }],
        signals,
        adapter,
        mode,
        jobId: row.prompt.id,
        trace: createPromptGenerationTrace(),
      },
      [cell],
      fixed,
      "single_row",
    ),
    [cell],
  );
  const combined = applyLibraryFailures(
    [...fixed, ...selected],
    [...fixed.map((prompt) => prompt.cell), cell],
  );
  const replacement = combined.find((prompt) => prompt.candidate.plan_key === cell.key)!;
  const reviewStatus = passesQuality(replacement) ? "ready" : "needs_revision";
  await db.transaction(async (tx) => {
    await tx
      .update(generatedPrompts)
      .set({
        promptText: replacement.candidate.prompt_text,
        normalizedHash: sha256(normalizePromptText(replacement.candidate.prompt_text)),
        intent: replacement.candidate.intent,
        qualityScore: replacement.scores.total,
        rubricScores: replacement.scores,
        evaluatorExplanation: [replacement.explanation, ...replacement.hardFailures].join(" "),
        qualityIssues: replacement.qualityIssues,
        researchFactIds: replacement.candidate.research_fact_ids,
        maximumSimilarity: replacement.maximumSimilarity,
        reviewStatus,
        expectedAnswerElements: replacement.candidate.expected_answer_elements,
        signalIds: replacement.candidate.signal_ids,
        updatedAt: new Date(),
      })
      .where(eq(generatedPrompts.id, row.prompt.id));
    await tx.delete(promptSignalLinks).where(eq(promptSignalLinks.promptId, row.prompt.id));
    for (const signalId of [...new Set(replacement.candidate.signal_ids)]) {
      await tx.insert(promptSignalLinks).values({
        id: newId(ID_PREFIXES.promptSignalLink),
        organizationId: ctx.organizationId,
        promptId: row.prompt.id,
        signalId,
      });
    }
  });
  await recordAudit({
    organizationId: ctx.organizationId,
    projectId: ctx.projectId,
    actorUserId: ctx.userId,
    action: "prompt.regenerate_single",
    entityType: "generated_prompt",
    entityId: row.prompt.id,
    metadata: { qualityScore: replacement.scores.total, reviewStatus },
  });
  for (const childId of directChildIds) await regenerateSinglePrompt(ctx, childId);
  await tryPromoteDraftVersion(ctx, row.version.id);
}

export async function tryPromoteDraftVersion(ctx: ProjectContext, versionId: string) {
  const [version] = await db
    .select()
    .from(promptSetVersions)
    .where(
      and(
        eq(promptSetVersions.id, versionId),
        eq(promptSetVersions.organizationId, ctx.organizationId),
        eq(promptSetVersions.projectId, ctx.projectId),
      ),
    )
    .limit(1);
  if (!version || version.lifecycleStatus !== "draft") return false;
  const versions = version.generationRunId
    ? await db
        .select()
        .from(promptSetVersions)
        .where(
          and(
            eq(promptSetVersions.generationRunId, version.generationRunId),
            eq(promptSetVersions.lifecycleStatus, "draft"),
          ),
        )
    : [version];
  if (!versions.length) return false;
  const versionIds = versions.map((item) => item.id);
  const prompts = await db
    .select()
    .from(generatedPrompts)
    .where(inArray(generatedPrompts.promptSetVersionId, versionIds));
  if (
    prompts.length !== versions.reduce((total, item) => total + item.promptCount, 0) ||
    prompts.some(
      (prompt) =>
        prompt.qualityScore < 80 ||
        prompt.rubricScores.funnelCoherence < 16 ||
        prompt.rubricScores.evidenceSupport < 8 ||
        prompt.qualityIssues.some((issue) => issue.blocking) ||
        prompt.reviewStatus === "needs_revision" ||
        prompt.reviewStatus === "excluded",
    )
  ) {
    return false;
  }

  await db.transaction(async (tx) => {
    for (const draft of versions) {
      const [set] = await tx
        .select()
        .from(promptSets)
        .where(eq(promptSets.id, draft.promptSetId))
        .limit(1);
      if (!set) throw new ValidationError("Prompt set was not found.");
      await tx
        .update(promptSetVersions)
        .set({ lifecycleStatus: "superseded" })
        .where(
          and(
            eq(promptSetVersions.promptSetId, draft.promptSetId),
            ne(promptSetVersions.id, draft.id),
            ne(promptSetVersions.lifecycleStatus, "superseded"),
          ),
        );
      await tx
        .update(promptSetVersions)
        .set({ lifecycleStatus: "current" })
        .where(eq(promptSetVersions.id, draft.id));
      await tx
        .update(generatedPrompts)
        .set({ reviewStatus: "approved", updatedAt: new Date() })
        .where(eq(generatedPrompts.promptSetVersionId, draft.id));
      await tx
        .update(promptSets)
        .set({ currentVersionId: draft.id, updatedAt: new Date() })
        .where(eq(promptSets.id, draft.promptSetId));
    }
  });
  await recordAudit({
    organizationId: ctx.organizationId,
    projectId: ctx.projectId,
    actorUserId: ctx.userId,
    action: "prompt.draft_promote",
    entityType: "prompt_set_version",
    entityId: version.id,
    metadata: { versionIds },
  });
  return true;
}

export async function approveCurrentPromptLibrary(ctx: ProjectContext) {
  requireCapability(ctx, "prompt:generate");
  const sets = await listLatestPromptSets(ctx);
  const versionIds = sets.map((set) => set.version.id);
  if (!versionIds.length) throw new ValidationError("Generate prompts before approving them.");
  await db
    .update(generatedPrompts)
    .set({ reviewStatus: "approved" })
    .where(
      and(
        eq(generatedPrompts.organizationId, ctx.organizationId),
        eq(generatedPrompts.projectId, ctx.projectId),
        inArray(generatedPrompts.promptSetVersionId, versionIds),
        eq(generatedPrompts.reviewStatus, "ready"),
        gte(generatedPrompts.qualityScore, 80),
      ),
    );
  await recordAudit({
    organizationId: ctx.organizationId,
    projectId: ctx.projectId,
    actorUserId: ctx.userId,
    action: "prompt.review.bulk_approve",
    entityType: "project",
    entityId: ctx.projectId,
    metadata: { promptCount: sets.reduce((total, set) => total + set.version.promptCount, 0) },
  });
}

function emptyRubric() {
  return {
    categorySpecificity: 0,
    personaContextFit: 0,
    naturalBuyerLanguage: 0,
    funnelCoherence: 0,
    answerValue: 0,
    evidenceSupport: 0,
    distinctiveness: 0,
    total: 0,
  };
}
