import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { profoundPromptLinks, profoundResultSnapshots } from "@/db/schema";
import { getProfoundAdapter } from "@/adapters/profound";
import { AppError } from "@/lib/errors";
import { newId, ID_PREFIXES } from "@/lib/ids";
import { mergeResultRows } from "@/lib/profound-results";
import { withVendorUsage } from "@/services/usage";
import { JOB_TYPES, registerJob } from "../registry";

/**
 * Result retrieval (§25).
 *
 * Retrieval only ever covers prompts this product actually linked in Profound
 * — `profound_prompt_links` is the source of truth for which vendor prompt ids
 * to ask about, never a locally-typed list. The four reporting calls are
 * merged into one row per `(profoundPromptId, runId, modelId)` and inserted
 * with `ON CONFLICT DO NOTHING`: a snapshot, once stored, is never
 * recomputed or relabelled, so re-running retrieval for an overlapping window
 * is a no-op for the runs it already has.
 */
registerJob(JOB_TYPES.profoundResults, async ({ job }) => {
  const organizationId = String(job.payload.organizationId ?? "");
  const brandId = String(job.payload.brandId ?? "");
  const startDate = String(job.payload.startDate ?? "");
  const endDate = String(job.payload.endDate ?? "");
  if (!organizationId || !brandId || !startDate || !endDate) {
    throw new AppError(
      "validation",
      "profound_results requires organizationId, brandId, startDate and endDate",
    );
  }

  const links = await db
    .select({
      promptId: profoundPromptLinks.promptId,
      profoundPromptId: profoundPromptLinks.profoundPromptId,
      profoundCategoryId: profoundPromptLinks.profoundCategoryId,
    })
    .from(profoundPromptLinks)
    .where(
      and(
        eq(profoundPromptLinks.organizationId, organizationId),
        eq(profoundPromptLinks.brandId, brandId),
      ),
    );

  if (links.length === 0) {
    return { status: "succeeded", result: { skipped: "no linked prompts" } };
  }

  // A local prompt should only ever have one link, but de-duplicating by the
  // vendor's own id keeps the retrieval loop honest regardless.
  const targets = [...new Map(links.map((link) => [link.profoundPromptId, link])).values()];

  const { adapter, mode } = await getProfoundAdapter(organizationId);

  const modelIds = (
    await withVendorUsage(
      { organizationId, brandId, vendor: "profound", operation: "getModels", mode, jobId: job.id },
      () => adapter.getModels(),
    )
  ).map((model) => model.id);

  const query = {
    profoundPromptIds: targets.map((target) => target.profoundPromptId),
    modelIds,
    startDate,
    endDate,
  };

  // Reports and per-prompt answers are fetched together under one usage
  // entry, matching how this call was always billed/timed as a single unit;
  // answers are fetched concurrently across targets rather than one at a time.
  const [visibility, citations, sentiment, answers] = await withVendorUsage(
    { organizationId, brandId, vendor: "profound", operation: "queryResults", mode, jobId: job.id },
    async () => {
      const [visibility, citations, sentiment] = await Promise.all([
        adapter.queryVisibility(query),
        adapter.queryCitations(query),
        adapter.querySentiment(query),
      ]);
      const answers = (
        await Promise.all(
          targets.map((target) =>
            adapter.getPromptAnswers(target.profoundPromptId, { startDate, endDate }),
          ),
        )
      ).flat();
      return [visibility, citations, sentiment, answers] as const;
    },
  );

  const merged = mergeResultRows(visibility, citations, sentiment, answers);
  const targetByProfoundId = new Map(targets.map((target) => [target.profoundPromptId, target]));

  const values = merged.flatMap((row) => {
    const target = targetByProfoundId.get(row.profoundPromptId);
    if (!target) return [];
    return [
      {
        id: newId(ID_PREFIXES.resultSnapshot),
        organizationId,
        brandId,
        promptId: target.promptId,
        profoundPromptId: row.profoundPromptId,
        profoundCategoryId: target.profoundCategoryId,
        runId: row.runId,
        runDate: new Date(`${row.runDate}T00:00:00Z`),
        model: row.model,
        modelId: row.modelId,
        region: row.region,
        asset: row.asset,
        topic: row.topic,
        profoundPersona: row.profoundPersona,
        tags: row.tags,
        visibilityScore: row.visibilityScore,
        shareOfVoice: row.shareOfVoice,
        mentionCount: row.mentionCount,
        executions: row.executions,
        averagePosition: row.averagePosition,
        citationCount: row.citationCount,
        citationShare: row.citationShare,
        brandMentioned: row.brandMentioned,
        rawAnswer: row.rawAnswer,
        mentions: row.mentions,
        citations: row.citations,
        searchQueries: row.searchQueries,
        sentimentThemes: row.sentimentThemes,
        dataOrigin: mode,
      },
    ];
  });

  let inserted = 0;
  let alreadyPresent = 0;
  if (values.length > 0) {
    const insertedRows = await db
      .insert(profoundResultSnapshots)
      .values(values)
      .onConflictDoNothing()
      .returning({ id: profoundResultSnapshots.id });
    inserted = insertedRows.length;
    alreadyPresent = values.length - inserted;
  }

  return {
    status: "succeeded",
    result: { inserted, alreadyPresent, prompts: targets.length },
  };
});
