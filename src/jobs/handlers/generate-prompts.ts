import "server-only";
import { and, desc, eq, inArray, isNull, max } from "drizzle-orm";
import { cosineSimilarity, getOpenAIAdapter, type OpenAIAdapter } from "@/adapters/openai";
import {
  buildCoverageBlueprint,
  FUNNEL_STAGE_LABELS,
  strategyReadiness,
  type CoverageCell,
  type FunnelStage,
  type PromptStrategy,
} from "@/contracts/prompt-strategy";
import {
  hasPromptEvidence,
  qualityIssue,
  type PromptEvidencePacket,
  type PromptGenerationMetrics,
  type PromptPlanCell,
  type PromptQualityIssue,
} from "@/contracts/prompt-generation";
import { db } from "@/db/client";
import {
  generatedPrompts,
  generationRuns,
  marketResearchBriefs,
  personas,
  personaVersions,
  projects,
  promptClusters,
  promptSets,
  promptSetVersions,
  promptSignalLinks,
  researchSignals,
  type PromptRubricScores,
} from "@/db/schema";
import { sha256 } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import { ID_PREFIXES, newId, slugify } from "@/lib/ids";
import { toStrictJsonSchema } from "@/prompts/json-schema";
import {
  PROMPT_GENERATION,
  PROMPT_PLANNING,
  PROMPT_QUALITY_EVALUATION,
  PROMPT_REPAIR,
  renderTemplate,
} from "@/prompts/registry";
import {
  promptCandidateLibrarySchema,
  promptPlanSchema,
  promptQualityEvaluationSchema,
  SCHEMA_VERSION,
  type PromptCandidateLibrary,
  type PromptLibraryGeneration,
  type PromptQualityEvaluation,
} from "@/prompts/schemas";
import { withVendorUsage } from "@/services/usage";
import { JOB_TYPES, registerJob } from "../registry";

const QUALITY_THRESHOLD = 80;
const SEMANTIC_WARNING_THRESHOLD = 0.86;
const SEMANTIC_DUPLICATE_THRESHOLD = 0.92;
const MAX_REPAIR_ROUNDS = 2;
const MAX_COVERAGE_RETRIES = 1;
export const PROMPT_CELLS_PER_BATCH = 10;

export type ActivePersona = {
  persona: typeof personas.$inferSelect;
  version: typeof personaVersions.$inferSelect;
};
type Candidate = PromptCandidateLibrary["candidates"][number];
type Assessment = PromptQualityEvaluation["assessments"][number];
export type EvaluatedPrompt = {
  candidate: Candidate;
  cell: PromptPlanCell;
  scores: PromptRubricScores;
  explanation: string;
  repairInstruction: string;
  qualityIssues: PromptQualityIssue[];
  /** Backward-compatible text projection used by older service callers. */
  hardFailures: string[];
  maximumSimilarity: number;
};
type SelectedPrompt = EvaluatedPrompt & {
  reviewStatus: "ready" | "needs_revision";
};

type PromptGenerationTrace = PromptGenerationMetrics & {
  modelIdSet: Set<string>;
  startedAtMs: number;
};
type GenerationContext = {
  project: typeof projects.$inferSelect;
  strategy: PromptStrategy;
  brief: typeof marketResearchBriefs.$inferSelect;
  active: ActivePersona[];
  signals: (typeof researchSignals.$inferSelect)[];
  adapter: OpenAIAdapter;
  mode: "mock" | "live";
  jobId: string;
  trace: PromptGenerationTrace;
};

function createTrace(): PromptGenerationTrace {
  return {
    plannerCalls: 0,
    writerCalls: 0,
    evaluatorCalls: 0,
    repairCalls: 0,
    repairRounds: 0,
    initialCellCount: 0,
    initialPassCount: 0,
    finalPassCount: 0,
    durationMs: 0,
    tokensIn: 0,
    tokensOut: 0,
    costCents: 0,
    modelIds: [],
    byTemplate: {},
    modelIdSet: new Set(),
    startedAtMs: Date.now(),
  };
}

export function createPromptGenerationTrace() {
  return createTrace();
}

