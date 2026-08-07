import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import {
  competitors,
  dataSources,
  evidenceRecords,
  ingestionJobs,
  sourceDocuments,
} from "@/db/schema";
import { getOpenAIAdapter } from "@/adapters/openai";
import { getQueue } from "@/adapters/queue";
import { AppError } from "@/lib/errors";
import { newId, ID_PREFIXES } from "@/lib/ids";
import { chunkText } from "@/lib/chunking";
import { classifyPiiStatus, redact } from "@/lib/redaction";
import { EVIDENCE_EXTRACTION, renderTemplate } from "@/prompts/registry";
import { evidenceExtractionSchema, SCHEMA_VERSION } from "@/prompts/schemas";
import { toStrictJsonSchema } from "@/prompts/json-schema";
import { recordVendorUsage } from "@/services/usage";
import { JOB_TYPES, registerJob } from "../registry";
import { loadBrandContext, markStage } from "./ingest-source";

/**
 * Stage 2: turn redacted source documents into atomic evidence records.
 *
 * Only redacted text is ever sent to the model. Every record stores the exact
 * model id, prompt-template version, schema version and source offsets, so a
 * claim can always be traced back to the passage it came from.
 */
registerJob(JOB_TYPES.extractEvidence, async ({ job }) => {
  const dataSourceId = String(job.payload.dataSourceId ?? "");
  if (!dataSourceId) throw new AppError("validation", "extract_evidence requires dataSourceId");

  const [source] = await db
    .select()
    .from(dataSources)
    .where(eq(dataSources.id, dataSourceId))
    .limit(1);
  if (!source) throw new AppError("not_found", `Data source ${dataSourceId} no longer exists`);
  if (source.deletedAt) return { status: "succeeded", result: { skipped: "source was deleted" } };
  if (source.excludeFromModelCalls) {
    return { status: "succeeded", result: { skipped: "source is excluded from model calls" } };
  }

  await markStage(dataSourceId, "extract", "running");

  const brand = await loadBrandContext(source.brandId);
  const competitorRows = await db
    .select({ name: competitors.name })
    .from(competitors)
    .where(eq(competitors.brandId, source.brandId));
  const competitorNames = competitorRows.map((row) => row.name);

  const documents = await db
    .select()
    .from(sourceDocuments)
    .where(eq(sourceDocuments.dataSourceId, dataSourceId))
    .orderBy(sourceDocuments.sequence);

  if (documents.length === 0) {
    await markStage(dataSourceId, "extract", "failed", "No parsed documents to extract from.");
    throw new AppError("validation", "No parsed documents to extract from.");
  }

  const { adapter, mode } = await getOpenAIAdapter(source.organizationId);
  const jsonSchema = toStrictJsonSchema(evidenceExtractionSchema, "EvidenceExtraction");

  const brandContext = [
    `Brand: ${brand.name} (${brand.canonicalDomain})`,
    `Description: ${brand.description}`,
    competitorNames.length > 0 ? `Known competitors: ${competitorNames.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  // Re-extraction replaces this source's records rather than duplicating them.
  await db.delete(evidenceRecords).where(eq(evidenceRecords.dataSourceId, dataSourceId));

  let created = 0;
  let failedChunks = 0;
  const errors: string[] = [];

  for (const document of documents) {
    const chunks = chunkText(document.redactedText);

    for (const chunk of chunks) {
      const started = Date.now();
      try {
        const result = await adapter.generateStructured({
          templateId: EVIDENCE_EXTRACTION.id,
          templateVersion: EVIDENCE_EXTRACTION.version,
          schemaVersion: SCHEMA_VERSION,
          system: EVIDENCE_EXTRACTION.system,
          user: renderTemplate(EVIDENCE_EXTRACTION, {
            brand_context: brandContext,
            source_metadata: [
              `Source label: ${source.label}`,
              `Source type: ${source.sourceType}`,
              `Source system: ${source.sourceSystem}`,
              `Location: ${document.location}`,
              document.speaker ? `Speaker: ${document.speaker}` : "",
              document.observedAt ? `Observed at: ${document.observedAt.toISOString()}` : "",
            ]
              .filter(Boolean)
              .join("\n"),
            source_passage: chunk.text,
          }),
          schema: evidenceExtractionSchema,
          schemaName: "EvidenceExtraction",
          jsonSchema,
          modelTier: EVIDENCE_EXTRACTION.modelTier,
          mockContext: {
            passage: chunk.text,
            speaker: chunk.speaker ?? document.speaker,
            sourceType: source.sourceType,
            brandName: brand.name,
            competitorNames,
            observedAt: document.observedAt?.toISOString() ?? null,
          },
        });

        await recordVendorUsage({
          organizationId: source.organizationId,
          brandId: source.brandId,
          vendor: "openai",
          operation: "evidence_extraction",
          mode,
          jobId: job.id,
          durationMs: Date.now() - started,
          retryCount: result.attempts - 1,
          outcome: "success",
          tokensIn: result.tokensIn,
          tokensOut: result.tokensOut,
          costCents: result.costCents,
        });

        for (const item of result.data.records) {
          // Belt and braces: the model sees redacted text, but anything it
          // echoes back is redacted again before storage.
          const quoteRedaction = redact(item.quote);
          const claimRedaction = redact(item.normalized_claim);

          await db.insert(evidenceRecords).values({
            id: newId(ID_PREFIXES.evidence),
            organizationId: source.organizationId,
            brandId: source.brandId,
            dataSourceId,
            sourceDocumentId: document.id,
            sourceType: source.sourceType,
            sourceSystem: source.sourceSystem,
            sourceLocation: document.location,
            charStart: chunk.charStart + item.char_start,
            charEnd: chunk.charStart + item.char_end,
            timestampLabel: (document.metadata as { timestamp?: string })?.timestamp ?? null,
            observedAt: document.observedAt ?? source.observedAt,
            speaker: item.speaker ?? document.speaker,
            rawText: quoteRedaction.text,
            redactedText: quoteRedaction.text,
            normalizedClaim: claimRedaction.text,
            category: item.category,
            provenance: item.provenance,
            journeyStage: item.journey_stage,
            sentiment: item.sentiment,
            entities: item.entities,
            vocabulary: item.vocabulary,
            candidateSegmentLabels: [],
            piiStatus: classifyPiiStatus(item.quote, quoteRedaction),
            extractionConfidence: item.extraction_confidence,
            qualityScore: item.quality_score,
            uncertaintyNote: item.uncertainty_note,
            createdByModel: result.modelId,
            modelProvider: result.modelProvider,
            promptTemplateVersion: EVIDENCE_EXTRACTION.version,
            schemaVersion: SCHEMA_VERSION,
            dataOrigin: result.dataOrigin,
            reviewStatus: "pending_review",
          });
          created++;
        }
      } catch (error) {
        // One bad chunk must not discard the rest of the source (§ error handling).
        failedChunks++;
        const message = error instanceof Error ? error.message : String(error);
        errors.push(`${document.location} chunk ${chunk.index}: ${message}`);

        await recordVendorUsage({
          organizationId: source.organizationId,
          brandId: source.brandId,
          vendor: "openai",
          operation: "evidence_extraction",
          mode,
          jobId: job.id,
          durationMs: Date.now() - started,
          retryCount: 0,
          outcome: "failure",
          errorCode: error instanceof Error ? error.name : "unknown",
        });
      }
    }
  }

  await db
    .update(dataSources)
    .set({
      evidenceCount: created,
      status: failedChunks > 0 ? "partially_succeeded" : "succeeded",
      updatedAt: new Date(),
    })
    .where(eq(dataSources.id, dataSourceId));

  await markStage(
    dataSourceId,
    "extract",
    failedChunks > 0 ? "partially_succeeded" : "succeeded",
    failedChunks > 0
      ? `${created} record(s) extracted; ${failedChunks} chunk(s) failed. ${errors.slice(0, 3).join(" | ")}`
      : `${created} evidence record(s) extracted.`,
  );

  if (created > 0) {
    await db.insert(ingestionJobs).values({
      id: newId(ID_PREFIXES.ingestionJob),
      organizationId: source.organizationId,
      brandId: source.brandId,
      dataSourceId,
      stage: "embed",
      status: "queued",
    });

    await getQueue().enqueue(
      JOB_TYPES.embedEvidence,
      { dataSourceId },
      {
        organizationId: source.organizationId,
        brandId: source.brandId,
        idempotencyKey: `embed:${dataSourceId}:${job.id}`,
      },
    );
  }

  return {
    status: failedChunks > 0 ? "partially_succeeded" : "succeeded",
    result: { created, failedChunks, errors: errors.slice(0, 10) },
  };
});
