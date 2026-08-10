import "server-only";
import type { BrandContext } from "@/lib/auth/context";
import { AppError } from "@/lib/errors";
import { parseBriefBody } from "./content-brief";
import { getBriefDetail, type BriefDetail } from "./content-brief";
import { recordAudit } from "./audit";

/**
 * SEO brief exports (§29). One brief, one document — the export mirrors the
 * editor screen's 27 sections in order, so a writer can work from the export
 * alone without losing anything the editor showed them.
 */

export type ExportFormat = "json" | "csv" | "md";

export const EXPORT_CONTENT_TYPES: Record<ExportFormat, string> = {
  json: "application/json; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  md: "text/markdown; charset=utf-8",
};

export async function exportBrief(
  ctx: BrandContext,
  briefId: string,
  format: ExportFormat,
): Promise<{ filename: string; contentType: string; body: string }> {
  const detail = await getBriefDetail(ctx, briefId);
  const parsedBody = parseBriefBody(detail.body);
  if (!parsedBody) {
    throw new AppError(
      "schema_validation",
      "This brief's stored body no longer matches the brief schema.",
    );
  }

  const body =
    format === "json"
      ? toJson(ctx, detail)
      : format === "csv"
        ? toCsv(detail, parsedBody)
        : toMarkdown(ctx, detail, parsedBody);

  await recordAudit({
    organizationId: ctx.organizationId,
    brandId: ctx.brandId,
    actorUserId: ctx.userId,
    action: "export",
    entityType: "content_brief",
    entityId: briefId,
    metadata: { format, version: detail.version },
  });

  return {
    filename: `seo-brief-${briefId}-v${detail.version}.${format}`,
    contentType: EXPORT_CONTENT_TYPES[format],
    body,
  };
}

function toJson(ctx: BrandContext, detail: BriefDetail): string {
  return JSON.stringify(
    {
      export_format_version: "1.0.0",
      disclaimer:
        "An evidence-backed SEO and AI-search brief. Every persona-specific recommendation cites evidence ids; every Profound-specific recommendation cites Profound prompt ids or result bucket ids.",
      organization_id: ctx.organizationId,
      brand: { id: ctx.brandId, name: ctx.brandName, slug: ctx.brandSlug },
      brief: {
        id: detail.id,
        version: detail.version,
        persona: detail.personaName,
        opportunity: detail.opportunityTitle,
        review_status: detail.reviewStatus,
        data_origin: detail.dataOrigin,
        generated_by_model: detail.modelId,
        prompt_template_version: detail.promptTemplateVersion,
        evidence_ids: detail.evidenceIds,
        profound_prompt_ids: detail.profoundPromptIds,
        bucket_ids: detail.bucketIds,
        generated_by: detail.generatedByName,
        approved_by: detail.approvedByName,
      },
      body: detail.body,
    },
    null,
    2,
  );
}

function toCsv(detail: BriefDetail, body: ReturnType<typeof parseBriefBody>): string {
  if (!body) return "";
  const rows: string[][] = [["section", "field", "value", "evidence_ids"]];

  rows.push(["header", "working_title", body.working_title, ""]);
  rows.push(["header", "target_persona", body.target_persona, ""]);
  rows.push(["header", "primary_query", body.primary_query, ""]);
  rows.push(["header", "recommended_content_type", body.recommended_content_type, ""]);
  rows.push(["header", "conversion_action", body.conversion_action, ""]);

  for (const item of body.constraints)
    rows.push(["constraints", "constraint", item.statement, item.evidence_ids.join(" ")]);
  for (const item of body.objections)
    rows.push(["objections", "objection", item.statement, item.evidence_ids.join(" ")]);
  for (const item of body.decision_criteria)
    rows.push(["decision_criteria", "criterion", item.statement, item.evidence_ids.join(" ")]);
  for (const section of body.recommended_outline) {
    rows.push(["outline", section.heading, section.purpose, section.evidence_ids.join(" ")]);
  }
  for (const prompt of body.relevant_profound_prompts) {
    rows.push(["profound_prompts", prompt.profound_prompt_id, prompt.gap, ""]);
  }

  return rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
}

