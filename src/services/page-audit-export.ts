import "server-only";
import type { BrandContext } from "@/lib/auth/context";
import { getPageAuditDetail, type AuditDetail, type AuditFindingRow } from "./page-audit";
import { recordAudit } from "./audit";

/**
 * Page-audit exports (§30). One audit, one document — findings are grouped
 * by severity first (the order a reviewer would triage them) and the
 * homepage-vs-supporting-page split is always visible, matching the
 * distinction §30 requires the product itself to make rather than leaving
 * every persona concern piled onto the audited page.
 */

export type ExportFormat = "json" | "csv" | "md";

export const EXPORT_CONTENT_TYPES: Record<ExportFormat, string> = {
  json: "application/json; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  md: "text/markdown; charset=utf-8",
};

const SEVERITY_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

function bySeverity(findings: AuditFindingRow[]): AuditFindingRow[] {
  return [...findings].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9),
  );
}

export async function exportPageAudit(
  ctx: BrandContext,
  auditId: string,
  format: ExportFormat,
): Promise<{ filename: string; contentType: string; body: string }> {
  const detail = await getPageAuditDetail(ctx, auditId);

  const body =
    format === "json"
      ? toJson(ctx, detail)
      : format === "csv"
        ? toCsv(detail)
        : toMarkdown(ctx, detail);

  await recordAudit({
    organizationId: ctx.organizationId,
    brandId: ctx.brandId,
    actorUserId: ctx.userId,
    action: "export",
    entityType: "page_audit",
    entityId: auditId,
    metadata: { format, findings: detail.findings.length },
  });

  return {
    filename: `page-audit-${auditId}.${format}`,
    contentType: EXPORT_CONTENT_TYPES[format],
    body,
  };
}

function toJson(ctx: BrandContext, detail: AuditDetail): string {
  return JSON.stringify(
    {
      export_format_version: "1.0.0",
      disclaimer:
        "A page audit evaluates one page against one approved persona's requirements. Findings marked belongs_on_supporting_page were deliberately not recommended for this page — §30 requires distinguishing homepage requirements from content that belongs elsewhere.",
      organization_id: ctx.organizationId,
      brand: { id: ctx.brandId, name: ctx.brandName, slug: ctx.brandSlug },
      audit: {
        id: detail.id,
        scope: detail.scope,
        url: detail.url,
        page_title: detail.pageTitle,
        persona: detail.personaName,
        summary: detail.summary,
        scores: detail.scores,
        review_status: detail.reviewStatus,
        data_origin: detail.dataOrigin,
        generated_by_model: detail.modelId,
        prompt_template_version: detail.promptTemplateVersion,
        created_at: detail.createdAt.toISOString(),
      },
      supporting_page_recommendations: detail.supportingPageRecommendations,
      findings_on_this_page: bySeverity(detail.homepageFindings).map(exportFinding),
      findings_belonging_elsewhere: bySeverity(detail.supportingPageFindings).map(exportFinding),
    },
    null,
    2,
  );
}

function exportFinding(finding: AuditFindingRow) {
  return {
    severity: finding.severity,
    page_element: finding.pageElement,
    page_excerpt: finding.pageExcerpt,
    persona_requirement: finding.personaRequirement,
    explanation: finding.explanation,
    recommended_change: finding.recommendedChange,
    suggested_replacement: finding.suggestedReplacement,
    validation_method: finding.validationMethod,
    evidence_ids: finding.evidenceIds,
    related_prompt_ids: finding.relatedPromptIds,
    related_profound_prompt_ids: finding.relatedProfoundPromptIds,
  };
}

const CSV_COLUMNS = [
  "severity",
  "belongs_on_supporting_page",
  "page_element",
  "persona_requirement",
  "explanation",
  "recommended_change",
  "validation_method",
  "evidence_ids",
  "related_prompt_ids",
  "related_profound_prompt_ids",
] as const;

function toCsv(detail: AuditDetail): string {
  const rows: string[][] = [[...CSV_COLUMNS]];
  for (const finding of bySeverity(detail.findings)) {
    rows.push([
      finding.severity,
      String(finding.belongsOnSupportingPage),
      finding.pageElement,
      finding.personaRequirement,
      finding.explanation,
      finding.recommendedChange,
      finding.validationMethod,
      finding.evidenceIds.join(" "),
      finding.relatedPromptIds.join(" "),
      finding.relatedProfoundPromptIds.join(" "),
    ]);
  }
  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}

function csvCell(value: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${guarded.replace(/"/g, '""')}"`;
}

function toMarkdown(ctx: BrandContext, detail: AuditDetail): string {
  const lines: string[] = [];

  lines.push(`# Page audit — ${detail.pageTitle ?? detail.url ?? detail.scope}`);
  lines.push("");
  lines.push(
    `_${ctx.brandName}, scope: ${detail.scope.replace("_", " ")}, persona: ${detail.personaName ?? "—"}, status: ${detail.reviewStatus}, data origin: ${detail.dataOrigin}._`,
  );
  lines.push("");
  lines.push(`## Summary`);
  lines.push("");
  lines.push(detail.summary);
  lines.push("");

  lines.push(`## Scores`);
  lines.push("");
  for (const [key, value] of Object.entries(detail.scores)) {
    lines.push(`- **${key.replace(/_/g, " ")}:** ${(value * 100).toFixed(0)}%`);
  }
  lines.push("");

  lines.push(`## Findings on this page (${detail.homepageFindings.length})`);
  lines.push("");
  writeFindings(lines, bySeverity(detail.homepageFindings));

  lines.push(
    `## Findings that belong on a supporting page (${detail.supportingPageFindings.length})`,
  );
  lines.push("");
  lines.push(
    "_These persona concerns are real, but §30 requires that not every concern be put on this page — they belong elsewhere._",
  );
  lines.push("");
  writeFindings(lines, bySeverity(detail.supportingPageFindings));

  if (detail.supportingPageRecommendations.length > 0) {
    lines.push(`## Supporting-page recommendations`);
    lines.push("");
    for (const rec of detail.supportingPageRecommendations) {
      lines.push(`- **${rec.suggestedPageType}**: ${rec.need} — ${rec.rationale}`);
    }
    lines.push("");
  }

  return lines.join("\n");
}

function writeFindings(lines: string[], findings: AuditFindingRow[]): void {
  if (findings.length === 0) {
    lines.push("_None._");
    lines.push("");
    return;
  }
  for (const finding of findings) {
    lines.push(`### [${finding.severity.toUpperCase()}] ${finding.pageElement}`);
    lines.push("");
    lines.push(`**Persona requirement:** ${finding.personaRequirement}`);
    lines.push("");
    if (finding.pageExcerpt) {
      lines.push(`**Page excerpt:** "${finding.pageExcerpt}"`);
      lines.push("");
    }
    lines.push(`**Explanation:** ${finding.explanation}`);
    lines.push("");
    lines.push(`**Recommended change:** ${finding.recommendedChange}`);
    lines.push("");
    if (finding.suggestedReplacement) {
      lines.push(`**Suggested replacement:** ${finding.suggestedReplacement}`);
      lines.push("");
    }
    lines.push(`**Validation method:** ${finding.validationMethod}`);
    lines.push("");
    lines.push(
      `Evidence: ${finding.evidenceIds.join(", ") || "none"} — Profound prompts: ${finding.relatedProfoundPromptIds.join(", ") || "none"}`,
    );
    lines.push("");
    lines.push("---");
    lines.push("");
  }
}
