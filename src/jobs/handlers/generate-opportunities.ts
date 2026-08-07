import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import {
  brandProducts,
  competitors,
  contentOpportunities,
  pageInventory,
  personaVersions,
  personas,
  profoundPromptLinks,
  profoundResultSnapshots,
  promptEvidence,
  promptPairs,
  promptSetVersions,
  prompts,
} from "@/db/schema";
import { getOpenAIAdapter } from "@/adapters/openai";
import type {
  ContentGapMockCandidate,
  ContentGapMockContext,
} from "@/adapters/openai/mock/content-gap";
import { AppError } from "@/lib/errors";
import { newId, ID_PREFIXES } from "@/lib/ids";
import {
  analyzeGap,
  estimateEffort,
  estimatePriority,
  type GapSignal,
  type ResultClassification,
} from "@/lib/content-gap";
import { classifyResult, compareControl, detectMissingElements } from "@/lib/profound-results";
import { getBrandSearchIntelligence } from "@/services/search-intelligence";
import { CONTENT_GAP, renderTemplate } from "@/prompts/registry";
import { opportunityGenerationSchema, SCHEMA_VERSION } from "@/prompts/schemas";
import { toStrictJsonSchema } from "@/prompts/json-schema";
import { withVendorUsage } from "@/services/usage";
import { JOB_TYPES, registerJob } from "../registry";
import { loadBrandContext } from "./ingest-source";
import { evaluateStatementCoverage, tokenize } from "@/lib/page-audit";

/**
 * Content-gap analysis and opportunity generation (§27, §28).
 *
 * The model (or the mock generator) only ever supplies prose. `gap_type` and
 * `recommendation` are always recomputed from `analyzeGap` and used to
 * overwrite whatever the model returned — the guarantee that not every gap
 * becomes `new_article` has to hold in live mode too, not only when the mock
 * generator happens to call the same function. Evidence ids, Profound prompt
 * ids and run ids are filtered to exactly what was supplied to the call, the
 * same citation-integrity rule `generate-prompts.ts` applies.
 */
