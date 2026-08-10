import "server-only";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import {
  auditFindings,
  pageAudits,
  personaVersions,
  personas,
  profoundPromptLinks,
  promptAnswerCoverageEstimates,
  promptSetVersions,
  prompts,
} from "@/db/schema";
import { getOpenAIAdapter } from "@/adapters/openai";
import type { PageAuditMockContext } from "@/adapters/openai/mock/page-audit";
import { hashExpectedElements } from "@/lib/answer-coverage";
import { sanitizeAuditFindings } from "@/lib/content-traceability";
import { AppError } from "@/lib/errors";
import { newId, ID_PREFIXES } from "@/lib/ids";
import { loadFieldsWithEvidence } from "@/services/personas";
import { PAGE_AUDIT, renderTemplate } from "@/prompts/registry";
import { pageAuditSchema, SCHEMA_VERSION } from "@/prompts/schemas";
import { toStrictJsonSchema } from "@/prompts/json-schema";
import { withVendorUsage } from "@/services/usage";
import { JOB_TYPES, registerJob } from "../registry";
import { loadBrandContext } from "./ingest-source";

/**
 * Homepage / landing-page audit (§30).
 *
 * There is no live crawler wired for this milestone (§ progress.md, the
 * milestone-2 known limitation), so the input is pasted page content plus an
 * optional URL label, never a fetch. Findings are traceable by construction:
 * `sanitizeAuditFindings` drops anything the model attaches no available
 * evidence, prompt or Profound prompt id to, so an untraceable finding is
 * never written rather than merely discouraged in the system prompt.
 */
const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

