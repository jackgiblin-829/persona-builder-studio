import "server-only";
import { and, countDistinct, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import {
  dataSources,
  evidenceEmbeddings,
  evidenceRecords,
  ingestionJobs,
  personaFieldEvidence,
  personaFields,
  personaVersions,
  promptEvidence,
  sourceDocuments,
} from "@/db/schema";
import { getObjectStorage, storageKeyFor } from "@/adapters/storage";
import { getQueue } from "@/adapters/queue";
import { JOB_TYPES } from "@/jobs/registry";
import { requireCapability, type BrandContext } from "@/lib/auth/context";
import { sha256 } from "@/lib/crypto";
import { env } from "@/lib/env";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { newId, ID_PREFIXES } from "@/lib/ids";
import { detectFormat, verifyMagicBytes } from "@/lib/parsers";
import { recordAudit } from "./audit";

export const SOURCE_TYPES = [
  "interview",
  "sales_transcript",
  "support_ticket",
  "survey",
  "review",
  "community",
  "search_console",
  "onsite_search",
  "crm_note",
  "brand_page",
  "documentation",
  "other",
] as const;

export const SOURCE_TYPE_LABELS: Record<(typeof SOURCE_TYPES)[number], string> = {
  interview: "Customer interview",
  sales_transcript: "Sales call transcript",
  support_ticket: "Support ticket",
  survey: "Survey response",
  review: "Product review",
  community: "Community discussion",
  search_console: "Search Console export",
  onsite_search: "On-site search log",
  crm_note: "CRM note",
  brand_page: "Brand page",
  documentation: "Documentation",
  other: "Other",
};

export const uploadInputSchema = z.object({
  label: z.string().trim().min(2, "Give this source a label").max(200),
  sourceType: z.enum(SOURCE_TYPES),
  observedAt: z
    .string()
    .optional()
    .transform((value) => {
      if (!value) return null;
      const date = new Date(value);
      return Number.isNaN(date.getTime()) ? null : date;
    }),
  excludeFromModelCalls: z
    .union([z.literal("on"), z.literal("true"), z.boolean(), z.undefined()])
    .transform((v) => v === true || v === "on" || v === "true"),
});

export const pasteInputSchema = uploadInputSchema.extend({
  content: z.string().trim().min(20, "Paste at least a couple of sentences").max(2_000_000),
  isTranscript: z
    .union([z.literal("on"), z.literal("true"), z.boolean(), z.undefined()])
    .transform((v) => v === true || v === "on" || v === "true"),
});

export type UploadInput = z.infer<typeof uploadInputSchema>;

const SOURCE_SYSTEM_BY_FORMAT = {
  csv: "uploaded_csv",
  json: "uploaded_json",
  txt: "uploaded_txt",
  markdown: "uploaded_markdown",
  docx: "uploaded_docx",
  pasted_text: "pasted_text",
  transcript: "transcript_text",
  search_console_csv: "search_console_export",
} as const;

// ── Reads ───────────────────────────────────────────────────────────────────

export async function listSources(ctx: BrandContext) {
  return db
    .select()
    .from(dataSources)
    .where(
      and(
        eq(dataSources.organizationId, ctx.organizationId),
        eq(dataSources.brandId, ctx.brandId),
        isNull(dataSources.deletedAt),
      ),
    )
    .orderBy(desc(dataSources.createdAt));
}

export async function getSource(ctx: BrandContext, sourceId: string) {
  const [source] = await db
    .select()
    .from(dataSources)
    .where(
      and(
        eq(dataSources.id, sourceId),
        eq(dataSources.organizationId, ctx.organizationId),
        eq(dataSources.brandId, ctx.brandId),
      ),
    )
    .limit(1);
  if (!source) throw new NotFoundError("Data source");
  return source;
}

export async function getSourceDetail(ctx: BrandContext, sourceId: string) {
  const source = await getSource(ctx, sourceId);
  const [documents, stages] = await Promise.all([
    db
      .select({
        id: sourceDocuments.id,
        title: sourceDocuments.title,
        location: sourceDocuments.location,
        sequence: sourceDocuments.sequence,
        speaker: sourceDocuments.speaker,
        piiFindings: sourceDocuments.piiFindings,
        redactedText: sourceDocuments.redactedText,
      })
      .from(sourceDocuments)
      .where(eq(sourceDocuments.dataSourceId, sourceId))
      .orderBy(sourceDocuments.sequence)
      .limit(200),
    db
      .select()
      .from(ingestionJobs)
      .where(eq(ingestionJobs.dataSourceId, sourceId))
      .orderBy(ingestionJobs.createdAt),
  ]);
  return { source, documents, stages };
}

export async function getSourceDocument(ctx: BrandContext, documentId: string) {
  const [document] = await db
    .select()
    .from(sourceDocuments)
    .where(
      and(
        eq(sourceDocuments.id, documentId),
        eq(sourceDocuments.organizationId, ctx.organizationId),
        eq(sourceDocuments.brandId, ctx.brandId),
      ),
    )
    .limit(1);
  if (!document) throw new NotFoundError("Source document");
  return document;
}

// ── Writes ──────────────────────────────────────────────────────────────────

export async function createSourceFromUpload(
  ctx: BrandContext,
  input: UploadInput,
  file: { name: string; type: string; bytes: Buffer },
) {
  requireCapability(ctx, "source:upload");

  if (file.bytes.byteLength === 0) throw new ValidationError("The uploaded file is empty.");
  if (file.bytes.byteLength > env.MAX_UPLOAD_BYTES) {
    throw new ValidationError(
      `File is ${(file.bytes.byteLength / 1_048_576).toFixed(1)} MB; the limit is ${(env.MAX_UPLOAD_BYTES / 1_048_576).toFixed(0)} MB.`,
    );
  }

  const format = detectFormat(file.name, file.type);
  if (!format) {
    throw new ValidationError(
      "Unsupported file type. Upload CSV, JSON, TXT, Markdown or DOCX, or paste the text directly.",
    );
  }
  verifyMagicBytes(format, file.bytes);

  const effectiveFormat =
    input.sourceType === "search_console" && format === "csv" ? "search_console_csv" : format;
  const checksum = sha256(file.bytes.toString("base64"));

  const [duplicate] = await db
    .select({ id: dataSources.id, label: dataSources.label })
    .from(dataSources)
    .where(and(eq(dataSources.brandId, ctx.brandId), eq(dataSources.checksum, checksum)))
    .limit(1);
  if (duplicate) {
    throw new ValidationError(
      `This exact file has already been uploaded to this brand as "${duplicate.label}".`,
    );
  }

  const sourceId = newId(ID_PREFIXES.dataSource);
  const storage = getObjectStorage();
  const key = storageKeyFor({
    organizationId: ctx.organizationId,
    brandId: ctx.brandId,
    dataSourceId: sourceId,
    filename: file.name,
  });
  const stored = await storage.put(key, file.bytes, file.type || "application/octet-stream");

  const source = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(dataSources)
      .values({
        id: sourceId,
        organizationId: ctx.organizationId,
        brandId: ctx.brandId,
        label: input.label,
        sourceType: input.sourceType,
        sourceSystem: SOURCE_SYSTEM_BY_FORMAT[effectiveFormat],
        originalFilename: file.name,
        storageKey: stored.key,
        byteSize: stored.bytes,
        contentType: file.type || null,
        checksum,
        observedAt: input.observedAt,
        excludeFromModelCalls: input.excludeFromModelCalls,
        status: "queued",
        uploadedByUserId: ctx.userId,
      })
      .returning();
    if (!row) throw new ValidationError("Could not record the upload.");

    await tx.insert(ingestionJobs).values({
      id: newId(ID_PREFIXES.ingestionJob),
      organizationId: ctx.organizationId,
      brandId: ctx.brandId,
      dataSourceId: sourceId,
      stage: "parse",
      status: "queued",
    });

    // Enqueued in the same transaction so the job can never reference a source
    // that was rolled back.
    await getQueue().enqueue(
      JOB_TYPES.ingestSource,
      { dataSourceId: sourceId, format: effectiveFormat },
      {
        organizationId: ctx.organizationId,
        brandId: ctx.brandId,
        idempotencyKey: `ingest:${sourceId}`,
        tx,
      },
    );

    return row;
  });

  await recordAudit({
    organizationId: ctx.organizationId,
    brandId: ctx.brandId,
    actorUserId: ctx.userId,
    action: "source.upload",
    entityType: "data_source",
    entityId: sourceId,
    metadata: {
      label: input.label,
      sourceType: input.sourceType,
      bytes: stored.bytes,
      format: effectiveFormat,
    },
  });

  return source;
}

