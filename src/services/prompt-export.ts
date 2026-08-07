import "server-only";
import type { BrandContext } from "@/lib/auth/context";
import { LOCAL_ONLY_FIELDS } from "@/lib/profound-tags";
import { PROMPT_INTENT_LABELS, type PromptRow } from "@/lib/prompt-display";
import { getPromptSetDetail, type PromptSetDetail } from "./prompt-sets";
import { recordAudit } from "./audit";

/**
 * Prompt-set exports (§18).
 *
 * The export is what a client or a colleague actually reads, so it carries the
 * same traceability the screen does: every prompt ships with its evidence ids,
 * its inclusion rationale, its control, its Profound metadata and the §33
 * generation metadata. A prompt list without those is a keyword list, and a
 * keyword list is the artefact this product exists to replace.
 */

export type ExportFormat = "json" | "csv" | "md";

export const EXPORT_CONTENT_TYPES: Record<ExportFormat, string> = {
  json: "application/json; charset=utf-8",
  csv: "text/csv; charset=utf-8",
  md: "text/markdown; charset=utf-8",
};

export async function exportPromptSet(
  ctx: BrandContext,
  promptSetId: string,
  format: ExportFormat,
  version?: number,
): Promise<{ filename: string; contentType: string; body: string }> {
  const detail = await getPromptSetDetail(ctx, promptSetId, version);

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
    entityType: "prompt_set_version",
    entityId: detail.version.id,
    metadata: { format, promptSetId, version: detail.version.version },
  });

  return {
    filename: `${detail.set.slug}-v${detail.version.version}.${format}`,
    contentType: EXPORT_CONTENT_TYPES[format],
    body,
  };
}

// ── JSON ────────────────────────────────────────────────────────────────────

function toJson(ctx: BrandContext, detail: PromptSetDetail): string {
  return JSON.stringify(
    {
      export_format_version: "1.0.0",
      disclaimer:
        "Prompt hypotheses derived from an evidence-backed persona. Each prompt records the evidence it came from and why it was included. Confidence is inherited from the persona field it was derived from and is a transparent heuristic, not a probability.",
      organization_id: ctx.organizationId,
      brand: { id: ctx.brandId, name: ctx.brandName, slug: ctx.brandSlug },
      prompt_set: {
        id: detail.set.id,
        name: detail.set.name,
        slug: detail.set.slug,
        persona: {
          id: detail.persona.id,
          name: detail.persona.name,
          slug: detail.persona.slug,
          version: detail.personaVersion.version,
          version_status: detail.personaVersion.status,
        },
      },
      version: {
        id: detail.version.id,
        version: detail.version.version,
        status: detail.version.status,
        prompt_count: detail.version.promptCount,
        control_count: detail.version.controlCount,
        evidence_cutoff: detail.version.evidenceCutoff?.toISOString() ?? null,
        generated_at: detail.version.generatedAt.toISOString(),
        generated_by: detail.generatedByName,
        approved_by: detail.approvedByName,
        approved_at: detail.version.approvedAt?.toISOString() ?? null,
        rejected_reason: detail.version.rejectedReason,
        parent_version_id: detail.version.parentVersionId,
        change_summary: detail.version.changeSummary,
        model_provider: detail.version.modelProvider,
        model_id: detail.version.modelId,
        prompt_template_version: detail.version.promptTemplateVersion,
        schema_version: detail.version.schemaVersion,
        data_origin: detail.version.dataOrigin,
      },
      counts: detail.counts,
      /** Named so a reader knows what did not travel to Profound and why. */
      fields_kept_local_only: LOCAL_ONLY_FIELDS,
      prompts: detail.personaPrompts.map((prompt) => exportPrompt(prompt)),
      generic_controls: detail.controls.map((control) => ({
        ...exportPrompt(control),
        paired_to_prompt_id: control.pairedTo?.id ?? null,
      })),
    },
    null,
    2,
  );
}

function exportPrompt(prompt: PromptRow) {
  return {
    id: prompt.id,
    prompt_type: prompt.promptType,
    topic: prompt.topic,
    prompt_text: prompt.promptText,
    normalized_hash: prompt.normalizedHash,
    information_need: prompt.informationNeed,
    intent: prompt.intent,
    journey_stage: prompt.journeyStage,
    constraints_used: prompt.constraintsUsed,
    decision_criteria_used: prompt.decisionCriteriaUsed,
    vocabulary_used: prompt.vocabularyUsed,
    expected_answer_elements: prompt.expectedAnswerElements,
    inclusion_rationale: prompt.inclusionRationale,
    confidence: prompt.confidence,
    tracking_priority: prompt.trackingPriority,
    execution_mode: prompt.executionMode,
    review_status: prompt.reviewStatus,
    edited_by_user: prompt.editedByUser,
    data_origin: prompt.dataOrigin,
    profound_sync_state: prompt.profoundSyncState,
    profound_metadata: prompt.profoundMetadata,
    duplicate_warning: prompt.similarityWarning,
    generic_control: prompt.control
      ? { id: prompt.control.id, prompt_text: prompt.control.promptText }
      : null,
    persona_fields: prompt.personaFieldStatements.map((field) => ({
      id: field.id,
      field_type: field.fieldType,
      statement: field.statement,
    })),
    evidence: prompt.evidence.map((link) => ({
      evidence_id: link.evidenceId,
      claim: link.normalizedClaim,
      quote: link.redactedText,
      category: link.category,
      provenance: link.provenance,
      source: link.sourceLabel,
      location: link.sourceLocation,
      speaker: link.speaker,
      observed_at: link.observedAt?.toISOString() ?? null,
      available: !link.unavailable && link.availability === "available",
    })),
  };
}

