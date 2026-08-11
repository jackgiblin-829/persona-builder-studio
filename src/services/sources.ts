import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getQueue } from "@/adapters/queue";
import { getObjectStorage, storageKeyFor } from "@/adapters/storage";
import { db } from "@/db/client";
import { dataSources } from "@/db/schema";
import { requireCapability, type ProjectContext } from "@/lib/auth/context";
import { sha256 } from "@/lib/crypto";
import { env } from "@/lib/env";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { ID_PREFIXES, newId } from "@/lib/ids";
import { detectFormat, verifyMagicBytes } from "@/lib/parsers";
import { JOB_TYPES } from "@/jobs/registry";
import { recordAudit } from "./audit";

export const SOURCE_TYPES = [
  "sales_transcript",
  "customer_interview",
  "support_conversation",
  "survey",
  "review",
  "research_note",
  "other",
] as const;

export const sourceInputSchema = z.object({
  sourceType: z.enum(SOURCE_TYPES).default("sales_transcript"),
  observedAt: z
    .string()
    .optional()
    .transform((value) => (value ? new Date(value) : null))
    .refine((value) => value === null || !Number.isNaN(value.getTime()), "Enter a valid date"),
});

const SYSTEM_BY_FORMAT = {
  csv: "uploaded_csv",
  json: "uploaded_json",
  txt: "uploaded_txt",
  markdown: "uploaded_markdown",
  docx: "uploaded_docx",
  pdf: "uploaded_pdf",
  pasted_text: "pasted_text",
  transcript: "transcript_text",
  search_console_csv: "uploaded_csv",
} as const;

type SourceInput = z.infer<typeof sourceInputSchema>;

export async function createSourcesFromUploads(
  ctx: ProjectContext,
  input: SourceInput,
  files: { name: string; type: string; bytes: Buffer }[],
) {
  requireCapability(ctx, "source:upload");
  if (!files.length) throw new ValidationError("Choose at least one file.");
  if (files.length > 25) throw new ValidationError("Upload up to 25 files at a time.");
  const created = [];
  for (const file of files) created.push(await createUpload(ctx, input, file));
  return created;
}

async function createUpload(
  ctx: ProjectContext,
  input: SourceInput,
  file: { name: string; type: string; bytes: Buffer },
) {
  if (!file.bytes.byteLength) throw new ValidationError(`${file.name} is empty.`);
  if (file.bytes.byteLength > env.MAX_UPLOAD_BYTES) {
    throw new ValidationError(`${file.name} is larger than the upload limit.`);
  }
  const format = detectFormat(file.name, file.type);
  if (!format)
    throw new ValidationError(
      `${file.name} is not a supported PDF, DOCX, TXT, Markdown, CSV or JSON file.`,
    );
  verifyMagicBytes(format, file.bytes);
  const checksum = sha256(file.bytes.toString("base64"));
  const [duplicate] = await db
    .select({ label: dataSources.label })
    .from(dataSources)
    .where(and(eq(dataSources.projectId, ctx.projectId), eq(dataSources.checksum, checksum)))
    .limit(1);
  if (duplicate)
    throw new ValidationError(`${file.name} is already in this project as “${duplicate.label}”.`);

  const sourceId = newId(ID_PREFIXES.dataSource);
  const storage = getObjectStorage();
  const key = storageKeyFor({
    organizationId: ctx.organizationId,
    projectId: ctx.projectId,
    dataSourceId: sourceId,
    filename: file.name,
  });
  const stored = await storage.put(key, file.bytes, file.type || "application/octet-stream");
  const [source] = await db.transaction(async (tx) => {
    const rows = await tx
      .insert(dataSources)
      .values({
        id: sourceId,
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        label: file.name,
        sourceType: input.sourceType,
        sourceSystem: SYSTEM_BY_FORMAT[format],
        originalFilename: file.name,
        storageKey: stored.key,
        byteSize: stored.bytes,
        contentType: file.type || null,
        checksum,
        observedAt: input.observedAt,
        status: "queued",
        stage: "queued",
        uploadedByUserId: ctx.userId,
      })
      .returning();
    await getQueue().enqueue(
      JOB_TYPES.ingestSource,
      { dataSourceId: sourceId, format },
      {
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        idempotencyKey: `ingest:${sourceId}`,
        tx,
      },
    );
    return rows;
  });
  if (!source) throw new ValidationError(`Could not save ${file.name}.`);
  await recordAudit({
    organizationId: ctx.organizationId,
    projectId: ctx.projectId,
    actorUserId: ctx.userId,
    action: "source.upload",
    entityType: "data_source",
    entityId: source.id,
    metadata: { format, bytes: stored.bytes },
  });
  return source;
}

export async function createSourceFromTranscript(
  ctx: ProjectContext,
  input: SourceInput & { label: string; content: string },
) {
  requireCapability(ctx, "source:upload");
  const label = input.label.trim();
  const content = input.content.trim();
  if (label.length < 2 || label.length > 200)
    throw new ValidationError("Give the transcript a short label.");
  if (content.length < 20 || content.length > 2_000_000)
    throw new ValidationError("Paste at least a few transcript lines.");
  return createUpload(ctx, input, {
    name: `${label.replace(/[^a-z0-9_-]+/gi, "-")}.txt`,
    type: "text/plain",
    bytes: Buffer.from(content, "utf8"),
  });
}

export async function listProjectSources(ctx: ProjectContext) {
  return db
    .select()
    .from(dataSources)
    .where(
      and(
        eq(dataSources.organizationId, ctx.organizationId),
        eq(dataSources.projectId, ctx.projectId),
      ),
    )
    .orderBy(desc(dataSources.createdAt));
}

export async function retrySource(ctx: ProjectContext, sourceId: string) {
  requireCapability(ctx, "source:upload");
  const [source] = await db
    .select()
    .from(dataSources)
    .where(
      and(
        eq(dataSources.id, sourceId),
        eq(dataSources.projectId, ctx.projectId),
        eq(dataSources.organizationId, ctx.organizationId),
      ),
    )
    .limit(1);
  if (!source) throw new NotFoundError("Source");
  const format = source.sourceSystem.replace(/^uploaded_/, "").replace("pasted_text", "txt");
  await db
    .update(dataSources)
    .set({
      status: "queued",
      stage: "queued",
      progress: 0,
      errorMessage: null,
      updatedAt: new Date(),
    })
    .where(eq(dataSources.id, source.id));
  await getQueue().enqueue(
    JOB_TYPES.ingestSource,
    { dataSourceId: source.id, format },
    {
      organizationId: ctx.organizationId,
      projectId: ctx.projectId,
      idempotencyKey: `retry:${source.id}:${Date.now()}`,
    },
  );
}
