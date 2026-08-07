import "server-only";
import { and, eq, sql as raw } from "drizzle-orm";
import { db } from "@/db/client";
import { brands, dataSources, evidenceRecords, users } from "@/db/schema";
import type { BrandContext } from "@/lib/auth/context";
import { SEED_SOURCES } from "@fixtures/seed/sources";
import { createSourceFromPaste } from "@/services/sources";
import { reviewEvidence } from "@/services/evidence";
import { decideSegment, listSegments, startSegmentation } from "@/services/segments";
import { approvePersonaVersion, listPersonas, startPersonaGeneration } from "@/services/personas";
import { startPromptGeneration } from "@/services/prompt-sets";
import { seedOrganizationAndBrand } from "./organization";
import { drainQueue } from "./pipeline";

export type SeedSummary = Record<string, string | number>;

/**
 * Builds the demo dataset by running the real pipeline against mock adapters.
 *
 * Nothing here inserts fabricated rows straight into a result table — the seed
 * uploads real source text, runs the real ingestion, redaction, extraction and
 * embedding handlers, and reviews the output through the real service. If a
 * stage is broken the seed fails instead of producing a database that looks
 * right but proves nothing.
 */
export async function runSeed(opts: { fresh: boolean }): Promise<SeedSummary> {
  if (opts.fresh) await truncateAll();

  const { organizationId, brandId, ownerUserId } = await seedOrganizationAndBrand();
  const ctx = await buildSeedContext(organizationId, brandId, ownerUserId);

  // ── Sources ───────────────────────────────────────────────────────────────
  for (const source of SEED_SOURCES) {
    await createSourceFromPaste(ctx, {
      label: source.label,
      sourceType: source.sourceType,
      observedAt: new Date(source.observedAt),
      excludeFromModelCalls: false,
      content: source.content,
      isTranscript: source.format === "transcript",
      // The paste path stores plain text; the source system is corrected below
      // so CSV/JSON/Markdown sources parse with the right parser.
    });

    // Match the parser to the fixture's real format.
    const system = SOURCE_SYSTEM_BY_FORMAT[source.format];
    await db
      .update(dataSources)
      .set({
        sourceSystem: system,
        originalFilename: source.filename,
        contentType: source.contentType,
      })
      .where(and(eq(dataSources.brandId, brandId), eq(dataSources.label, source.label)));

    await db.execute(raw`
      UPDATE jobs
      SET payload = jsonb_set(payload, '{format}', to_jsonb(${FORMAT_BY_SEED[source.format]}::text))
      WHERE type = 'ingest_source'
        AND status = 'queued'
        AND payload->>'dataSourceId' = (
          SELECT id FROM data_sources
          WHERE brand_id = ${brandId} AND label = ${source.label}
          LIMIT 1
        )
    `);
  }

  const ingestion = await drainQueue({ workerId: "seed" });
  if (ingestion.failed > 0) {
    throw new Error(
      `Seed ingestion failed for ${ingestion.failed} job(s):\n  ${ingestion.errors.join("\n  ")}`,
    );
  }

  // ── Evidence review ───────────────────────────────────────────────────────
  // Approve everything except brand assertions, which stay pending so the demo
  // shows a reviewer that brand copy is not customer belief.
  const toApprove = await db
    .select({ id: evidenceRecords.id })
    .from(evidenceRecords)
    .where(
      and(
        eq(evidenceRecords.brandId, brandId),
        raw`${evidenceRecords.provenance} <> 'brand_assertion'`,
      ),
    );
  await reviewEvidence(
    ctx,
    toApprove.map((row) => row.id),
    "approved",
  );

  // ── Candidate segments ────────────────────────────────────────────────────
  await startSegmentation(ctx);
  const segmentation = await drainQueue({ workerId: "seed" });
  if (segmentation.failed > 0) {
    throw new Error(
      `Seed segmentation failed for ${segmentation.failed} job(s):\n  ${segmentation.errors.join("\n  ")}`,
    );
  }

  // Approve the two best-evidenced candidates, and leave the rest undecided so
  // the demo shows a queue rather than a finished state.
  //
  // Deliberately ranked by supporting-record count rather than by confidence: a
  // narrow candidate can score well precisely because it has little to
  // contradict, and a reviewer choosing what to invest in cares first about how
  // much evidence there is to work from.
  const { segments } = await listSegments(ctx);
  const toApproveSegments = [...segments]
    .sort((a, b) => b.supportingCount - a.supportingCount || a.slug.localeCompare(b.slug))
    .slice(0, 2);
  for (const segment of toApproveSegments) {
    await decideSegment(ctx, segment.id, "approved");
  }

  // ── Personas ──────────────────────────────────────────────────────────────
  for (const segment of toApproveSegments) {
    await startPersonaGeneration(ctx, segment.id);
  }
  const synthesis = await drainQueue({ workerId: "seed" });
  if (synthesis.failed > 0) {
    throw new Error(
      `Seed persona synthesis failed for ${synthesis.failed} job(s):\n  ${synthesis.errors.join("\n  ")}`,
    );
  }

  // ── Persona approval ──────────────────────────────────────────────────────
  // Approval runs through the real service, blockers and all. A persona whose
  // core fields are not all supported stays a draft — that is the product
  // working, and the demo is more honest with one approved persona and one
  // visibly blocked than with two that were waved through.
  const personaRows = await listPersonas(ctx);
  const approvedPersonaIds: string[] = [];
  const blockedPersonas: string[] = [];

  for (const row of personaRows) {
    if (!row.currentVersionId) continue;
    const { blockers } = await approvePersonaVersion(ctx, row.currentVersionId);
    if (blockers.length === 0) {
      approvedPersonaIds.push(row.id);
    } else {
      blockedPersonas.push(`${row.name}: ${blockers[0]}`);
    }
  }

  // ── Prompt sets ───────────────────────────────────────────────────────────
  for (const personaId of approvedPersonaIds) {
    await startPromptGeneration(ctx, personaId);
  }
  const promptGeneration = await drainQueue({ workerId: "seed" });
  if (promptGeneration.failed > 0) {
    throw new Error(
      `Seed prompt generation failed for ${promptGeneration.failed} job(s):\n  ${promptGeneration.errors.join("\n  ")}`,
    );
  }

  const counts = await summarise(brandId);

  return {
    organization: organizationId,
    brand: brandId,
    users: 3,
    sources: counts.sources,
    "source documents": counts.documents,
    "evidence records": counts.evidence,
    "evidence approved": counts.approved,
    "pii redactions": counts.redactions,
    embeddings: counts.embeddings,
    "candidate segments": counts.segments,
    "segments approved": counts.segmentsApproved,
    personas: counts.personas,
    "persona versions": counts.personaVersions,
    "persona fields": counts.personaFields,
    "fields marked insufficient": counts.personaFieldsInsufficient,
    "persona field citations": counts.personaFieldEvidence,
    "personas approved": approvedPersonaIds.length,
    "personas blocked from approval": blockedPersonas.length > 0 ? blockedPersonas.join(" | ") : 0,
    "prompt sets": counts.promptSets,
    "prompt set versions": counts.promptSetVersions,
    "persona prompts": counts.personaPrompts,
    "generic controls": counts.controlPrompts,
    "control pairs": counts.promptPairs,
    "prompt evidence citations": counts.promptEvidence,
    "prompt duplicate warnings": counts.promptWarnings,
    "jobs processed":
      ingestion.processed +
      segmentation.processed +
      synthesis.processed +
      promptGeneration.processed,
  };
}

