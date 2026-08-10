import "server-only";
import { and, eq, inArray, sql as raw } from "drizzle-orm";
import { db } from "@/db/client";
import {
  brands,
  dataSources,
  evidenceRecords,
  pageInventory,
  profoundResultBuckets,
  promptSets,
  prompts,
  users,
} from "@/db/schema";
import type { BrandContext } from "@/lib/auth/context";
import { SEED_SOURCES } from "@fixtures/seed/sources";
import { MOCK_CATEGORIES } from "@fixtures/profound/account";
import { newId, ID_PREFIXES } from "@/lib/ids";
import { createSourceFromPaste } from "@/services/sources";
import { reviewEvidence } from "@/services/evidence";
import { decideSegment, listSegments, startSegmentation } from "@/services/segments";
import { approvePersonaVersion, listPersonas, startPersonaGeneration } from "@/services/personas";
import {
  approvePromptSetVersion,
  reviewPrompts,
  startPromptGeneration,
} from "@/services/prompt-sets";
import { refreshProfoundConfiguration, testProfoundConnection } from "@/services/profound-config";
import { setCategoryMapping } from "@/services/profound-mapping";
import { listDeployableSets } from "@/services/profound-links";
import { reconcilePromptSetVersion } from "@/services/profound-reconcile";
import { mockPromptId, seedMockProfoundUpload } from "@/adapters/profound";
import { promptHash } from "@/lib/prompt-dedupe";
import { startResultRetrieval } from "@/services/profound-results";
import { classifyResult } from "@/lib/profound-results";
import {
  approveOpportunity,
  listOpportunities,
  startOpportunityGeneration,
} from "@/services/content-opportunities";
import { approveBrief, listBriefs, startBriefGeneration } from "@/services/content-brief";
import {
  approvePageAudit,
  getPageAuditDetail,
  listPageAudits,
  startPageAuditGeneration,
} from "@/services/page-audit";
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

  // ── Prompt-set approval ───────────────────────────────────────────────────
  // A Profound deployment can only ever target an approved, immutable
  // prompt-set version (§17, and enforced again in profound-deploy's
  // `loadApprovedSet`), so every prompt generated above is bulk-approved and
  // the set approved through the real service — the same review path a human
  // reviewer would take, not a status column written in directly.
  const generatedSets =
    approvedPersonaIds.length === 0
      ? []
      : await db
          .select({
            personaId: promptSets.personaId,
            currentVersionId: promptSets.currentVersionId,
          })
          .from(promptSets)
          .where(
            and(
              eq(promptSets.organizationId, organizationId),
              eq(promptSets.brandId, brandId),
              inArray(promptSets.personaId, approvedPersonaIds),
            ),
          );

  for (const set of generatedSets) {
    if (!set.currentVersionId) continue;

    const pending = await db
      .select({ id: prompts.id })
      .from(prompts)
      .where(
        and(
          eq(prompts.promptSetVersionId, set.currentVersionId),
          eq(prompts.reviewStatus, "pending_review"),
        ),
      );
    if (pending.length > 0) {
      await reviewPrompts(
        ctx,
        pending.map((row) => row.id),
        "approved",
      );
    }

    const { blockers } = await approvePromptSetVersion(ctx, set.currentVersionId);
    if (blockers.length > 0) {
      throw new Error(
        `Seed prompt-set approval was blocked for persona ${set.personaId}: ${blockers.join(" | ")}`,
      );
    }
  }

  // ── Profound export & reconciliation ──────────────────────────────────────
  // The app no longer pushes prompts to Profound automatically — the real
  // flow is a human exporting a prompt set and pasting it into Profound's own
  // UI. `seedMockProfoundUpload` models that upload having happened (the mock
  // account otherwise has no way to know about prompts this product never
  // sent it), then reconciliation runs exactly as it would in production:
  // list what the account has, match by normalized text, link.
  await testProfoundConnection(ctx);
  await refreshProfoundConfiguration(ctx);

  const productAnalyticsCategoryId = MOCK_CATEGORIES.find(
    (category) => category.name === "Product analytics",
  )?.id;
  if (!productAnalyticsCategoryId) {
    throw new Error("Seed fixture has no 'Product analytics' Profound category to map.");
  }
  await setCategoryMapping(ctx, { profoundCategoryId: productAnalyticsCategoryId });

  const deployableSets = await listDeployableSets(ctx);

  for (const personaId of approvedPersonaIds) {
    const deployable = deployableSets.find((row) => row.personaId === personaId);
    if (!deployable) continue;

    const approvedPrompts = await db
      .select({ promptText: prompts.promptText })
      .from(prompts)
      .where(
        and(
          eq(prompts.promptSetVersionId, deployable.versionId),
          eq(prompts.reviewStatus, "approved"),
        ),
      );

    seedMockProfoundUpload(
      productAnalyticsCategoryId,
      approvedPrompts.map((prompt) => {
        const normalizedHash = promptHash(prompt.promptText);
        return {
          id: mockPromptId(productAnalyticsCategoryId, normalizedHash),
          text: prompt.promptText,
          topic: null,
          tags: [],
          personaId: null,
          regions: ["us"],
          platforms: ["chatgpt", "perplexity"],
          status: "active",
        };
      }),
    );

    await reconcilePromptSetVersion(ctx, deployable.versionId);
  }

  // Milestone 6: retrieve results for every prompt just reconciled, over the
  // 30 days ending today. The mock adapter's per-day generator needs no clock
  // of its own — "today" here is only the edge of the window a real user
  // would pick, not something the generator depends on for determinism.
  const endDate = new Date().toISOString().slice(0, 10);
  const startDate = new Date(Date.now() - 29 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  await startResultRetrieval(ctx, { startDate, endDate });
  const results = await drainQueue({ workerId: "seed" });
  if (results.failed > 0) {
    throw new Error(
      `Seed Profound result retrieval failed for ${results.failed} job(s):\n  ${results.errors.join("\n  ")}`,
    );
  }
  const profoundJobsProcessed = results.processed;

  const snapshots = await db
    .select()
    .from(profoundResultBuckets)
    .where(eq(profoundResultBuckets.brandId, brandId));
  // Seed data doesn't request competitor asset scope, so `competitorVisible`
  // is honestly `null` here — never guessed.
  const classifications = snapshots.map((snapshot) =>
    classifyResult({
      visibilityScore: snapshot.visibilityScore,
      shareOfVoice: snapshot.shareOfVoice,
      competitorShareOfVoice: null,
    }),
  );

  // ── Milestone 7: page inventory ───────────────────────────────────────────
  // Nothing else in the seed populates this table; content-gap analysis and
  // page audits both need an existing-page inventory to reason about, so a
  // small, realistic set of brand pages is inserted directly — the same way
  // the ingestion loop above corrects `data_sources.source_system` directly
  // rather than through a service that does not exist for this purpose.
  const homepageUrl = "https://northwind-analytics.example/";
  const homepageContent = HOMEPAGE_CONTENT;
  await db.insert(pageInventory).values([
    {
      id: newId(ID_PREFIXES.pageInventory),
      organizationId,
      brandId,
      url: homepageUrl,
      canonicalUrl: homepageUrl,
      title: "Northwind Analytics — Product analytics for regulated teams",
      pageType: "homepage",
      headings: ["Product analytics built for regulated teams"],
      summary:
        "Northwind Analytics is a product-analytics platform for regulated and security-sensitive companies, with self-hosted and private-cloud deployment.",
      wordCount: homepageContent.split(/\s+/).length,
      internalLinks: [
        "https://northwind-analytics.example/private-cloud",
        "https://northwind-analytics.example/lineage",
        "https://northwind-analytics.example/governance",
      ],
      structuredData: [],
    },
    {
      id: newId(ID_PREFIXES.pageInventory),
      organizationId,
      brandId,
      url: "https://northwind-analytics.example/private-cloud",
      canonicalUrl: "https://northwind-analytics.example/private-cloud",
      title: "Northwind Private Cloud",
      pageType: "product_page",
      headings: ["Single-tenant deployment", "Data residency", "Onboarding"],
      summary: "Single-tenant deployment inside the customer's own cloud account.",
      wordCount: 420,
      internalLinks: [homepageUrl],
      structuredData: [],
    },
    {
      id: newId(ID_PREFIXES.pageInventory),
      organizationId,
      brandId,
      url: "https://northwind-analytics.example/governance",
      canonicalUrl: "https://northwind-analytics.example/governance",
      title: "Governance Console",
      pageType: "product_page",
      headings: ["Role-based access", "Retention policies", "Audit export"],
      summary: "Role-based access, retention policies and audit export.",
      wordCount: 380,
      internalLinks: [homepageUrl],
      structuredData: [],
    },
  ]);

  // ── Milestone 7: content-gap analysis and opportunities ───────────────────
  // Runs for every persona that actually made it through Profound deployment
  // (has linked prompts and retrieved results) — there is no gap to analyze
  // for a persona whose prompts were never sent to Profound.
  let opportunitiesGenerated = 0;
  let opportunitiesApproved = 0;
  let briefsGenerated = 0;
  let briefsApproved = 0;
  let firstApprovedOpportunityId: string | null = null;
  let contentJobsProcessed = 0;

  for (const personaId of approvedPersonaIds) {
    const deployable = deployableSets.find((row) => row.personaId === personaId);
    if (!deployable) continue;

    await startOpportunityGeneration(ctx, {
      personaVersionId: deployable.personaVersionId,
      promptSetVersionId: deployable.versionId,
    });
    const gapAnalysis = await drainQueue({ workerId: "seed" });
    if (gapAnalysis.failed > 0) {
      throw new Error(
        `Seed content-gap analysis failed for ${gapAnalysis.failed} job(s):\n  ${gapAnalysis.errors.join("\n  ")}`,
      );
    }
    contentJobsProcessed += gapAnalysis.processed;

    const opportunities = await listOpportunities(ctx, {
      personaVersionId: deployable.personaVersionId,
    });
    opportunitiesGenerated += opportunities.length;

    // Approve every material opportunity (p1/p2) and leave the rest — including
    // any `no_content_action` recommendations — pending, so the demo shows a
    // reviewer's queue rather than a fully rubber-stamped one.
    const toApprove = opportunities.filter(
      (o) =>
        o.recommendation !== "no_content_action" && (o.priority === "p1" || o.priority === "p2"),
    );
    for (const opportunity of toApprove) {
      await approveOpportunity(ctx, opportunity.id);
      opportunitiesApproved++;
      if (!firstApprovedOpportunityId) firstApprovedOpportunityId = opportunity.id;
    }
  }

  // ── Milestone 7: SEO brief ─────────────────────────────────────────────────
  // One brief, generated from the first approved opportunity and then
  // approved — demonstrating the full opportunity → brief → approval path
  // the 16-step demo requires, not merely that generation is possible.
  if (firstApprovedOpportunityId) {
    await startBriefGeneration(ctx, { opportunityId: firstApprovedOpportunityId });
    const briefGeneration = await drainQueue({ workerId: "seed" });
    if (briefGeneration.failed > 0) {
      throw new Error(
        `Seed SEO brief generation failed for ${briefGeneration.failed} job(s):\n  ${briefGeneration.errors.join("\n  ")}`,
      );
    }
    contentJobsProcessed += briefGeneration.processed;

    const briefs = await listBriefs(ctx);
    briefsGenerated += briefs.length;
    const generatedBrief = briefs.find((b) => b.opportunityId === firstApprovedOpportunityId);
    if (generatedBrief) {
      await approveBrief(ctx, generatedBrief.id);
      briefsApproved++;
    }
  }

  // ── Milestone 7: homepage audit ────────────────────────────────────────────
  // Audited against the same persona/prompt-set pair the opportunities came
  // from, using the homepage content just inserted above — pasted content
  // rather than a live fetch (§ Known limitations: no crawler is wired for
  // this milestone).
  let auditFindingsBySeverity: Record<string, number> = {};
  let auditHomepageFindingCount = 0;
  let auditSupportingFindingCount = 0;
  const auditedPersona = approvedPersonaIds
    .map((personaId) => deployableSets.find((row) => row.personaId === personaId))
    .find((row) => row !== undefined);

  if (auditedPersona) {
    await startPageAuditGeneration(ctx, {
      personaVersionId: auditedPersona.personaVersionId,
      promptSetVersionId: auditedPersona.versionId,
      scope: "homepage",
      url: homepageUrl,
      pageTitle: "Northwind Analytics homepage",
      pageContent: homepageContent,
    });
    const auditGeneration = await drainQueue({ workerId: "seed" });
    if (auditGeneration.failed > 0) {
      throw new Error(
        `Seed page audit generation failed for ${auditGeneration.failed} job(s):\n  ${auditGeneration.errors.join("\n  ")}`,
      );
    }
    contentJobsProcessed += auditGeneration.processed;

    const audits = await listPageAudits(ctx);
    const latestAudit = audits[0];
    if (latestAudit) {
      const detail = await getPageAuditDetail(ctx, latestAudit.id);
      auditHomepageFindingCount = detail.homepageFindings.length;
      auditSupportingFindingCount = detail.supportingPageFindings.length;
      auditFindingsBySeverity = detail.findings.reduce<Record<string, number>>((acc, finding) => {
        acc[finding.severity] = (acc[finding.severity] ?? 0) + 1;
        return acc;
      }, {});

      // Only approve when the audit found something specific enough to act
      // on — an audit with zero findings is left pending rather than
      // approved by default, matching the same "not every outcome is
      // rubber-stamped" discipline as the opportunities above.
      if (detail.findings.length > 0) {
        await approvePageAudit(ctx, latestAudit.id);
      }
    }
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
    "profound category mapped": counts.profoundCategoryStatus ?? "not mapped",
    "profound prompts linked": counts.profoundPromptsLinked,
    "profound result buckets": snapshots.length,
    "profound brand-absent buckets": classifications.filter(
      (c) => c.classification === "brand_absent",
    ).length,
    // Seed retrieval never requests competitor asset scope, so this is
    // honestly "not measured" rather than a zero that could be mistaken for
    // "checked and found none".
    "profound competitor-visible buckets": classifications.every(
      (c) => c.competitorVisible === null,
    )
      ? "not measured (no competitor asset scope requested)"
      : classifications.filter((c) => c.competitorVisible === true).length,
    "page inventory rows": counts.pageInventory,
    "content opportunities generated": opportunitiesGenerated,
    "content opportunities approved": opportunitiesApproved,
    "content opportunities by recommendation": summariseByColumn(
      await opportunityRecommendationCounts(brandId),
    ),
    "seo briefs generated": briefsGenerated,
    "seo briefs approved": briefsApproved,
    "page audit findings on this page": auditHomepageFindingCount,
    "page audit findings belonging elsewhere": auditSupportingFindingCount,
    "page audit findings by severity": summariseByColumn(auditFindingsBySeverity),
    "jobs processed":
      ingestion.processed +
      segmentation.processed +
      synthesis.processed +
      promptGeneration.processed +
      profoundJobsProcessed +
      contentJobsProcessed,
  };
}