registerJob(JOB_TYPES.generatePrompts, async ({ job }) => {
  const runId = String(job.payload.runId ?? "");
  const personaIds = Array.isArray(job.payload.personaIds)
    ? job.payload.personaIds.filter((value): value is string => typeof value === "string")
    : [];
  if (!runId || !personaIds.length) {
    throw new AppError("validation", "generate_prompts requires runId and personaIds");
  }
  const [run] = await db.select().from(generationRuns).where(eq(generationRuns.id, runId)).limit(1);
  if (!run) throw new AppError("not_found", "Generation run no longer exists");
  const [project] = await db.select().from(projects).where(eq(projects.id, run.projectId)).limit(1);
  if (!project) throw new AppError("not_found", "Project no longer exists");

  await updateRun(runId, {
    status: "running",
    stage: "creating_clusters",
    progress: 5,
    startedAt: new Date(),
    errorMessage: null,
  });
  try {
    const active = await db
      .select({ persona: personas, version: personaVersions })
      .from(personas)
      .innerJoin(personaVersions, eq(personaVersions.id, personas.currentVersionId))
      .where(
        and(
          eq(personas.projectId, project.id),
          inArray(personas.id, personaIds),
          isNull(personas.archivedAt),
        ),
      );
    if (active.length !== personaIds.length) {
      throw new AppError("conflict", "One or more personas changed before generation started.");
    }
    const [brief] = await db
      .select()
      .from(marketResearchBriefs)
      .where(
        and(
          eq(marketResearchBriefs.projectId, project.id),
          eq(marketResearchBriefs.status, "approved"),
        ),
      )
      .orderBy(desc(marketResearchBriefs.version))
      .limit(1);
    if (!brief) {
      throw new AppError(
        "validation",
        "Approve a market research brief before generating prompts.",
      );
    }
    if (project.promptStrategyEdited) {
      throw new AppError(
        "validation",
        "The prompt strategy changed after research approval. Refresh and approve the market brief.",
      );
    }
    const strategy = brief.content.strategy;
    const readiness = strategyReadiness(strategy);
    if (!readiness.ready) {
      throw new AppError("validation", `Complete the strategy: ${readiness.blockers.join(" ")}`);
    }
    const blueprint = buildCoverageBlueprint(
      strategy,
      active.map((item) => ({ slug: item.persona.slug, name: item.version.name })),
    );
    validateArchetypeDistribution(blueprint);

    const signals = await db
      .select()
      .from(researchSignals)
      .where(eq(researchSignals.projectId, project.id));
    const allowedSignalIds = new Set(signals.map((signal) => signal.id));
    if (!allowedSignalIds.size) {
      throw new AppError("validation", "Prompt generation requires uploaded-source signals.");
    }

    const { adapter, mode } = await getOpenAIAdapter(project.organizationId);
    const trace = createTrace();
    const context = {
      project,
      strategy,
      brief,
      active,
      signals,
      adapter,
      mode,
      jobId: job.id,
      trace,
    };
    await updateRun(runId, { stage: "creating_clusters", progress: 18 });
    const planned = await planPromptLibrary(context, blueprint);
    await updateRun(runId, { stage: "creating_prompts", progress: 28 });
    let selected: EvaluatedPrompt[] = [];
    const stageProgress: Record<FunnelStage, number> = {
      decision: 42,
      consideration: 60,
      awareness: 78,
    };
    for (const stage of ["decision", "consideration", "awareness"] as const) {
      const stageCells = planned.filter((cell) => cell.funnelStage === stage);
      const completed = await generateStageWithRepairs(
        context,
        stageCells,
        selected,
        planned,
        stage,
      );
      selected = [...selected, ...completed];
      await updateRun(runId, {
        stage: "creating_prompts",
        progress: stageProgress[stage],
        warnings: [
          ...run.warnings,
          ...(completed.some((prompt) => !passesQuality(prompt))
            ? [`${stage}: one or more cells remain below the quality gate after targeted repair.`]
            : []),
        ],
      });
    }

    const finalized: SelectedPrompt[] = applyLibraryFailures(selected, planned).map((prompt) => ({
      ...prompt,
      reviewStatus: passesQuality(prompt) ? "ready" : "needs_revision",
    }));
    trace.finalPassCount = finalized.filter(passesQuality).length;
    await updateRun(runId, { stage: "validating", progress: 88 });
    const persisted = await persistPromptLibraryAtomically(project, runId, {
      active,
      strategy,
      blueprint: planned,
      selected: finalized,
      researchBriefId: brief.id,
      modelProvider: mode === "mock" ? "mock" : "openai",
      modelId: [...trace.modelIdSet].join(", ") || (mode === "mock" ? "mock:gpt-4.1" : "gpt-4.1"),
      dataOrigin: mode,
      metrics: finishTrace(trace),
    });
    const needsRevision = finalized.filter(
      (prompt) => prompt.reviewStatus === "needs_revision",
    ).length;
    await updateRun(runId, {
      status: needsRevision ? "completed_with_warnings" : "completed",
      stage: "ready",
      progress: 100,
      warnings: needsRevision
        ? [
            `${needsRevision} prompts need revision. The run is saved as a draft and the previous baseline remains current.`,
          ]
        : [],
      resultingVersionIds: persisted.versionIds,
      finishedAt: new Date(),
    });
    return {
      status: needsRevision ? "partially_succeeded" : "succeeded",
      result: {
        promptSetVersionIds: persisted.versionIds,
        needsRevision,
        promoted: persisted.promoted,
      },
    };
  } catch (error) {
    await updateRun(runId, {
      status: "failed",
      progress: 100,
      errorMessage: error instanceof Error ? error.message.slice(0, 3000) : String(error),
      finishedAt: new Date(),
    });
    throw error;
  }
});

type RepairFeedback = {
  previousCandidate: Candidate;
  issues: PromptQualityIssue[];
  evaluatorExplanation: string;
  repairInstruction: string;
  nearestConflict: string;
};

function recordTrace(
  trace: PromptGenerationTrace,
  phase: "planner" | "writer" | "evaluator" | "repair",
  value: {
    modelId: string;
    tokensIn: number;
    tokensOut: number;
    costCents: number;
    durationMs: number;
  },
) {
  if (phase === "planner") trace.plannerCalls++;
  else if (phase === "writer") trace.writerCalls++;
  else if (phase === "evaluator") trace.evaluatorCalls++;
  else trace.repairCalls++;
  trace.tokensIn += value.tokensIn;
  trace.tokensOut += value.tokensOut;
  trace.costCents += value.costCents;
  trace.modelIdSet.add(value.modelId);
  const template =
    phase === "planner"
      ? PROMPT_PLANNING
      : phase === "writer"
        ? PROMPT_GENERATION
        : phase === "evaluator"
          ? PROMPT_QUALITY_EVALUATION
          : PROMPT_REPAIR;
  const key = `${template.id}@${template.version}`;
  const metric = trace.byTemplate[key] ?? {
    calls: 0,
    latencyMs: 0,
    tokensIn: 0,
    tokensOut: 0,
    costCents: 0,
    modelIds: [],
  };
  metric.calls++;
  metric.latencyMs += value.durationMs;
  metric.tokensIn += value.tokensIn;
  metric.tokensOut += value.tokensOut;
  metric.costCents += value.costCents;
  if (!metric.modelIds.includes(value.modelId)) metric.modelIds.push(value.modelId);
  trace.byTemplate[key] = metric;
}

function finishTrace(trace: PromptGenerationTrace): PromptGenerationMetrics {
  return {
    plannerCalls: trace.plannerCalls,
    writerCalls: trace.writerCalls,
    evaluatorCalls: trace.evaluatorCalls,
    repairCalls: trace.repairCalls,
    repairRounds: trace.repairRounds,
    initialCellCount: trace.initialCellCount,
    initialPassCount: trace.initialPassCount,
    finalPassCount: trace.finalPassCount,
    durationMs: Date.now() - trace.startedAtMs,
    tokensIn: trace.tokensIn,
    tokensOut: trace.tokensOut,
    costCents: trace.costCents,
    modelIds: [...trace.modelIdSet],
    byTemplate: trace.byTemplate,
  };
}

export function validateFunnelHierarchy(cells: CoverageCell[]) {
  const byKey = new Map(cells.map((cell) => [cell.key, cell]));
  for (const cell of cells) {
    if (cell.funnelStage === "decision") {
      if (cell.parentKey)
        throw new AppError("schema_validation", `${cell.key} cannot have a parent.`);
      continue;
    }
    const parent = cell.parentKey ? byKey.get(cell.parentKey) : null;
    const expectedStage = cell.funnelStage === "consideration" ? "decision" : "consideration";
    if (!parent || parent.funnelStage !== expectedStage) {
      throw new AppError("schema_validation", `${cell.key} has an invalid parent.`);
    }
    if (
      parent.personaSlug !== cell.personaSlug ||
      parent.pathwayKey !== cell.pathwayKey ||
      parent.businessLine !== cell.businessLine
    ) {
      throw new AppError(
        "schema_validation",
        `${cell.key} must stay in its parent's persona, pathway, and business line.`,
      );
    }
  }
  for (const personaSlug of new Set(cells.map((cell) => cell.personaSlug))) {
    for (const parentStage of ["decision", "consideration"] as const) {
      const parents = cells.filter(
        (cell) => cell.personaSlug === personaSlug && cell.funnelStage === parentStage,
      );
      const childStage = parentStage === "decision" ? "consideration" : "awareness";
      const childCounts = parents.map(
        (parent) =>
          cells.filter(
            (cell) =>
              cell.personaSlug === personaSlug &&
              cell.funnelStage === childStage &&
              cell.parentKey === parent.key,
          ).length,
      );
      if (childCounts.length && Math.max(...childCounts) - Math.min(...childCounts) > 1) {
        throw new AppError(
          "schema_validation",
          `${childStage} cells are not balanced across ${parentStage} parents.`,
        );
      }
    }
  }
}

