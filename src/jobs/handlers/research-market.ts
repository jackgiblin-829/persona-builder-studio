import "server-only";
import { eq, max } from "drizzle-orm";
import { getOpenAIAdapter } from "@/adapters/openai";
import { RESEARCH_STALE_DAYS } from "@/contracts/market-research";
import { strategyReadiness } from "@/contracts/prompt-strategy";
import { db } from "@/db/client";
import {
  generationRuns,
  marketResearchBriefs,
  personas,
  personaVersions,
  projects,
  researchSignals,
} from "@/db/schema";
import { AppError } from "@/lib/errors";
import { ID_PREFIXES, newId } from "@/lib/ids";
import { toStrictJsonSchema } from "@/prompts/json-schema";
import { MARKET_RESEARCH, renderTemplate } from "@/prompts/registry";
import { marketResearchBriefSchema, SCHEMA_VERSION } from "@/prompts/schemas";
import { withVendorUsage } from "@/services/usage";
import { JOB_TYPES, registerJob } from "../registry";

registerJob(JOB_TYPES.researchMarket, async ({ job }) => {
  const runId = String(job.payload.runId ?? "");
  if (!runId) throw new AppError("validation", "research_market requires runId");
  const [run] = await db.select().from(generationRuns).where(eq(generationRuns.id, runId)).limit(1);
  if (!run) throw new AppError("not_found", "Research run no longer exists");
  const [project] = await db.select().from(projects).where(eq(projects.id, run.projectId)).limit(1);
  if (!project) throw new AppError("not_found", "Project no longer exists");

  await db
    .update(generationRuns)
    .set({
      status: "running",
      stage: "researching_market",
      progress: 10,
      startedAt: new Date(),
      errorMessage: null,
      updatedAt: new Date(),
    })
    .where(eq(generationRuns.id, runId));

  try {
    const signals = await db
      .select({
        id: researchSignals.id,
        sourceKind: researchSignals.sourceKind,
        category: researchSignals.category,
        text: researchSignals.displayText,
        confidence: researchSignals.confidence,
        provenance: researchSignals.provenance,
        sourceLocation: researchSignals.sourceLocation,
      })
      .from(researchSignals)
      .where(eq(researchSignals.projectId, project.id));
    if (!signals.length) {
      throw new AppError(
        "validation",
        "Persona grounding requires completed uploaded or SparkToro evidence.",
      );
    }
    const activePersonas = await db
      .select({ persona: personas, version: personaVersions })
      .from(personas)
      .innerJoin(personaVersions, eq(personaVersions.id, personas.currentVersionId))
      .where(eq(personas.projectId, project.id));
    if (!activePersonas.length) {
      throw new AppError("validation", "Generate personas before creating a prompt taxonomy.");
    }
    const { adapter, mode } = await getOpenAIAdapter(project.organizationId);
    const result = await withVendorUsage(
      {
        organizationId: project.organizationId,
        projectId: project.id,
        vendor: "openai",
        operation: "persona_grounding_brief",
        mode,
        jobId: job.id,
      },
      () =>
        adapter.generateStructured({
          templateId: MARKET_RESEARCH.id,
          templateVersion: MARKET_RESEARCH.version,
          schemaVersion: SCHEMA_VERSION,
          system: MARKET_RESEARCH.system,
          user: renderTemplate(MARKET_RESEARCH, {
            project_context: JSON.stringify({
              name: project.name,
              canonicalDomain: project.canonicalDomain,
              description: project.description,
              market: project.primaryMarket,
              locale: project.languageLocale,
            }),
            prompt_strategy: JSON.stringify(project.promptStrategy),
            persona_profiles: JSON.stringify(
              activePersonas.map(({ persona, version }) => ({
                id: persona.id,
                name: version.name,
                description: version.description,
                profile: version.profile,
                evidenceUrl: `https://evidence.persona-builder.local/personas/${version.id}`,
              })),
            ),
            research_signals: JSON.stringify(
              signals.map((signal) => ({
                ...signal,
                evidenceUrl: `https://evidence.persona-builder.local/signals/${signal.id}`,
              })),
            ),
          }),
          schema: marketResearchBriefSchema,
          schemaName: "CitedMarketResearchBrief",
          jsonSchema: toStrictJsonSchema(marketResearchBriefSchema, "CitedMarketResearchBrief"),
          modelTier: MARKET_RESEARCH.modelTier,
          mockContext: {
            strategy: project.promptStrategy,
            domain: project.canonicalDomain,
            signals,
          },
        }),
      (value) => ({
        retryCount: value.attempts - 1,
        tokensIn: value.tokensIn,
        tokensOut: value.tokensOut,
        costCents: value.costCents,
      }),
    );
    const readiness = strategyReadiness(result.data.strategy);
    if (!readiness.ready) {
      throw new AppError(
        "schema_validation",
        `The researched strategy is incomplete: ${readiness.blockers.join(" ")}`,
      );
    }
    const [latest] = await db
      .select({ value: max(marketResearchBriefs.version) })
      .from(marketResearchBriefs)
      .where(eq(marketResearchBriefs.projectId, project.id));
    const capturedAt = new Date();
    const staleAt = new Date(capturedAt.getTime() + RESEARCH_STALE_DAYS * 24 * 60 * 60 * 1000);
    const briefId = newId(ID_PREFIXES.marketResearchBrief);
    await db.insert(marketResearchBriefs).values({
      id: briefId,
      organizationId: project.organizationId,
      projectId: project.id,
      generationRunId: runId,
      version: (latest?.value ?? 0) + 1,
      status: "draft",
      content: result.data,
      sourceRevision: project.sourceRevision,
      modelProvider: result.modelProvider,
      modelId: result.modelId,
      dataOrigin: result.dataOrigin,
      capturedAt,
      staleAt,
    });
    await db
      .update(generationRuns)
      .set({
        status: "completed",
        stage: "ready",
        progress: 100,
        resultingVersionIds: [briefId],
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(generationRuns.id, runId));
    return { status: "succeeded", result: { marketResearchBriefId: briefId } };
  } catch (error) {
    await db
      .update(generationRuns)
      .set({
        status: "failed",
        progress: 100,
        errorMessage: error instanceof Error ? error.message.slice(0, 3000) : String(error),
        finishedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(generationRuns.id, runId));
    throw error;
  }
});