registerJob(JOB_TYPES.generateOpportunities, async ({ job }) => {
  const brandId = String(job.payload.brandId ?? "");
  const personaVersionId = String(job.payload.personaVersionId ?? "");
  const promptSetVersionId = String(job.payload.promptSetVersionId ?? "");
  const requestedByUserId = job.payload.requestedByUserId
    ? String(job.payload.requestedByUserId)
    : null;

  if (!brandId || !personaVersionId || !promptSetVersionId) {
    throw new AppError(
      "validation",
      "generate_opportunities requires brandId, personaVersionId and promptSetVersionId",
    );
  }

  const brand = await loadBrandContext(brandId);

  const [personaVersion] = await db
    .select()
    .from(personaVersions)
    .where(and(eq(personaVersions.id, personaVersionId), eq(personaVersions.brandId, brandId)))
    .limit(1);
  if (!personaVersion) throw new AppError("not_found", "The persona version no longer exists.");
  if (personaVersion.status !== "approved") {
    throw new AppError(
      "validation",
      "Content-gap analysis runs against an approved persona version only.",
    );
  }

  const [persona] = await db
    .select()
    .from(personas)
    .where(eq(personas.id, personaVersion.personaId))
    .limit(1);
  if (!persona) throw new AppError("not_found", "The persona no longer exists.");

  const [promptSetVersion] = await db
    .select()
    .from(promptSetVersions)
    .where(
      and(eq(promptSetVersions.id, promptSetVersionId), eq(promptSetVersions.brandId, brandId)),
    )
    .limit(1);
  if (!promptSetVersion)
    throw new AppError("not_found", "The prompt set version no longer exists.");
  if (promptSetVersion.status !== "approved") {
    throw new AppError(
      "validation",
      "Content-gap analysis runs against an approved prompt-set version only.",
    );
  }

  const personaPrompts = await db
    .select()
    .from(prompts)
    .where(
      and(
        eq(prompts.promptSetVersionId, promptSetVersionId),
        eq(prompts.brandId, brandId),
        eq(prompts.promptType, "persona"),
      ),
    );

  if (personaPrompts.length === 0) {
    throw new AppError("validation", "This prompt-set version has no persona prompts to analyze.");
  }

  const promptIds = personaPrompts.map((p) => p.id);

  const [links, snapshots, pairs, pages, evidenceLinks, productRows, competitorRows] =
    await Promise.all([
      db
        .select()
        .from(profoundPromptLinks)
        .where(
          and(
            inArray(profoundPromptLinks.promptId, promptIds),
            eq(profoundPromptLinks.organizationId, brand.organizationId),
          ),
        ),
      db
        .select()
        .from(profoundResultSnapshots)
        .where(
          and(
            inArray(profoundResultSnapshots.promptId, promptIds),
            eq(profoundResultSnapshots.organizationId, brand.organizationId),
          ),
        )
        .orderBy(desc(profoundResultSnapshots.runDate)),
      db.select().from(promptPairs).where(eq(promptPairs.promptSetVersionId, promptSetVersionId)),
      db.select().from(pageInventory).where(eq(pageInventory.brandId, brandId)),
      db
        .select()
        .from(promptEvidence)
        .where(
          and(inArray(promptEvidence.promptId, promptIds), eq(promptEvidence.unavailable, false)),
        ),
      db.select().from(brandProducts).where(eq(brandProducts.brandId, brandId)),
      db.select().from(competitors).where(eq(competitors.brandId, brandId)),
    ]);

  // Most recent snapshot per prompt, and every snapshot per prompt for
  // aggregation (control comparison uses the whole window, not just the tip).
  const snapshotsByPrompt = new Map<string, typeof snapshots>();
  for (const snapshot of snapshots) {
    if (!snapshot.promptId) continue;
    const list = snapshotsByPrompt.get(snapshot.promptId) ?? [];
    list.push(snapshot);
    snapshotsByPrompt.set(snapshot.promptId, list);
  }

  const linkByPrompt = new Map(links.map((link) => [link.promptId, link]));
  const evidenceByPrompt = new Map<string, string[]>();
  for (const link of evidenceLinks) {
    const list = evidenceByPrompt.get(link.promptId) ?? [];
    list.push(link.evidenceId);
    evidenceByPrompt.set(link.promptId, list);
  }
  const pairByPersonaPrompt = new Map(pairs.map((pair) => [pair.personaPromptId, pair]));

  const competitorNames = competitorRows.map((c) => c.name);
  const competitorDomains = new Set(
    competitorRows.map((c) => c.domain).filter((d): d is string => !!d),
  );
  const productTokens = productRows.map((p) => ({ name: p.name, tokens: tokenize(p.name) }));

  // DataForSEO: cached search demand and domain-competitor context for the
  // brand's own domain, keyed by prompt topic. A single call per generation
  // run regardless of how many prompts are analyzed.
  const intelligence = await getBrandSearchIntelligence(
    { organizationId: brand.organizationId, brandId, jobId: job.id },
    { domain: brand.canonicalDomain, keywords: personaPrompts.map((p) => p.topic) },
  );
  const volumeByKeyword = new Map(
    intelligence.searchVolume.volumes.map((row) => [row.keyword.toLowerCase(), row]),
  );
  const unknownAuthorityDomain = intelligence.domainCompetitors.competitors.find(
    (c) => c.domain !== brand.canonicalDomain && !competitorDomains.has(c.domain),
  );

  const candidates: ContentGapMockCandidate[] = [];

  for (const prompt of personaPrompts) {
    const link = linkByPrompt.get(prompt.id);
    if (!link) continue; // Never analyze a prompt that was never deployed — there is no result to analyze.

    const promptSnapshots = snapshotsByPrompt.get(prompt.id) ?? [];
    if (promptSnapshots.length === 0) continue; // No retrieval yet; nothing to analyze.

    const latest = promptSnapshots[0]!; // Sorted desc by runDate above.
    const classification: ResultClassification = classifyResult({
      brandMentioned: latest.brandMentioned ?? false,
      mentionCount: latest.mentionCount ?? 0,
      shareOfVoice: latest.shareOfVoice,
      mentions: (latest.mentions as { entity: string; share: number }[]) ?? [],
    });

    const missingElements = detectMissingElements(prompt.expectedAnswerElements, {
      rawAnswer: latest.rawAnswer,
    });

    let controlOutperforms: boolean | null = null;
    const pair = pairByPersonaPrompt.get(prompt.id);
    if (pair) {
      const controlSnapshots = snapshotsByPrompt.get(pair.controlPromptId) ?? [];
      if (controlSnapshots.length > 0) {
        const comparison = compareControl(
          promptSnapshots.map(toSnapshotMetrics),
          controlSnapshots.map(toSnapshotMetrics),
        );
        controlOutperforms = comparison.personaOutperforms;
      }
    }

    const promptTokens = tokenize(`${prompt.topic} ${prompt.promptText}`);
    const matchedPage = pages
      .map((page) => ({
        page,
        score: coverageScore(promptTokens, page),
      }))
      .sort((a, b) => b.score - a.score)[0];
    const hasExistingPage = Boolean(matchedPage && matchedPage.score >= 0.2);
    const existingPageCoversTopic = Boolean(matchedPage && matchedPage.score >= 0.4);
    const extractabilityIssue =
      hasExistingPage &&
      matchedPage!.page.structuredData.length === 0 &&
      matchedPage!.page.headings.length < 2;
    const messagingMismatch =
      hasExistingPage &&
      prompt.vocabularyUsed.length > 0 &&
      coverageOfVocabulary(prompt.vocabularyUsed, matchedPage!.page) < 0.3;

    const evidenceIds = evidenceByPrompt.get(prompt.id) ?? [];
    const evidenceAvailable = evidenceIds.length > 0;

    const volumeRow = volumeByKeyword.get(prompt.topic.toLowerCase());
    const thirdPartyAuthorityDominant =
      classification === "brand_absent" && Boolean(unknownAuthorityDomain) && !hasExistingPage;

    const productSpecific = productTokens.some((product) =>
      [...product.tokens].some((token) => promptTokens.has(token)),
    );

    const proofOfOutcomeNeeded =
      prompt.intent === "risk_reduction" ||
      missingElements.some((el) => /\b(proof|case study|results|outcome|example)\b/i.test(el));

    const technicalDepth =
      prompt.intent === "implementation" ||
      prompt.intent === "troubleshooting" ||
      prompt.intent === "optimization";

    const isHomepageSurface =
      !hasExistingPage &&
      prompt.journeyStage === "unaware" &&
      /\b(what is|overview|who is)\b/i.test(prompt.promptText);

    const signal: GapSignal = {
      classification,
      missingElements,
      controlOutperforms,
      hasExistingPage,
      existingPageCoversTopic,
      extractabilityIssue,
      messagingMismatch,
      thirdPartyAuthorityDominant,
      productFitGap: false, // No reliable deterministic signal for this without product-fit evidence tagging; see Known limitations.
      evidenceAvailable,
      comparisonIntent: prompt.intent === "comparison",
      questionShaped:
        prompt.promptText.trim().endsWith("?") ||
        missingElements.some((el) =>
          /^(what|how|why|when|which|who|does|is|can)\b/i.test(el.trim()),
        ),
      decisionStage: ["consideration", "evaluation", "purchase"].includes(prompt.journeyStage),
      productSpecific,
      technicalDepth,
      proofOfOutcomeNeeded,
      isHomepageSurface,
      searchVolume: volumeRow?.searchVolume ?? null,
      keywordDifficulty: null,
    };

    candidates.push({
      promptId: prompt.id,
      profoundPromptId: link.profoundPromptId,
      promptText: prompt.promptText,
      topic: prompt.topic,
      personaName: persona.name,
      runIds: promptSnapshots.slice(0, 5).map((s) => s.runId),
      competitors: competitorNames.filter((name) =>
        (latest.mentions as { entity: string }[])?.some((m) => m.entity === name),
      ),
      citationSources: [
        ...new Set(
          ((latest.citations as { domain?: string }[]) ?? [])
            .map((c) => c.domain)
            .filter((d): d is string => !!d),
        ),
      ],
      existingPageUrl: hasExistingPage ? matchedPage!.page.canonicalUrl : null,
      evidenceIds,
      signal,
    });
  }

  if (candidates.length === 0) {
    return {
      status: "succeeded",
      result: { opportunities: 0, skipped: "no linked prompts with results to analyze" },
    };
  }

  // Rank material gaps by priority, but always keep room for at least one
  // `no_content_action` example when one exists — the seeded proof that this
  // workflow does not treat every gap the same way.
  const scored = candidates.map((candidate) => {
    const analysis = analyzeGap(candidate.signal);
    return { candidate, analysis, priority: estimatePriority(candidate.signal, analysis) };
  });
  const material = scored
    .filter((row) => row.analysis.material)
    .sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);
  const immaterial = scored.filter((row) => !row.analysis.material);

  const selected = [...material.slice(0, 10).map((row) => row.candidate)];
  for (const row of immaterial) {
    if (selected.length >= 12) break;
    selected.push(row.candidate);
  }

  const brandContext = [
    `Brand: ${brand.name} (${brand.canonicalDomain})`,
    `Description: ${brand.description}`,
  ]
    .filter(Boolean)
    .join("\n");

  const { adapter, mode } = await getOpenAIAdapter(brand.organizationId);
  const jsonSchema = toStrictJsonSchema(opportunityGenerationSchema, "OpportunityGeneration");

  const mockContext: ContentGapMockContext = { brandName: brand.name, candidates: selected };

  const result = await withVendorUsage(
    {
      organizationId: brand.organizationId,
      brandId,
      vendor: "openai",
      operation: "content_gap_analysis",
      mode,
      jobId: job.id,
    },
    () =>
      adapter.generateStructured({
        templateId: CONTENT_GAP.id,
        templateVersion: CONTENT_GAP.version,
        schemaVersion: SCHEMA_VERSION,
        system: CONTENT_GAP.system,
        user: renderTemplate(CONTENT_GAP, {
          brand_context: brandContext,
          persona: `${persona.name}: ${personaVersion.segmentDefinition}`,
          prompt_set: selected
            .map((c) => `${c.promptId}: ${c.promptText} (topic: ${c.topic})`)
            .join("\n"),
          profound_performance: selected
            .map(
              (c) =>
                `${c.profoundPromptId}: ${c.signal.classification}, control outperforms: ${c.signal.controlOutperforms}`,
            )
            .join("\n"),
          profound_results: selected
            .map((c) => `${c.profoundPromptId}: missing [${c.signal.missingElements.join("; ")}]`)
            .join("\n"),
          site_inventory: pages.map((p) => `${p.canonicalUrl}: ${p.title ?? ""}`).join("\n"),
          search_data: [...volumeByKeyword.values()]
            .map((v) => `${v.keyword}: volume ${v.searchVolume ?? "unknown"}`)
            .join("\n"),
          evidence: selected.map((c) => `${c.promptId}: [${c.evidenceIds.join(", ")}]`).join("\n"),
        }),
        schema: opportunityGenerationSchema,
        schemaName: "OpportunityGeneration",
        jsonSchema,
        modelTier: CONTENT_GAP.modelTier,
        mockContext: mockContext as unknown as Record<string, unknown>,
      }),
    (gapResult) => ({
      retryCount: gapResult.attempts - 1,
      tokensIn: gapResult.tokensIn,
      tokensOut: gapResult.tokensOut,
      costCents: gapResult.costCents,
    }),
  );

  const validProfoundPromptIds = new Set(selected.map((c) => c.profoundPromptId));
  const validRunIds = new Set(selected.flatMap((c) => c.runIds));

  let created = 0;
  const evidenceCutoff = personaVersion.evidenceCutoff;

  await db.transaction(async (tx) => {
    // The model's opportunities are matched back to a candidate by whichever
    // Profound prompt id they cite; an opportunity that cites none of the
    // supplied ids cannot be trusted to a candidate and is dropped rather than
    // guessed at.
    for (const opportunity of result.data.opportunities) {
      const citedProfoundId = opportunity.relevant_profound_prompt_ids.find((id) =>
        validProfoundPromptIds.has(id),
      );
      const candidate = citedProfoundId
        ? selected.find((c) => c.profoundPromptId === citedProfoundId)
        : undefined;
      if (!candidate) continue;

      // The deterministic decision always wins over whatever the model said.
      const analysis = analyzeGap(candidate.signal);
      const priority = estimatePriority(candidate.signal, analysis);
      const effort = estimateEffort(analysis.recommendation);

      const filteredEvidenceIds = opportunity.evidence_ids.filter((id) =>
        candidate.evidenceIds.includes(id),
      );
      const filteredRunIds = opportunity.relevant_run_ids.filter((id) => validRunIds.has(id));

      await tx.insert(contentOpportunities).values({
        id: newId(ID_PREFIXES.contentOpportunity),
        organizationId: brand.organizationId,
        brandId,
        personaId: persona.id,
        personaVersionId,
        promptSetVersionId,
        title: opportunity.title,
        problemStatement: opportunity.problem_statement,
        performanceGap: opportunity.performance_gap,
        gapType: analysis.gapType,
        recommendation: analysis.recommendation,
        recommendationRationale: analysis.rationale,
        relevantProfoundPromptIds: [candidate.profoundPromptId],
        relevantRunIds: filteredRunIds.length > 0 ? filteredRunIds : candidate.runIds,
        competitors: candidate.competitors,
        citationSources: candidate.citationSources,
        missingAnswerElements: candidate.signal.missingElements,
        searchDemand: {
          searchVolume: candidate.signal.searchVolume,
          keywordDifficulty: candidate.signal.keywordDifficulty,
        },
        existingPageUrl: candidate.existingPageUrl,
        priority,
        estimatedEffort: effort,
        evidenceIds: filteredEvidenceIds,
        validationMethod: opportunity.validation_method,
        modelProvider: result.modelProvider,
        modelId: result.modelId,
        promptTemplateVersion: CONTENT_GAP.version,
        schemaVersion: SCHEMA_VERSION,
        dataOrigin: result.dataOrigin,
        evidenceCutoff,
        reviewStatus: "pending_review",
        generatedByUserId: requestedByUserId,
      });
      created++;
    }
  });

  return {
    status: created > 0 ? "succeeded" : "partially_succeeded",
    result: { opportunities: created, analyzed: candidates.length, selected: selected.length },
  };
});

