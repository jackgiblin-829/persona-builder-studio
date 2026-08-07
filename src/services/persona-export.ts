import "server-only";
import { COMPONENT_LABELS, CONFIDENCE_COMPONENT_KEYS } from "@/lib/confidence";
import type { BrandContext } from "@/lib/auth/context";
import { FIELD_TYPE_META, getPersonaDetail, type PersonaDetail } from "./personas";
import { recordAudit } from "./audit";

/**
 * Persona exports (§16).
 *
 * Every format carries the same provenance: the evidence ids behind each claim,
 * the confidence components rather than only the score, the insufficient-evidence
 * markers, and the §33 generation metadata. An export that dropped the citations
 * would turn an evidence-backed hypothesis back into an unattributed assertion,
 * which is the failure mode this product exists to prevent.
 */

export type ExportFormat = "json" | "csv" | "md";

export const EXPORT_CONTENT_TYPES: Record<ExportFormat, string> = {
  json: "application/json; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  md: "text/markdown; charset=utf-8",
};

export async function exportPersona(
  ctx: BrandContext,
  personaId: string,
  format: ExportFormat,
  version?: number,
): Promise<{ filename: string; contentType: string; body: string }> {
  const detail = await getPersonaDetail(ctx, personaId, version);

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
    entityType: "persona_version",
    entityId: detail.version.id,
    metadata: { format, personaId, version: detail.version.version },
  });

  return {
    filename: `${detail.persona.slug}-v${detail.version.version}.${format}`,
    contentType: EXPORT_CONTENT_TYPES[format],
    body,
  };
}

// ── JSON ────────────────────────────────────────────────────────────────────

function toJson(ctx: BrandContext, detail: PersonaDetail): string {
  const { persona, version } = detail;

  return JSON.stringify(
    {
      export_format_version: "1.0.0",
      disclaimer:
        "An internal, evidence-backed persona hypothesis. Not a real person, not a digital twin, and not a claim about any individual. Confidence is a transparent heuristic, not a probability that the persona is correct.",
      organization_id: ctx.organizationId,
      brand: { id: ctx.brandId, name: ctx.brandName, slug: ctx.brandSlug },
      persona: {
        id: persona.id,
        name: version.name,
        slug: persona.slug,
        segment_candidate_id: persona.segmentCandidateId,
        segment: detail.segment,
      },
      version: {
        id: version.id,
        version: version.version,
        status: version.status,
        overall_confidence: version.overallConfidence,
        segment_definition: version.segmentDefinition,
        summary: version.summary,
        journey_stages: version.journeyStages,
        information_depth: version.informationDepth,
        excluded_assumptions: version.excludedAssumptions,
        source_mix: version.sourceMix,
        evidence_cutoff: version.evidenceCutoff?.toISOString() ?? null,
        generated_at: version.generatedAt.toISOString(),
        generated_by: detail.generatedByName,
        approved_by: detail.approvedByName,
        approved_at: version.approvedAt?.toISOString() ?? null,
        rejected_reason: version.rejectedReason,
        needs_review_reason: version.needsReviewReason,
        parent_version_id: version.parentVersionId,
        change_summary: version.changeSummary,
        model_provider: version.modelProvider,
        model_id: version.modelId,
        prompt_template_version: version.promptTemplateVersion,
        schema_version: version.schemaVersion,
        data_origin: version.dataOrigin,
      },
      fields: detail.groups.flatMap((group) =>
        group.fields.map((field) => ({
          field_type: group.fieldType,
          field_label: FIELD_TYPE_META[group.fieldType].label,
          is_core_field: FIELD_TYPE_META[group.fieldType].core,
          counts_toward_confidence: FIELD_TYPE_META[group.fieldType].scored,
          is_structural: FIELD_TYPE_META[group.fieldType].structural,
          statement: field.statement,
          provenance: field.provenance,
          insufficient_evidence: field.insufficientEvidence,
          marked_unsupported: field.markedUnsupported,
          locked: field.locked,
          edited_by_user: field.editedByUser,
          confidence: field.confidence,
          confidence_components: field.confidenceComponents,
          confidence_explanation: field.confidenceExplanation,
          evidence_count: field.evidenceCount,
          contradiction_count: field.contradictionCount,
          source_mix: field.sourceMix,
          supporting_evidence: field.evidence
            .filter((link) => link.relation === "supports")
            .map(exportEvidenceLink),
          contradicting_evidence: field.evidence
            .filter((link) => link.relation === "contradicts")
            .map(exportEvidenceLink),
        })),
      ),
    },
    null,
    2,
  );
}