// ── CSV ─────────────────────────────────────────────────────────────────────

const CSV_COLUMNS = [
  "prompt_id",
  "prompt_set_slug",
  "prompt_set_version",
  "persona_slug",
  "persona_version",
  "prompt_type",
  "topic",
  "prompt_text",
  "generic_control_prompt",
  "information_need",
  "intent",
  "journey_stage",
  "constraints_used",
  "decision_criteria_used",
  "vocabulary_used",
  "expected_answer_elements",
  "inclusion_rationale",
  "confidence",
  "tracking_priority",
  "execution_mode",
  "review_status",
  "edited_by_user",
  "duplicate_warning",
  "evidence_ids",
  "evidence_sources",
  "persona_field_statements",
  "profound_tags",
  "profound_language",
  "profound_regions",
  "profound_platforms",
  "evidence_cutoff",
  "model_id",
  "prompt_template_version",
  "schema_version",
  "data_origin",
] as const;

function toCsv(detail: PromptSetDetail): string {
  const rows: string[][] = [[...CSV_COLUMNS]];

  // Persona prompts first, each followed by nothing — the control travels in
  // the persona row's `generic_control_prompt` column and again as its own row,
  // so the file is usable both as a review sheet and as a deployment list.
  for (const prompt of [...detail.personaPrompts, ...detail.controls]) {
    const metadata = prompt.profoundMetadata as {
      tags?: string[];
      language?: string;
      regions?: string[];
      platforms?: string[];
    };

    rows.push([
      prompt.id,
      detail.set.slug,
      String(detail.version.version),
      detail.persona.slug,
      String(detail.personaVersion.version),
      prompt.promptType,
      prompt.topic,
      prompt.promptText,
      prompt.control?.promptText ?? "",
      prompt.informationNeed,
      prompt.intent,
      prompt.journeyStage,
      prompt.constraintsUsed.join(" | "),
      prompt.decisionCriteriaUsed.join(" | "),
      prompt.vocabularyUsed.join(" | "),
      prompt.expectedAnswerElements.join(" | "),
      prompt.inclusionRationale,
      prompt.confidence.toFixed(3),
      prompt.trackingPriority,
      prompt.executionMode,
      prompt.reviewStatus,
      String(prompt.editedByUser),
      prompt.similarityWarning
        ? `${prompt.similarityWarning.kind} ${prompt.similarityWarning.score.toFixed(2)} vs ${prompt.similarityWarning.promptId}`
        : "",
      prompt.evidence.map((link) => link.evidenceId).join(" "),
      [...new Set(prompt.evidence.map((link) => link.sourceLabel))].join(" | "),
      prompt.personaFieldStatements.map((field) => field.statement).join(" | "),
      (metadata.tags ?? []).join(" "),
      metadata.language ?? "",
      (metadata.regions ?? []).join(" "),
      (metadata.platforms ?? []).join(" "),
      detail.version.evidenceCutoff?.toISOString() ?? "",
      detail.version.modelId ?? "",
      detail.version.promptTemplateVersion ?? "",
      detail.version.schemaVersion ?? "",
      prompt.dataOrigin,
    ]);
  }

  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n");
}

/**
 * RFC 4180 quoting plus a leading apostrophe on anything a spreadsheet would
 * execute. Prompt text and evidence quotes are customer language and must never
 * be interpreted as a formula.
 */
function csvCell(value: string): string {
  const guarded = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
  return `"${guarded.replace(/"/g, '""')}"`;
}

// ── Markdown ────────────────────────────────────────────────────────────────

