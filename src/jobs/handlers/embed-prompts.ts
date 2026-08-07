import "server-only";
import { asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { promptEmbeddings, promptPairs, promptSetVersions, promptSets, prompts } from "@/db/schema";
import { getOpenAIAdapter } from "@/adapters/openai";
import { AppError } from "@/lib/errors";
import { newId, ID_PREFIXES } from "@/lib/ids";
import { findDuplicate, type DuplicateCandidate } from "@/lib/prompt-dedupe";
import { recordVendorUsage } from "@/services/usage";
import { JOB_TYPES, registerJob } from "../registry";

const BATCH_SIZE = 64;

/**
 * Embeds a prompt-set version, then recomputes its duplicate warnings (§18).
 *
 * The two run together because the semantic half of duplicate detection is
 * meaningless without vectors, and running detection separately would leave a
 * window where a set looks clean only because it has not been embedded yet.
 *
 * Detection compares against the whole brand's prompt library, not just this
 * set: the expensive mistake is deploying a prompt to Profound that a different
 * persona already tracks, because both then report half the traffic.
 *
 * A warning never blocks. A persona prompt and its generic control are near-
 * identical *by design*, so an automatic removal here would delete the control
 * pairs the measurement depends on.
 */
registerJob(JOB_TYPES.embedPrompts, async ({ job }) => {
  const promptSetVersionId = String(job.payload.promptSetVersionId ?? "");
  if (!promptSetVersionId) {
    throw new AppError("validation", "embed_prompts requires promptSetVersionId");
  }

  const [version] = await db
    .select()
    .from(promptSetVersions)
    .where(eq(promptSetVersions.id, promptSetVersionId))
    .limit(1);
  if (!version) {
    return { status: "succeeded", result: { skipped: "prompt-set version no longer exists" } };
  }

  const { adapter, mode } = await getOpenAIAdapter(version.organizationId);

  const pending = await db
    .select({ id: prompts.id, text: prompts.promptText })
    .from(prompts)
    .where(eq(prompts.promptSetVersionId, promptSetVersionId))
    .orderBy(asc(prompts.id));

  const alreadyEmbedded = new Set(
    (
      await db
        .select({ promptId: promptEmbeddings.promptId })
        .from(promptEmbeddings)
        .innerJoin(prompts, eq(prompts.id, promptEmbeddings.promptId))
        .where(eq(prompts.promptSetVersionId, promptSetVersionId))
    ).map((row) => row.promptId),
  );

  const toEmbed = pending.filter((row) => !alreadyEmbedded.has(row.id));
  let embedded = 0;
  let failedBatches = 0;

  for (let i = 0; i < toEmbed.length; i += BATCH_SIZE) {
    const batch = toEmbed.slice(i, i + BATCH_SIZE);
    const started = Date.now();
    try {
      const result = await adapter.embed({ texts: batch.map((row) => row.text) });

      await recordVendorUsage({
        organizationId: version.organizationId,
        brandId: version.brandId,
        vendor: "openai",
        operation: "embed_prompts",
        mode,
        jobId: job.id,
        durationMs: Date.now() - started,
        retryCount: 0,
        outcome: "success",
        tokensIn: result.tokensIn,
        costCents: result.costCents,
      });

      for (let j = 0; j < batch.length; j++) {
        const row = batch[j]!;
        const embedding = result.embeddings[j];
        if (!embedding) continue;
        await db
          .insert(promptEmbeddings)
          .values({
            id: newId(ID_PREFIXES.evidenceEmbedding),
            organizationId: version.organizationId,
            promptId: row.id,
            modelId: result.modelId,
            dataOrigin: result.dataOrigin,
            embedding,
          })
          .onConflictDoNothing();
        embedded++;
      }
    } catch (error) {
      failedBatches++;
      await recordVendorUsage({
        organizationId: version.organizationId,
        brandId: version.brandId,
        vendor: "openai",
        operation: "embed_prompts",
        mode,
        jobId: job.id,
        durationMs: Date.now() - started,
        retryCount: 0,
        outcome: "failure",
        errorCode: error instanceof Error ? error.name : "unknown",
      });
    }
  }

  const warnings = await recomputeDuplicateWarnings(promptSetVersionId);

  return {
    status: failedBatches > 0 ? "partially_succeeded" : "succeeded",
    result: { embedded, failedBatches, prompts: pending.length, duplicateWarnings: warnings },
  };
});

/**
 * Recomputes `similarity_warning` for every prompt in a set version.
 *
 * Exported so the service layer can re-run it after an edit — a reviewer who
 * rewrites a prompt into an existing one should see that immediately, not after
 * the next generation.
 */
export async function recomputeDuplicateWarnings(promptSetVersionId: string): Promise<number> {
  const [version] = await db
    .select()
    .from(promptSetVersions)
    .where(eq(promptSetVersions.id, promptSetVersionId))
    .limit(1);
  if (!version) return 0;

  const rows = await db
    .select({
      id: prompts.id,
      text: prompts.promptText,
      hash: prompts.normalizedHash,
      promptType: prompts.promptType,
      setVersionId: prompts.promptSetVersionId,
      setName: promptSets.name,
      setVersion: promptSetVersions.version,
      embedding: promptEmbeddings.embedding,
    })
    .from(prompts)
    .innerJoin(promptSetVersions, eq(promptSetVersions.id, prompts.promptSetVersionId))
    .innerJoin(promptSets, eq(promptSets.id, promptSetVersions.promptSetId))
    .leftJoin(promptEmbeddings, eq(promptEmbeddings.promptId, prompts.id))
    .where(eq(prompts.brandId, version.brandId));

  const subjects = rows.filter((row) => row.setVersionId === promptSetVersionId);

  // A prompt's own generic control is excluded from its candidate pool: the
  // control is a deliberate near-duplicate, so warning about it would train
  // reviewers to ignore the warnings that matter.
  const controlPartners = await loadPairPartners(promptSetVersionId);

  let warned = 0;

  for (const subject of subjects) {
    const partners = controlPartners.get(subject.id) ?? new Set<string>();
    const candidates: DuplicateCandidate[] = rows
      .filter((row) => row.id !== subject.id && !partners.has(row.id))
      // A control is expected to resemble other controls of the same shape;
      // comparing across types produces warnings nobody can act on.
      .filter((row) => row.promptType === subject.promptType)
      .map((row) => ({
        promptId: row.id,
        promptText: row.text,
        normalizedHash: row.hash,
        embedding: row.embedding,
        promptSetLabel:
          row.setVersionId === promptSetVersionId
            ? "this prompt set"
            : `${row.setName} v${row.setVersion}`,
      }));

    const finding = findDuplicate(
      { promptId: subject.id, promptText: subject.text, embedding: subject.embedding },
      candidates,
    );

    await db
      .update(prompts)
      .set({
        similarityWarning: finding
          ? {
              promptId: finding.promptId,
              score: Number(finding.score.toFixed(4)),
              text: finding.text,
              kind: finding.kind,
              promptSetLabel: finding.promptSetLabel,
            }
          : null,
        updatedAt: new Date(),
      })
      .where(eq(prompts.id, subject.id));

    if (finding) warned++;
  }

  return warned;
}

/** Maps each prompt to the prompts it is deliberately paired with. */
async function loadPairPartners(promptSetVersionId: string): Promise<Map<string, Set<string>>> {
  const rows = await db
    .select({
      personaPromptId: promptPairs.personaPromptId,
      controlPromptId: promptPairs.controlPromptId,
    })
    .from(promptPairs)
    .where(eq(promptPairs.promptSetVersionId, promptSetVersionId));

  const out = new Map<string, Set<string>>();
  const link = (from: string, to: string) => {
    const set = out.get(from) ?? new Set<string>();
    set.add(to);
    out.set(from, set);
  };
  for (const row of rows) {
    link(row.personaPromptId, row.controlPromptId);
    link(row.controlPromptId, row.personaPromptId);
  }
  return out;
}