function csvCell(value: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${guarded.replace(/"/g, '""')}"`;
}

function toMarkdown(
  ctx: BrandContext,
  detail: BriefDetail,
  body: ReturnType<typeof parseBriefBody>,
): string {
  if (!body) return "";
  const lines: string[] = [];

  lines.push(`# ${body.working_title}`);
  lines.push("");
  lines.push(
    `_Brief for ${ctx.brandName}, v${detail.version}, status: ${detail.reviewStatus}, data origin: ${detail.dataOrigin}._`,
  );
  lines.push("");

  section(lines, "Target persona", body.target_persona);
  section(lines, "Job to be done", body.job_to_be_done);
  section(lines, "Primary information need", body.primary_information_need);
  section(lines, "Intent", body.intent);
  section(lines, "Journey stage", body.journey_stage);
  section(lines, "Primary query", body.primary_query);
  list(lines, "Supporting queries", body.supporting_queries);

  lines.push("## Relevant Profound prompts");
  lines.push("");
  for (const prompt of body.relevant_profound_prompts) {
    lines.push(`- **${prompt.profound_prompt_id}**: ${prompt.prompt_text} — gap: ${prompt.gap}`);
  }
  lines.push("");

  section(lines, "Profound gap summary", body.profound_gap_summary);
  section(lines, "Reader's existing knowledge", body.reader_existing_knowledge);

  claimSection(lines, "Constraints", body.constraints);
  claimSection(lines, "Objections", body.objections);
  claimSection(lines, "Decision criteria", body.decision_criteria);

  list(lines, "Expected answer elements", body.expected_answer_elements);
  section(lines, "Recommended content type", body.recommended_content_type);

  lines.push("## Recommended outline");
  lines.push("");
  for (const outlineSection of body.recommended_outline) {
    lines.push(`### ${outlineSection.heading}`);
    lines.push("");
    lines.push(`_Purpose: ${outlineSection.purpose}_`);
    lines.push("");
    for (const item of outlineSection.must_cover) lines.push(`- ${item}`);
    lines.push("");
    lines.push(`Evidence: ${outlineSection.evidence_ids.join(", ") || "none"}`);
    lines.push("");
  }

  list(lines, "Customer vocabulary", body.customer_vocabulary);
  list(lines, "Concepts and entities", body.concepts_and_entities);
  list(lines, "Required evidence", body.required_evidence);
  list(lines, "Required examples", body.required_examples);
  list(lines, "Source requirements", body.source_requirements);
  list(lines, "Product proof", body.product_proof);
  list(lines, "Competitor coverage", body.competitor_coverage);

  lines.push("## Internal links");
  lines.push("");
  for (const link of body.internal_links)
    lines.push(`- [${link.url}](${link.url}) — ${link.rationale}`);
  lines.push("");

  section(lines, "Conversion action", body.conversion_action);
  list(lines, "Unsupported claims to avoid", body.unsupported_claims_to_avoid);
  list(lines, "Final quality checklist", body.final_quality_checklist);

  return lines.join("\n");
}

function section(lines: string[], heading: string, value: string): void {
  lines.push(`## ${heading}`);
  lines.push("");
  lines.push(value);
  lines.push("");
}

function list(lines: string[], heading: string, items: string[]): void {
  lines.push(`## ${heading}`);
  lines.push("");
  if (items.length === 0) {
    lines.push("_None._");
  } else {
    for (const item of items) lines.push(`- ${item}`);
  }
  lines.push("");
}

function claimSection(
  lines: string[],
  heading: string,
  items: { statement: string; evidence_ids: string[] }[],
): void {
  lines.push(`## ${heading}`);
  lines.push("");
  if (items.length === 0) {
    lines.push("_None._");
  } else {
    for (const item of items) {
      lines.push(`- ${item.statement} (evidence: ${item.evidence_ids.join(", ")})`);
    }
  }
  lines.push("");
}