export async function planPromptLibrary(context: GenerationContext, blueprint: CoverageCell[]) {
  validateFunnelHierarchy(blueprint);
  const planned: PromptPlanCell[] = [];
  for (const active of context.active) {
    const personaCells = blueprint.filter((cell) => cell.personaSlug === active.persona.slug);
    if (!personaCells.length) continue;
    const packet = compileEvidencePacket(context, active);
    const schema = promptPlanSchema.extend({
      cells: promptPlanSchema.shape.cells.length(personaCells.length),
    });
    const result = await withVendorUsage(
      {
        organizationId: context.project.organizationId,
        projectId: context.project.id,
        vendor: "openai",
        operation: `prompt_plan_${active.persona.slug}`,
        mode: context.mode,
        jobId: context.jobId,
      },
      () =>
        context.adapter.generateStructured({
          templateId: PROMPT_PLANNING.id,
          templateVersion: PROMPT_PLANNING.version,
          schemaVersion: SCHEMA_VERSION,
          system: PROMPT_PLANNING.system,
          user: renderTemplate(PROMPT_PLANNING, {
            project_context: JSON.stringify(projectContract(context)),
            evidence_packet: JSON.stringify(packet),
            coverage_blueprint: JSON.stringify(personaCells),
          }),
          schema,
          schemaName: "QueryFunnelLogicalPlan",
          jsonSchema: toStrictJsonSchema(schema, "QueryFunnelLogicalPlan"),
          modelTier: PROMPT_PLANNING.modelTier,
          mockContext: {
            blueprint: personaCells,
            strategy: context.strategy,
            personaSlug: active.persona.slug,
            personaName: active.version.name,
            signals: packet.signals.map((signal) => ({
              id: signal.id,
              category: signal.category,
              displayText: signal.text,
            })),
            factIds: packet.facts.map((fact) => fact.id),
          },
        }),
      (value) => ({
        retryCount: value.attempts - 1,
        tokensIn: value.tokensIn,
        tokensOut: value.tokensOut,
        costCents: value.costCents,
      }),
    );
    recordTrace(context.trace, "planner", result);
    if (result.data.persona_slug !== active.persona.slug) {
      throw new AppError("schema_validation", "The prompt plan changed the persona slug.");
    }
    const planByKey = new Map(result.data.cells.map((cell) => [cell.plan_key, cell]));
    if (planByKey.size !== personaCells.length) {
      throw new AppError(
        "schema_validation",
        "The prompt plan did not cover every cell exactly once.",
      );
    }
    const allowedSignalIds = new Set(packet.signals.map((signal) => signal.id));
    const allowedFactIds = new Set(packet.facts.map((fact) => fact.id));
    const allowedEntities = new Set(
      [
        context.strategy.canonicalBrand,
        context.strategy.parentCompany,
        ...context.strategy.aliases,
        ...context.strategy.entityCollisions,
        ...context.strategy.competitors,
      ]
        .filter(Boolean)
        .map(normalizePromptText),
    );
    for (const cell of personaCells) {
      const semantic = planByKey.get(cell.key);
      if (!semantic) throw new AppError("schema_validation", `Missing plan cell ${cell.key}.`);
      const signalIds = semantic.signal_ids.filter((id) => allowedSignalIds.has(id));
      const researchFactIds = semantic.research_fact_ids.filter((id) => allowedFactIds.has(id));
      const permittedEntities = semantic.permitted_entities.filter((entity) =>
        allowedEntities.has(normalizePromptText(entity)),
      );
      const hasEvidence = hasPromptEvidence(signalIds, researchFactIds);
      planned.push({
        ...cell,
        buyerMoment: semantic.buyer_moment,
        informationNeed: semantic.information_need,
        stageObjective: semantic.stage_objective,
        requiredConcepts: semantic.required_concepts,
        permittedEntities,
        signalIds,
        researchFactIds,
        parentReason: semantic.parent_reason,
        evidenceStatus:
          semantic.evidence_status === "supported" && hasEvidence
            ? "supported"
            : "insufficient_evidence",
      });
    }
  }
  return planned.sort((a, b) => a.sequence - b.sequence);
}

function compileEvidencePacket(
  context: GenerationContext,
  active: ActivePersona,
): PromptEvidencePacket {
  const referenced = collectSignalIds(active.version.profile);
  const personaSignals = context.signals.filter(
    (signal) => referenced.has(signal.id) && signal.confidence >= 0.6,
  );
  const rankedSignals = personaSignals.sort(
    (left, right) =>
      Number(referenced.has(right.id)) - Number(referenced.has(left.id)) ||
      right.confidence - left.confidence,
  );
  return {
    personaSlug: active.persona.slug,
    personaName: active.version.name,
    personaDescription: active.version.description,
    personaSummary: active.version.profile.summary,
    market: context.project.primaryMarket,
    locale: context.project.languageLocale,
    signals: rankedSignals.slice(0, 80).map((signal) => ({
      id: signal.id,
      category: signal.category,
      text: signal.displayText,
      confidence: signal.confidence,
    })),
    facts: context.brief.content.facts.slice(0, 80).map((fact) => ({
      id: fact.id,
      kind: fact.kind,
      claim: fact.claim,
    })),
  };
}

function collectSignalIds(value: unknown, output = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    value.forEach((item) => collectSignalIds(item, output));
  } else if (value && typeof value === "object") {
    for (const [key, nested] of Object.entries(value)) {
      if (key === "signalIds" && Array.isArray(nested)) {
        nested.forEach((id) => typeof id === "string" && output.add(id));
      } else collectSignalIds(nested, output);
    }
  }
  return output;
}

function projectContract(context: GenerationContext) {
  return {
    name: context.project.name,
    domain: context.project.canonicalDomain,
    description: context.project.description,
    market: context.project.primaryMarket,
    locale: context.project.languageLocale,
    strategy: context.strategy,
  };
}

