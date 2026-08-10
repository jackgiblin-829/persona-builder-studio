import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { dataSources, profoundCategoryMappings, sourceDocuments } from "@/db/schema";
import { getProfoundAdapter } from "@/adapters/profound";
import type {
  ProfoundAccountCitationsRow,
  ProfoundAccountSentimentRow,
  ProfoundAccountVisibilityRow,
} from "@/adapters/profound/types";
import { getQueue } from "@/adapters/queue";
import { AppError } from "@/lib/errors";
import { newId, ID_PREFIXES } from "@/lib/ids";
import { withVendorUsage } from "@/services/usage";
import { JOB_TYPES, registerJob } from "../registry";
import { loadBrandContext } from "./ingest-source";

/**
 * Pulls the brand's existing AI-visibility data from Profound — scoped to
 * the mapped category, not to any prompt this product deployed — and turns
 * it into evidence, the same way a SparkToro report or an upload does.
 *
 * Distinct from milestone 6's results retrieval: that tracks *this product's*
 * deployed prompts one by one; this reads whatever Profound already knows
 * about the category as a whole, as an input to persona building rather than
 * a performance dashboard.
 */
registerJob(JOB_TYPES.profoundEvidence, async ({ job }) => {
  const brandId = String(job.payload.brandId ?? "");
  const startDate = String(job.payload.startDate ?? "");
  const endDate = String(job.payload.endDate ?? "");
  if (!brandId || !startDate || !endDate) {
    throw new AppError("validation", "profound_evidence requires brandId, startDate, endDate");
  }

  const brand = await loadBrandContext(brandId);

  const [categoryRow] = await db
    .select()
    .from(profoundCategoryMappings)
    .where(
      and(
        eq(profoundCategoryMappings.organizationId, brand.organizationId),
        eq(profoundCategoryMappings.brandId, brandId),
      ),
    )
    .orderBy(desc(profoundCategoryMappings.updatedAt))
    .limit(1);
  if (!categoryRow) {
    throw new AppError("validation", "This brand has no Profound category mapping yet.");
  }

  const { adapter, mode } = await getProfoundAdapter(brand.organizationId);
  // `asset` is required by `queryAccountSentiment` specifically (the brand
  // name being analyzed) — included on every call here, the same way
  // `src/jobs/handlers/profound-results.ts` does, rather than only on the
  // sentiment call, since it is harmless for the other two.
  const query = {
    categoryId: categoryRow.profoundCategoryId,
    startDate,
    endDate,
    asset: brand.canonicalDomain,
  };

  const [visibility, citations, sentiment]: [
    ProfoundAccountVisibilityRow[],
    ProfoundAccountCitationsRow[],
    ProfoundAccountSentimentRow[],
  ] = await withVendorUsage(
    {
      organizationId: brand.organizationId,
      brandId,
      vendor: "profound",
      operation: "account_evidence_pull",
      mode,
    },
    () =>
      Promise.all([
        adapter.queryAccountVisibility(query),
        adapter.queryAccountCitations(query),
        adapter.queryAccountSentiment(query),
      ]),
  );

  const topics = new Set([
    ...visibility.map((row) => row.topic),
    ...citations.map((row) => row.topic),
    ...sentiment.map((row) => row.topic),
  ]);

  const documents: { title: string; location: string; text: string }[] = [];
  for (const topic of topics) {
    const text = documentifyTopic(
      topic,
      startDate,
      endDate,
      visibility.filter((row) => row.topic === topic),
      citations.filter((row) => row.topic === topic),
      sentiment.filter((row) => row.topic === topic),
    );
    if (text) documents.push({ title: topic, location: `Profound topic: ${topic}`, text });
  }

  if (documents.length === 0) {
    return { status: "succeeded", result: { topics: 0 } };
  }

  // Keyed by job id so a retried/re-enqueued attempt of this exact job run
  // cannot insert a second copy of the same documents.
  const checksum = `profound_evidence:${job.id}`;
  const dataSourceId = newId(ID_PREFIXES.dataSource);
  const [inserted] = await db
    .insert(dataSources)
    .values({
      id: dataSourceId,
      organizationId: brand.organizationId,
      brandId,
      label: `Profound AI-visibility: ${startDate} to ${endDate}`,
      sourceType: "profound",
      sourceSystem: "profound_report",
      checksum,
      status: "running",
      documentCount: documents.length,
    })
    .onConflictDoNothing({ target: [dataSources.brandId, dataSources.checksum] })
    .returning({ id: dataSources.id });

  if (!inserted) {
    return {
      status: "succeeded",
      result: {
        topics: documents.length,
        skipped: "already ingested by a previous attempt of this job",
      },
    };
  }

  await db.insert(sourceDocuments).values(
    documents.map((document, index) => ({
      id: newId(ID_PREFIXES.sourceDocument),
      organizationId: brand.organizationId,
      brandId,
      dataSourceId,
      title: document.title,
      location: document.location,
      sequence: index,
      rawText: document.text,
      redactedText: document.text,
      piiFindings: {},
      metadata: { topic: document.title, piiStatus: "none" },
      speaker: null,
      observedAt: null,
      contentHash: `${dataSourceId}:${index}`,
    })),
  );

  await getQueue().enqueue(
    JOB_TYPES.extractEvidence,
    { dataSourceId },
    {
      organizationId: brand.organizationId,
      brandId,
      idempotencyKey: `extract:${dataSourceId}:${job.id}`,
    },
  );

  return { status: "succeeded", result: { topics: documents.length } };
});

function documentifyTopic(
  topic: string,
  startDate: string,
  endDate: string,
  visibility: ProfoundAccountVisibilityRow[],
  citations: ProfoundAccountCitationsRow[],
  sentiment: ProfoundAccountSentimentRow[],
): string | null {
  if (visibility.length === 0 && citations.length === 0 && sentiment.length === 0) return null;

  const parts: string[] = [];

  if (visibility.length > 0) {
    const avgVisibility = average(visibility.map((row) => row.visibilityScore));
    const avgShare = average(visibility.map((row) => row.shareOfVoice));
    parts.push(
      `For the topic "${topic}" between ${startDate} and ${endDate}, this brand's AI-visibility ` +
        `score across search queries on this topic averaged ${formatPercent(avgVisibility)}, ` +
        `with an average share of voice of ${formatPercent(avgShare)}.`,
    );
  }

  const totalCitations = citations.reduce((sum, row) => sum + row.citationCount, 0);
  if (totalCitations > 0) {
    const domains = [...new Set(citations.flatMap((row) => row.topDomains))].slice(0, 5);
    parts.push(
      `${totalCitations} citation(s) were recorded` +
        (domains.length > 0 ? `, most often from ${domains.join(", ")}` : "") +
        ".",
    );
  }

  const positiveValues = sentiment
    .map((row) => row.positiveSentiment)
    .filter((v): v is number => v != null);
  const negativeValues = sentiment
    .map((row) => row.negativeSentiment)
    .filter((v): v is number => v != null);
  if (positiveValues.length > 0 || negativeValues.length > 0) {
    const avgPositive = average(positiveValues);
    const avgNegative = average(negativeValues);
    parts.push(
      `Sentiment in AI answers about this topic averaged ` +
        `${avgPositive != null ? `${avgPositive.toFixed(1)}%` : "unavailable"} positive and ` +
        `${avgNegative != null ? `${avgNegative.toFixed(1)}%` : "unavailable"} negative.`,
    );
  }

  return parts.length > 0 ? parts.join(" ") : null;
}

function average(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatPercent(value: number | null): string {
  return value === null ? "unavailable" : `${(value * 100).toFixed(1)}%`;
}
