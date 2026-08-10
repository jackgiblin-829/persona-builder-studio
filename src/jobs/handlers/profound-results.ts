import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import {
  brands,
  profoundPromptLinks,
  profoundResultBuckets,
  profoundSentimentBuckets,
  prompts,
} from "@/db/schema";
import { getProfoundAdapter } from "@/adapters/profound";
import { getQueue } from "@/adapters/queue";
import type { ProfoundResultQuery } from "@/adapters/profound/types";
import { hashExpectedElements } from "@/lib/answer-coverage";
import { AppError, NotFoundError } from "@/lib/errors";
import { newId, ID_PREFIXES } from "@/lib/ids";
import { mergeVisibilityCitations } from "@/lib/profound-results";
import { withVendorUsage } from "@/services/usage";
import { JOB_TYPES, registerJob } from "../registry";

/**
 * Result retrieval (§25).
 *
 * Retrieval only ever covers prompts this product actually linked in Profound
 * — `profound_prompt_links` is the source of truth for which vendor prompt ids
 * to ask about, never a locally-typed list. The real reporting API is
 * category-scoped, so targets are grouped by `profoundCategoryId` and one
 * query is issued per category. Visibility and citations are merged onto one
 * bucket row per (prompt, date, model, topic, region, persona, asset) —
 * `mergeVisibilityCitations` — and inserted with `ON CONFLICT DO NOTHING`: a
 * bucket, once stored, is never recomputed or relabelled, so re-running
 * retrieval for an overlapping window is a no-op for buckets it already has.
 * Sentiment is a separate, unmerged bucket set — see
 * `src/lib/profound-results.ts`'s module doc comment for why.
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

  const [brand] = await db.select().from(brands).where(eq(brands.id, brandId)).limit(1);
  if (!brand) throw new NotFoundError("Brand");

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
  const targetByProfoundId = new Map(targets.map((target) => [target.profoundPromptId, target]));

  // Group by category — the real API is category-scoped, not prompt-list-scoped.
  const targetsByCategory = new Map<string, typeof targets>();
  for (const target of targets) {
    const list = targetsByCategory.get(target.profoundCategoryId) ?? [];
    list.push(target);
    targetsByCategory.set(target.profoundCategoryId, list);
  }

  const { adapter, mode } = await getProfoundAdapter(organizationId);

  const modelIds = (
    await withVendorUsage(
      { organizationId, brandId, vendor: "profound", operation: "getModels", mode, jobId: job.id },
      () => adapter.getModels(),
    )
  ).map((model) => model.id);

  const resultBucketValues: (typeof profoundResultBuckets.$inferInsert)[] = [];
  const sentimentBucketValues: (typeof profoundSentimentBuckets.$inferInsert)[] = [];

  for (const [profoundCategoryId, categoryTargets] of targetsByCategory) {
    const query: ProfoundResultQuery = {
      categoryId: profoundCategoryId,
      profoundPromptIds: categoryTargets.map((target) => target.profoundPromptId),
      modelIds,
      startDate,
      endDate,
      asset: brand.canonicalDomain,
    };

    const [visibility, citations, sentiment] = await withVendorUsage(
      { organizationId, brandId, vendor: "profound", operation: "queryResults", mode, jobId: job.id },
      () =>
        Promise.all([
          adapter.queryVisibility(query),
          adapter.queryCitations(query),
          adapter.querySentiment(query),
        ]),
    );

    for (const row of mergeVisibilityCitations(visibility, citations)) {
      const target = targetByProfoundId.get(row.profoundPromptId);
      if (!target) continue;
      resultBucketValues.push({
        id: newId(ID_PREFIXES.resultSnapshot),
        organizationId,
        brandId,
        promptId: target.promptId,
        profoundPromptId: row.profoundPromptId,
        profoundCategoryId: target.profoundCategoryId,
        bucketDate: new Date(`${row.bucketDate}T00:00:00Z`),
        modelId: row.modelId,
        model: row.model,
        topicId: row.topicId ?? "",
        topic: row.topic,
        regionId: row.regionId ?? "",
        region: row.region,
        personaId: row.personaId ?? "",
        profoundPersona: row.profoundPersona,
        asset: row.asset,
        assetOwned: row.assetOwned,
        rank: row.rank,
        visibilityScore: row.visibilityScore,
        shareOfVoice: row.shareOfVoice,
        averagePosition: row.averagePosition,
        citationCount: row.citationCount,
        citationShare: row.citationShare,
        citationDomains: row.citationDomains,
        citations: row.citations,
        dataOrigin: mode,
      });
    }

    for (const row of sentiment) {
      if (!row.profoundPromptId) continue;
      const target = targetByProfoundId.get(row.profoundPromptId);
      if (!target) continue;
      sentimentBucketValues.push({
        id: newId(ID_PREFIXES.resultSnapshot),
        organizationId,
        brandId,
        promptId: target.promptId,
        profoundPromptId: row.profoundPromptId,
        profoundCategoryId: target.profoundCategoryId,
        asset: row.asset,
        bucketDate: new Date(`${row.bucketDate ?? startDate}T00:00:00Z`),
        modelId: row.modelId ?? "",
        model: row.model,
        topicId: row.topicId ?? "",
        topic: row.topic,
        regionId: row.regionId ?? "",
        region: row.region,
        personaId: row.personaId ?? "",
        profoundPersona: row.profoundPersona,
        tag: row.tag ?? "",
        theme: row.theme ?? "",
        claim: row.claim ?? "",
        profoundRun: row.profoundRun ?? "",
        competitor: row.competitor ?? "",
        positiveSentiment: row.positiveSentiment,
        negativeSentiment: row.negativeSentiment,
        occurrence: row.occurrence,
        citedWebsites: row.citedWebsites,
        rank: row.rank,
        dataOrigin: mode,
      });
    }
  }

  // Each row binds many columns; Postgres caps a single query at 65,535 bind
  // parameters, so a wide retrieval window must be inserted in batches rather
  // than as one values() call.
  const INSERT_BATCH_SIZE = 1000;

  let inserted = 0;
  let alreadyPresent = 0;
  for (let i = 0; i < resultBucketValues.length; i += INSERT_BATCH_SIZE) {
    const batch = resultBucketValues.slice(i, i + INSERT_BATCH_SIZE);
    const insertedRows = await db
      .insert(profoundResultBuckets)
      .values(batch)
      .onConflictDoNothing()
      .returning({ id: profoundResultBuckets.id });
    inserted += insertedRows.length;
    alreadyPresent += batch.length - insertedRows.length;
  }

  let sentimentInserted = 0;
  for (let i = 0; i < sentimentBucketValues.length; i += INSERT_BATCH_SIZE) {
    const batch = sentimentBucketValues.slice(i, i + INSERT_BATCH_SIZE);
    const insertedRows = await db
      .insert(profoundSentimentBuckets)
      .values(batch)
      .onConflictDoNothing()
      .returning({ id: profoundSentimentBuckets.id });
    sentimentInserted += insertedRows.length;
  }

  // Phase 2: enqueue a self-computed answer-coverage estimate for every
  // retrieved prompt that has expected answer elements to estimate against.
  // Cheap to enqueue redundantly — the idempotency key covers the current
  // (promptId, expectedElementsHash) pair, and the job itself skips a cache
  // hit — so re-running retrieval for an overlapping window never produces a
  // duplicate OpenAI call, but editing a prompt's expected elements does
  // produce a fresh one the next time results are retrieved.
  const targetPromptIds = targets.map((target) => target.promptId);
  const targetPromptRows =
    targetPromptIds.length > 0
      ? await db
          .select({ id: prompts.id, expectedAnswerElements: prompts.expectedAnswerElements })
          .from(prompts)
          .where(inArray(prompts.id, targetPromptIds))
      : [];
  let coverageEstimatesQueued = 0;
  for (const promptRow of targetPromptRows) {
    if (promptRow.expectedAnswerElements.length === 0) continue;
    const expectedElementsHash = hashExpectedElements(promptRow.expectedAnswerElements);
    await getQueue().enqueue(
      JOB_TYPES.estimateAnswerCoverage,
      { organizationId, brandId, promptId: promptRow.id },
      {
        organizationId,
        brandId,
        idempotencyKey: `estimate_answer_coverage:${promptRow.id}:${expectedElementsHash}`,
      },
    );
    coverageEstimatesQueued++;
  }

  return {
    status: "succeeded",
    result: {
      inserted,
      alreadyPresent,
      sentimentInserted,
      prompts: targets.length,
      coverageEstimatesQueued,
    },
  };
});