function toSnapshotMetrics(row: typeof profoundResultSnapshots.$inferSelect) {
  return {
    visibilityScore: row.visibilityScore,
    shareOfVoice: row.shareOfVoice,
    mentionCount: row.mentionCount,
    executions: row.executions,
    citationCount: row.citationCount,
    citationShare: row.citationShare,
    averagePosition: row.averagePosition,
  };
}

function coverageScore(promptTokens: Set<string>, page: typeof pageInventory.$inferSelect): number {
  const pageTokens = tokenize(
    `${page.title ?? ""} ${page.headings.join(" ")} ${page.summary ?? ""}`,
  );
  if (pageTokens.size === 0) return 0;
  let hits = 0;
  for (const token of promptTokens) if (pageTokens.has(token)) hits++;
  return promptTokens.size === 0 ? 0 : hits / promptTokens.size;
}

function coverageOfVocabulary(
  vocabulary: string[],
  page: typeof pageInventory.$inferSelect,
): number {
  const [row] = evaluateStatementCoverage(
    `${page.title ?? ""} ${page.headings.join(" ")} ${page.summary ?? ""}`,
    [{ id: "vocab", statement: vocabulary.join(" ") }],
  );
  return row?.score ?? 0;
}

const PRIORITY_RANK: Record<"p1" | "p2" | "p3", number> = { p1: 0, p2: 1, p3: 2 };
