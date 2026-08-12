import "server-only";
import { and, desc, eq, inArray, isNull, max } from "drizzle-orm";
import { cosineSimilarity, getOpenAIAdapter, type OpenAIAdapter } from "@/adapters/openai";
import {
  buildCoverageBlueprint,
  FUNNEL_STAGE_LABELS,
  strategyReadiness,
  type CoverageCell,
  type PromptStrategy,
} from "@/contracts/prompt-strategy";
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
import { PROMPT_GENERATION, PROMPT_QUALITY_EVALUATION, renderTemplate } from "@/prompts/registry";
import {
  promptCandidateLibrarySchema,
  promptQualityEvaluationSchema,
  SCHEMA_VERSION,
  type PromptCandidateLibrary,
  type PromptLibraryGeneration,
  type PromptQualityEvaluation,
} from "@/prompts/schemas";
import { withVendorUsage } from "@/services/usage";
import { JOB_TYPES, registerJob } from "../registry";

const QUALITY_THRESHOLD = 80;
const SEMANTIC_DUPLICATE_THRESHOLD = 0.86;
const MAX_REPAIR_ROUNDS = 2;
export const PROMPT_CELLS_PER_BATCH = 10;

export type ActivePersona = {
  persona: typeof personas.$inferSelect;
  version: typeof personaVersions.$inferSelect;
};
type Candidate = PromptCandidateLibrary["candidates"][number];
type Assessment = PromptQualityEvaluation["assessments"][number];
export type EvaluatedPrompt = {
  candidate: Candidate;
  scores: PromptRubricScores;
  explanation: string;
  hardFailures: string[];
  maximumSimilarity: number;
};
type SelectedPrompt = EvaluatedPrompt & {
  reviewStatus: "ready" | "needs_revision";
};

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
    const context = {
      project,
      strategy,
      brief,
      active,
      signals,
      adapter,
      mode,
      jobId: job.id,
    };
    await updateRun(runId, { stage: "creating_prompts", progress: 25 });
    let selected = selectBestByCell(
      await generateAndEvaluateInBatches(context, blueprint, [], "initial"),
      blueprint,
    );

    for (let round = 1; round <= MAX_REPAIR_ROUNDS; round++) {
      selected = applyLibraryFailures(selected, blueprint);
      const failedKeys = selected
        .filter((prompt) => !passesQuality(prompt))
        .map((prompt) => prompt.candidate.plan_key);
      if (!failedKeys.length) break;
      await updateRun(runId, {
        stage: "validating",
        progress: 45 + round * 18,
        warnings: [
          ...run.warnings,
          `Repair round ${round}: ${failedKeys.length} coverage cells below the quality gate.`,
        ],
      });
      const failedCells = blueprint.filter((cell) => failedKeys.includes(cell.key));
      const fixed = selected.filter((prompt) => !failedKeys.includes(prompt.candidate.plan_key));
      const repaired = selectBestByCell(
        await generateAndEvaluateInBatches(context, failedCells, fixed, `repair_${round}`),
        failedCells,
      );
      const repairedByKey = new Map(repaired.map((prompt) => [prompt.candidate.plan_key, prompt]));
      selected = selected.map((prompt) => repairedByKey.get(prompt.candidate.plan_key) ?? prompt);
    }

    const finalized: SelectedPrompt[] = applyLibraryFailures(selected, blueprint).map((prompt) => ({
      ...prompt,
      reviewStatus: passesQuality(prompt) ? "ready" : "needs_revision",
    }));
    await updateRun(runId, { stage: "validating", progress: 88 });
    const versionIds = await persistPromptLibraryAtomically(project, runId, {
      active,
      strategy,
      blueprint,
      selected: finalized,
      researchBriefId: brief.id,
      modelProvider: finalized[0]?.candidate ? "openai" : mode,
      modelId: mode === "mock" ? "mock:quality-pipeline" : "responses-api",
      dataOrigin: mode,
    });
    const needsRevision = finalized.filter(
      (prompt) => prompt.reviewStatus === "needs_revision",
    ).length;
    await updateRun(runId, {
      status: needsRevision ? "completed_with_warnings" : "completed",
      stage: "ready",
      progress: 100,
      warnings: needsRevision
        ? [`${needsRevision} prompts need revision before the baseline can be exported.`]
        : [],
      resultingVersionIds: versionIds,
      finishedAt: new Date(),
    });
    return {
      status: needsRevision ? "partially_succeeded" : "succeeded",
      result: { promptSetVersionIds: versionIds, needsRevision },
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

async function generateAndEvaluateInBatches(
  context: Parameters<typeof generateAndEvaluate>[0],
  cells: CoverageCell[],
  fixed: EvaluatedPrompt[],
  operation: string,
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
    );
    evaluated.push(...result);
  }
  return evaluated;
}

