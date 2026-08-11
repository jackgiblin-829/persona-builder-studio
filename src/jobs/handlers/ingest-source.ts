import "server-only";
import { eq } from "drizzle-orm";
import { getQueue } from "@/adapters/queue";
import { getObjectStorage } from "@/adapters/storage";
import { db } from "@/db/client";
import { dataSources, sourceDocuments } from "@/db/schema";
import { sha256 } from "@/lib/crypto";
import { AppError } from "@/lib/errors";
import { ID_PREFIXES, newId } from "@/lib/ids";
import {
  parseCsv,
  parseDocx,
  parseJson,
  parseMarkdown,
  parsePdf,
  parseText,
  parseTranscript,
  type ParseResult,
} from "@/lib/parsers";
import { redactWithStatus } from "@/lib/redaction";
import { JOB_TYPES, registerJob } from "../registry";

registerJob(JOB_TYPES.ingestSource, async ({ job }) => {
  const sourceId = String(job.payload.dataSourceId ?? "");
  const format = String(job.payload.format ?? "txt");
  if (!sourceId) throw new AppError("validation", "ingest_source requires dataSourceId");
  const [source] = await db.select().from(dataSources).where(eq(dataSources.id, sourceId)).limit(1);
  if (!source) throw new AppError("not_found", "Source no longer exists");

  await db
    .update(dataSources)
    .set({
      status: "processing",
      stage: "parsing",
      progress: 10,
      errorMessage: null,
      updatedAt: new Date(),
    })
    .where(eq(dataSources.id, sourceId));
  try {
    if (!source.storageKey) throw new AppError("validation", "Source has no stored file");
    const bytes = await getObjectStorage().get(source.storageKey);
    let parsed: ParseResult;
    switch (format) {
      case "csv":
        parsed = parseCsv(bytes.toString("utf8"));
        break;
      case "json":
        parsed = parseJson(bytes.toString("utf8"));
        break;
      case "markdown":
        parsed = parseMarkdown(bytes.toString("utf8"), source.label);
        break;
      case "docx":
        parsed = await parseDocx(bytes, source.label);
        break;
      case "pdf":
        parsed = await parsePdf(bytes, source.label);
        break;
      case "transcript":
        parsed = parseTranscript(bytes.toString("utf8"), source.label);
        break;
      default:
        parsed = source.sourceType.includes("transcript")
          ? parseTranscript(bytes.toString("utf8"), source.label)
          : parseText(bytes.toString("utf8"), source.label);
    }
    if (!parsed.documents.length)
      throw new AppError("validation", "No usable text was found in this source.");

    await db.delete(sourceDocuments).where(eq(sourceDocuments.dataSourceId, source.id));
    let sequence = 0;
    let redactionCount = 0;
    let piiStatus = "none";
    const hashes = new Set<string>();
    for (const document of parsed.documents) {
      const contentHash = sha256(document.text);
      if (hashes.has(contentHash)) continue;
      hashes.add(contentHash);
      const redaction = redactWithStatus(document.text);
      redactionCount += redaction.count;
      if (
        redaction.status === "redacted" ||
        (redaction.status === "suspected" && piiStatus === "none")
      )
        piiStatus = redaction.status;
      await db.insert(sourceDocuments).values({
        id: newId(ID_PREFIXES.sourceDocument),
        organizationId: source.organizationId,
        projectId: source.projectId,
        dataSourceId: source.id,
        title: document.title,
        location: document.location,
        sequence: sequence++,
        rawText: document.text,
        redactedText: redaction.text,
        piiFindings: redaction.findings,
        metadata: { ...document.metadata, parserWarnings: parsed.warnings },
        speaker: document.speaker ?? null,
        observedAt: document.observedAt ?? source.observedAt,
        contentHash,
      });
    }
    await db
      .update(dataSources)
      .set({
        status: "processing",
        stage: "extracting_signals",
        progress: 55,
        documentCount: sequence,
        piiRedactionCount: redactionCount,
        piiStatus,
        warningMessage: parsed.warnings.length ? parsed.warnings.join(" · ").slice(0, 2000) : null,
        updatedAt: new Date(),
      })
      .where(eq(dataSources.id, source.id));
    await getQueue().enqueue(
      JOB_TYPES.extractSignals,
      { dataSourceId: source.id },
      {
        organizationId: source.organizationId,
        projectId: source.projectId,
        idempotencyKey: `extract:${source.id}:${job.id}`,
      },
    );
    return { status: "succeeded", result: { documents: sequence, redactions: redactionCount } };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(dataSources)
      .set({
        status: "failed",
        stage: "failed",
        errorMessage: message.slice(0, 2000),
        updatedAt: new Date(),
      })
      .where(eq(dataSources.id, source.id));
    throw error;
  }
});