registerJob(JOB_TYPES.generatePageAudit, async ({ job }) => {
  const brandId = String(job.payload.brandId ?? "");
  const personaVersionId = String(job.payload.personaVersionId ?? "");
  const promptSetVersionId = job.payload.promptSetVersionId
    ? String(job.payload.promptSetVersionId)
    : null;
  const scope = String(job.payload.scope ?? "homepage") as
    "homepage" | "landing_page" | "product_page";
  const url = job.payload.url ? String(job.payload.url) : null;
  const pageTitle = job.payload.pageTitle ? String(job.payload.pageTitle) : null;
  const pageContent = String(job.payload.pageContent ?? "");
  const requestedByUserId = job.payload.requestedByUserId
    ? String(job.payload.requestedByUserId)
    : null;

  if (!brandId || !personaVersionId || !pageContent.trim()) {
    throw new AppError(
      "validation",
      "generate_page_audit requires brandId, personaVersionId and pageContent",
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
    throw new AppError("validation", "Page audits run against an approved persona version only.");
  }

  const [persona] = await db
    .select()
    .from(personas)
    .where(eq(personas.id, personaVersion.personaId))
    .limit(1);
  if (!persona) throw new AppError("not_found", "The persona no longer exists.");

  const fields = await loadFieldsWithEvidence(personaVersionId);
  const byType = (type: string) =>
    fields
      .filter((f) => f.fieldType === type && !f.insufficientEvidence && !f.markedUnsupported)
      .map((f) => ({
        id: f.id,
        statement: f.statement,
        evidenceIds: f.evidence
          .filter((e) => e.relation === "supports" && e.availability === "available")
          .map((e) => e.evidenceId),
      }));

  const constraints = byType("constraint").filter((c) => c.evidenceIds.length > 0);
  const objections = byType("objection").filter((c) => c.evidenceIds.length > 0);
  const decisionCriteria = byType("decision_criterion").filter((c) => c.evidenceIds.length > 0);
  const proofPreferences = byType("proof_preference").filter((c) => c.evidenceIds.length > 0);
  const jobField = byType("job_to_be_done").find((c) => c.evidenceIds.length > 0) ?? null;
  const vocabulary = fields.filter((f) => f.fieldType === "vocabulary").map((f) => f.statement);

  const availableEvidenceIds = new Set([
    ...constraints.flatMap((c) => c.evidenceIds),
    ...objections.flatMap((c) => c.evidenceIds),
    ...decisionCriteria.flatMap((c) => c.evidenceIds),
    ...proofPreferences.flatMap((c) => c.evidenceIds),
    ...(jobField?.evidenceIds ?? []),
  ]);

  let relatedPromptIds: string[] = [];
  let relatedProfoundPromptIds: string[] = [];
  let missingAnswerElements: string[] = [];

  if (promptSetVersionId) {
    const [setVersion] = await db
      .select({ id: promptSetVersions.id })
      .from(promptSetVersions)
      .where(
        and(eq(promptSetVersions.id, promptSetVersionId), eq(promptSetVersions.brandId, brandId)),
      )
      .limit(1);

    if (setVersion) {
      const setPrompts = await db
        .select()
        .from(prompts)
        .where(
          and(
            eq(prompts.promptSetVersionId, promptSetVersionId),
            eq(prompts.promptType, "persona"),
          ),
        );
      relatedPromptIds = setPrompts.map((p) => p.id);

      const links =
        relatedPromptIds.length > 0
          ? await db
              .select()
              .from(profoundPromptLinks)
              .where(
                and(
                  eq(profoundPromptLinks.brandId, brandId),
                  inArray(profoundPromptLinks.promptId, relatedPromptIds),
                ),
              )
          : [];
      relatedProfoundPromptIds = links.map((l) => l.profoundPromptId);

      // "Missing expected answer elements" is no longer a substring match
      // against a Profound raw answer (the vendor has none) — it is read from
      // this product's own self-computed `prompt_answer_coverage_estimates`
      // (see `src/jobs/handlers/estimate-answer-coverage.ts`), keyed on each
      // prompt's *current* expected-elements hash so a stale estimate from
      // before the prompt was edited is never surfaced. A prompt with no
      // estimate yet (the job hasn't run or hasn't caught up) contributes
      // nothing here rather than blocking the audit.
      const estimateRows =
        relatedPromptIds.length > 0
          ? await db
              .select()
              .from(promptAnswerCoverageEstimates)
              .where(inArray(promptAnswerCoverageEstimates.promptId, relatedPromptIds))
          : [];
      const estimateByKey = new Map(
        estimateRows.map((estimate) => [
          `${estimate.promptId}::${estimate.expectedElementsHash}`,
          estimate,
        ]),
      );
      const missing = new Set<string>();
      for (const prompt of setPrompts) {
        const hash = hashExpectedElements(prompt.expectedAnswerElements);
        const estimate = estimateByKey.get(`${prompt.id}::${hash}`);
        for (const element of estimate?.missing ?? []) missing.add(element);
      }
      missingAnswerElements = [...missing].slice(0, 10);
    }
  }

  const mockContext: PageAuditMockContext = {
    brandName: brand.name,
    scope,
    pageContent,
    jobToBeDone: jobField,
    constraints,
    objections,
    decisionCriteria,
    proofPreferences,
    vocabulary,
    relatedPromptIds,
    relatedProfoundPromptIds,
    missingAnswerElements,
  };

  const { adapter, mode } = await getOpenAIAdapter(brand.organizationId);
  const jsonSchema = toStrictJsonSchema(pageAuditSchema, "PageAudit");

  const result = await withVendorUsage(
    {
      organizationId: brand.organizationId,
      brandId,
      vendor: "openai",
      operation: "page_audit_generation",
      mode,
      jobId: job.id,
    },
    () =>
      adapter.generateStructured({
        templateId: PAGE_AUDIT.id,
        templateVersion: PAGE_AUDIT.version,
        schemaVersion: SCHEMA_VERSION,
        system: PAGE_AUDIT.system,
        user: renderTemplate(PAGE_AUDIT, {
          brand_context: `Brand: ${brand.name} (${brand.canonicalDomain})\n${brand.description}`,
          persona: `${persona.name}: ${personaVersion.segmentDefinition}`,
          page_content: pageContent,
          site_inventory: "",
          market_evidence: missingAnswerElements.join("; "),
        }),
        schema: pageAuditSchema,
        schemaName: "PageAudit",
        jsonSchema,
        modelTier: PAGE_AUDIT.modelTier,
        mockContext: mockContext as unknown as Record<string, unknown>,
      }),
    (auditResult) => ({
      retryCount: auditResult.attempts - 1,
      tokensIn: auditResult.tokensIn,
      tokensOut: auditResult.tokensOut,
      costCents: auditResult.costCents,
    }),
  );

  const sanitized = sanitizeAuditFindings(result.data.findings, {
    evidenceIds: availableEvidenceIds,
    promptIds: new Set(relatedPromptIds),
    profoundPromptIds: new Set(relatedProfoundPromptIds),
  });

  const ordered = [...sanitized.findings].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9),
  );

  const auditId = newId(ID_PREFIXES.pageAudit);

  await db.transaction(async (tx) => {
    await tx.insert(pageAudits).values({
      id: auditId,
      organizationId: brand.organizationId,
      brandId,
      personaId: persona.id,
      personaVersionId,
      promptSetVersionId,
      scope,
      url,
      pageTitle,
      pageContent,
      version: 1,
      summary: result.data.summary,
      supportingPageRecommendations: result.data.supporting_page_recommendations.map((r) => ({
        need: r.need,
        suggestedPageType: r.suggested_page_type,
        rationale: r.rationale,
      })),
      scores: result.data.scores,
      modelProvider: result.modelProvider,
      modelId: result.modelId,
      promptTemplateVersion: PAGE_AUDIT.version,
      schemaVersion: SCHEMA_VERSION,
      dataOrigin: result.dataOrigin,
      evidenceCutoff: personaVersion.evidenceCutoff,
      reviewStatus: "draft",
      generatedByUserId: requestedByUserId,
    });

    let sequence = 0;
    for (const finding of ordered) {
      await tx.insert(auditFindings).values({
        id: newId(ID_PREFIXES.auditFinding),
        organizationId: brand.organizationId,
        pageAuditId: auditId,
        sequence: sequence++,
        severity: finding.severity,
        pageElement: finding.page_element,
        pageExcerpt: finding.page_excerpt,
        personaRequirement: finding.persona_requirement,
        explanation: finding.explanation,
        recommendedChange: finding.recommended_change,
        suggestedReplacement: finding.suggested_replacement,
        validationMethod: finding.validation_method,
        evidenceIds: finding.evidence_ids,
        relatedPromptIds: finding.related_prompt_ids,
        relatedProfoundPromptIds: finding.related_profound_prompt_ids,
        belongsOnSupportingPage: finding.belongs_on_supporting_page,
      });
    }
  });

  return {
    status: "succeeded",
    result: {
      auditId,
      findings: ordered.length,
      droppedFindings: sanitized.violations.length,
    },
  };
});