const SOURCE_SYSTEM_BY_FORMAT = {
  transcript: "transcript_text",
  csv: "uploaded_csv",
  json: "uploaded_json",
  search_console_csv: "search_console_export",
  markdown: "uploaded_markdown",
} as const;

const FORMAT_BY_SEED = {
  transcript: "transcript",
  csv: "csv",
  json: "json",
  search_console_csv: "search_console_csv",
  markdown: "markdown",
} as const;

async function buildSeedContext(
  organizationId: string,
  brandId: string,
  userId: string,
): Promise<BrandContext> {
  const [brand] = await db.select().from(brands).where(eq(brands.id, brandId)).limit(1);
  const [user] = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  if (!brand || !user) throw new Error("Seed context could not be built");

  return {
    userId: user.id,
    userName: user.name,
    userEmail: user.email,
    organizationId,
    role: "owner",
    brandId,
    brandName: brand.name,
    brandSlug: brand.slug,
    regulatedDomain: brand.regulatedDomain,
  };
}

async function summarise(brandId: string) {
  const rows = await db.execute<{
    sources: number;
    documents: number;
    evidence: number;
    approved: number;
    redactions: number;
    embeddings: number;
    segments: number;
    segments_approved: number;
    personas: number;
    persona_versions: number;
    persona_fields: number;
    persona_fields_insufficient: number;
    persona_field_evidence: number;
    prompt_sets: number;
    prompt_set_versions: number;
    persona_prompts: number;
    control_prompts: number;
    prompt_pairs: number;
    prompt_evidence: number;
    prompt_warnings: number;
  }>(raw`
    SELECT
      (SELECT COUNT(*)::int FROM data_sources WHERE brand_id = ${brandId}) AS sources,
      (SELECT COUNT(*)::int FROM source_documents WHERE brand_id = ${brandId}) AS documents,
      (SELECT COUNT(*)::int FROM evidence_records WHERE brand_id = ${brandId}) AS evidence,
      (SELECT COUNT(*)::int FROM evidence_records WHERE brand_id = ${brandId} AND review_status = 'approved') AS approved,
      (SELECT COALESCE(SUM(pii_redaction_count), 0)::int FROM data_sources WHERE brand_id = ${brandId}) AS redactions,
      (SELECT COUNT(*)::int FROM evidence_embeddings WHERE brand_id = ${brandId}) AS embeddings,
      (SELECT COUNT(*)::int FROM segment_candidates WHERE brand_id = ${brandId}) AS segments,
      (SELECT COUNT(*)::int FROM segment_candidates WHERE brand_id = ${brandId} AND status = 'approved') AS segments_approved,
      (SELECT COUNT(*)::int FROM personas WHERE brand_id = ${brandId}) AS personas,
      (SELECT COUNT(*)::int FROM persona_versions WHERE brand_id = ${brandId}) AS persona_versions,
      (SELECT COUNT(*)::int FROM persona_fields pf JOIN persona_versions pv ON pv.id = pf.persona_version_id WHERE pv.brand_id = ${brandId}) AS persona_fields,
      (SELECT COUNT(*)::int FROM persona_fields pf JOIN persona_versions pv ON pv.id = pf.persona_version_id WHERE pv.brand_id = ${brandId} AND pf.insufficient_evidence) AS persona_fields_insufficient,
      (SELECT COUNT(*)::int FROM persona_field_evidence pfe JOIN persona_fields pf ON pf.id = pfe.persona_field_id JOIN persona_versions pv ON pv.id = pf.persona_version_id WHERE pv.brand_id = ${brandId}) AS persona_field_evidence,
      (SELECT COUNT(*)::int FROM prompt_sets WHERE brand_id = ${brandId}) AS prompt_sets,
      (SELECT COUNT(*)::int FROM prompt_set_versions WHERE brand_id = ${brandId}) AS prompt_set_versions,
      (SELECT COUNT(*)::int FROM prompts WHERE brand_id = ${brandId} AND prompt_type = 'persona') AS persona_prompts,
      (SELECT COUNT(*)::int FROM prompts WHERE brand_id = ${brandId} AND prompt_type = 'generic_control') AS control_prompts,
      (SELECT COUNT(*)::int FROM prompt_pairs pp JOIN prompt_set_versions psv ON psv.id = pp.prompt_set_version_id WHERE psv.brand_id = ${brandId}) AS prompt_pairs,
      (SELECT COUNT(*)::int FROM prompt_evidence pe JOIN prompts p ON p.id = pe.prompt_id WHERE p.brand_id = ${brandId}) AS prompt_evidence,
      (SELECT COUNT(*)::int FROM prompts WHERE brand_id = ${brandId} AND similarity_warning IS NOT NULL) AS prompt_warnings
  `);
  const row = rows[0];
  return {
    sources: row?.sources ?? 0,
    documents: row?.documents ?? 0,
    evidence: row?.evidence ?? 0,
    approved: row?.approved ?? 0,
    redactions: row?.redactions ?? 0,
    embeddings: row?.embeddings ?? 0,
    segments: row?.segments ?? 0,
    segmentsApproved: row?.segments_approved ?? 0,
    personas: row?.personas ?? 0,
    personaVersions: row?.persona_versions ?? 0,
    personaFields: row?.persona_fields ?? 0,
    personaFieldsInsufficient: row?.persona_fields_insufficient ?? 0,
    personaFieldEvidence: row?.persona_field_evidence ?? 0,
    promptSets: row?.prompt_sets ?? 0,
    promptSetVersions: row?.prompt_set_versions ?? 0,
    personaPrompts: row?.persona_prompts ?? 0,
    controlPrompts: row?.control_prompts ?? 0,
    promptPairs: row?.prompt_pairs ?? 0,
    promptEvidence: row?.prompt_evidence ?? 0,
    promptWarnings: row?.prompt_warnings ?? 0,
  };
}

async function truncateAll(): Promise<void> {
  await db.execute(raw`
    DO $$
    DECLARE r record;
    BEGIN
      FOR r IN
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public' AND tablename <> '__pes_migrations'
      LOOP
        EXECUTE format('TRUNCATE TABLE %I CASCADE', r.tablename);
      END LOOP;
    END $$;
  `);
}