function toMarkdown(ctx: BrandContext, detail: PromptSetDetail): string {
  const out: string[] = [];

  out.push(`# ${detail.set.name}`);
  out.push("");
  out.push(
    `> Prompt hypotheses for **${ctx.brandName}**, derived from the evidence-backed persona **${detail.persona.name}** (version ${detail.personaVersion.version}). Every prompt below records the evidence it came from and why it was included. None of them was written to make the brand appear.`,
  );
  out.push("");
  out.push(
    `**Version ${detail.version.version}** · status \`${detail.version.status}\` · ${detail.counts.persona} persona prompts, ${detail.counts.controls} generic controls · ${detail.counts.approved} approved, ${detail.counts.pending} awaiting review`,
  );
  out.push("");

  out.push("## Provenance");
  out.push("");
  out.push("| Field | Value |");
  out.push("| --- | --- |");
  const provenance: [string, string][] = [
    ["Prompt-set slug", `\`${detail.set.slug}\``],
    [
      "Persona",
      `${detail.persona.name} (\`${detail.persona.slug}\`) v${detail.personaVersion.version}`,
    ],
    ["Evidence cutoff", detail.version.evidenceCutoff?.toISOString().slice(0, 10) ?? "—"],
    ["Generated at", detail.version.generatedAt.toISOString()],
    ["Generated by", detail.generatedByName ?? "—"],
    ["Approved by", detail.approvedByName ?? "—"],
    ["Approved at", detail.version.approvedAt?.toISOString() ?? "—"],
    ["Model", `${detail.version.modelProvider ?? "—"} / ${detail.version.modelId ?? "—"}`],
    ["Prompt template", detail.version.promptTemplateVersion ?? "—"],
    ["Schema version", detail.version.schemaVersion ?? "—"],
    ["Data origin", detail.version.dataOrigin],
    ["Parent version", detail.version.parentVersionId ?? "—"],
    ["Change summary", detail.version.changeSummary ?? "—"],
  ];
  for (const [label, value] of provenance) out.push(`| ${label} | ${escapeCell(value)} |`);
  out.push("");

  if (detail.version.rejectedReason) {
    out.push(`> **Rejected:** ${detail.version.rejectedReason}`);
    out.push("");
  }

  for (const group of detail.byIntent) {
    out.push(`## ${group.label}`);
    out.push("");

    for (const prompt of group.prompts) {
      out.push(`### ${prompt.promptText}`);
      out.push("");
      out.push(
        `- **Status:** ${prompt.reviewStatus.replace(/_/g, " ")} · **priority:** ${prompt.trackingPriority} · **stage:** ${prompt.journeyStage.replace(/_/g, " ")} · **mode:** ${prompt.executionMode}`,
      );
      out.push(`- **Information need:** ${prompt.informationNeed}`);
      out.push(`- **Why it was included:** ${prompt.inclusionRationale}`);

      if (prompt.control) {
        out.push(`- **Generic control:** ${escapeCell(prompt.control.promptText)}`);
      } else {
        out.push(
          "- **Generic control:** none — no meaningful control exists for this prompt, so no lift can be measured against it.",
        );
      }

      if (prompt.expectedAnswerElements.length > 0) {
        out.push(`- **A useful answer contains:**`);
        for (const element of prompt.expectedAnswerElements) out.push(`  - ${escapeCell(element)}`);
      }

      if (prompt.constraintsUsed.length > 0) {
        out.push(`- **Constraints used:** ${prompt.constraintsUsed.map(escapeCell).join("; ")}`);
      }
      if (prompt.decisionCriteriaUsed.length > 0) {
        out.push(
          `- **Decision criteria used:** ${prompt.decisionCriteriaUsed.map(escapeCell).join("; ")}`,
        );
      }
      if (prompt.vocabularyUsed.length > 0) {
        out.push(`- **Customer vocabulary:** ${prompt.vocabularyUsed.map(escapeCell).join(", ")}`);
      }

      if (prompt.evidence.length > 0) {
        out.push(`- **Evidence (${prompt.evidence.length}):**`);
        for (const link of prompt.evidence) {
          out.push(
            `  - \`${link.evidenceId}\` — ${escapeCell(link.normalizedClaim)} _(${link.category}, ${link.provenance}, ${escapeCell(link.sourceLabel)} · ${escapeCell(link.sourceLocation)})_${
              link.unavailable || link.availability !== "available"
                ? " **[source deleted — unavailable]**"
                : ""
            }`,
          );
        }
      } else {
        out.push("- **Evidence:** none available");
      }

      const tags = (prompt.profoundMetadata as { tags?: string[] }).tags ?? [];
      if (tags.length > 0) {
        out.push(`- **Profound tags:** ${tags.map((tag) => `\`${tag}\``).join(" ")}`);
      }

      if (prompt.similarityWarning) {
        out.push(
          `- **Duplicate warning:** ${prompt.similarityWarning.kind} match at ${(prompt.similarityWarning.score * 100).toFixed(0)}% against ${escapeCell(prompt.similarityWarning.text)}`,
        );
      }

      out.push("");
    }
  }

  if (detail.controls.length > 0) {
    out.push("## Generic controls");
    out.push("");
    out.push(
      "Each control is its paired prompt with the persona's qualifier removed. If a persona prompt does not outperform its control, the persona hypothesis is what failed — not the content.",
    );
    out.push("");
    for (const control of detail.controls) {
      out.push(
        `- ${escapeCell(control.promptText)} _(${PROMPT_INTENT_LABELS[control.intent] ?? control.intent}, ${control.reviewStatus.replace(/_/g, " ")})_`,
      );
    }
    out.push("");
  }

  out.push("## Held locally, not sent to Profound");
  out.push("");
  for (const field of LOCAL_ONLY_FIELDS) out.push(`- ${field}`);
  out.push("");

  return out.join("\n");
}

function escapeCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}