async function generateStageWithRepairs(
  context: GenerationContext,
  cells: PromptPlanCell[],
  fixed: EvaluatedPrompt[],
  fullPlan: PromptPlanCell[],
  stage: FunnelStage,
) {
  let selected = selectBestByCell(
    await generateAndEvaluateInBatches(context, cells, fixed, `${stage}_initial`),
    cells,
  );
  for (let round = 1; round <= MAX_REPAIR_ROUNDS; round++) {
    const combined = applyLibraryFailures([...fixed, ...selected], fullPlan);
    const combinedByKey = new Map(combined.map((prompt) => [prompt.candidate.plan_key, prompt]));
    selected = selected.map((prompt) => combinedByKey.get(prompt.candidate.plan_key) ?? prompt);
    if (round === 1) {
      context.trace.initialCellCount += selected.length;
      context.trace.initialPassCount += selected.filter(passesQuality).length;
    }
    const failed = selected.filter((prompt) => !passesQuality(prompt));
    if (!failed.length) break;
    context.trace.repairRounds = Math.max(context.trace.repairRounds, round);
    const feedback = new Map<string, RepairFeedback>();
    for (const prompt of failed) {
      feedback.set(prompt.candidate.plan_key, {
        previousCandidate: prompt.candidate,
        issues: prompt.qualityIssues,
        evaluatorExplanation: prompt.explanation,
        repairInstruction: prompt.repairInstruction,
        nearestConflict: nearestConflictFor(prompt, [...fixed, ...selected]),
      });
    }
    const failedKeys = new Set(failed.map((prompt) => prompt.candidate.plan_key));
    const fixedForRepair = [
      ...fixed,
      ...selected.filter((prompt) => !failedKeys.has(prompt.candidate.plan_key)),
    ];
    const repaired = selectBestByCell(
      await generateAndEvaluateInBatches(
        context,
        cells.filter((cell) => failedKeys.has(cell.key)),
        fixedForRepair,
        `${stage}_repair_${round}`,
        feedback,
      ),
      cells.filter((cell) => failedKeys.has(cell.key)),
    );
    const repairedByKey = new Map(repaired.map((prompt) => [prompt.candidate.plan_key, prompt]));
    selected = selected.map((prompt) => repairedByKey.get(prompt.candidate.plan_key) ?? prompt);
  }
  const finalCombined = applyLibraryFailures([...fixed, ...selected], fullPlan);
  const finalByKey = new Map(finalCombined.map((prompt) => [prompt.candidate.plan_key, prompt]));
  return selected.map((prompt) => finalByKey.get(prompt.candidate.plan_key) ?? prompt);
}

function nearestConflictFor(prompt: EvaluatedPrompt, library: EvaluatedPrompt[]) {
  return (
    library
      .filter(
        (candidate) =>
          candidate.candidate.plan_key !== prompt.candidate.plan_key &&
          !isAncestorPair(
            prompt.cell,
            candidate.cell,
            library.map((item) => item.cell),
          ),
      )
      .map((candidate) => ({
        text: candidate.candidate.prompt_text,
        similarity: semanticSimilarity(
          prompt.candidate.prompt_text,
          candidate.candidate.prompt_text,
        ),
      }))
      .sort((left, right) => right.similarity - left.similarity)[0]?.text ?? ""
  );
}

async function generateAndEvaluateInBatches(
  context: GenerationContext,
  cells: PromptPlanCell[],
  fixed: EvaluatedPrompt[],
  operation: string,
  repairFeedback?: Map<string, RepairFeedback>,
) {
  const evaluated: EvaluatedPrompt[] = [];
  const batches = buildPromptGenerationBatches(cells);
  for (let index = 0; index < batches.length; index++) {
    const batch = batches[index]!;
    const result = await generateAndEvaluate(
      context,
      batch,
      [...fixed, ...evaluated],
      `${operation}_${index + 1}`,
      repairFeedback,
    );
    evaluated.push(...result);
  }
  return evaluated;
}

export function buildPromptGenerationBatches<T extends CoverageCell>(cells: T[]): T[][] {
  const batches: T[][] = [];
  for (const personaSlug of new Set(cells.map((cell) => cell.personaSlug))) {
    const personaCells = cells.filter((cell) => cell.personaSlug === personaSlug);
    for (let index = 0; index < personaCells.length; index += PROMPT_CELLS_PER_BATCH) {
      batches.push(personaCells.slice(index, index + PROMPT_CELLS_PER_BATCH));
    }
  }
  return batches;
}

export function promptCandidateLibrarySchemaForBatch(cellCount: number) {
  return promptCandidateLibrarySchema.extend({
    candidates: promptCandidateLibrarySchema.shape.candidates.length(cellCount * 2),
  });
}

export function promptQualityEvaluationSchemaForBatch(candidateCount: number) {
  return promptQualityEvaluationSchema.extend({
    assessments: promptQualityEvaluationSchema.shape.assessments.length(candidateCount),
  });
}

