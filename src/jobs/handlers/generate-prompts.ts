import "server-only";
import { and, asc, desc, eq, max, ne } from "drizzle-orm";
import { db } from "@/db/client";
import {
  competitors,
  evidenceRecords,
  personaFieldEvidence,
  personaFields,
  personaVersions,
  personas,
  promptEvidence,
  promptPairs,
  promptSetVersions,
  promptSets,
  prompts,
} from "@/db/schema";
import { getOpenAIAdapter } from "@/adapters/openai";
import { getQueue } from "@/adapters/queue";
import { AppError } from "@/lib/errors";
import { newId, slugify, ID_PREFIXES } from "@/lib/ids";
import { dedupeExact, promptHash } from "@/lib/prompt-dedupe";
import { buildPromptMetadata } from "@/lib/profound-tags";
import { PROMPT_GENERATION, renderTemplate } from "@/prompts/registry";
import { promptGenerationSchema, SCHEMA_VERSION } from "@/prompts/schemas";
import { toStrictJsonSchema } from "@/prompts/json-schema";
import { recordVendorUsage } from "@/services/usage";
import { JOB_TYPES, registerJob } from "../registry";
import { loadBrandContext } from "./ingest-source";

/**
 * Prompt generation for one approved persona version (§17).
 *
 * Three invariants are enforced here rather than trusted to the model:
 *
 * 1. **Citation integrity.** A prompt may only cite evidence that is actually
 *    attached to the persona version it was generated from. Anything else is
 *    dropped and counted; a prompt left with no verifiable citation is not
 *    stored at all, because an uncited prompt is exactly the brand-keyword
 *    guess the product exists to prevent.
 * 2. **No forced brand insertion.** A generated prompt whose text names the
 *    target brand is rejected. §17 forbids inserting the brand to improve its
 *    own measured visibility, and a rule the application enforces is worth more
 *    than a line in a system prompt.
 * 3. **A new version every time.** Regenerating never modifies an existing
 *    prompt-set version; the prompt set is a stable identity and the version is
 *    new, so an approved version is untouchable (§33).
 */
