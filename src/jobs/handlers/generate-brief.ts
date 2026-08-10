import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import {
  brands,
  contentBriefs,
  contentOpportunities,
  pageInventory,
  personaVersions,
  personas,
  profoundPromptLinks,
  prompts,
} from "@/db/schema";
import { getOpenAIAdapter } from "@/adapters/openai";
import type { BriefMockContext } from "@/adapters/openai/mock/seo-brief";
import { sanitizeBriefBody } from "@/lib/content-traceability";
import { AppError } from "@/lib/errors";
import { newId, ID_PREFIXES } from "@/lib/ids";
import { tokenize } from "@/lib/page-audit";
import { loadFieldsWithEvidence } from "@/services/personas";
import { getBrandSearchIntelligence } from "@/services/search-intelligence";
import { SEO_BRIEF, renderTemplate } from "@/prompts/registry";
import { briefSchema, SCHEMA_VERSION } from "@/prompts/schemas";
import { toStrictJsonSchema } from "@/prompts/json-schema";
import { withVendorUsage } from "@/services/usage";
import { JOB_TYPES, registerJob } from "../registry";
import { loadBrandContext } from "./ingest-source";

/**
 * SEO brief generation (§29) from an approved content opportunity.
 *
 * The opportunity is the source of truth for which persona, which Profound
 * prompt and which evidence this brief is allowed to cite — the brief never
 * re-derives them independently, so a brief can never drift from the
 * opportunity it was generated to satisfy. `sanitizeBriefBody` is the write
 * boundary: a brief whose outline or Profound references cannot be traced
 * after filtering is never written at all (the job throws, nothing partial).
 */
