import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { competitors, dataSources, sourceDocuments } from "@/db/schema";
import { getOpenAIAdapter } from "@/adapters/openai";
import { getQueue } from "@/adapters/queue";
import { AppError } from "@/lib/errors";
import { newId, ID_PREFIXES } from "@/lib/ids";
import { WEB_RESEARCH_PLANNING, renderTemplate } from "@/prompts/registry";
import { webResearchPlanSchema, SCHEMA_VERSION } from "@/prompts/schemas";
import { toStrictJsonSchema } from "@/prompts/json-schema";
import { withVendorUsage } from "@/services/usage";
import { JOB_TYPES, registerJob } from "../registry";
import { loadBrandContext } from "./ingest-source";

/**
 * Deep web research: plans a short list of externally-answerable research
 * questions from the brand's own context, runs a web search for each, and
 * feeds the findings into the ordinary evidence pipeline.
 *
 * Query planning is auto-derived, not user-supplied — the brand's
 * description and competitors are enough context for a first cut, and this
 * keeps the feature to one LLM call plus N searches rather than a separate
 * "write your own research brief" UI.
 */
registerJob(JOB_TYPES.webResearch, async ({ job }) => {
  const brandId = String(job.payload.brandId ?? "");
  if (!brandId) throw new AppError("validation", "web_research requires brandId");

  const brand = await loadBrandContext(brandId);
  const competitorRows = await db
    .select({ name: competitors.name })
    .from(competitors)
    .where(eq(competitors.brandId, brandId));
  const competitorNames = competitorRows.map((row) => row.name);

  const brandContext = [
    `Brand: ${brand.name} (${brand.canonicalDomain})`,
    `Description: ${brand.description}`,
    competitorNames.length > 0 ? `Known competitors: ${competitorNames.join(", ")}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const { adapter, mode } = await getOpenAIAdapter(brand.organizationId);
  const jsonSchema = toStrictJsonSchema(webResearchPlanSchema, "WebResearchPlan");

  const plan = await withVendorUsage(
    {
      organizationId: brand.organizationId,
      brandId,
      vendor: "openai",
      operation: "web_research_planning",
      mode,
      jobId: job.id,
    },
    () =>
      adapter.generateStructured({
        templateId: WEB_RESEARCH_PLANNING.id,
        templateVersion: WEB_RESEARCH_PLANNING.version,
        schemaVersion: SCHEMA_VERSION,
        system: WEB_RESEARCH_PLANNING.system,
        user: renderTemplate(WEB_RESEARCH_PLANNING, { brand_context: brandContext }),
        schema: webResearchPlanSchema,
        schemaName: "WebResearchPlan",
        jsonSchema,
        modelTier: WEB_RESEARCH_PLANNING.modelTier,
        mockContext: {
          brandName: brand.name,
          brandDescription: brand.description,
          competitorNames,
        },
      }),
    (planResult) => ({
      retryCount: planResult.attempts - 1,
      tokensIn: planResult.tokensIn,
      tokensOut: planResult.tokensOut,
      costCents: planResult.costCents,
    }),
  );

  const documents: { title: string; location: string; text: string }[] = [];
  let searchFailures = 0;

  for (const item of plan.data.queries) {
    // One failed search must not discard the others.
    const result = await withVendorUsage(
      {
        organizationId: brand.organizationId,
        brandId,
        vendor: "openai",
        operation: "web_search",
        mode,
        jobId: job.id,
      },
      () => adapter.webSearch({ query: item.query, brandContext }),
      (searchResult) => ({
        tokensIn: searchResult.tokensIn,
        tokensOut: searchResult.tokensOut,
        costCents: searchResult.costCents,
      }),
      { swallow: true },
    );

    if (!result) {
      searchFailures++;
      continue;
    }

    if (!result.findings.trim()) continue;
    const sources =
      result.citations.length > 0
        ? `\n\nSources: ${result.citations.map((c) => c.url).join(", ")}`
        : "";
    documents.push({
      title: item.query,
      location: result.citations[0]?.url ?? `web research: ${item.query}`,
      text: `${result.findings}${sources}`,
    });
  }

  if (documents.length === 0) {
    return {
      status: searchFailures > 0 ? "partially_succeeded" : "succeeded",
      result: { queries: plan.data.queries.length, documents: 0, searchFailures },
    };
  }

  // Keyed by job id so a retried/re-enqueued attempt of this exact job run
  // cannot insert a second copy of the same documents.
  const checksum = `web_research:${job.id}`;
  const dataSourceId = newId(ID_PREFIXES.dataSource);
  const [inserted] = await db
    .insert(dataSources)
    .values({
      id: dataSourceId,
      organizationId: brand.organizationId,
      brandId,
      label: `Deep research: ${brand.name}`,
      sourceType: "web_research",
      sourceSystem: "openai_web_search",
      checksum,
      status: "running",
      documentCount: documents.length,
    })
    .onConflictDoNothing({ target: [dataSources.brandId, dataSources.checksum] })
    .returning({ id: dataSources.id });

  if (!inserted) {
    return {
      status: searchFailures > 0 ? "partially_succeeded" : "succeeded",
      result: {
        queries: plan.data.queries.length,
        documents: documents.length,
        searchFailures,
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
      metadata: { query: document.title, piiStatus: "none" },
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

  return {
    status: searchFailures > 0 ? "partially_succeeded" : "succeeded",
    result: { queries: plan.data.queries.length, documents: documents.length, searchFailures },
  };
});