export function buildPromptGenerationBatches(cells: CoverageCell[]): CoverageCell[][] {
  const batches: CoverageCell[][] = [];
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
  context: {
    project: typeof projects.$inferSelect;
    strategy: PromptStrategy;
    brief: typeof marketResearchBriefs.$inferSelect;
    active: ActivePersona[];
    signals: (typeof researchSignals.$inferSelect)[];
    adapter: OpenAIAdapter;
    mode: "mock" | "live";
    jobId: string;
  },
  cells: CoverageCell[],
  fixed: EvaluatedPrompt[],
  operation: string,
) {
  const candidateSchema = promptCandidateLibrarySchemaForBatch(cells.length);
  const projectContext = JSON.stringify({
    name: context.project.name,
    domain: context.project.canonicalDomain,
    description: context.project.description,
    market: context.project.primaryMarket,
    locale: context.project.languageLocale,
    promptStrategy: context.strategy,
  });
  const personaContext = JSON.stringify(
    context.active.map((item) => ({
      slug: item.persona.slug,
      name: item.version.name,
      description: item.version.description,
      profile: item.version.profile,
    })),
  );
  const signalContext = JSON.stringify(
    context.signals.map((signal) => ({
      id: signal.id,
      category: signal.category,
      text: signal.displayText,
      confidence: signal.confidence,
      provenance: signal.provenance,
    })),
  );
  const generated = await withVendorUsage(
    {
      organizationId: context.project.organizationId,
      projectId: context.project.id,
      vendor: "openai",
      operation: `prompt_candidates_${operation}`,
      mode: context.mode,
      jobId: context.jobId,
    },
    () =>
      context.adapter.generateStructured({
        templateId: PROMPT_GENERATION.id,
        templateVersion: PROMPT_GENERATION.version,
        schemaVersion: SCHEMA_VERSION,
        system: PROMPT_GENERATION.system,
        user: renderTemplate(PROMPT_GENERATION, {
          project_context: projectContext,
          market_brief: JSON.stringify(context.brief.content),
          persona_profiles: personaContext,
          coverage_blueprint: JSON.stringify(cells),
          research_signals: signalContext,
        }),
        schema: candidateSchema,
        schemaName: "GroundedPromptCandidateLibrary",
        jsonSchema: toStrictJsonSchema(candidateSchema, "GroundedPromptCandidateLibrary"),
        modelTier: PROMPT_GENERATION.modelTier,
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
  validateCandidateCoverage(generated.data.candidates, cells);
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
    let maximum = 0;
    for (let other = 0; other < embedded.embeddings.length; other++) {
      if (other === index) continue;
      if (
        other < generated.data.candidates.length &&
        generated.data.candidates[other]!.plan_key === candidate.plan_key
      ) {
        continue;
      }
      maximum = Math.max(maximum, cosineSimilarity(vector, embedded.embeddings[other]!));
    }
    return maximum;
  });
  const evaluationInput = generated.data.candidates.map((candidate, index) => ({
    ...candidate,
    coverage_cell: cells.find((cell) => cell.key === candidate.plan_key),
    maximum_semantic_similarity: maximumSimilarities[index],
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
            marketBrief: context.brief.content,
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
    return {
      candidate,
      scores,
      explanation: assessment.explanation,
      hardFailures: [
        ...assessment.hard_fail_reasons,
        ...deterministicFailures(
          candidate,
          cell,
          context.strategy,
          allowedSignalIds,
          allowedFactIds,
        ),
      ],
      maximumSimilarity: maximumSimilarities[index] ?? 0,
    };
  });
}

function scoresFromAssessment(assessment: Assessment): PromptRubricScores {
  const scores = {
    categorySpecificity: assessment.category_specificity,
    personaQualifierFit: assessment.persona_qualifier_fit,
    naturalBuyerLanguage: assessment.natural_buyer_language,
    measurementValue: assessment.measurement_value,
    researchSupport: assessment.research_support,
    distinctiveness: assessment.distinctiveness,
    metadataCompleteness: assessment.metadata_completeness,
  };
  return { ...scores, total: Object.values(scores).reduce((sum, value) => sum + value, 0) };
}

function validateCandidateCoverage(candidates: Candidate[], cells: CoverageCell[]) {
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
          Number(a.hardFailures.length > 0) - Number(b.hardFailures.length > 0) ||
          b.scores.total - a.scores.total ||
          a.maximumSimilarity - b.maximumSimilarity,
      );
    if (!options[0]) throw new AppError("schema_validation", `No candidate for ${cell.key}.`);
    return options[0];
  });
}

