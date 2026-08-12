import "server-only";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { closeDb, db } from "@/db/client";
import {
  generatedPrompts,
  generationRuns,
  personas,
  projects,
  promptSets,
  promptSetVersions,
} from "@/db/schema";
import type { ProjectContext } from "@/lib/auth/context";
import { hasPromptEvidence } from "@/contracts/prompt-generation";
import { startPromptGeneration } from "@/services/studio";

const projectId = process.env.EVAL_PROJECT_ID ?? "prj_01kzsk3zj7md5b81p068836b9m";

async function promptRowsForVersions(versionIds: string[]) {
  if (!versionIds.length) return [];
  return db
    .select()
    .from(generatedPrompts)
    .where(inArray(generatedPrompts.promptSetVersionId, versionIds));
}

function summarizePrompts(prompts: Array<typeof generatedPrompts.$inferSelect>) {
  const issueCounts: Record<string, number> = {};
  for (const prompt of prompts) {
    for (const issue of prompt.qualityIssues) {
      issueCounts[issue.code] = (issueCounts[issue.code] ?? 0) + 1;
    }
  }
  const normalized = prompts.map((prompt) =>
    prompt.promptText.toLowerCase().replace(/[^a-z0-9]+/g, ""),
  );
  return {
    promptCount: prompts.length,
    stageCounts: {
      bofu: prompts.filter((prompt) => prompt.journeyStage === "decision").length,
      mofu: prompts.filter((prompt) => prompt.journeyStage === "consideration").length,
      tofu: prompts.filter((prompt) => prompt.journeyStage === "awareness").length,
    },
    passingRows: prompts.filter(
      (prompt) =>
        prompt.qualityScore >= 80 &&
        prompt.rubricScores.funnelCoherence >= 16 &&
        prompt.rubricScores.evidenceSupport >= 8 &&
        !prompt.qualityIssues.some((issue) => issue.blocking),
    ).length,
    readyRows: prompts.filter((prompt) => ["ready", "approved"].includes(prompt.reviewStatus))
      .length,
    needsRevisionRows: prompts.filter((prompt) => prompt.reviewStatus === "needs_revision").length,
    averageQuality:
      prompts.reduce((sum, prompt) => sum + prompt.qualityScore, 0) / Math.max(prompts.length, 1),
    minimumQuality: prompts.length ? Math.min(...prompts.map((prompt) => prompt.qualityScore)) : 0,
    citationValidityRate:
      prompts.filter((prompt) => hasPromptEvidence(prompt.signalIds, prompt.researchFactIds))
        .length / Math.max(prompts.length, 1),
    exactDuplicateRows: normalized.length - new Set(normalized).size,
    blockingDuplicateRows: prompts.filter((prompt) =>
      prompt.qualityIssues.some(
        (issue) => issue.blocking && ["exact_duplicate", "semantic_duplicate"].includes(issue.code),
      ),
    ).length,
    issueCounts,
  };
}

async function main() {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) throw new Error(`Evaluation project ${projectId} was not found.`);

  const currentSetsBefore = await db
    .select({ versionId: promptSets.currentVersionId })
    .from(promptSets)
    .innerJoin(personas, eq(personas.id, promptSets.personaId))
    .where(and(eq(promptSets.projectId, projectId), isNull(personas.archivedAt)));
  const legacyVersionIds = currentSetsBefore
    .map((row) => row.versionId)
    .filter((value): value is string => Boolean(value));
  const legacyPrompts = await promptRowsForVersions(legacyVersionIds);

  const context: ProjectContext = {
    userId: "usr_analyst",
    userName: "Demo Strategist",
    userEmail: "analyst@example.com",
    organizationId: project.organizationId,
    role: "editor",
    projectId: project.id,
    projectName: project.name,
    projectSlug: project.slug,
  };

  const runId = await startPromptGeneration(context);
  const [run] = await db.select().from(generationRuns).where(eq(generationRuns.id, runId)).limit(1);
  if (!run) throw new Error(`Generation run ${runId} disappeared.`);
  const candidateVersionIds = run.resultingVersionIds;
  const candidateVersions = candidateVersionIds.length
    ? await db
        .select()
        .from(promptSetVersions)
        .where(inArray(promptSetVersions.id, candidateVersionIds))
    : [];
  const candidatePrompts = await promptRowsForVersions(candidateVersionIds);
  const metrics = candidateVersions[0]?.generationMetrics ?? null;

  const report = {
    evaluatedAt: new Date().toISOString(),
    project: { id: project.id, name: project.name },
    model: process.env.OPENAI_MODEL_REASONING ?? "gpt-4.1",
    run: {
      id: run.id,
      status: run.status,
      promoted: candidateVersions.every((version) => version.lifecycleStatus === "current"),
      lifecycleStatuses: [...new Set(candidateVersions.map((version) => version.lifecycleStatus))],
    },
    legacy: {
      versionIds: legacyVersionIds,
      ...summarizePrompts(legacyPrompts),
    },
    revised: {
      versionIds: candidateVersionIds,
      ...summarizePrompts(candidatePrompts),
      metrics,
      firstPassRate:
        metrics && metrics.initialCellCount
          ? metrics.initialPassCount / metrics.initialCellCount
          : null,
      finalPassRate:
        metrics && metrics.initialCellCount
          ? metrics.finalPassCount / metrics.initialCellCount
          : null,
    },
  };
  console.log(`QUERY_FUNNEL_EVAL_RESULT=${JSON.stringify(report)}`);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  })
  .finally(async () => closeDb());