export async function createSourceFromPaste(
  ctx: BrandContext,
  input: z.infer<typeof pasteInputSchema>,
) {
  const bytes = Buffer.from(input.content, "utf8");
  const format = input.isTranscript ? "transcript" : "pasted_text";
  const checksum = sha256(input.content);

  const [duplicate] = await db
    .select({ id: dataSources.id, label: dataSources.label })
    .from(dataSources)
    .where(and(eq(dataSources.brandId, ctx.brandId), eq(dataSources.checksum, checksum)))
    .limit(1);
  if (duplicate) {
    throw new ValidationError(`This exact text has already been added as "${duplicate.label}".`);
  }

  requireCapability(ctx, "source:upload");

  const sourceId = newId(ID_PREFIXES.dataSource);
  const storage = getObjectStorage();
  const key = storageKeyFor({
    organizationId: ctx.organizationId,
    brandId: ctx.brandId,
    dataSourceId: sourceId,
    filename: "pasted.txt",
  });
  const stored = await storage.put(key, bytes, "text/plain");

  const source = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(dataSources)
      .values({
        id: sourceId,
        organizationId: ctx.organizationId,
        brandId: ctx.brandId,
        label: input.label,
        sourceType: input.sourceType,
        sourceSystem: SOURCE_SYSTEM_BY_FORMAT[format],
        originalFilename: null,
        storageKey: stored.key,
        byteSize: stored.bytes,
        contentType: "text/plain",
        checksum,
        observedAt: input.observedAt,
        excludeFromModelCalls: input.excludeFromModelCalls,
        status: "queued",
        uploadedByUserId: ctx.userId,
      })
      .returning();
    if (!row) throw new ValidationError("Could not record the pasted text.");

    await tx.insert(ingestionJobs).values({
      id: newId(ID_PREFIXES.ingestionJob),
      organizationId: ctx.organizationId,
      brandId: ctx.brandId,
      dataSourceId: sourceId,
      stage: "parse",
      status: "queued",
    });

    await getQueue().enqueue(
      JOB_TYPES.ingestSource,
      { dataSourceId: sourceId, format },
      {
        organizationId: ctx.organizationId,
        brandId: ctx.brandId,
        idempotencyKey: `ingest:${sourceId}`,
        tx,
      },
    );

    return row;
  });

  await recordAudit({
    organizationId: ctx.organizationId,
    brandId: ctx.brandId,
    actorUserId: ctx.userId,
    action: "source.upload",
    entityType: "data_source",
    entityId: sourceId,
    metadata: { label: input.label, sourceType: input.sourceType, pasted: true },
  });

  return source;
}