export function applyLibraryFailures(selected: EvaluatedPrompt[], blueprint: CoverageCell[]) {
  const failures = new Map<string, string[]>();
  const addFailure = (key: string, message: string) =>
    failures.set(key, [...(failures.get(key) ?? []), message]);
  const normalized = new Map<string, string>();
  selected.forEach((prompt) => {
    const value = normalizePromptText(prompt.candidate.prompt_text);
    const duplicate = normalized.get(value);
    if (duplicate) addFailure(prompt.candidate.plan_key, `Exact duplicate of ${duplicate}.`);
    else normalized.set(value, prompt.candidate.plan_key);
  });
  const openings = new Map<string, EvaluatedPrompt[]>();
  for (const prompt of selected) {
    if (prompt.maximumSimilarity >= SEMANTIC_DUPLICATE_THRESHOLD) {
      addFailure(
        prompt.candidate.plan_key,
        `Embedding similarity ${prompt.maximumSimilarity.toFixed(3)} exceeds ${SEMANTIC_DUPLICATE_THRESHOLD}.`,
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
      .forEach((prompt) => addFailure(prompt.candidate.plan_key, "Repeated sentence opening."));
  }
  for (let left = 0; left < selected.length; left++) {
    for (let right = left + 1; right < selected.length; right++) {
      const a = selected[left]!;
      const b = selected[right]!;
      if (semanticSimilarity(a.candidate.prompt_text, b.candidate.prompt_text) >= 0.9) {
        const weaker = a.scores.total <= b.scores.total ? a : b;
        addFailure(weaker.candidate.plan_key, "Near-duplicate wording in the selected baseline.");
      }
    }
  }
  return selected.map((prompt) => ({
    ...prompt,
    hardFailures: [
      ...new Set([...prompt.hardFailures, ...(failures.get(prompt.candidate.plan_key) ?? [])]),
    ],
  }));
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
  return prompt.scores.total >= QUALITY_THRESHOLD && prompt.hardFailures.length === 0;
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

function qualifierCoverage(text: string, qualifier: string) {
  const tokens = [...tokenSet(qualifier)];
  if (!tokens.length) return true;
  return tokens.filter((token) => text.includes(token)).length / tokens.length >= 0.6;
}

function deterministicFailures(
  prompt: Candidate,
  cell: CoverageCell,
  strategy: PromptStrategy,
  allowedSignalIds: Set<string>,
  allowedFactIds: Set<string>,
) {
  const failures: string[] = [];
  const text = normalizePromptText(prompt.prompt_text);
  const brandTerms = [strategy.canonicalBrand, ...strategy.aliases].filter(Boolean);
  const disambiguators = [
    strategy.parentCompany,
    ...strategy.aliases,
    ...strategy.entityCollisions,
  ].filter(Boolean);
  if (prompt.signal_ids.some((id) => !allowedSignalIds.has(id)))
    failures.push("Unknown signal ID.");
  if (prompt.research_fact_ids.some((id) => !allowedFactIds.has(id))) {
    failures.push("Unknown research fact ID.");
  }
  if (!prompt.signal_ids.length || !prompt.research_fact_ids.length) {
    failures.push("Missing research support.");
  }
  if (text.includes("when fit evidence risk and implementation effort all matter")) {
    failures.push("Banned boilerplate.");
  }
  const mentionsBrand = brandTerms.some((term) => includesTerm(text, term));
  if (cell.promptType === "unbranded" && mentionsBrand) failures.push("Brand leakage.");
  if (cell.promptType !== "unbranded" && !includesTerm(text, strategy.canonicalBrand)) {
    failures.push("Missing canonical brand.");
  }
  if (cell.promptType === "competitor_comparative" && !includesTerm(text, cell.competitor)) {
    failures.push("Missing assigned competitor.");
  }
  if (
    cell.promptType === "entity_disambiguation" &&
    disambiguators.length &&
    !disambiguators.some((term) => includesTerm(text, term))
  ) {
    failures.push("Missing disambiguating entity.");
  }
  if (!includesTerm(text, cell.businessLine)) failures.push("Missing business-line meaning.");
  if (cell.buyerQualifier && !qualifierCoverage(text, cell.buyerQualifier)) {
    failures.push("Missing buyer qualifier.");
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
    if (failures.length) throw new AppError("schema_validation", failures.join(" "));
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
    blueprint: CoverageCell[];
    selected: SelectedPrompt[];
    researchBriefId: string;
    modelProvider: string;
    modelId: string;
    dataOrigin: "mock" | "live";
  },
) {
  const versionIds: string[] = [];
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
        researchBriefId: built.researchBriefId,
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
          informationNeed: `${item.version.name} moves from ${FUNNEL_STAGE_LABELS.decision.toLowerCase()} selection questions through evaluation and awareness for ${group.cells[0]!.businessLine}.`,
          rationale:
            "This Query Funnel pathway begins with a conversion-adjacent anchor and projects upward using the approved persona and evidence brief.",
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
            researchFactIds: prompt.research_fact_ids,
            maximumSimilarity: selected.maximumSimilarity,
            reviewStatus: selected.reviewStatus,
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
      await tx
        .update(promptSets)
        .set({ currentVersionId: versionId, updatedAt: new Date() })
        .where(eq(promptSets.id, set.id));
      versionIds.push(versionId);
    }
  });
  return versionIds;
}

async function updateRun(id: string, values: Partial<typeof generationRuns.$inferInsert>) {
  await db
    .update(generationRuns)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(generationRuns.id, id));
}