registerJob(JOB_TYPES.generatePrompts, async ({ job }) => {
  const brandId = String(job.payload.brandId ?? "");
  const personaVersionId = String(job.payload.personaVersionId ?? "");
  const requestedByUserId = job.payload.requestedByUserId
    ? String(job.payload.requestedByUserId)
    : null;

  if (!brandId || !personaVersionId) {
    throw new AppError("validation", "generate_prompts requires brandId and personaVersionId");
  }

  const brand = await loadBrandContext(brandId);

  const [version] = await db
    .select()
    .from(personaVersions)
    .where(and(eq(personaVersions.id, personaVersionId), eq(personaVersions.brandId, brandId)))
    .limit(1);
  if (!version) throw new AppError("not_found", "The persona version no longer exists.");
  if (version.status !== "approved") {
    throw new AppError(
      "validation",
      "Prompts are generated from an approved persona version only — an unapproved persona would put unreviewed claims into a tracked prompt set.",
    );
  }

  const [persona] = await db
    .select()
    .from(personas)
    .where(eq(personas.id, version.personaId))
    .limit(1);
  if (!persona) throw new AppError("not_found", "The persona no longer exists.");

  // Fields plus the evidence each one actually cites and that is still
  // available. A field whose source was deleted contributes no evidence ids, so
  // it cannot seed a prompt.
  const fieldRows = await db
    .select()
    .from(personaFields)
    .where(eq(personaFields.personaVersionId, personaVersionId))
    .orderBy(asc(personaFields.sequence));

  const citationRows = await db
    .select({
      personaFieldId: personaFieldEvidence.personaFieldId,
      relation: personaFieldEvidence.relation,
      unavailable: personaFieldEvidence.unavailable,
      evidenceId: evidenceRecords.id,
      claim: evidenceRecords.normalizedClaim,
      category: evidenceRecords.category,
      sourceType: evidenceRecords.sourceType,
      journeyStage: evidenceRecords.journeyStage,
      entities: evidenceRecords.entities,
      vocabulary: evidenceRecords.vocabulary,
      availability: evidenceRecords.availability,
      observedAt: evidenceRecords.observedAt,
      ingestedAt: evidenceRecords.ingestedAt,
    })
    .from(personaFieldEvidence)
    .innerJoin(evidenceRecords, eq(evidenceRecords.id, personaFieldEvidence.evidenceId))
    .innerJoin(personaFields, eq(personaFields.id, personaFieldEvidence.personaFieldId))
    .where(eq(personaFields.personaVersionId, personaVersionId))
    .orderBy(asc(evidenceRecords.id));

  const usable = citationRows.filter(
    (row) => row.relation === "supports" && !row.unavailable && row.availability === "available",
  );

  const evidenceByField = new Map<string, string[]>();
  for (const row of usable) {
    const list = evidenceByField.get(row.personaFieldId) ?? [];
    if (!list.includes(row.evidenceId)) list.push(row.evidenceId);
    evidenceByField.set(row.personaFieldId, list);
  }

  const evidenceById = new Map<string, (typeof usable)[number]>();
  for (const row of usable)
    if (!evidenceById.has(row.evidenceId)) evidenceById.set(row.evidenceId, row);

  const suppliedEvidenceIds = new Set(evidenceById.keys());
  if (suppliedEvidenceIds.size === 0) {
    throw new AppError(
      "validation",
      "This persona version has no available supporting evidence left, so no prompt could be traced to anything. Review the persona before generating prompts.",
    );
  }

  const evidenceCutoff = [...evidenceById.values()].reduce<Date>((latest, row) => {
    const stamp = row.observedAt ?? row.ingestedAt;
    return stamp > latest ? stamp : latest;
  }, new Date(0));

  const competitorRows = await db
    .select({ name: competitors.name })
    .from(competitors)
    .where(eq(competitors.brandId, brandId));

  // Prompts already tracked for this brand under a different persona, so the
  // generator can avoid restating them and the dedupe pass has something to
  // compare against.
  const existingPrompts = await db
    .select({ text: prompts.promptText })
    .from(prompts)
    .where(and(eq(prompts.brandId, brandId), ne(prompts.personaVersionId, personaVersionId)))
    .limit(300);

  const mockFields = fieldRows.map((field) => ({
    id: field.id,
    fieldType: field.fieldType as string,
    statement: field.statement,
    evidenceIds: evidenceByField.get(field.id) ?? [],
    insufficientEvidence: field.insufficientEvidence || field.markedUnsupported,
    confidence: field.confidence,
  }));

  const { adapter, mode } = await getOpenAIAdapter(brand.organizationId);
  const jsonSchema = toStrictJsonSchema(promptGenerationSchema, "PromptGeneration");
  const started = Date.now();

  const result = await adapter.generateStructured({
    templateId: PROMPT_GENERATION.id,
    templateVersion: PROMPT_GENERATION.version,
    schemaVersion: SCHEMA_VERSION,
    system: PROMPT_GENERATION.system,
    user: renderTemplate(PROMPT_GENERATION, {
      persona: renderPersona(brand, version, fieldRows, evidenceByField),
      retrieved_evidence: [...evidenceById.values()]
        .map((row) => `[${row.evidenceId}] (${row.category}) ${row.claim}`)
        .join("\n"),
      sparktoro_signals: "",
      seo_signals: "",
      existing_prompts: existingPrompts.map((row) => row.text).join("\n"),
    }),
    schema: promptGenerationSchema,
    schemaName: "PromptGeneration",
    jsonSchema,
    modelTier: PROMPT_GENERATION.modelTier,
    mockContext: {
      brandName: brand.name,
      brandDescription: brand.description,
      competitorNames: competitorRows.map((row) => row.name),
      personaName: version.name,
      segmentDefinition: version.segmentDefinition,
      fields: mockFields,
      evidence: [...evidenceById.values()].map((row) => ({
        id: row.evidenceId,
        claim: row.claim,
        category: row.category,
        sourceType: row.sourceType,
        journeyStage: row.journeyStage,
        entities: row.entities,
        vocabulary: row.vocabulary,
      })),
      existingPromptTexts: existingPrompts.map((row) => row.text),
    },
  });

  await recordVendorUsage({
    organizationId: brand.organizationId,
    brandId,
    vendor: "openai",
    operation: "prompt_generation",
    mode,
    jobId: job.id,
    durationMs: Date.now() - started,
    retryCount: result.attempts - 1,
    outcome: "success",
    tokensIn: result.tokensIn,
    tokensOut: result.tokensOut,
    costCents: result.costCents,
  });

  // ── Validate before storing ───────────────────────────────────────────────

  const fieldsByStatement = new Map<string, string>();
  for (const field of fieldRows) {
    fieldsByStatement.set(normalizeStatement(field.statement), field.id);
  }

  let droppedCitations = 0;
  let rejectedForBrand = 0;
  let rejectedUncited = 0;

  const accepted = result.data.prompts.filter((prompt) => {
    if (mentionsBrand(prompt.prompt_text, brand.name) || mentionsBrand(prompt.topic, brand.name)) {
      rejectedForBrand++;
      return false;
    }

    const validIds = prompt.evidence_ids.filter((id) => suppliedEvidenceIds.has(id));
    droppedCitations += prompt.evidence_ids.length - validIds.length;
    prompt.evidence_ids = [...new Set(validIds)];

    if (prompt.evidence_ids.length === 0) {
      rejectedUncited++;
      return false;
    }
    return true;
  });

  if (accepted.length === 0) {
    throw new AppError(
      "validation",
      "No generated prompt survived the citation and brand-insertion checks, so nothing was stored. Re-run generation, or review the persona's evidence.",
    );
  }

  const { kept, dropped } = dedupeExact(
    accepted.map((prompt) => ({ prompt, promptText: prompt.prompt_text })),
  );

  // ── Prompt-set identity and the new version ───────────────────────────────

  let promptSetId = "";
  const [existingSet] = await db
    .select({ id: promptSets.id })
    .from(promptSets)
    .where(and(eq(promptSets.brandId, brandId), eq(promptSets.personaId, persona.id)))
    .limit(1);
  promptSetId = existingSet?.id ?? "";

  const setName = `${version.name} prompt set`;

  if (!promptSetId) {
    const taken = new Set(
      (
        await db
          .select({ slug: promptSets.slug })
          .from(promptSets)
          .where(eq(promptSets.brandId, brandId))
      ).map((row) => row.slug),
    );
    // The slug feeds `prompt-set:<slug>` tags in Profound, so it is derived from
    // the persona's stable slug rather than the version's display name.
    let slug = slugify(`${persona.slug}-prompts`);
    let suffix = 2;
    while (taken.has(slug)) slug = slugify(`${persona.slug}-prompts-${suffix++}`);

    promptSetId = newId(ID_PREFIXES.promptSet);
    await db.insert(promptSets).values({
      id: promptSetId,
      organizationId: brand.organizationId,
      brandId,
      personaId: persona.id,
      name: setName,
      slug,
    });
  }

  const [setRow] = await db
    .select()
    .from(promptSets)
    .where(eq(promptSets.id, promptSetId))
    .limit(1);
  if (!setRow) throw new AppError("internal", "The prompt set could not be loaded after creation.");

  const [maxRow] = await db
    .select({ n: max(promptSetVersions.version) })
    .from(promptSetVersions)
    .where(eq(promptSetVersions.promptSetId, promptSetId));
  const nextVersion = (maxRow?.n ?? 0) + 1;

  const [previous] = await db
    .select({ id: promptSetVersions.id, version: promptSetVersions.version })
    .from(promptSetVersions)
    .where(eq(promptSetVersions.promptSetId, promptSetId))
    .orderBy(desc(promptSetVersions.version))
    .limit(1);

  const setVersionId = newId(ID_PREFIXES.promptSetVersion);
  let personaPromptCount = 0;
  let controlCount = 0;

  await db.transaction(async (tx) => {
    await tx.insert(promptSetVersions).values({
      id: setVersionId,
      organizationId: brand.organizationId,
      brandId,
      promptSetId,
      personaVersionId,
      version: nextVersion,
      status: "draft",
      modelProvider: result.modelProvider,
      modelId: result.modelId,
      promptTemplateVersion: PROMPT_GENERATION.version,
      schemaVersion: SCHEMA_VERSION,
      dataOrigin: result.dataOrigin,
      evidenceCutoff,
      generatedByUserId: requestedByUserId,
      parentVersionId: previous?.id ?? null,
      changeSummary: previous
        ? `Regenerated from persona version ${version.version}; prompt-set version ${previous.version} kept unchanged.`
        : `First generation from persona version ${version.version} (${suppliedEvidenceIds.size} cited evidence record(s)).`,
    });

    // Controls are shared: two persona prompts that reduce to the same generic
    // question should be paired to one control row, not two, so the control's
    // measured visibility is not double-counted.
    const controlIdByHash = new Map<string, string>();

    for (const item of kept) {
      const generated = item.prompt;
      const personaFieldIds = personaFieldIdsFor(generated, fieldsByStatement);

      const promptId = newId(ID_PREFIXES.prompt);
      await tx.insert(prompts).values({
        id: promptId,
        organizationId: brand.organizationId,
        brandId,
        promptSetVersionId: setVersionId,
        personaId: persona.id,
        personaVersionId,
        promptType: "persona",
        topic: generated.topic,
        promptText: generated.prompt_text,
        normalizedHash: item.normalizedHash,
        informationNeed: generated.information_need,
        intent: generated.intent,
        journeyStage: generated.journey_stage,
        constraintsUsed: generated.constraints_used,
        decisionCriteriaUsed: generated.decision_criteria_used,
        vocabularyUsed: generated.vocabulary_used,
        personaFieldIds,
        expectedAnswerElements: generated.expected_answer_elements,
        inclusionRationale: generated.inclusion_rationale,
        confidence: generated.confidence,
        trackingPriority: generated.tracking_priority,
        executionMode: generated.execution_mode,
        reviewStatus: "pending_review",
        profoundMetadata: buildPromptMetadata({
          personaSlug: persona.slug,
          personaVersion: version.version,
          promptSetSlug: setRow.slug,
          promptSetVersion: nextVersion,
          intent: generated.intent,
          journeyStage: generated.journey_stage,
          promptType: "persona",
          promptText: generated.prompt_text,
          topic: generated.topic,
          languages: brand.languages,
          regions: brand.regions,
        }) as unknown as Record<string, unknown>,
        dataOrigin: result.dataOrigin,
      });
      personaPromptCount++;

      for (const evidenceId of generated.evidence_ids) {
        await tx
          .insert(promptEvidence)
          .values({
            id: newId(ID_PREFIXES.prompt),
            organizationId: brand.organizationId,
            promptId,
            evidenceId,
          })
          .onConflictDoNothing();
      }

      const controlText = generated.generic_control_prompt?.trim();
      if (!controlText) continue;

      const controlHash = promptHash(controlText);
      let controlId = controlIdByHash.get(controlHash);

      if (!controlId) {
        controlId = newId(ID_PREFIXES.prompt);
        await tx.insert(prompts).values({
          id: controlId,
          organizationId: brand.organizationId,
          brandId,
          promptSetVersionId: setVersionId,
          personaId: persona.id,
          personaVersionId,
          promptType: "generic_control",
          topic: generated.topic,
          promptText: controlText,
          normalizedHash: controlHash,
          informationNeed: `Generic control for: ${generated.information_need}`,
          intent: generated.intent,
          journeyStage: generated.journey_stage,
          constraintsUsed: [],
          decisionCriteriaUsed: [],
          vocabularyUsed: [],
          personaFieldIds: [],
          expectedAnswerElements: generated.expected_answer_elements,
          inclusionRationale:
            "The same question with the persona's qualifier removed. It exists to isolate the persona framing: if the persona prompt does not outperform it, the hypothesis failed rather than the content.",
          confidence: generated.confidence,
          trackingPriority: generated.tracking_priority,
          executionMode: generated.execution_mode,
          reviewStatus: "pending_review",
          profoundMetadata: buildPromptMetadata({
            personaSlug: persona.slug,
            personaVersion: version.version,
            promptSetSlug: setRow.slug,
            promptSetVersion: nextVersion,
            intent: generated.intent,
            journeyStage: generated.journey_stage,
            promptType: "generic_control",
            promptText: controlText,
            topic: generated.topic,
            languages: brand.languages,
            regions: brand.regions,
          }) as unknown as Record<string, unknown>,
          dataOrigin: result.dataOrigin,
        });
        controlIdByHash.set(controlHash, controlId);
        controlCount++;
      }

      await tx
        .insert(promptPairs)
        .values({
          id: newId(ID_PREFIXES.promptPair),
          organizationId: brand.organizationId,
          promptSetVersionId: setVersionId,
          personaPromptId: promptId,
          controlPromptId: controlId,
          rationale:
            "The control is the persona prompt with its qualifying clause removed, so the difference between them is the persona framing and nothing else.",
        })
        .onConflictDoNothing();
    }

    await tx
      .update(promptSetVersions)
      .set({ promptCount: personaPromptCount, controlCount, updatedAt: new Date() })
      .where(eq(promptSetVersions.id, setVersionId));

    await tx
      .update(promptSets)
      .set({ currentVersionId: setVersionId, name: setName, updatedAt: new Date() })
      .where(eq(promptSets.id, promptSetId));
  });

  // Embedding drives semantic near-duplicate detection (§18). Queued rather
  // than inlined so a slow embedding call cannot fail the generation that has
  // already succeeded.
  await getQueue().enqueue(
    JOB_TYPES.embedPrompts,
    { brandId, promptSetVersionId: setVersionId },
    { organizationId: brand.organizationId, brandId },
  );

  const partial = droppedCitations > 0 || rejectedForBrand > 0 || rejectedUncited > 0;

  return {
    status: partial ? "partially_succeeded" : "succeeded",
    result: {
      promptSetId,
      promptSetVersionId: setVersionId,
      version: nextVersion,
      personaPrompts: personaPromptCount,
      controls: controlCount,
      generated: result.data.prompts.length,
      droppedCitations,
      rejectedForBrandInsertion: rejectedForBrand,
      rejectedUncited,
      droppedExactDuplicates: dropped.length,
      modelId: result.modelId,
      dataOrigin: result.dataOrigin,
    },
  };
});

