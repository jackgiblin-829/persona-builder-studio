import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { brands, dataSources, ingestionJobs, sourceDocuments } from "@/db/schema";
import { getObjectStorage } from "@/adapters/storage";
import { getQueue } from "@/adapters/queue";
import { sha256 } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import { newId, ID_PREFIXES } from "@/lib/ids";
import {
  parseCsv,
  parseDocx,
  parseJson,
  parseMarkdown,
  parseSearchConsoleCsv,
  parseText,
  parseTranscript,
  type ParseResult,
} from "@/lib/parsers";
import { redactWithStatus } from "@/lib/redaction";
import { JOB_TYPES, registerJob } from "../registry";

/**
 * Stage 1 of ingestion: read the stored object, parse it into documents,
 * redact PII, persist, then hand off to extraction.
 *
 * Raw source text and redacted text are both stored — the raw text is what
 * "open original source context" shows to a reviewer, and only the redacted
 * text is ever sent to a model provider.
 */
registerJob(JOB_TYPES.ingestSource, async ({ job }) => {
  const dataSourceId = String(job.payload.dataSourceId ?? "");
  const format = String(job.payload.format ?? "txt");
  if (!dataSourceId) throw new AppError("validation", "ingest_source requires dataSourceId");

  const [source] = await db
    .select()
    .from(dataSources)
    .where(eq(dataSources.id, dataSourceId))
    .limit(1);
  if (!source) throw new AppError("not_found", `Data source ${dataSourceId} no longer exists`);
  if (source.deletedAt) {
    return { status: "succeeded", result: { skipped: "source was deleted" } };
  }

  await markStage(dataSourceId, "parse", "running");
  await db
    .update(dataSources)
    .set({ status: "running", updatedAt: new Date() })
    .where(eq(dataSources.id, dataSourceId));

  try {
    if (!source.storageKey) throw new AppError("validation", "Source has no stored object");
    const bytes = await getObjectStorage().get(source.storageKey);
    const label = source.label;

    let parsed: ParseResult;
    switch (format) {
      case "csv":
        parsed = parseCsv(bytes.toString("utf8"));
        break;
      case "search_console_csv":
        parsed = parseSearchConsoleCsv(bytes.toString("utf8"));
        break;
      case "json":
        parsed = parseJson(bytes.toString("utf8"));
        break;
      case "markdown":
        parsed = parseMarkdown(bytes.toString("utf8"), label);
        break;
      case "docx":
        parsed = await parseDocx(bytes, label);
        break;
      case "transcript":
        parsed = parseTranscript(bytes.toString("utf8"), label);
        break;
      default:
        parsed = parseText(bytes.toString("utf8"), label);
    }

    if (parsed.documents.length === 0) {
      throw new AppError("validation", "No usable documents were found in this source.");
    }

    // Re-running ingestion for a source replaces its documents rather than
    // duplicating them; extraction is keyed off document ids.
    await db.delete(sourceDocuments).where(eq(sourceDocuments.dataSourceId, dataSourceId));

    let redactionCount = 0;
    let sequence = 0;
    const seenHashes = new Set<string>();

    for (const document of parsed.documents) {
      const contentHash = sha256(document.text);
      if (seenHashes.has(contentHash)) continue; // exact duplicate within one source
      seenHashes.add(contentHash);

      const redaction = redactWithStatus(document.text);
      redactionCount += redaction.count;

      await db.insert(sourceDocuments).values({
        id: newId(ID_PREFIXES.sourceDocument),
        organizationId: source.organizationId,
        brandId: source.brandId,
        dataSourceId,
        title: document.title,
        location: document.location,
        sequence: sequence++,
        rawText: document.text,
        redactedText: redaction.text,
        piiFindings: redaction.findings,
        metadata: { ...document.metadata, piiStatus: redaction.status, warnings: parsed.warnings },
        speaker: document.speaker ?? null,
        observedAt: document.observedAt ?? source.observedAt,
        contentHash,
      });
    }

    await db
      .update(dataSources)
      .set({
        documentCount: sequence,
        piiRedactionCount: redactionCount,
        updatedAt: new Date(),
      })
      .where(eq(dataSources.id, dataSourceId));

    await markStage(
      dataSourceId,
      "parse",
      "succeeded",
      `${sequence} document(s), ${redactionCount} redaction(s)`,
    );

    if (source.excludeFromModelCalls) {
      // Honour the exclusion: parse and store, but never send to a model.
      await db
        .update(dataSources)
        .set({ status: "succeeded", updatedAt: new Date() })
        .where(eq(dataSources.id, dataSourceId));
      await markStage(
        dataSourceId,
        "extract",
        "cancelled",
        "Source is excluded from model calls, so no evidence was extracted.",
      );
      return { status: "succeeded", result: { documents: sequence, extraction: "skipped" } };
    }

    await db.insert(ingestionJobs).values({
      id: newId(ID_PREFIXES.ingestionJob),
      organizationId: source.organizationId,
      brandId: source.brandId,
      dataSourceId,
      stage: "extract",
      status: "queued",
    });

    await getQueue().enqueue(
      JOB_TYPES.extractEvidence,
      { dataSourceId },
      {
        organizationId: source.organizationId,
        brandId: source.brandId,
        idempotencyKey: `extract:${dataSourceId}:${job.id}`,
      },
    );

    return { status: "succeeded", result: { documents: sequence, redactions: redactionCount } };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markStage(dataSourceId, "parse", "failed", message);
    await db
      .update(dataSources)
      .set({ status: "failed", updatedAt: new Date() })
      .where(eq(dataSources.id, dataSourceId));
    throw error;
  }
});

/**
 * Records the outcome of one ingestion stage.
 *
 * Upserts rather than updating: a stage that was never queued (for example
 * `extract` on a source excluded from model calls) still gets its own row, so
 * the status UI shows what happened to that stage instead of silently
 * overwriting a different one.
 */
export async function markStage(
  dataSourceId: string,
  stage: string,
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled" | "partially_succeeded",
  message?: string,
): Promise<void> {
  const terminal = ["succeeded", "failed", "cancelled", "partially_succeeded"].includes(status);

  const [target] = await db
    .select()
    .from(ingestionJobs)
    .where(and(eq(ingestionJobs.dataSourceId, dataSourceId), eq(ingestionJobs.stage, stage)))
    .limit(1);

  if (target) {
    await db
      .update(ingestionJobs)
      .set({
        status,
        message: message?.slice(0, 2000) ?? null,
        startedAt: status === "running" ? new Date() : target.startedAt,
        finishedAt: terminal ? new Date() : null,
        updatedAt: new Date(),
      })
      .where(eq(ingestionJobs.id, target.id));
    return;
  }

  const [source] = await db
    .select({ organizationId: dataSources.organizationId, brandId: dataSources.brandId })
    .from(dataSources)
    .where(eq(dataSources.id, dataSourceId))
    .limit(1);
  if (!source) return;

  await db.insert(ingestionJobs).values({
    id: newId(ID_PREFIXES.ingestionJob),
    organizationId: source.organizationId,
    brandId: source.brandId,
    dataSourceId,
    stage,
    status,
    message: message?.slice(0, 2000) ?? null,
    startedAt: status === "running" ? new Date() : null,
    finishedAt: terminal ? new Date() : null,
  });
}

/** Brand context passed to the extraction model. */
export async function loadBrandContext(brandId: string) {
  const [brand] = await db.select().from(brands).where(eq(brands.id, brandId)).limit(1);
  if (!brand) throw new AppError("not_found", `Brand ${brandId} no longer exists`);
  return brand;
}
