import Link from "next/link";
import {
  addEvidenceNoteAction,
  reviewEvidenceAction,
  setSegmentLabelsAction,
  updateEvidenceAction,
} from "@/app/actions/evidence";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import {
  Badge,
  Callout,
  Card,
  CardHeader,
  Field,
  Input,
  KeyValue,
  PageHeader,
  ProvenanceBadge,
  Select,
  Textarea,
  OriginBadge,
  StatusBadge,
} from "@/components/ui";
import { hasCapability, requireBrandAccess } from "@/lib/auth/context";
import { getCsrfToken } from "@/lib/auth/session";
import { getEvidenceDetail } from "@/services/evidence";
import { EVIDENCE_CATEGORIES, JOURNEY_STAGES, PROVENANCE, SENTIMENTS } from "@/prompts/schemas";

export const dynamic = "force-dynamic";

export default async function EvidenceDetailPage({
  params,
}: {
  params: Promise<{ brandId: string; evidenceId: string }>;
}) {
  const { brandId, evidenceId } = await params;
  const ctx = await requireBrandAccess(brandId);
  const [detail, csrfToken] = await Promise.all([
    getEvidenceDetail(ctx, evidenceId),
    getCsrfToken(),
  ]);

  const { evidence } = detail;
  const canEdit = hasCapability(ctx, "evidence:edit");
  const canReview = hasCapability(ctx, "evidence:review");

  // Highlight the exact span this record was extracted from.
  const context = buildContext(detail.documentText, evidence.charStart, evidence.charEnd);

  return (
    <>
      <PageHeader
        title="Evidence record"
        description={evidence.normalizedClaim}
        breadcrumb={
          <>
            <Link href={`/brands/${brandId}/evidence`} className="hover:underline">
              Evidence
            </Link>{" "}
            / {evidence.id}
          </>
        }
        actions={
          canReview ? (
            <div className="flex gap-2">
              <ActionForm
                action={reviewEvidenceAction}
                csrfToken={csrfToken}
                hidden={{ brandId, evidenceId, decision: "approved", evidenceIds: evidenceId }}
                className="space-y-0"
              >
                <SubmitButton label="Approve" size="sm" />
              </ActionForm>
              <ActionForm
                action={reviewEvidenceAction}
                csrfToken={csrfToken}
                hidden={{ brandId, evidenceId, decision: "rejected", evidenceIds: evidenceId }}
                className="space-y-0"
              >
                <SubmitButton label="Reject" variant="secondary" size="sm" />
              </ActionForm>
            </div>
          ) : null
        }
      />

      {evidence.availability === "source_deleted" ? (
        <div className="mb-4">
          <Callout tone="danger" title="Source deleted">
            The source this record came from has been deleted. The record is retained for
            auditability but is excluded from generation, and any persona version citing it has been
            queued for review.
          </Callout>
        </div>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <ProvenanceBadge provenance={evidence.provenance} />
        <Badge tone="neutral">{evidence.category.replace(/_/g, " ")}</Badge>
        <StatusBadge status={evidence.reviewStatus} />
        <OriginBadge origin={evidence.dataOrigin} />
        {evidence.piiStatus !== "none" ? <Badge tone="warn">pii {evidence.piiStatus}</Badge> : null}
        {evidence.editedByUser ? <Badge tone="accent">edited by a reviewer</Badge> : null}
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader
              title="Original source context"
              description={`${detail.sourceLabel} · ${detail.documentLocation}${evidence.speaker ? ` · ${evidence.speaker}` : ""}`}
            />
            <div className="px-4 py-3">
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-muted">
                {context.before}
                <mark className="rounded bg-accent-soft px-0.5 text-ink">{context.match}</mark>
                {context.after}
              </p>
              <p className="mt-2 text-xs text-ink-subtle">
                Characters {evidence.charStart ?? "?"}–{evidence.charEnd ?? "?"} of the parsed
                document. Text shown is the redacted version; personal information was replaced
                before extraction.
              </p>
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Classification"
              description={
                canEdit
                  ? "Reviewer edits are recorded and marked on the record."
                  : "Read-only for your role."
              }
            />
            <div className="px-4 py-4">
              {canEdit ? (
                <ActionForm
                  action={updateEvidenceAction}
                  csrfToken={csrfToken}
                  hidden={{ brandId, evidenceId }}
                >
                  <Field label="Normalized claim" htmlFor="normalizedClaim" required>
                    <Textarea
                      id="normalizedClaim"
                      name="normalizedClaim"
                      rows={2}
                      required
                      defaultValue={evidence.normalizedClaim}
                    />
                  </Field>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="Category" htmlFor="category" required>
                      <Select id="category" name="category" defaultValue={evidence.category}>
                        {EVIDENCE_CATEGORIES.map((value) => (
                          <option key={value} value={value}>
                            {value.replace(/_/g, " ")}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field
                      label="Provenance"
                      htmlFor="provenance"
                      required
                      hint="Changing this changes the confidence weight of every claim built on it."
                    >
                      <Select id="provenance" name="provenance" defaultValue={evidence.provenance}>
                        {PROVENANCE.map((value) => (
                          <option key={value} value={value}>
                            {value.replace(/_/g, " ")}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Journey stage" htmlFor="journeyStage" required>
                      <Select
                        id="journeyStage"
                        name="journeyStage"
                        defaultValue={evidence.journeyStage}
                      >
                        {JOURNEY_STAGES.map((value) => (
                          <option key={value} value={value}>
                            {value.replace(/_/g, " ")}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field label="Sentiment" htmlFor="sentiment" required>
                      <Select id="sentiment" name="sentiment" defaultValue={evidence.sentiment}>
                        {SENTIMENTS.map((value) => (
                          <option key={value} value={value}>
                            {value}
                          </option>
                        ))}
                      </Select>
                    </Field>
                  </div>
                  <SubmitButton label="Save classification" size="sm" />
                </ActionForm>
              ) : (
                <KeyValue
                  items={[
                    { label: "Claim", value: evidence.normalizedClaim },
                    { label: "Category", value: evidence.category.replace(/_/g, " ") },
                    { label: "Provenance", value: evidence.provenance.replace(/_/g, " ") },
                    { label: "Journey stage", value: evidence.journeyStage.replace(/_/g, " ") },
                    { label: "Sentiment", value: evidence.sentiment },
                  ]}
                />
              )}
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Dependants"
              description="Personas and prompts that cite this record. Deleting its source marks these references unavailable rather than deleting them."
            />
            <div className="px-4 py-3">
              {detail.dependants.personas.length === 0 && detail.dependants.prompts.length === 0 ? (
                <p className="text-sm text-ink-muted">Nothing depends on this record yet.</p>
              ) : (
                <div className="space-y-3">
                  {detail.dependants.personas.length > 0 ? (
                    <div>
                      <p className="text-2xs font-semibold uppercase tracking-wide text-ink-muted">
                        Persona claims
                      </p>
                      <ul className="mt-1 space-y-1">
                        {detail.dependants.personas.map((dep, index) => (
                          <li key={`${dep.personaId}-${index}`} className="text-sm">
                            <Badge tone={dep.relation === "contradicts" ? "danger" : "success"}>
                              {dep.relation}
                            </Badge>{" "}
                            <Link
                              href={`/brands/${brandId}/personas/${dep.personaId}`}
                              className="text-accent hover:underline"
                            >
                              {dep.personaName} v{dep.version}
                            </Link>{" "}
                            <span className="text-ink-muted">— {dep.fieldStatement}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {detail.dependants.prompts.length > 0 ? (
                    <div>
                      <p className="text-2xs font-semibold uppercase tracking-wide text-ink-muted">
                        Prompts
                      </p>
                      <ul className="mt-1 space-y-1">
                        {detail.dependants.prompts.map((dep) => (
                          <li key={dep.promptId} className="text-sm">
                            <Badge tone="neutral">{dep.intent.replace(/_/g, " ")}</Badge>{" "}
                            <Link
                              href={`/brands/${brandId}/prompt-sets/${dep.setVersionId}`}
                              className="text-accent hover:underline"
                            >
                              {dep.promptText}
                            </Link>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                </div>
              )}
            </div>
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Provenance and extraction" />
            <div className="px-4 py-3">
              <KeyValue
                items={[
                  { label: "Source", value: detail.sourceLabel },
                  { label: "Source type", value: evidence.sourceType.replace(/_/g, " ") },
                  { label: "Source system", value: evidence.sourceSystem.replace(/_/g, " ") },
                  { label: "Location", value: evidence.sourceLocation },
                  {
                    label: "Observed",
                    value: evidence.observedAt
                      ? evidence.observedAt.toISOString().slice(0, 10)
                      : "unknown",
                  },
                  { label: "Ingested", value: evidence.ingestedAt.toISOString().slice(0, 10) },
                  {
                    label: "Extraction confidence",
                    value: evidence.extractionConfidence.toFixed(2),
                  },
                  { label: "Quality score", value: evidence.qualityScore.toFixed(2) },
                  {
                    label: "Model",
                    value: (
                      <span className="font-mono text-xs">{evidence.createdByModel ?? "—"}</span>
                    ),
                  },
                  { label: "Template version", value: evidence.promptTemplateVersion ?? "—" },
                  { label: "Schema version", value: evidence.schemaVersion ?? "—" },
                ]}
              />
              {evidence.uncertaintyNote ? (
                <div className="mt-3">
                  <Callout tone="warn" title="Uncertainty">
                    {evidence.uncertaintyNote}
                  </Callout>
                </div>
              ) : null}
            </div>
          </Card>

          <Card>
            <CardHeader title="Entities and vocabulary" />
            <div className="space-y-2 px-4 py-3 text-sm">
              <div>
                <p className="text-2xs font-semibold uppercase tracking-wide text-ink-muted">
                  Entities
                </p>
                <p className="mt-0.5">{evidence.entities.join(", ") || "—"}</p>
              </div>
              <div>
                <p className="text-2xs font-semibold uppercase tracking-wide text-ink-muted">
                  Customer vocabulary
                </p>
                <p className="mt-0.5">{evidence.vocabulary.join(", ") || "—"}</p>
              </div>
            </div>
          </Card>

          {canEdit ? (
            <Card>
              <CardHeader
                title="Candidate segment labels"
                description="Comma separated. Used to filter the explorer and to seed segmentation."
              />
              <div className="px-4 py-3">
                <ActionForm
                  action={setSegmentLabelsAction}
                  csrfToken={csrfToken}
                  hidden={{ brandId, evidenceId }}
                >
                  <Input name="labels" defaultValue={evidence.candidateSegmentLabels.join(", ")} />
                  <SubmitButton label="Save labels" size="sm" variant="secondary" />
                </ActionForm>
              </div>
            </Card>
          ) : null}

          <Card>
            <CardHeader title="Notes" />
            <div className="px-4 py-3">
              {detail.notes.length === 0 ? (
                <p className="text-sm text-ink-muted">No notes yet.</p>
              ) : (
                <ul className="mb-3 space-y-2">
                  {detail.notes.map((note) => (
                    <li key={note.id} className="text-sm">
                      <p className="whitespace-pre-wrap">{note.body}</p>
                      <p className="text-xs text-ink-subtle">
                        {note.authorName ?? "Unknown"} · {note.createdAt.toISOString().slice(0, 10)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
              {canEdit ? (
                <ActionForm
                  action={addEvidenceNoteAction}
                  csrfToken={csrfToken}
                  hidden={{ brandId, evidenceId }}
                >
                  <Textarea name="body" rows={2} placeholder="Add a review note…" required />
                  <SubmitButton label="Add note" size="sm" variant="secondary" />
                </ActionForm>
              ) : null}
            </div>
          </Card>
        </div>
      </div>
    </>
  );
}

function buildContext(documentText: string, start: number | null, end: number | null) {
  if (start === null || end === null || start >= documentText.length || end <= start) {
    return { before: documentText.slice(0, 1200), match: "", after: "" };
  }
  const windowSize = 500;
  const from = Math.max(0, start - windowSize);
  const to = Math.min(documentText.length, end + windowSize);
  return {
    before: (from > 0 ? "… " : "") + documentText.slice(from, start),
    match: documentText.slice(start, end),
    after: documentText.slice(end, to) + (to < documentText.length ? " …" : ""),
  };
}