function summariseByColumn(counts: Record<string, number>): string {
  const entries = Object.entries(counts);
  if (entries.length === 0) return "none";
  return entries
    .sort((a, b) => b[1] - a[1])
    .map(([key, value]) => `${key}: ${value}`)
    .join(", ");
}

async function opportunityRecommendationCounts(brandId: string): Promise<Record<string, number>> {
  const rows = await db.execute<{ recommendation: string; count: number }>(raw`
    SELECT recommendation, COUNT(*)::int AS count
    FROM content_opportunities
    WHERE brand_id = ${brandId}
    GROUP BY recommendation
  `);
  const out: Record<string, number> = {};
  for (const row of rows) out[row.recommendation] = row.count;
  return out;
}

const HOMEPAGE_CONTENT = `Northwind Analytics helps teams understand their product data with confidence. We are a leading platform trusted by data, security and product teams everywhere.

Our platform brings together analytics, governance and deployment flexibility in one place, so your organization can move fast without compromising on control. Northwind Analytics is built for companies that take data seriously.

Whatever your team is trying to accomplish, Northwind Analytics gives you the tools to get there. Explore private cloud deployment, column-level lineage, and role-based governance, all backed by a platform built for organizations with real requirements.

Ready to see what Northwind Analytics can do for your team? Get started today.`;

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
    profound_category_status: string | null;
    profound_prompts_linked: number;
    page_inventory: number;
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
      (SELECT COUNT(*)::int FROM prompts WHERE brand_id = ${brandId} AND similarity_warning IS NOT NULL) AS prompt_warnings,
      (SELECT status FROM profound_category_mappings WHERE brand_id = ${brandId} ORDER BY updated_at DESC LIMIT 1) AS profound_category_status,
      (SELECT COUNT(*)::int FROM profound_prompt_links WHERE brand_id = ${brandId}) AS profound_prompts_linked,
      (SELECT COUNT(*)::int FROM page_inventory WHERE brand_id = ${brandId}) AS page_inventory
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
    profoundCategoryStatus: row?.profound_category_status ?? null,
    profoundPromptsLinked: row?.profound_prompts_linked ?? 0,
    pageInventory: row?.page_inventory ?? 0,
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
