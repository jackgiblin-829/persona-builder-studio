import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import {
  personas,
  personaVersions,
  profoundResultBuckets,
  promptAnswerCoverageEstimates,
  prompts,
} from "@/db/schema";
import { getOpenAIAdapter } from "@/adapters/openai";
import { hashExpectedElements } from "@/lib/answer-coverage";
import { AppError, NotFoundError } from "@/lib/errors";
import { newId, ID_PREFIXES } from "@/lib/ids";
import { ANSWER_COVERAGE_ESTIMATE, renderTemplate } from "@/prompts/registry";
import { answerCoverageEstimateSchema, SCHEMA_VERSION } from "@/prompts/schemas";
import { toStrictJsonSchema } from "@/prompts/json-schema";
import { withVendorUsage } from "@/services/usage";
import { JOB_TYPES, registerJob } from "../registry";
import { loadBrandContext } from "./ingest-source";

/**
 * Self-computed answer-coverage estimate (Phase 2 of the 2026-08-10 Profound
 * redesign).
 *
 * Profound exposes no raw-answer text at all, so "which of a prompt's expected
 * answer elements does a well-informed answer currently cover" cannot be read
 * back from the vendor. This job asks this product's own OpenAI adapter to
 * estimate it instead, grounded in whatever real evidence this prompt's own
 * retrieved buckets already show (topic, cited domains) — never a guess made
 * from the prompt text alone without saying so. The result is always inserted
 * with `dataOrigin: "local"` and is meant to always be rendered next to an
 * `OriginBadge` that says so, never confused with something Profound measured.
 *
 * Cacheable by design: keyed on `(promptId, expectedElementsHash)` — see
 * `src/lib/answer-coverage.ts` — so editing a prompt's expected elements
 * produces a fresh estimate, but re-running this job for an unchanged prompt
 * is a no-op rather than a second OpenAI call.
 *
 * Enqueued automatically from `src/jobs/handlers/profound-results.ts` once a
 * category's buckets have been retrieved, so real evidence is available by
 * the time this runs; it is also safe to enqueue standalone (e.g. right after
 * prompt generation) — a prompt with no retrieval yet just gets an honestly
 * low-evidence estimate rather than failing.
 */
registerJob(JOB_TYPES.estimateAnswerCoverage, async ({ job }) => {
  const brandId = String(job.payload.brandId ?? "");
  const promptId = String(job.payload.promptId ?? "");
  if (!brandId || !promptId) {
    throw new AppError("validation", "estimate_answer_coverage requires brandId and promptId");
  }

  const brand = await loadBrandContext(brandId);

  const [prompt] = await db
    .select()
    .from(prompts)
    .where(and(eq(prompts.id, promptId), eq(prompts.brandId, brandId)))
    .limit(1);
  if (!prompt) throw new NotFoundError("Prompt");

  if (prompt.expectedAnswerElements.length === 0) {
    return {
      status: "succeeded",
      result: { skipped: "prompt has no expected answer elements to estimate" },
    };
  }

  const expectedElementsHash = hashExpectedElements(prompt.expectedAnswerElements);

  const [existing] = await db
    .select({ id: promptAnswerCoverageEstimates.id })
    .from(promptAnswerCoverageEstimates)
    .where(
      and(
        eq(promptAnswerCoverageEstimates.promptId, promptId),
        eq(promptAnswerCoverageEstimates.expectedElementsHash, expectedElementsHash),
      ),
    )
    .limit(1);
  if (existing) {
    return {
      status: "succeeded",
      result: { skipped: "an estimate is already cached for this expected-elements set" },
    };
  }

  const [persona] = await db
    .select({ name: personas.name })
    .from(personas)
    .where(eq(personas.id, prompt.personaId))
    .limit(1);
  const [personaVersion] = await db
    .select({ segmentDefinition: personaVersions.segmentDefinition })
    .from(personaVersions)
    .where(eq(personaVersions.id, prompt.personaVersionId))
    .limit(1);

  // Real evidence, never fabricated: whatever this prompt's own retrieved
  // buckets already show about its topic and cited domains. A prompt with no
  // retrieval yet gets an honestly empty evidence string, not a guess.
  const recentBuckets = await db
    .select({
      topic: profoundResultBuckets.topic,
      citationDomains: profoundResultBuckets.citationDomains,
    })
    .from(profoundResultBuckets)
    .where(eq(profoundResultBuckets.promptId, promptId))
    .orderBy(desc(profoundResultBuckets.bucketDate))
    .limit(5);

  const topic = recentBuckets.find((bucket) => bucket.topic)?.topic ?? prompt.topic;
  const citationDomains = [...new Set(recentBuckets.flatMap((bucket) => bucket.citationDomains))];
  const realEvidence =
    recentBuckets.length === 0
      ? "No Profound retrieval evidence exists yet for this prompt."
      : `Topic: ${topic}. Cited domains observed: ${citationDomains.join(", ") || "none"}.`;

  const { adapter, mode } = await getOpenAIAdapter(brand.organizationId);
  const jsonSchema = toStrictJsonSchema(answerCoverageEstimateSchema, "AnswerCoverageEstimate");

  const mockContext = { expectedAnswerElements: prompt.expectedAnswerElements, citationDomains, topic };

  const result = await withVendorUsage(
    {
      organizationId: brand.organizationId,
      brandId,
      vendor: "openai",
      operation: "answer_coverage_estimate",
      mode,
      jobId: job.id,
    },
    () =>
      adapter.generateStructured({
        templateId: ANSWER_COVERAGE_ESTIMATE.id,
        templateVersion: ANSWER_COVERAGE_ESTIMATE.version,
        schemaVersion: SCHEMA_VERSION,
        system: ANSWER_COVERAGE_ESTIMATE.system,
        user: renderTemplate(ANSWER_COVERAGE_ESTIMATE, {
          prompt_text: prompt.promptText,
          persona: persona ? `${persona.name}: ${personaVersion?.segmentDefinition ?? ""}` : "(none)",
          expected_answer_elements: prompt.expectedAnswerElements.join("; "),
          real_evidence: realEvidence,
        }),
        schema: answerCoverageEstimateSchema,
        schemaName: "AnswerCoverageEstimate",
        jsonSchema,
        modelTier: ANSWER_COVERAGE_ESTIMATE.modelTier,
        mockContext,
      }),
    (estimateResult) => ({
      retryCount: estimateResult.attempts - 1,
      tokensIn: estimateResult.tokensIn,
      tokensOut: estimateResult.tokensOut,
      costCents: estimateResult.costCents,
    }),
  );

  await db
    .insert(promptAnswerCoverageEstimates)
    .values({
      id: newId(ID_PREFIXES.answerCoverageEstimate),
      organizationId: brand.organizationId,
      brandId,
      promptId,
      expectedElementsHash,
      covered: result.data.covered,
      missing: result.data.missing,
      confidence: result.data.confidence,
      rationale: result.data.rationale,
      modelProvider: result.modelProvider,
      modelId: result.modelId,
      promptTemplateVersion: ANSWER_COVERAGE_ESTIMATE.version,
      // Always "local" regardless of whether the underlying OpenAI call was
      // mock or live — this table records a self-computed estimate, not a
      // vendor report, and that label must never vary with adapter mode.
      dataOrigin: "local",
    })
    .onConflictDoNothing();

  return {
    status: "succeeded",
    result: { promptId, covered: result.data.covered.length, missing: result.data.missing.length },
  };
});
