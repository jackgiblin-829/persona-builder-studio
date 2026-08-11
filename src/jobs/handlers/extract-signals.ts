import "server-only";
import { eq, sql } from "drizzle-orm";
import { getOpenAIAdapter } from "@/adapters/openai";
import { db } from "@/db/client";
import { dataSources, projects, researchSignals, sourceDocuments } from "@/db/schema";
import { chunkText } from "@/lib/chunking";
import { AppError } from "@/lib/errors";
import { ID_PREFIXES, newId } from "@/lib/ids";
import { toStrictJsonSchema } from "@/prompts/json-schema";
import { renderTemplate, SIGNAL_EXTRACTION } from "@/prompts/registry";
import { SCHEMA_VERSION, signalExtractionSchema } from "@/prompts/schemas";
import { withVendorUsage } from "@/services/usage";
import { JOB_TYPES, registerJob } from "../registry";

registerJob(JOB_TYPES.extractSignals, async ({ job }) => {
  const sourceId = String(job.payload.dataSourceId ?? "");
  if (!sourceId) throw new AppError("validation", "extract_signals requires dataSourceId");
  const [source] = await db.select().from(dataSources).where(eq(dataSources.id, sourceId)).limit(1);
  if (!source) throw new AppError("not_found", "Source no longer exists");
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, source.projectId))
    .limit(1);
  if (!project) throw new AppError("not_found", "Project no longer exists");
  const documents = await db
    .select()
    .from(sourceDocuments)
    .where(eq(sourceDocuments.dataSourceId, source.id))
    .orderBy(sourceDocuments.sequence);
  const { adapter, mode } = await getOpenAIAdapter(source.organizationId);
  await db.delete(researchSignals).where(eq(researchSignals.dataSourceId, source.id));

  let created = 0;
  let failedChunks = 0;
  for (const document of documents) {
    for (const chunk of chunkText(document.redactedText)) {
      try {
        const result = await withVendorUsage(
          {
            organizationId: source.organizationId,
            projectId: source.projectId,
            vendor: "openai",
            operation: "research_signal_extraction",
            mode,
            jobId: job.id,
          },
          () =>
            adapter.generateStructured({
              templateId: SIGNAL_EXTRACTION.id,
              templateVersion: SIGNAL_EXTRACTION.version,
              schemaVersion: SCHEMA_VERSION,
              system: SIGNAL_EXTRACTION.system,
              user: renderTemplate(SIGNAL_EXTRACTION, {
                project_context: `${project.name} — ${project.description}`,
                source_location: document.location,
                source_passage: chunk.text,
              }),
              schema: signalExtractionSchema,
              schemaName: "ResearchSignalExtraction",
              jsonSchema: toStrictJsonSchema(signalExtractionSchema, "ResearchSignalExtraction"),
              modelTier: SIGNAL_EXTRACTION.modelTier,
              mockContext: { passage: chunk.text, location: document.location },
            }),
          (value) => ({
            retryCount: value.attempts - 1,
            tokensIn: value.tokensIn,
            tokensOut: value.tokensOut,
            costCents: value.costCents,
          }),
        );
        for (const signal of result.data.signals) {
          await db.insert(researchSignals).values({
            id: newId(ID_PREFIXES.researchSignal),
            organizationId: source.organizationId,
            projectId: source.projectId,
            sourceKind: "first_party",
            dataSourceId: source.id,
            category: signal.category,
            displayText: signal.display_text,
            structuredValue: { quote: signal.quote },
            provenance: "observed",
            sourceLocation: signal.source_location,
            confidence: signal.confidence,
            dataOrigin: result.dataOrigin,
          });
          created++;
        }
      } catch {
        failedChunks++;
      }
    }
  }
  if (!created) {
    await db
      .update(dataSources)
      .set({
        status: "failed",
        stage: "failed",
        progress: 100,
        errorMessage: "No research signals could be extracted.",
        updatedAt: new Date(),
      })
      .where(eq(dataSources.id, source.id));
    throw new AppError("schema_validation", "No research signals could be extracted.");
  }
  const completedStatus = failedChunks ? "completed_with_warnings" : "completed";
  await db.transaction(async (tx) => {
    await tx
      .update(dataSources)
      .set({
        status: completedStatus,
        stage: "ready",
        progress: 100,
        signalCount: created,
        warningMessage: failedChunks
          ? `${failedChunks} passage(s) could not be extracted and can be retried.`
          : source.warningMessage,
        updatedAt: new Date(),
      })
      .where(eq(dataSources.id, source.id));
    await tx
      .update(projects)
      .set({ sourceRevision: sql`${projects.sourceRevision} + 1`, updatedAt: new Date() })
      .where(eq(projects.id, source.projectId));
  });
  return {
    status: failedChunks ? "partially_succeeded" : "succeeded",
    result: { signals: created, failedChunks },
  };
});