export async function retrySource(ctx: BrandContext, sourceId: string) {
  requireCapability(ctx, "source:upload");
  const source = await getSource(ctx, sourceId);
  if (source.status === "running") {
    throw new ValidationError("This source is already being processed.");
  }

  await db
    .update(dataSources)
    .set({ status: "queued", updatedAt: new Date() })
    .where(eq(dataSources.id, sourceId));

  // A distinct idempotency key per attempt, so a retry is a new job rather than
  // a silent no-op against the original.
  await getQueue().enqueue(
    JOB_TYPES.ingestSource,
    { dataSourceId: sourceId, format: formatFromSystem(source.sourceSystem), retry: true },
    {
      organizationId: ctx.organizationId,
      brandId: ctx.brandId,
      idempotencyKey: `ingest:${sourceId}:retry:${Date.now()}`,
    },
  );
}

function formatFromSystem(system: string): string {
  const map: Record<string, string> = {
    uploaded_csv: "csv",
    uploaded_json: "json",
    uploaded_txt: "txt",
    uploaded_markdown: "markdown",
    uploaded_docx: "docx",
    pasted_text: "pasted_text",
    transcript_text: "transcript",
    search_console_export: "search_console_csv",
    url_crawl: "url_crawl",
  };
  return map[system] ?? "txt";
}

export type DeletionImpact = {
  evidenceCount: number;
  embeddingCount: number;
  personaVersionsAffected: { id: string; name: string; version: number; status: string }[];
  promptsAffected: number;
};

/** What deleting this source would break — shown before the user confirms. */
export async function previewSourceDeletion(
  ctx: BrandContext,
  sourceId: string,
): Promise<DeletionImpact> {
  await getSource(ctx, sourceId);

  const evidence = await db
    .select({ id: evidenceRecords.id })
    .from(evidenceRecords)
    .where(eq(evidenceRecords.dataSourceId, sourceId));
  const evidenceIds = evidence.map((row) => row.id);

  if (evidenceIds.length === 0) {
    return { evidenceCount: 0, embeddingCount: 0, personaVersionsAffected: [], promptsAffected: 0 };
  }

  const [embeddings, versions, promptCount] = await Promise.all([
    db
      .select({ id: evidenceEmbeddings.id })
      .from(evidenceEmbeddings)
      .where(inArray(evidenceEmbeddings.evidenceId, evidenceIds)),
    personaVersionsDependingOnEvidence(ctx.organizationId, evidenceIds),
    promptsDependingOnEvidence(ctx.organizationId, evidenceIds),
  ]);

  return {
    evidenceCount: evidenceIds.length,
    embeddingCount: embeddings.length,
    personaVersionsAffected: versions,
    promptsAffected: promptCount,
  };
}

