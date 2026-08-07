import "server-only";
import type { BrandContext } from "@/lib/auth/context";
import {
  listOpportunities,
  type OpportunityFilters,
  type OpportunityListRow,
} from "./content-opportunities";
import { recordAudit } from "./audit";

/**
 * Content-opportunity exports (§28). Unlike a persona or a brief, an
 * opportunity is a short recommendation rather than a long document, so the
 * natural export unit is the filtered list, not one record at a time — the
 * same shape the "Content opportunities" list screen shows.
 */

export type ExportFormat = "json" | "csv" | "md";

export const EXPORT_CONTENT_TYPES: Record<ExportFormat, string> = {
  json: "application/json; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  md: "text/markdown; charset=utf-8",
};

export async function exportOpportunities(
  ctx: BrandContext,
  format: ExportFormat,
  filters: OpportunityFilters = {},
): Promise<{ filename: string; contentType: string; body: string }> {
  const rows = await listOpportunities(ctx, filters);

  const body =
    format === "json" ? toJson(ctx, rows) : format === "csv" ? toCsv(rows) : toMarkdown(ctx, rows);

  await recordAudit({
    organizationId: ctx.organizationId,
    brandId: ctx.brandId,
    actorUserId: ctx.userId,
    action: "export",
    entityType: "content_opportunity",
    entityId: ctx.brandId,
    metadata: { format, count: rows.length, filters },
  });

  return {
    filename: `content-opportunities-${ctx.brandSlug}.${format}`,
    contentType: EXPORT_CONTENT_TYPES[format],
    body,
  };
}

function toJson(ctx: BrandContext, rows: OpportunityListRow[]): string {
  return JSON.stringify(
    {
      export_format_version: "1.0.0",
      disclaimer:
        "Content opportunities are recommendations derived from Profound performance, existing site content, evidence and search demand. 'no_content_action' is a deliberate recommendation, not an omission — this workflow does not assume every visibility gap requires a new article.",
      organization_id: ctx.organizationId,
      brand: { id: ctx.brandId, name: ctx.brandName, slug: ctx.brandSlug },
      opportunities: rows.map((row) => ({
        id: row.id,
        title: row.title,
        problem_statement: row.problemStatement,
        performance_gap: row.performanceGap,
        gap_type: row.gapType,
        recommendation: row.recommendation,
        recommendation_rationale: row.recommendationRationale,
        persona: row.personaName,
        relevant_profound_prompt_ids: row.relevantProfoundPromptIds,
        relevant_run_ids: row.relevantRunIds,
        competitors: row.competitors,
        citation_sources: row.citationSources,
        missing_answer_elements: row.missingAnswerElements,
        search_demand: row.searchDemand,
        existing_page_url: row.existingPageUrl,
        priority: row.priority,
        estimated_effort: row.estimatedEffort,
        evidence_ids: row.evidenceIds,
        validation_method: row.validationMethod,
        generated_by_model: row.modelId,
        prompt_template_version: row.promptTemplateVersion,
        data_origin: row.dataOrigin,
        review_status: row.reviewStatus,
        created_at: row.createdAt.toISOString(),
      })),
    },
    null,
    2,
  );
}

const CSV_COLUMNS = [
  "id",
  "title",
  "persona",
  "gap_type",
  "recommendation",
  "priority",
  "estimated_effort",
  "review_status",
  "existing_page_url",
  "competitors",
  "missing_answer_elements",
  "evidence_ids",
  "relevant_profound_prompt_ids",
  "data_origin",
  "created_at",
] as const;

function toCsv(rows: OpportunityListRow[]): string {
  const out: string[][] = [[...CSV_COLUMNS]];
  for (const row of rows) {
    out.push([
      row.id,
      row.title,
      row.personaName ?? "",
      row.gapType,
      row.recommendation,
      row.priority,
      row.estimatedEffort,
      row.reviewStatus,
      row.existingPageUrl ?? "",
      row.competitors.join("; "),
      row.missingAnswerElements.join("; "),
      row.evidenceIds.join(" "),
      row.relevantProfoundPromptIds.join(" "),
      row.dataOrigin,
      row.createdAt.toISOString(),
    ]);
  }
  return out.map((r) => r.map(csvCell).join(",")).join("\r\n");
}

function csvCell(value: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${guarded.replace(/"/g, '""')}"`;
}

function toMarkdown(ctx: BrandContext, rows: OpportunityListRow[]): string {
  const lines: string[] = [
    `# Content opportunities — ${ctx.brandName}`,
    "",
    "_Recommendations derived from Profound performance, existing site content, evidence and search demand. `no_content_action` is a deliberate recommendation, not an omission._",
    "",
  ];

  for (const row of rows) {
    lines.push(`## ${row.title}`);
    lines.push("");
    lines.push(
      `**Recommendation:** ${row.recommendation} (${row.gapType} gap) — **Priority:** ${row.priority}, **Effort:** ${row.estimatedEffort}`,
    );
    lines.push("");
    lines.push(`**Problem:** ${row.problemStatement}`);
    lines.push("");
    lines.push(`**Performance gap:** ${row.performanceGap}`);
    lines.push("");
    lines.push(`**Rationale:** ${row.recommendationRationale}`);
    lines.push("");
    if (row.missingAnswerElements.length > 0) {
      lines.push(`**Missing answer elements:** ${row.missingAnswerElements.join("; ")}`);
      lines.push("");
    }
    if (row.competitors.length > 0) {
      lines.push(`**Competitors present:** ${row.competitors.join(", ")}`);
      lines.push("");
    }
    if (row.existingPageUrl) {
      lines.push(`**Existing page:** ${row.existingPageUrl}`);
      lines.push("");
    }
    lines.push(`**Validation method:** ${row.validationMethod}`);
    lines.push("");
    lines.push(`**Evidence ids:** ${row.evidenceIds.join(", ") || "none"}`);
    lines.push(`**Profound prompt ids:** ${row.relevantProfoundPromptIds.join(", ") || "none"}`);
    lines.push(`**Status:** ${row.reviewStatus} — **Data origin:** ${row.dataOrigin}`);
    lines.push("");
    lines.push("---");
    lines.push("");
  }

  return lines.join("\n");
}
