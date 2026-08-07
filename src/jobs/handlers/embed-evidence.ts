import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db/client";
import { dataSources, evidenceEmbeddings, evidenceRecords } from "@/db/schema";
import { getOpenAIAdapter } from "@/adapters/openai";
import { AppError } from "@/lib/errors";
import { newId, ID_PREFIXES } from "@/lib/ids";
import { withVendorUsage } from "@/services/usage";
import { JOB_TYPES, registerJob } from "../registry";
import { markStage } from "./ingest-source";

const BATCH_SIZE = 64;

/**
 * Stage 3: embed evidence for semantic search and near-duplicate detection.
 *
 * Embeddings are stored in their own table keyed by `(evidence_id, model_id)`,
 * so re-embedding with a different model is additive and mock vectors are never
 * compared against live ones.
 */
registerJob(JOB_TYPES.embedEvidence, async ({ job }) => {
  const dataSourceId = job.payload.dataSourceId ? String(job.payload.dataSourceId) : null;
  const brandId = job.payload.brandId ? String(job.payload.brandId) : null;

  let organizationId: string;
  let scopedBrandId: string;

  if (dataSourceId) {
    const [source] = await db
      .select()
      .from(dataSources)
      .where(eq(dataSources.id, dataSourceId))
      .limit(1);
    if (!source) throw new AppError("not_found", `Data source ${dataSourceId} no longer exists`);
    if (source.deletedAt) return { status: "succeeded", result: { skipped: "source was deleted" } };
    organizationId = source.organizationId;
    scopedBrandId = source.brandId;
  } else if (brandId && job.organizationId) {
    organizationId = job.organizationId;
    scopedBrandId = brandId;
  } else {
    throw new AppError("validation", "embed_evidence requires dataSourceId or brandId");
  }

  if (dataSourceId) await markStage(dataSourceId, "embed", "running");

  const { adapter, mode } = await getOpenAIAdapter(organizationId);

  // Only records without an embedding for the current model, so a re-run is
  // cheap and resumable after a partial failure.
  const pending = await db
    .select({
      id: evidenceRecords.id,
      normalizedClaim: evidenceRecords.normalizedClaim,
      redactedText: evidenceRecords.redactedText,
    })
    .from(evidenceRecords)
    .leftJoin(evidenceEmbeddings, eq(evidenceEmbeddings.evidenceId, evidenceRecords.id))
    .where(
      and(
        dataSourceId
          ? eq(evidenceRecords.dataSourceId, dataSourceId)
          : eq(evidenceRecords.brandId, scopedBrandId),
        eq(evidenceRecords.availability, "available"),
        isNull(evidenceEmbeddings.id),
      ),
    );

  let embedded = 0;
  let failedBatches = 0;

  for (let i = 0; i < pending.length; i += BATCH_SIZE) {
    const batch = pending.slice(i, i + BATCH_SIZE);
    const result = await withVendorUsage(
      {
        organizationId,
        brandId: scopedBrandId,
        vendor: "openai",
        operation: "embed_evidence",
        mode,
        jobId: job.id,
      },
      () =>
        adapter.embed({
          // The claim carries the meaning; the quote grounds it in real wording.
          texts: batch.map((row) => `${row.normalizedClaim}\n${row.redactedText}`),
        }),
      (embedResult) => ({ tokensIn: embedResult.tokensIn, costCents: embedResult.costCents }),
      { swallow: true },
    );

    if (!result) {
      failedBatches++;
      continue;
    }

    for (let j = 0; j < batch.length; j++) {
      const row = batch[j]!;
      const embedding = result.embeddings[j];
      if (!embedding) continue;
      await db
        .insert(evidenceEmbeddings)
        .values({
          id: newId(ID_PREFIXES.evidenceEmbedding),
          organizationId,
          brandId: scopedBrandId,
          evidenceId: row.id,
          modelId: result.modelId,
          dimensions: result.dimensions,
          dataOrigin: result.dataOrigin,
          embedding,
        })
        .onConflictDoNothing();
      embedded++;
    }
  }

  if (dataSourceId) {
    await markStage(
      dataSourceId,
      "embed",
      failedBatches > 0 ? "partially_succeeded" : "succeeded",
      `${embedded} embedding(s) created${failedBatches > 0 ? `, ${failedBatches} batch(es) failed` : ""}.`,
    );
  }

  return {
    status: failedBatches > 0 ? "partially_succeeded" : "succeeded",
    result: { embedded, failedBatches, pending: pending.length },
  };
});
