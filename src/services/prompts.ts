import "server-only";
import { and, asc, eq, gte, inArray, isNotNull, isNull, ne } from "drizzle-orm";
import { getOpenAIAdapter } from "@/adapters/openai";
import type {
  CoverageCell,
  FunnelStage,
  PromptType,
  QuestionArchetype,
  TopicClass,
} from "@/contracts/prompt-strategy";
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

export async function editPromptText(ctx: ProjectContext, promptId: string, value: string) {
  requireCapability(ctx, "prompt:generate");
  const promptText = value.trim();
  if (promptText.length < 12 || promptText.length > 500) {
    throw new ValidationError("Keep prompt text between 12 and 500 characters.");
  }
  const [prompt] = await db
    .select()
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
      maximumSimilarity: 0,
      reviewStatus: "needs_revision",
      updatedAt: new Date(),
    })
    .where(eq(generatedPrompts.id, prompt.id));
  await recordAudit({
    organizationId: ctx.organizationId,
    projectId: ctx.projectId,
    actorUserId: ctx.userId,
    action: "prompt.edit",
    entityType: "generated_prompt",
    entityId: prompt.id,
  });
}

export async function regenerateSinglePrompt(ctx: ProjectContext, promptId: string) {
  requireCapability(ctx, "prompt:generate");
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
        eq(generatedPrompts.id, promptId),
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
  const competitor = row.prompt.namedEntities.find(
    (entity) => entity !== brief.content.strategy.canonicalBrand,
  );
  const cell: CoverageCell = {
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
  };
  const latestSets = await listLatestPromptSets(ctx);
  const fixed: EvaluatedPrompt[] = latestSets.flatMap((set) =>
    set.clusters.flatMap((cluster) =>
      cluster.prompts
        .filter((prompt) => prompt.id !== row.prompt.id)
        .map((prompt) => ({
          candidate: {
            plan_key: prompt.coverageKey,
            candidate_key: `${prompt.coverageKey}-a`,
            prompt_text: prompt.promptText,
            intent: prompt.intent,
            expected_answer_elements: prompt.expectedAnswerElements,
            signal_ids: prompt.signalIds,
            research_fact_ids: prompt.researchFactIds,
          },
          scores: prompt.rubricScores,
          explanation: prompt.evaluatorExplanation,
          hardFailures: prompt.reviewStatus === "needs_revision" ? ["Needs revision."] : [],
          maximumSimilarity: prompt.maximumSimilarity,
        })),
    ),
  );
  const { adapter, mode } = await getOpenAIAdapter(ctx.organizationId);
  let selected = selectBestByCell(
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
      },
      [cell],
      fixed,
      "single_row",
    ),
    [cell],
  );
  selected = applyLibraryFailures(selected, [cell]);
  const replacement = selected[0]!;
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
    personaQualifierFit: 0,
    naturalBuyerLanguage: 0,
    measurementValue: 0,
    researchSupport: 0,
    distinctiveness: 0,
    metadataCompleteness: 0,
    total: 0,
  };
}