/**
 * Which persona versions cite any of these evidence records. Two joins deep
 * (evidence → field → version), using Drizzle's join chain rather than a raw
 * `ANY()` array parameter — the postgres-js driver binds a template-literal
 * array as separate positional parameters, not a SQL array, so `= ANY($n)`
 * fails; `inArray()` generates the correct `IN (...)` list instead.
 */
async function personaVersionsDependingOnEvidence(organizationId: string, evidenceIds: string[]) {
  if (evidenceIds.length === 0) return [];
  const rows = await db
    .selectDistinct({
      id: personaVersions.id,
      name: personaVersions.name,
      version: personaVersions.version,
      status: personaVersions.status,
    })
    .from(personaFieldEvidence)
    .innerJoin(personaFields, eq(personaFields.id, personaFieldEvidence.personaFieldId))
    .innerJoin(personaVersions, eq(personaVersions.id, personaFields.personaVersionId))
    .where(
      and(
        eq(personaFieldEvidence.organizationId, organizationId),
        inArray(personaFieldEvidence.evidenceId, evidenceIds),
      ),
    );
  return rows;
}

async function promptsDependingOnEvidence(organizationId: string, evidenceIds: string[]) {
  if (evidenceIds.length === 0) return 0;
  const [row] = await db
    .select({ n: countDistinct(promptEvidence.promptId) })
    .from(promptEvidence)
    .where(
      and(
        eq(promptEvidence.organizationId, organizationId),
        inArray(promptEvidence.evidenceId, evidenceIds),
      ),
    );
  return row?.n ?? 0;
}

/**
 * Source deletion (§16, §34).
 *
 * Deletes the stored object and all embeddings, marks derived evidence
 * unavailable, and marks dependent persona references unavailable — but never
 * deletes an approved persona version. Affected approved versions are queued
 * for review instead.
 */
export async function deleteSource(ctx: BrandContext, sourceId: string) {
  requireCapability(ctx, "source:delete");
  const source = await getSource(ctx, sourceId);
  const impact = await previewSourceDeletion(ctx, sourceId);

  const evidence = await db
    .select({ id: evidenceRecords.id })
    .from(evidenceRecords)
    .where(eq(evidenceRecords.dataSourceId, sourceId));
  const evidenceIds = evidence.map((row) => row.id);

  await db.transaction(async (tx) => {
    if (evidenceIds.length > 0) {
      await tx
        .delete(evidenceEmbeddings)
        .where(inArray(evidenceEmbeddings.evidenceId, evidenceIds));

      await tx
        .update(personaFieldEvidence)
        .set({ unavailable: true })
        .where(inArray(personaFieldEvidence.evidenceId, evidenceIds));

      await tx
        .update(promptEvidence)
        .set({ unavailable: true })
        .where(inArray(promptEvidence.evidenceId, evidenceIds));

      // Approved versions survive; they are flagged for human review.
      for (const version of impact.personaVersionsAffected) {
        await tx
          .update(personaVersions)
          .set({
            status: version.status === "approved" ? "needs_review" : "needs_review",
            needsReviewReason: `Supporting evidence was deleted with source "${source.label}" on ${new Date().toISOString().slice(0, 10)}. Review the affected claims.`,
            updatedAt: new Date(),
          })
          .where(eq(personaVersions.id, version.id));
      }

      await tx
        .update(evidenceRecords)
        .set({ availability: "source_deleted", updatedAt: new Date() })
        .where(inArray(evidenceRecords.id, evidenceIds));
    }

    await tx
      .update(dataSources)
      .set({ deletedAt: new Date(), status: "cancelled", updatedAt: new Date() })
      .where(eq(dataSources.id, sourceId));
  });

  if (source.storageKey) {
    await getObjectStorage().delete(source.storageKey);
  }

  await recordAudit({
    organizationId: ctx.organizationId,
    brandId: ctx.brandId,
    actorUserId: ctx.userId,
    action: "source.delete",
    entityType: "data_source",
    entityId: sourceId,
    metadata: {
      label: source.label,
      evidenceMarkedUnavailable: impact.evidenceCount,
      embeddingsDeleted: impact.embeddingCount,
      personaVersionsQueuedForReview: impact.personaVersionsAffected.length,
    },
  });

  return impact;
}