/**
 * A prompt names the target brand.
 *
 * Word-boundary matched on the full name and on its first word when that word
 * is distinctive, so "Northwind Analytics" and a bare "Northwind" are both
 * caught, but a brand called "Analytics Co" does not blacklist the word
 * "analytics" for every prompt in the set.
 */
export function mentionsBrand(text: string, brandName: string): boolean {
  const name = brandName.trim();
  if (name.length < 3) return false;

  const patterns = [name];
  const firstWord = name.split(/\s+/)[0];
  if (firstWord && firstWord.length >= 5 && !GENERIC_BRAND_WORDS.has(firstWord.toLowerCase())) {
    patterns.push(firstWord);
  }

  return patterns.some((pattern) =>
    new RegExp(`\\b${pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text),
  );
}

/** Words too common to treat as a brand mention on their own. */
const GENERIC_BRAND_WORDS = new Set([
  "analytics",
  "software",
  "systems",
  "platform",
  "digital",
  "global",
  "technologies",
  "solutions",
  "services",
  "insights",
  "metrics",
  "data",
  "cloud",
]);

/** Resolves the persona fields a prompt cites, by statement match. */
function personaFieldIdsFor(
  prompt: { constraints_used: string[]; decision_criteria_used: string[] },
  byStatement: Map<string, string>,
): string[] {
  const ids = new Set<string>();
  for (const statement of [...prompt.constraints_used, ...prompt.decision_criteria_used]) {
    const id = byStatement.get(normalizeStatement(statement));
    if (id) ids.add(id);
  }
  return [...ids];
}

function normalizeStatement(statement: string): string {
  return statement
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function renderPersona(
  brand: { name: string; description: string; canonicalDomain: string },
  version: {
    name: string;
    segmentDefinition: string;
    summary: string | null;
    journeyStages: string[];
  },
  fields: (typeof personaFields.$inferSelect)[],
  evidenceByField: Map<string, string[]>,
): string {
  const lines = [
    `Brand context (for market vocabulary only — never insert the brand name into a prompt):`,
    `${brand.name} (${brand.canonicalDomain}) — ${brand.description}`,
    "",
    `Persona: ${version.name}`,
    `Segment: ${version.segmentDefinition}`,
    version.summary ? `Summary: ${version.summary}` : "",
    `Journey stages: ${version.journeyStages.join(", ") || "unknown"}`,
    "",
    "Fields (only fields with evidence ids may seed a prompt):",
  ];

  for (const field of fields) {
    const ids = evidenceByField.get(field.id) ?? [];
    if (field.insufficientEvidence || field.markedUnsupported || ids.length === 0) continue;
    lines.push(`- [${field.fieldType}] ${field.statement} (evidence: ${ids.join(", ")})`);
  }

  return lines.filter(Boolean).join("\n");
}