export async function generateAndEvaluate(
  context: GenerationContext,
  cells: PromptPlanCell[],
  fixed: EvaluatedPrompt[],
  operation: string,
  repairFeedback?: Map<string, RepairFeedback>,
) {
  const candidateSchema = promptCandidateLibrarySchemaForBatch(cells.length);
  const generationContext = cells.map((cell) => {
    const feedback = repairFeedback?.get(cell.key);
    return {
      plan: cell,
      selected_parent: cell.parentKey
        ? (fixed.find((prompt) => prompt.candidate.plan_key === cell.parentKey)?.candidate
            .prompt_text ?? null)
        : null,
      evidence: evidenceForCell(context, cell),
      ...(feedback
        ? {
            previous_candidate: feedback.previousCandidate,
            issues: feedback.issues,
            evaluator_explanation: feedback.evaluatorExplanation,
            repair_instruction: feedback.repairInstruction,
            nearest_conflicting_prompt: feedback.nearestConflict || null,
          }
        : {}),
    };
  });
  const template = repairFeedback ? PROMPT_REPAIR : PROMPT_GENERATION;
  const baseUserPrompt = renderTemplate(template, {
    project_context: JSON.stringify(projectContract(context)),
    generation_context: JSON.stringify(generationContext),
    repair_context: JSON.stringify(generationContext),
  });
  const requestCandidates = async (coverageAttempt: number) => {
    const generated = await withVendorUsage(
      {
        organizationId: context.project.organizationId,
        projectId: context.project.id,
        vendor: "openai",
        operation: `prompt_candidates_${operation}${coverageAttempt ? `_coverage_retry_${coverageAttempt}` : ""}`,
        mode: context.mode,
        jobId: context.jobId,
      },
      () =>
        context.adapter.generateStructured({
          templateId: template.id,
          templateVersion: template.version,
          schemaVersion: SCHEMA_VERSION,
          system: template.system,
          user: coverageAttempt
            ? `${baseUserPrompt}\n\nCoverage correction: return exactly two candidates for each of these plan keys and no others: ${cells.map((cell) => cell.key).join(", ")}. Keep every plan_key unchanged.`
            : baseUserPrompt,
          schema: candidateSchema,
          schemaName: "GroundedPromptCandidateLibrary",
          jsonSchema: toStrictJsonSchema(candidateSchema, "GroundedPromptCandidateLibrary"),
          modelTier: template.modelTier,
          mockContext: {
            strategy: context.strategy,
            blueprint: cells,
            personaNames: Object.fromEntries(
              context.active.map((item) => [item.persona.slug, item.version.name]),
            ),
            signals: context.signals.map((signal) => ({
              id: signal.id,
              category: signal.category,
              displayText: signal.displayText,
            })),
            factIds: context.brief.content.facts.map((fact) => fact.id),
          },
        }),
      (value) => ({
        retryCount: value.attempts - 1,
        tokensIn: value.tokensIn,
        tokensOut: value.tokensOut,
        costCents: value.costCents,
      }),
    );
    recordTrace(context.trace, repairFeedback ? "repair" : "writer", generated);
    return generated;
  };
  let generated = await requestCandidates(0);
  for (let coverageAttempt = 0; ; coverageAttempt++) {
    try {
      validateCandidateCoverage(generated.data.candidates, cells);
      break;
    } catch (error) {
      if (coverageAttempt >= MAX_COVERAGE_RETRIES || !(error instanceof AppError)) throw error;
      generated = await requestCandidates(coverageAttempt + 1);
    }
  }
  const candidateTexts = generated.data.candidates.map((candidate) => candidate.prompt_text);
  const fixedTexts = fixed.map((prompt) => prompt.candidate.prompt_text);
  const embedded = await withVendorUsage(
    {
      organizationId: context.project.organizationId,
      projectId: context.project.id,
      vendor: "openai",
      operation: `prompt_similarity_${operation}`,
      mode: context.mode,
      jobId: context.jobId,
    },
    () => context.adapter.embed({ texts: [...candidateTexts, ...fixedTexts] }),
    (value) => ({ tokensIn: value.tokensIn, costCents: value.costCents }),
  );
  const candidateVectors = embedded.embeddings.slice(0, candidateTexts.length);
  const maximumSimilarities = candidateVectors.map((vector, index) => {
    const candidate = generated.data.candidates[index]!;
    const candidateCell = cells.find((cell) => cell.key === candidate.plan_key)!;
    let maximum = 0;
    for (let other = 0; other < embedded.embeddings.length; other++) {
      if (other === index) continue;
      const otherCell =
        other < generated.data.candidates.length
          ? cells.find((cell) => cell.key === generated.data.candidates[other]!.plan_key)
          : fixed[other - generated.data.candidates.length]?.cell;
      if (!otherCell || otherCell.key === candidate.plan_key) continue;
      if (isAncestorPair(candidateCell, otherCell, [...cells, ...fixed.map((item) => item.cell)]))
        continue;
      maximum = Math.max(maximum, cosineSimilarity(vector, embedded.embeddings[other]!));
    }
    return maximum;
  });
  const evaluationInput = generated.data.candidates.map((candidate, index) => ({
    ...candidate,
    planned_cell: cells.find((cell) => cell.key === candidate.plan_key),
    selected_parent: cells.find((cell) => cell.key === candidate.plan_key)?.parentKey
      ? (fixed.find(
          (prompt) =>
            prompt.candidate.plan_key ===
            cells.find((cell) => cell.key === candidate.plan_key)?.parentKey,
        )?.candidate.prompt_text ?? null)
      : null,
    evidence: evidenceForCell(
      context,
      cells.find((cell) => cell.key === candidate.plan_key)!,
    ),
    maximum_semantic_similarity: maximumSimilarities[index],
    similarity_requires_duplicate_review:
      (maximumSimilarities[index] ?? 0) >= SEMANTIC_DUPLICATE_THRESHOLD,
  }));
  const evaluationSchema = promptQualityEvaluationSchemaForBatch(evaluationInput.length);
  const evaluated = await withVendorUsage(
    {
      organizationId: context.project.organizationId,
      projectId: context.project.id,
      vendor: "openai",
      operation: `prompt_quality_${operation}`,
      mode: context.mode,
      jobId: context.jobId,
    },
    () =>
      context.adapter.generateStructured({
        templateId: PROMPT_QUALITY_EVALUATION.id,
        templateVersion: PROMPT_QUALITY_EVALUATION.version,
        schemaVersion: SCHEMA_VERSION,
        system: PROMPT_QUALITY_EVALUATION.system,
        user: renderTemplate(PROMPT_QUALITY_EVALUATION, {
          project_context: JSON.stringify({
            strategy: context.strategy,
            market: context.project.primaryMarket,
            locale: context.project.languageLocale,
          }),
          candidates: JSON.stringify(evaluationInput),
        }),
        schema: evaluationSchema,
        schemaName: "PromptCandidateQualityEvaluation",
        jsonSchema: toStrictJsonSchema(evaluationSchema, "PromptCandidateQualityEvaluation"),
        modelTier: PROMPT_QUALITY_EVALUATION.modelTier,
        mockContext: { candidates: evaluationInput },
      }),
    (value) => ({
      retryCount: value.attempts - 1,
      tokensIn: value.tokensIn,
      tokensOut: value.tokensOut,
      costCents: value.costCents,
    }),
  );
  recordTrace(context.trace, "evaluator", evaluated);
  const assessmentMap = new Map(
    evaluated.data.assessments.map((assessment) => [assessment.candidate_key, assessment]),
  );
  if (assessmentMap.size !== generated.data.candidates.length) {
    throw new AppError("schema_validation", "The evaluator did not score every candidate.");
  }
  const allowedSignalIds = new Set(context.signals.map((signal) => signal.id));
  const allowedFactIds = new Set(context.brief.content.facts.map((fact) => fact.id));
  return generated.data.candidates.map((candidate, index) => {
    const assessment = assessmentMap.get(candidate.candidate_key)!;
    const cell = cells.find((item) => item.key === candidate.plan_key)!;
    const scores = scoresFromAssessment(assessment);
    const issues = dedupeIssues([
      ...assessment.issues,
      ...deterministicFailures(candidate, cell, context.strategy, allowedSignalIds, allowedFactIds),
    ]);
    return {
      candidate,
      cell,
      scores,
      explanation: assessment.explanation,
      repairInstruction: assessment.repair_instruction,
      qualityIssues: issues,
      hardFailures: issues.filter((issue) => issue.blocking).map((issue) => issue.message),
      maximumSimilarity: maximumSimilarities[index] ?? 0,
    };
  });
}

function evidenceForCell(context: GenerationContext, cell: PromptPlanCell) {
  const signalIds = new Set(cell.signalIds);
  const factIds = new Set(cell.researchFactIds);
  return {
    signals: context.signals
      .filter((signal) => signalIds.has(signal.id))
      .map((signal) => ({
        id: signal.id,
        category: signal.category,
        text: signal.displayText,
        confidence: signal.confidence,
      })),
    facts: context.brief.content.facts
      .filter((fact) => factIds.has(fact.id))
      .map((fact) => ({ id: fact.id, kind: fact.kind, claim: fact.claim })),
  };
}