function exportEvidenceLink(
  link: PersonaDetail["groups"][number]["fields"][number]["evidence"][number],
) {
  return {
    evidence_id: link.evidenceId,
    claim: link.normalizedClaim,
    quote: link.redactedText,
    category: link.category,
    provenance: link.provenance,
    journey_stage: link.journeyStage,
    source: link.sourceLabel,
    source_type: link.sourceType,
    location: link.sourceLocation,
    speaker: link.speaker,
    observed_at: link.observedAt?.toISOString() ?? null,
    available: !link.unavailable && link.availability === "available",
  };
}

// ── CSV ─────────────────────────────────────────────────────────────────────

const CSV_COLUMNS = [
  "persona_slug",
  "persona_name",
  "version",
  "version_status",
  "field_type",
  "field_label",
  "is_core_field",
  "statement",
  "provenance",
  "insufficient_evidence",
  "marked_unsupported",
  "locked",
  "confidence",
  ...CONFIDENCE_COMPONENT_KEYS,
  "confidence_explanation",
  "supporting_evidence_ids",
  "contradicting_evidence_ids",
  "supporting_sources",
  "evidence_cutoff",
  "model_id",
  "prompt_template_version",
  "schema_version",
  "data_origin",
] as const;

function toCsv(detail: PersonaDetail): string {
  const { persona, version } = detail;
  const rows: string[][] = [[...CSV_COLUMNS]];

  for (const group of detail.groups) {
    for (const field of group.fields) {
      const components = field.confidenceComponents;
      const supporting = field.evidence.filter((link) => link.relation === "supports");
      const contradicting = field.evidence.filter((link) => link.relation === "contradicts");

      rows.push([
        persona.slug,
        version.name,
        String(version.version),
        version.status,
        group.fieldType,
        FIELD_TYPE_META[group.fieldType].label,
        String(FIELD_TYPE_META[group.fieldType].core),
        field.statement,
        field.provenance,
        String(field.insufficientEvidence),
        String(field.markedUnsupported),
        String(field.locked),
        field.confidence.toFixed(3),
        ...CONFIDENCE_COMPONENT_KEYS.map((key) => (components[key] ?? 0).toFixed(3)),
        field.confidenceExplanation ?? "",
        supporting.map((link) => link.evidenceId).join(" "),
        contradicting.map((link) => link.evidenceId).join(" "),
        [...new Set(supporting.map((link) => link.sourceLabel))].join(" | "),
        version.evidenceCutoff?.toISOString() ?? "",
        version.modelId ?? "",
        version.promptTemplateVersion ?? "",
        version.schemaVersion ?? "",
        version.dataOrigin,
      ]);
    }
  }

  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

/**
 * RFC 4180 quoting, plus a leading apostrophe on anything a spreadsheet would
 * execute as a formula. Evidence quotes are customer text and must never be
 * interpreted.
 */
function csvCell(value: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${guarded.replace(/"/g, '""')}"`;
}

// ── Markdown ────────────────────────────────────────────────────────────────

function toMarkdown(ctx: BrandContext, detail: PersonaDetail): string {
  const { persona, version } = detail;
  const out: string[] = [];

  out.push(`# ${version.name}`);
  out.push("");
  out.push(
    `> An internal, evidence-backed persona hypothesis for **${ctx.brandName}**. Not a real person and not a digital twin. Every claim below is either backed by the evidence ids shown or explicitly marked as insufficient evidence.`,
  );
  out.push("");
  out.push(
    `**Version ${version.version}** · status \`${version.status}\` · overall confidence **${(version.overallConfidence * 100).toFixed(0)}%** (heuristic, not a probability)`,
  );
  out.push("");

  out.push("## Provenance");
  out.push("");
  out.push("| Field | Value |");
  out.push("| --- | --- |");
  const provenanceRows: [string, string][] = [
    ["Persona slug", `\`${persona.slug}\``],
    ["Segment", detail.segment ? `${detail.segment.label} (\`${detail.segment.slug}\`)` : "—"],
    ["Evidence cutoff", version.evidenceCutoff?.toISOString().slice(0, 10) ?? "—"],
    ["Generated at", version.generatedAt.toISOString()],
    ["Generated by", detail.generatedByName ?? "—"],
    ["Approved by", detail.approvedByName ?? "—"],
    ["Approved at", version.approvedAt?.toISOString() ?? "—"],
    ["Model", `${version.modelProvider ?? "—"} / ${version.modelId ?? "—"}`],
    ["Prompt template", version.promptTemplateVersion ?? "—"],
    ["Schema version", version.schemaVersion ?? "—"],
    ["Data origin", version.dataOrigin],
    ["Parent version", version.parentVersionId ?? "—"],
    ["Change summary", version.changeSummary ?? "—"],
  ];
  for (const [label, value] of provenanceRows) {
    out.push(`| ${label} | ${escapeCell(value)} |`);
  }
  out.push("");

  if (version.needsReviewReason) {
    out.push(`> **Needs review:** ${version.needsReviewReason}`);
    out.push("");
  }

  out.push("## Segment definition");
  out.push("");
  out.push(version.segmentDefinition);
  out.push("");

  if (version.summary) {
    out.push("## Summary");
    out.push("");
    out.push(version.summary);
    out.push("");
  }

  out.push("## Scope");
  out.push("");
  out.push(`- **Journey stages:** ${version.journeyStages.join(", ") || "—"}`);
  out.push(`- **Information depth:** ${version.informationDepth ?? "—"}`);
  const mix = Object.entries(version.sourceMix);
  out.push(
    `- **Source mix:** ${mix.length > 0 ? mix.map(([source, n]) => `${source} (${n})`).join(", ") : "—"}`,
  );
  out.push("");

  for (const group of detail.groups) {
    const meta = FIELD_TYPE_META[group.fieldType];
    out.push(`## ${meta.label}`);
    out.push("");
    out.push(`_${meta.description}_`);
    out.push("");

    for (const field of group.fields) {
      const flags: string[] = [`provenance: ${field.provenance}`];
      if (field.insufficientEvidence) flags.push("**insufficient evidence**");
      if (field.markedUnsupported) flags.push("**marked unsupported by a reviewer**");
      if (field.locked) flags.push("locked");
      if (field.editedByUser) flags.push("edited by a reviewer");

      out.push(`### ${field.statement}`);
      out.push("");
      out.push(
        `- Confidence: **${(field.confidence * 100).toFixed(0)}%** — ${field.confidenceExplanation ?? "no explanation recorded"}`,
      );
      out.push(`- Flags: ${flags.join("; ")}`);

      const components = field.confidenceComponents;
      const rendered = CONFIDENCE_COMPONENT_KEYS.filter((key) => (components[key] ?? 0) !== 0)
        .map((key) => `${COMPONENT_LABELS[key]} ${(components[key] ?? 0).toFixed(2)}`)
        .join(", ");
      out.push(`- Components: ${rendered || "all zero (unsupported claim)"}`);

      const supporting = field.evidence.filter((link) => link.relation === "supports");
      const contradicting = field.evidence.filter((link) => link.relation === "contradicts");

      if (supporting.length > 0) {
        out.push(`- Supporting evidence (${supporting.length}):`);
        for (const link of supporting) {
          out.push(
            `  - \`${link.evidenceId}\` — ${escapeCell(link.normalizedClaim)} _(${link.category}, ${link.provenance}, ${escapeCell(link.sourceLabel)} · ${escapeCell(link.sourceLocation)})_${link.unavailable || link.availability !== "available" ? " **[source deleted — unavailable]**" : ""}`,
          );
        }
      } else if (!field.insufficientEvidence) {
        out.push("- Supporting evidence: none available");
      }

      if (contradicting.length > 0) {
        out.push(`- Contradicting evidence (${contradicting.length}):`);
        for (const link of contradicting) {
          out.push(
            `  - \`${link.evidenceId}\` — ${escapeCell(link.normalizedClaim)} _(${escapeCell(link.sourceLabel)})_`,
          );
        }
      }

      out.push("");
    }
  }

  out.push("## Excluded assumptions");
  out.push("");
  out.push(
    "These attributes are never inferred, regardless of how convenient they would be for content or targeting:",
  );
  out.push("");
  for (const assumption of version.excludedAssumptions) out.push(`- ${assumption}`);
  out.push("");

  return out.join("\n");
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}