registerJob(JOB_TYPES.generateBrief, async ({ job }) => {
  const brandId = String(job.payload.brandId ?? "");
  const opportunityId = String(job.payload.opportunityId ?? "");
  const requestedByUserId = job.payload.requestedByUserId
    ? String(job.payload.requestedByUserId)
    : null;
  const parentBriefId = job.payload.parentBriefId ? String(job.payload.parentBriefId) : null;

  if (!brandId || !opportunityId) {
    throw new AppError("validation", "generate_brief requires brandId and opportunityId");
  }

  const brand = await loadBrandContext(brandId);

  const [opportunity] = await db
    .select()
    .from(contentOpportunities)
    .where(
      and(eq(contentOpportunities.id, opportunityId), eq(contentOpportunities.brandId, brandId)),
    )
    .limit(1);
  if (!opportunity) throw new AppError("not_found", "The content opportunity no longer exists.");
  if (!opportunity.personaVersionId) {
    throw new AppError(
      "validation",
      "This opportunity has no linked persona version to brief from.",
    );
  }
  if (opportunity.reviewStatus === "rejected") {
    throw new AppError("validation", "A rejected opportunity cannot be turned into a brief.");
  }

  const [personaVersion] = await db
    .select()
    .from(personaVersions)
    .where(eq(personaVersions.id, opportunity.personaVersionId))
    .limit(1);
  if (!personaVersion) throw new AppError("not_found", "The persona version no longer exists.");

  const [persona] = await db
    .select()
    .from(personas)
    .where(eq(personas.id, personaVersion.personaId))
    .limit(1);
  if (!persona) throw new AppError("not_found", "The persona no longer exists.");

  const fields = await loadFieldsWithEvidence(personaVersion.id);
  const byType = (type: string) =>
    fields
      .filter((f) => f.fieldType === type && !f.insufficientEvidence && !f.markedUnsupported)
      .map((f) => ({
        id: f.id,
        statement: f.statement,
        evidenceIds: f.evidence
          .filter((e) => e.relation === "supports" && e.availability === "available")
          .map((e) => e.evidenceId),
      }))
      .filter((claim) => claim.evidenceIds.length > 0);

  const constraints = byType("constraint");
  const objections = byType("objection");
  const decisionCriteria = byType("decision_criterion");
  const jobField = fields.find((f) => f.fieldType === "job_to_be_done" && !f.insufficientEvidence);
  const vocabulary = fields.filter((f) => f.fieldType === "vocabulary").map((f) => f.statement);
  const distinguishingTopics = fields
    .filter((f) => f.fieldType === "distinguishing_topic")
    .map((f) => f.statement);

  const availableEvidenceIds = new Set([
    ...constraints.flatMap((c) => c.evidenceIds),
    ...objections.flatMap((c) => c.evidenceIds),
    ...decisionCriteria.flatMap((c) => c.evidenceIds),
    ...(jobField?.evidence.filter((e) => e.availability === "available").map((e) => e.evidenceId) ??
      []),
  ]);

  const relevantPromptLinks = await db
    .select()
    .from(profoundPromptLinks)
    .where(
      and(
        eq(profoundPromptLinks.brandId, brandId),
        inArray(profoundPromptLinks.profoundPromptId, opportunity.relevantProfoundPromptIds),
      ),
    );
  const relevantPrompts = await (relevantPromptLinks.length > 0
    ? db
        .select()
        .from(prompts)
        .where(
          inArray(
            prompts.id,
            relevantPromptLinks.map((l) => l.promptId),
          ),
        )
    : Promise.resolve([]));

  const promptTextByProfoundId = new Map(
    relevantPromptLinks.map((link) => [
      link.profoundPromptId,
      relevantPrompts.find((p) => p.id === link.promptId)?.promptText ?? "",
    ]),
  );

  const pages = await db.select().from(pageInventory).where(eq(pageInventory.brandId, brandId));
  const vocabTokens = tokenize(vocabulary.join(" "));
  const internalLinks = pages
    .filter((page) => page.canonicalUrl !== opportunity.existingPageUrl)
    .map((page) => ({
      page,
      score: overlapCount(vocabTokens, tokenize(`${page.title ?? ""} ${page.headings.join(" ")}`)),
    }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((row) => ({
      url: row.page.canonicalUrl,
      rationale: `Shares vocabulary with this persona's terms; link from the new content to ${row.page.title ?? row.page.canonicalUrl}.`,
    }));

  const searchKeywords = [opportunity.title, ...vocabulary, ...distinguishingTopics].slice(0, 15);
  let searchVolume: number | null = null;
  try {
    const intelligence = await getBrandSearchIntelligence(
      { organizationId: brand.organizationId, brandId, jobId: job.id },
      { domain: brand.canonicalDomain, keywords: searchKeywords },
    );
    searchVolume = intelligence.searchVolume.volumes[0]?.searchVolume ?? null;
  } catch {
    // Search intelligence is supplementary context for this brief, not a
    // hard dependency — a DataForSEO failure should not block writing a
    // brief that is otherwise fully evidence- and Profound-traceable.
    searchVolume = null;
  }

  const [brandRow] = await db.select().from(brands).where(eq(brands.id, brandId)).limit(1);
  const conversionAction = brandRow?.conversionActions[0] ?? "Talk to sales";

  const mockContext: BriefMockContext = {
    brandName: brand.name,
    brandDomain: brand.canonicalDomain,
    opportunityTitle: opportunity.title,
    opportunityProblemStatement: opportunity.problemStatement,
    recommendation: opportunity.recommendation,
    personaName: persona.name,
    jobToBeDone: jobField?.statement ?? personaVersion.segmentDefinition,
    constraints,
    objections,
    decisionCriteria,
    vocabulary,
    distinguishingTopics,
    missingAnswerElements: opportunity.missingAnswerElements,
    primaryQuery: opportunity.title,
    supportingQueries: [...new Set(vocabulary)].slice(0, 10),
    intent: relevantPrompts[0]?.intent ?? "education",
    journeyStage: relevantPrompts[0]?.journeyStage ?? "unknown",
    relevantPrompts: opportunity.relevantProfoundPromptIds.map((id) => ({
      profoundPromptId: id,
      promptText: promptTextByProfoundId.get(id) ?? "",
      gap: opportunity.performanceGap,
    })),
    profoundGapSummary: opportunity.performanceGap,
    competitors: opportunity.competitors,
    citationSources: opportunity.citationSources,
    existingPageUrl: opportunity.existingPageUrl,
    internalLinks,
    conversionAction,
    searchVolume,
    keywordDifficulty: null,
  };

  const { adapter, mode } = await getOpenAIAdapter(brand.organizationId);
  const jsonSchema = toStrictJsonSchema(briefSchema, "SeoBrief");

  const result = await withVendorUsage(
    {
      organizationId: brand.organizationId,
      brandId,
      vendor: "openai",
      operation: "seo_brief_generation",
      mode,
      jobId: job.id,
    },
    () =>
      adapter.generateStructured({
        templateId: SEO_BRIEF.id,
        templateVersion: SEO_BRIEF.version,
        schemaVersion: SCHEMA_VERSION,
        system: SEO_BRIEF.system,
        user: renderTemplate(SEO_BRIEF, {
          brand_context: `Brand: ${brand.name} (${brand.canonicalDomain})\n${brand.description}`,
          persona: `${persona.name}: ${personaVersion.segmentDefinition}`,
          opportunity: `${opportunity.title}\n${opportunity.problemStatement}\nRecommendation: ${opportunity.recommendation}`,
          prompt_cluster: [...promptTextByProfoundId.entries()]
            .map(([id, text]) => `${id}: ${text}`)
            .join("\n"),
          retrieved_evidence: [...constraints, ...objections, ...decisionCriteria]
            .map((c) => `${c.statement} [${c.evidenceIds.join(", ")}]`)
            .join("\n"),
          dataforseo_analysis: searchVolume != null ? `Search volume signal: ${searchVolume}` : "",
          profound_analysis: opportunity.performanceGap,
          site_inventory: pages.map((p) => `${p.canonicalUrl}: ${p.title ?? ""}`).join("\n"),
        }),
        schema: briefSchema,
        schemaName: "SeoBrief",
        jsonSchema,
        modelTier: SEO_BRIEF.modelTier,
        mockContext: mockContext as unknown as Record<string, unknown>,
      }),
    (briefResult) => ({
      retryCount: briefResult.attempts - 1,
      tokensIn: briefResult.tokensIn,
      tokensOut: briefResult.tokensOut,
      costCents: briefResult.costCents,
    }),
  );

  const sanitized = sanitizeBriefBody(result.data, {
    evidenceIds: availableEvidenceIds,
    profoundPromptIds: new Set(opportunity.relevantProfoundPromptIds),
  });

  if (!sanitized.writable) {
    throw new AppError(
      "schema_validation",
      `The generated brief has nothing left to write after removing untraceable sections: ${sanitized.violations.map((v) => v.issue).join("; ")}`,
    );
  }

  const evidenceIds = [
    ...new Set([
      ...sanitized.body.constraints.flatMap((c) => c.evidence_ids),
      ...sanitized.body.objections.flatMap((c) => c.evidence_ids),
      ...sanitized.body.decision_criteria.flatMap((c) => c.evidence_ids),
      ...sanitized.body.recommended_outline.flatMap((s) => s.evidence_ids),
    ]),
  ];
  const profoundPromptIds = sanitized.body.relevant_profound_prompts.map(
    (p) => p.profound_prompt_id,
  );

  let version = 1;
  if (parentBriefId) {
    const [parent] = await db
      .select({ version: contentBriefs.version })
      .from(contentBriefs)
      .where(eq(contentBriefs.id, parentBriefId))
      .limit(1);
    version = (parent?.version ?? 0) + 1;
  }

  const briefId = newId(ID_PREFIXES.contentBrief);
  await db.insert(contentBriefs).values({
    id: briefId,
    organizationId: brand.organizationId,
    brandId,
    opportunityId,
    personaId: persona.id,
    personaVersionId: personaVersion.id,
    promptSetVersionId: opportunity.promptSetVersionId,
    version,
    workingTitle: sanitized.body.working_title,
    body: sanitized.body,
    evidenceIds,
    profoundPromptIds,
    bucketIds: opportunity.relevantBucketIds,
    modelProvider: result.modelProvider,
    modelId: result.modelId,
    promptTemplateVersion: SEO_BRIEF.version,
    schemaVersion: SCHEMA_VERSION,
    dataOrigin: result.dataOrigin,
    evidenceCutoff: personaVersion.evidenceCutoff,
    reviewStatus: "draft",
    generatedByUserId: requestedByUserId,
    parentBriefId,
  });

  return {
    status: sanitized.violations.length > 0 ? "partially_succeeded" : "succeeded",
    result: { briefId, version, droppedSections: sanitized.violations.length },
  };
});

function overlapCount(a: Set<string>, b: Set<string>): number {
  let hits = 0;
  for (const token of a) if (b.has(token)) hits++;
  return hits;
}