function scoresFromAssessment(assessment: Assessment): PromptRubricScores {
  const scores = {
    categorySpecificity: assessment.category_specificity,
    personaContextFit: assessment.persona_context_fit,
    naturalBuyerLanguage: assessment.natural_buyer_language,
    funnelCoherence: assessment.funnel_coherence,
    answerValue: assessment.answer_value,
    evidenceSupport: assessment.evidence_support,
    distinctiveness: assessment.distinctiveness,
  };
  return { ...scores, total: Object.values(scores).reduce((sum, value) => sum + value, 0) };
}

export function validateCandidateCoverage(candidates: Candidate[], cells: CoverageCell[]) {
  if (candidates.length !== cells.length * 2) {
    throw new AppError(
      "schema_validation",
      `Expected ${cells.length * 2} prompt candidates, received ${candidates.length}.`,
    );
  }
  for (const cell of cells) {
    const rows = candidates.filter((candidate) => candidate.plan_key === cell.key);
    if (rows.length !== 2 || new Set(rows.map((row) => row.candidate_key)).size !== 2) {
      throw new AppError("schema_validation", `Coverage cell ${cell.key} needs two candidates.`);
    }
  }
}

export function selectBestByCell(evaluated: EvaluatedPrompt[], cells: CoverageCell[]) {
  return cells.map((cell) => {
    const options = evaluated
      .filter((prompt) => prompt.candidate.plan_key === cell.key)
      .sort(
        (a, b) =>
          Number(a.qualityIssues.some((issue) => issue.blocking)) -
            Number(b.qualityIssues.some((issue) => issue.blocking)) ||
          Number(a.scores.funnelCoherence < 16 || a.scores.evidenceSupport < 8) -
            Number(b.scores.funnelCoherence < 16 || b.scores.evidenceSupport < 8) ||
          b.scores.total - a.scores.total ||
          a.maximumSimilarity - b.maximumSimilarity,
      );
    if (!options[0]) throw new AppError("schema_validation", `No candidate for ${cell.key}.`);
    return options[0];
  });
}

export function applyLibraryFailures(selected: EvaluatedPrompt[], blueprint: CoverageCell[]) {
  const libraryCodes = new Set([
    "exact_duplicate",
    "semantic_duplicate",
    "semantic_similarity_warning",
    "repeated_opening",
  ]);
  const issues = new Map<string, PromptQualityIssue[]>();
  const addIssue = (key: string, issue: PromptQualityIssue) =>
    issues.set(key, [...(issues.get(key) ?? []), issue]);
  const normalized = new Map<string, string>();
  selected.forEach((prompt) => {
    const value = normalizePromptText(prompt.candidate.prompt_text);
    const duplicate = normalized.get(value);
    if (duplicate)
      addIssue(
        prompt.candidate.plan_key,
        qualityIssue("exact_duplicate", `Exact duplicate of ${duplicate}.`),
      );
    else normalized.set(value, prompt.candidate.plan_key);
  });
  const openings = new Map<string, EvaluatedPrompt[]>();
  for (const prompt of selected) {
    if (prompt.maximumSimilarity >= SEMANTIC_DUPLICATE_THRESHOLD) {
      addIssue(
        prompt.candidate.plan_key,
        qualityIssue(
          "semantic_duplicate",
          `Non-ancestor similarity ${prompt.maximumSimilarity.toFixed(3)} exceeds ${SEMANTIC_DUPLICATE_THRESHOLD}.`,
        ),
      );
    } else if (prompt.maximumSimilarity >= SEMANTIC_WARNING_THRESHOLD) {
      addIssue(
        prompt.candidate.plan_key,
        qualityIssue(
          "semantic_similarity_warning",
          `Similarity ${prompt.maximumSimilarity.toFixed(3)} needs review but is not blocking by itself.`,
          false,
        ),
      );
    }
    const opening = normalizePromptText(prompt.candidate.prompt_text)
      .split(" ")
      .slice(0, 4)
      .join(" ");
    openings.set(opening, [...(openings.get(opening) ?? []), prompt]);
  }
  const openingLimit = Math.max(2, Math.ceil(blueprint.length * 0.1));
  for (const rows of openings.values()) {
    rows
      .sort((a, b) => b.scores.total - a.scores.total)
      .slice(openingLimit)
      .forEach((prompt) =>
        addIssue(
          prompt.candidate.plan_key,
          qualityIssue("repeated_opening", "Repeated sentence opening."),
        ),
      );
  }
  for (let left = 0; left < selected.length; left++) {
    for (let right = left + 1; right < selected.length; right++) {
      const a = selected[left]!;
      const b = selected[right]!;
      if (isAncestorPair(a.cell, b.cell, blueprint)) continue;
      const materiallyComparable =
        a.cell.funnelStage === b.cell.funnelStage &&
        normalizePromptText(a.cell.businessLine) === normalizePromptText(b.cell.businessLine);
      if (
        materiallyComparable &&
        semanticSimilarity(a.candidate.prompt_text, b.candidate.prompt_text) >= 0.9
      ) {
        const weaker = a.scores.total <= b.scores.total ? a : b;
        addIssue(
          weaker.candidate.plan_key,
          qualityIssue("semantic_duplicate", "Near-duplicate intent in the selected baseline."),
        );
      }
    }
  }
  return selected.map((prompt) => {
    const merged = dedupeIssues([
      ...prompt.qualityIssues.filter((issue) => !libraryCodes.has(issue.code)),
      ...(issues.get(prompt.candidate.plan_key) ?? []),
    ]);
    return {
      ...prompt,
      qualityIssues: merged,
      hardFailures: merged.filter((issue) => issue.blocking).map((issue) => issue.message),
    };
  });
}

function dedupeIssues(items: PromptQualityIssue[]) {
  const seen = new Set<string>();
  return items.filter((issue) => {
    const key = `${issue.code}:${issue.message}:${issue.blocking}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function isAncestorPair(left: CoverageCell, right: CoverageCell, blueprint: CoverageCell[]) {
  if (left.personaSlug !== right.personaSlug) return false;
  const byKey = new Map(blueprint.map((cell) => [cell.key, cell]));
  const contains = (ancestor: string, child: CoverageCell) => {
    let parentKey = child.parentKey;
    while (parentKey) {
      if (parentKey === ancestor) return true;
      parentKey = byKey.get(parentKey)?.parentKey ?? null;
    }
    return false;
  };
  return contains(left.key, right) || contains(right.key, left);
}

function validateArchetypeDistribution(blueprint: CoverageCell[]) {
  const counts = new Map<string, number>();
  blueprint.forEach((cell) =>
    counts.set(cell.questionArchetype, (counts.get(cell.questionArchetype) ?? 0) + 1),
  );
  const maximum = Math.ceil(blueprint.length * 0.2);
  if ([...counts.values()].some((count) => count > maximum)) {
    throw new AppError("validation", "One question archetype exceeds 20% of the baseline.");
  }
}

export function passesQuality(prompt: EvaluatedPrompt) {
  return (
    prompt.scores.total >= QUALITY_THRESHOLD &&
    prompt.scores.funnelCoherence >= 16 &&
    prompt.scores.evidenceSupport >= 8 &&
    !prompt.qualityIssues.some((issue) => issue.blocking)
  );
}

export function normalizePromptText(value: string) {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokenSet(value: string) {
  return new Set(
    normalizePromptText(value)
      .split(" ")
      .filter((token) => token.length > 2),
  );
}

export function semanticSimilarity(left: string, right: string) {
  const a = tokenSet(left);
  const b = tokenSet(right);
  if (!a.size || !b.size) return 0;
  let intersection = 0;
  for (const token of a) if (b.has(token)) intersection++;
  return intersection / (a.size + b.size - intersection);
}

function includesTerm(text: string, term: string) {
  const normalizedTerm = normalizePromptText(term);
  return normalizedTerm.length >= 2 && text.includes(normalizedTerm);
}

function deterministicFailures(
  prompt: Candidate,
  cell: CoverageCell | PromptPlanCell,
  strategy: PromptStrategy,
  allowedSignalIds: Set<string>,
  allowedFactIds: Set<string>,
) {
  const failures: PromptQualityIssue[] = [];
  const text = normalizePromptText(prompt.prompt_text);
  const brandTerms = [strategy.canonicalBrand, ...strategy.aliases].filter(Boolean);
  const disambiguators = [
    strategy.parentCompany,
    ...strategy.aliases,
    ...strategy.entityCollisions,
  ].filter(Boolean);
  if (prompt.signal_ids.some((id) => !allowedSignalIds.has(id)))
    failures.push(qualityIssue("unknown_signal", "Unknown signal ID."));
  if (prompt.research_fact_ids.some((id) => !allowedFactIds.has(id))) {
    failures.push(qualityIssue("unknown_research_fact", "Unknown research fact ID."));
  }
  if (!hasPromptEvidence(prompt.signal_ids, prompt.research_fact_ids)) {
    failures.push(qualityIssue("missing_research_support", "Missing research support."));
  }
  if ("evidenceStatus" in cell && cell.evidenceStatus === "insufficient_evidence") {
    failures.push(
      qualityIssue(
        "insufficient_evidence",
        "The logical plan has insufficient evidence for this cell.",
      ),
    );
  }
  if (text.includes("when fit evidence risk and implementation effort all matter")) {
    failures.push(qualityIssue("boilerplate", "Banned boilerplate."));
  }
  const mentionsBrand = brandTerms.some((term) => includesTerm(text, term));
  if (cell.promptType === "unbranded" && mentionsBrand)
    failures.push(qualityIssue("brand_leakage", "Brand leakage."));
  if (cell.promptType !== "unbranded" && !includesTerm(text, strategy.canonicalBrand)) {
    failures.push(qualityIssue("missing_canonical_brand", "Missing canonical brand."));
  }
  if (cell.promptType === "competitor_comparative" && !includesTerm(text, cell.competitor)) {
    failures.push(qualityIssue("missing_competitor", "Missing assigned competitor."));
  }
  if (
    cell.promptType === "entity_disambiguation" &&
    disambiguators.length &&
    !disambiguators.some((term) => includesTerm(text, term))
  ) {
    failures.push(qualityIssue("missing_disambiguating_entity", "Missing disambiguating entity."));
  }
  const permittedCompetitors = new Set(
    ("permittedEntities" in cell ? cell.permittedEntities : [cell.competitor])
      .filter(Boolean)
      .map(normalizePromptText),
  );
  const unsupportedCompetitor = strategy.competitors.find(
    (competitor) =>
      includesTerm(text, competitor) && !permittedCompetitors.has(normalizePromptText(competitor)),
  );
  if (unsupportedCompetitor) {
    failures.push(
      qualityIssue("unsupported_entity", `Unsupported competitor ${unsupportedCompetitor}.`),
    );
  }
  if (cell.funnelStage !== "decision" && !cell.parentKey) {
    failures.push(qualityIssue("invalid_parent", "Missing required parent cell."));
  }
  return failures;
}

// Retained as a strict utility for regression tests and imported libraries.
export function validatePromptLibrary(
  output: PromptLibraryGeneration,
  blueprint: CoverageCell[],
  allowedSignalIds: Set<string>,
  strategy: PromptStrategy,
) {
  if (output.prompts.length !== blueprint.length) {
    throw new AppError("schema_validation", `Expected ${blueprint.length} prompts.`);
  }
  const seen = new Set<string>();
  const normalized = new Set<string>();
  for (const prompt of output.prompts) {
    const cell = blueprint.find((item) => item.key === prompt.plan_key);
    if (!cell || seen.has(prompt.plan_key))
      throw new AppError("schema_validation", "Invalid plan key.");
    seen.add(prompt.plan_key);
    const text = normalizePromptText(prompt.prompt_text);
    if (normalized.has(text)) throw new AppError("schema_validation", "Exact duplicate prompt.");
    normalized.add(text);
    const failures = deterministicFailures(
      { ...prompt, candidate_key: `${prompt.plan_key}-a`, research_fact_ids: ["fact-001"] },
      cell,
      strategy,
      allowedSignalIds,
      new Set(["fact-001"]),
    );
    if (failures.length)
      throw new AppError("schema_validation", failures.map((failure) => failure.message).join(" "));
  }
}

function namedEntities(cell: CoverageCell, strategy: PromptStrategy) {
  if (cell.promptType === "competitor_comparative")
    return [strategy.canonicalBrand, cell.competitor];
  if (cell.promptType === "branded" || cell.promptType === "entity_disambiguation") {
    return [strategy.canonicalBrand];
  }
  return [];
}

function qualitySummary(selected: SelectedPrompt[]) {
  const ready = selected.filter((prompt) => prompt.reviewStatus === "ready");
  const average = selected.length
    ? selected.reduce((sum, prompt) => sum + prompt.scores.total, 0) / selected.length
    : 0;
  return {
    promptCount: selected.length,
    readyCount: ready.length,
    needsRevisionCount: selected.length - ready.length,
    averageQualityScore: Math.round(average * 10) / 10,
    minimumQualityScore: Math.min(...selected.map((prompt) => prompt.scores.total)),
    qualityThreshold: QUALITY_THRESHOLD,
    passed: ready.length === selected.length,
  };
}

async function persistPromptLibraryAtomically(
  project: typeof projects.$inferSelect,
  runId: string,
  built: {
    active: ActivePersona[];
    strategy: PromptStrategy;
    blueprint: PromptPlanCell[];
    selected: SelectedPrompt[];
    researchBriefId: string;
    modelProvider: string;
    modelId: string;
    dataOrigin: "mock" | "live";
    metrics: PromptGenerationMetrics;
  },
) {
  const versionIds: string[] = [];
  const promoted = built.selected.every(passesQuality);
  const outputByKey = new Map(built.selected.map((prompt) => [prompt.candidate.plan_key, prompt]));
  await db.transaction(async (tx) => {
    for (const item of built.active) {
      const personaCells = built.blueprint.filter((cell) => cell.personaSlug === item.persona.slug);
      if (!personaCells.length) continue;
      let [set] = await tx
        .select()
        .from(promptSets)
        .where(eq(promptSets.personaId, item.persona.id))
        .limit(1);
      if (!set) {
        [set] = await tx
          .insert(promptSets)
          .values({
            id: newId(ID_PREFIXES.promptSet),
            organizationId: project.organizationId,
            projectId: project.id,
            personaId: item.persona.id,
          })
          .returning();
      }
      if (!set) throw new AppError("internal", "Could not create prompt set");
      const [latest] = await tx
        .select({ value: max(promptSetVersions.version) })
        .from(promptSetVersions)
        .where(eq(promptSetVersions.promptSetId, set.id));
      const pathwayGroups = [...new Set(personaCells.map((cell) => cell.pathwayKey))].map(
        (pathwayKey) => ({
          pathwayKey,
          label: personaCells.find((cell) => cell.pathwayKey === pathwayKey)!.pathwayLabel,
          cells: personaCells.filter((cell) => cell.pathwayKey === pathwayKey),
        }),
      );
      const versionId = newId(ID_PREFIXES.promptSetVersion);
      await tx.insert(promptSetVersions).values({
        id: versionId,
        organizationId: project.organizationId,
        projectId: project.id,
        promptSetId: set.id,
        personaVersionId: item.version.id,
        generationRunId: runId,
        version: (latest?.value ?? 0) + 1,
        clusterCount: pathwayGroups.length,
        promptCount: personaCells.length,
        modelProvider: built.modelProvider,
        modelId: built.modelId,
        dataOrigin: built.dataOrigin,
        lifecycleStatus: promoted ? "current" : "draft",
        researchBriefId: built.researchBriefId,
        plannerPromptVersion: PROMPT_PLANNING.version,
        writerPromptVersion: PROMPT_GENERATION.version,
        evaluatorPromptVersion: PROMPT_QUALITY_EVALUATION.version,
        repairPromptVersion: PROMPT_REPAIR.version,
        schemaVersion: SCHEMA_VERSION,
        generationMetrics: built.metrics,
        strategySnapshot: built.strategy,
        qualitySummary: qualitySummary(personaCells.map((cell) => outputByKey.get(cell.key)!)),
      });

      for (let groupIndex = 0; groupIndex < pathwayGroups.length; groupIndex++) {
        const group = pathwayGroups[groupIndex]!;
        const clusterId = newId(ID_PREFIXES.promptCluster);
        const groupPrompts = group.cells.map((cell) => outputByKey.get(cell.key)!);
        const groupSignalIds = [
          ...new Set(groupPrompts.flatMap((prompt) => prompt.candidate.signal_ids)),
        ];
        await tx.insert(promptClusters).values({
          id: clusterId,
          organizationId: project.organizationId,
          projectId: project.id,
          promptSetVersionId: versionId,
          personaVersionId: item.version.id,
          sequence: groupIndex,
          title: group.label,
          slug: slugify(group.pathwayKey),
          seedTopic: group.cells[0]!.businessLine,
          informationNeed:
            group.cells.find((cell) => cell.funnelStage === "decision")?.informationNeed ??
            `${item.version.name} evaluates ${group.cells[0]!.businessLine}.`,
          rationale: `This pathway starts with ${FUNNEL_STAGE_LABELS.decision.toLowerCase()} anchors and connects each evaluation and awareness need to a selected parent using the approved persona evidence.`,
          signalIds: groupSignalIds,
        });

        for (let promptIndex = 0; promptIndex < group.cells.length; promptIndex++) {
          const cell = group.cells[promptIndex]!;
          const selected = outputByKey.get(cell.key)!;
          const prompt = selected.candidate;
          const promptId = newId(ID_PREFIXES.prompt);
          await tx.insert(generatedPrompts).values({
            id: promptId,
            organizationId: project.organizationId,
            projectId: project.id,
            promptSetVersionId: versionId,
            clusterId,
            personaVersionId: item.version.id,
            sequence: promptIndex,
            coverageKey: cell.key,
            parentCoverageKey: cell.parentKey,
            promptText: prompt.prompt_text,
            normalizedHash: sha256(normalizePromptText(prompt.prompt_text)),
            geoCategory: cell.geoCategory,
            topicClass: cell.topicClass,
            promptType: cell.promptType,
            questionArchetype: cell.questionArchetype,
            intent: prompt.intent,
            journeyStage: cell.funnelStage,
            businessLine: cell.businessLine,
            signalTracked: cell.signalTracked,
            buyerQualifier: cell.buyerQualifier,
            namedEntities: namedEntities(cell, built.strategy),
            qualityScore: selected.scores.total,
            rubricScores: selected.scores,
            evaluatorExplanation: [selected.explanation, ...selected.hardFailures].join(" "),
            qualityIssues: selected.qualityIssues,
            researchFactIds: prompt.research_fact_ids,
            maximumSimilarity: selected.maximumSimilarity,
            reviewStatus: promoted ? "approved" : selected.reviewStatus,
            expectedAnswerElements: prompt.expected_answer_elements,
            signalIds: prompt.signal_ids,
          });
          for (const signalId of [...new Set(prompt.signal_ids)]) {
            await tx.insert(promptSignalLinks).values({
              id: newId(ID_PREFIXES.promptSignalLink),
              organizationId: project.organizationId,
              promptId,
              signalId,
            });
          }
        }
      }
      if (promoted) {
        if (set.currentVersionId) {
          await tx
            .update(promptSetVersions)
            .set({ lifecycleStatus: "superseded" })
            .where(eq(promptSetVersions.id, set.currentVersionId));
        }
        await tx
          .update(promptSets)
          .set({ currentVersionId: versionId, updatedAt: new Date() })
          .where(eq(promptSets.id, set.id));
      }
      versionIds.push(versionId);
    }
  });
  return { versionIds, promoted };
}

async function updateRun(id: string, values: Partial<typeof generationRuns.$inferInsert>) {
  await db
    .update(generationRuns)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(generationRuns.id, id));
}
