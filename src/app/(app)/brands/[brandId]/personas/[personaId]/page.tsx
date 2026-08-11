import Link from "next/link";
import {
  approvePersonaAction,
  createVersionAction,
  duplicatePersonaAction,
  markUnsupportedAction,
  rejectPersonaAction,
  renamePersonaAction,
  setFieldLockedAction,
  updatePersonaFieldAction,
} from "@/app/actions/personas";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { ConfidencePanel } from "@/components/confidence-panel";
import { EvidenceDrawer, type AttachableEvidence } from "@/components/evidence-drawer";
import { EvidenceTable } from "@/components/evidence-table";
import {
  Badge,
  ButtonLink,
  Callout,
  Card,
  CardHeader,
  Chips,
  ConfidenceBar,
  EmptyState,
  Field,
  Input,
  KeyValue,
  OriginBadge,
  PageHeader,
  ProvenanceBadge,
  Select,
  StatusBadge,
  Tabs,
  Textarea,
} from "@/components/ui";
import { hasCapability, requireBrandAccess } from "@/lib/auth/context";
import { getCsrfToken } from "@/lib/auth/session";
import { PROVENANCE } from "@/prompts/schemas";
import {
  FIELD_TYPE_META,
  getPersonaDetail,
  listApprovedEvidenceForAttachment,
  type PersonaDetail,
  type PersonaFieldGroup,
  type PersonaFieldWithEvidence,
} from "@/services/personas";
import { listPromptSetsForPersona, type PromptSetListRow } from "@/services/prompt-sets";

export const dynamic = "force-dynamic";

/** How many approved records the per-field attach control offers, highest quality first. */
const ATTACHABLE_LIMIT = 25;

/** Presentation-only grouping of the schema's field types for a marketer/SEO audience. */
const LIKES_FIELD_TYPES = [
  "decision_criterion",
  "success_metric",
  "proof_preference",
  "distinguishing_topic",
] as const;
const DISLIKES_FIELD_TYPES = ["objection", "constraint"] as const;
const VOCABULARY_FIELD_TYPES = ["vocabulary", "recurring_question"] as const;

export default async function PersonaDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ brandId: string; personaId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { brandId, personaId } = await params;
  const query = await searchParams;
  const requestedVersion =
    typeof query.version === "string" && /^\d+$/.test(query.version)
      ? Number(query.version)
      : undefined;

  const ctx = await requireBrandAccess(brandId);
  const [detail, promptSets, attachable, csrfToken] = await Promise.all([
    getPersonaDetail(ctx, personaId, requestedVersion),
    listPromptSetsForPersona(ctx, personaId),
    // Every field renders its own attach control, so this list is duplicated
    // once per field in the HTML. Kept deliberately short: at 200 records and
    // thirty-odd fields the page ballooned to megabytes of <option> elements.
    // Reviewers who need something further down the list use the explorer.
    listApprovedEvidenceForAttachment(ctx, ATTACHABLE_LIMIT),
    getCsrfToken(),
  ]);

  const canEdit = hasCapability(ctx, "persona:generate");
  const canApprove = hasCapability(ctx, "persona:approve");
  const canExport = hasCapability(ctx, "export:read");
  const { version } = detail;
  const editable = canEdit && detail.mutable;

  const missingCore = detail.coreCoverage.filter((entry) => entry.supported === 0);
  /** Only one draft may exist at a time, so the create-version control is gated on this. */
  const openDraft = detail.versions.find((row) => row.status === "draft");
  const exportBase = `/brands/${brandId}/personas/${personaId}/export?version=${version.version}`;

  const fieldRowProps = { brandId, personaId, editable, canApprove: canApprove && detail.mutable, csrfToken, attachable };

  const pickGroups = (types: readonly string[]) =>
    detail.groups.filter((group) => types.includes(group.fieldType));
  const likesGroups = pickGroups(LIKES_FIELD_TYPES);
  const dislikesGroups = pickGroups(DISLIKES_FIELD_TYPES);
  const vocabularyGroups = pickGroups(VOCABULARY_FIELD_TYPES);
  const shownElsewhere = new Set<string>([
    ...LIKES_FIELD_TYPES,
    ...DISLIKES_FIELD_TYPES,
    ...VOCABULARY_FIELD_TYPES,
  ]);
  const allFieldsGroups = detail.groups.filter((group) => !shownElsewhere.has(group.fieldType));

  return (
    <>
      <PageHeader
        title={version.name}
        description={version.summary ?? version.segmentDefinition}
        breadcrumb={
          <>
            {ctx.brandName} /{" "}
            <Link href={`/brands/${brandId}/personas`} className="hover:underline">
              Personas
            </Link>
          </>
        }
        actions={
          <span className="flex flex-wrap items-center gap-2">
            <ConfidenceBar value={version.overallConfidence} />
            <StatusBadge status={version.status} />
            <OriginBadge origin={version.dataOrigin} />
            <Badge tone="neutral">version {version.version}</Badge>
          </span>
        }
      />

      <Callout tone="info">
        This is a synthetic hypothesis used to organise evidence and generate testable information
        needs. It is not a real person, not a digital twin, and the confidence figures are a
        transparent heuristic rather than a probability that the persona is correct.
      </Callout>

      {version.needsReviewReason ? (
        <div className="mt-4">
          <Callout tone="warn" title="Queued for review">
            {version.needsReviewReason}
          </Callout>
        </div>
      ) : null}

      {version.rejectedReason ? (
        <div className="mt-4">
          <Callout tone="danger" title="Rejected">
            {version.rejectedReason}
          </Callout>
        </div>
      ) : null}

      {!detail.mutable ? (
        <div className="mt-4">
          <Callout tone="success" title="Approved and immutable">
            This version cannot be edited. To revise it, create a new version — the approved one is
            kept as the parent so the change is auditable.
          </Callout>
        </div>
      ) : null}

      {missingCore.length > 0 ? (
        <div className="mt-4">
          <Callout tone="warn" title="Core fields without support">
            {missingCore.map((entry) => FIELD_TYPE_META[entry.fieldType].label).join(", ")} —{" "}
            {missingCore.length === 1 ? "this core field has" : "these core fields have"} no
            supported entry. Approval is blocked until evidence is attached or the gap is accepted
            explicitly.
          </Callout>
        </div>
      ) : null}

      <div className="mt-5">
        <Tabs
          tabs={[
            {
              id: "overview",
              label: "Overview",
              content: (
                <OverviewTab
                  brandId={brandId}
                  personaId={personaId}
                  detail={detail}
                  canEdit={canEdit}
                  canApprove={canApprove}
                  canExport={canExport}
                  csrfToken={csrfToken}
                  openDraft={openDraft}
                  exportBase={exportBase}
                />
              ),
            },
            {
              id: "segment",
              label: "Segment: why & how built",
              content: <SegmentTab brandId={brandId} detail={detail} />,
            },
            {
              id: "likes",
              label: "Likes & priorities",
              content: (
                <FieldGroupsTab
                  groups={likesGroups}
                  emptyDescription="No decision criteria, success metrics, proof preferences or distinguishing topics recorded on this version yet."
                  {...fieldRowProps}
                />
              ),
            },
            {
              id: "dislikes",
              label: "Dislikes & friction",
              content: (
                <FieldGroupsTab
                  groups={dislikesGroups}
                  emptyDescription="No objections or constraints recorded on this version yet."
                  {...fieldRowProps}
                />
              ),
            },
            {
              id: "vocabulary",
              label: "Vocabulary & voice",
              content: (
                <FieldGroupsTab
                  groups={vocabularyGroups}
                  emptyDescription="No vocabulary or recurring questions recorded on this version yet."
                  {...fieldRowProps}
                />
              ),
            },
            {
              id: "fields",
              label: "All fields",
              content: (
                <>
                  <FieldGroupsTab
                    groups={allFieldsGroups}
                    emptyDescription="This version has no fields. Regenerate the persona from its segment."
                    {...fieldRowProps}
                  />
                  <Card className="mt-4">
                    <CardHeader
                      title="Excluded assumptions"
                      description="Recorded on every version so the refusal to infer these attributes is visible rather than assumed."
                    />
                    <ul className="list-disc space-y-1 px-8 py-3 text-sm text-ink-muted">
                      {version.excludedAssumptions.map((assumption) => (
                        <li key={assumption}>{assumption}</li>
                      ))}
                    </ul>
                  </Card>
                </>
              ),
            },
            {
              id: "prompts",
              label: "Prompts",
              content: <PromptsTab brandId={brandId} promptSets={promptSets} />,
            },
          ]}
        />
      </div>
    </>
  );
}

function OverviewTab({
  brandId,
  personaId,
  detail,
  canEdit,
  canApprove,
  canExport,
  csrfToken,
  openDraft,
  exportBase,
}: {
  brandId: string;
  personaId: string;
  detail: PersonaDetail;
  canEdit: boolean;
  canApprove: boolean;
  canExport: boolean;
  csrfToken: string;
  openDraft: PersonaDetail["versions"][number] | undefined;
  exportBase: string;
}) {
  const { persona, version } = detail;

  return (
    <>
      {/* ── Versions ─────────────────────────────────────────────────────── */}
      <Card>
        <CardHeader
          title="Versions"
          description="Approved versions are never overwritten. Each revision records its parent and a change summary."
          actions={
            detail.versions.length > 1 ? (
              <ButtonLink href={`/brands/${brandId}/personas/${personaId}/compare`} size="sm">
                Compare versions
              </ButtonLink>
            ) : null
          }
        />
        <ul className="divide-y divide-surface-border">
          {detail.versions.map((row) => (
            <li
              key={row.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm"
            >
              <Link
                href={`/brands/${brandId}/personas/${personaId}?version=${row.version}`}
                className={
                  row.version === version.version
                    ? "font-semibold text-accent-ink"
                    : "text-ink hover:text-accent hover:underline"
                }
              >
                Version {row.version}
              </Link>
              <StatusBadge status={row.status} />
              <ConfidenceBar value={row.overallConfidence} />
              <span className="text-xs text-ink-subtle">
                {row.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                {row.approvedAt ? ` · approved ${row.approvedAt.toISOString().slice(0, 10)}` : ""}
              </span>
              {row.changeSummary ? (
                <span className="w-full text-xs text-ink-muted sm:w-auto">{row.changeSummary}</span>
              ) : null}
            </li>
          ))}
        </ul>
      </Card>

      {/* ── Provenance ───────────────────────────────────────────────────── */}
      <Card className="mt-4">
        <CardHeader title="Identity and scope" />
        <div className="space-y-3 px-4 py-3">
          <KeyValue
            items={[
              { label: "Persona slug", value: <code className="text-xs">{persona.slug}</code> },
              {
                label: "Segment",
                value: detail.segment ? (
                  <span className="text-ink">
                    {detail.segment.label} — see the &ldquo;Segment: why &amp; how built&rdquo; tab
                  </span>
                ) : (
                  "— (duplicated persona, not tied to a segment)"
                ),
              },
              { label: "Journey stages", value: <Chips values={version.journeyStages} /> },
              { label: "Information depth", value: version.informationDepth ?? "—" },
              {
                label: "Generated",
                value: `${version.generatedAt.toISOString().slice(0, 16).replace("T", " ")}${detail.generatedByName ? ` by ${detail.generatedByName}` : ""}`,
              },
              {
                label: "Approved",
                value: version.approvedAt
                  ? `${version.approvedAt.toISOString().slice(0, 16).replace("T", " ")}${detail.approvedByName ? ` by ${detail.approvedByName}` : ""}`
                  : "—",
              },
            ]}
          />
        </div>
      </Card>

      {/* ── Actions ──────────────────────────────────────────────────────── */}
      {canExport || canApprove || canEdit ? (
        <Card className="mt-4">
          <CardHeader
            title="Review and export"
            description="Exports carry the evidence ids, confidence components and generation metadata, so a persona never leaves the product as an unattributed assertion."
          />
          <div className="space-y-4 px-4 py-3">
            {canExport ? (
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-medium text-ink-muted">
                  Export version {version.version}:
                </span>
                <ButtonLink href={`${exportBase}&format=json`} size="sm">
                  JSON
                </ButtonLink>
                <ButtonLink href={`${exportBase}&format=csv`} size="sm">
                  CSV
                </ButtonLink>
                <ButtonLink href={`${exportBase}&format=md`} size="sm">
                  Markdown
                </ButtonLink>
              </div>
            ) : null}

            {canApprove && detail.mutable ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <ActionForm
                  action={approvePersonaAction}
                  csrfToken={csrfToken}
                  hidden={{ brandId, personaId, personaVersionId: version.id }}
                >
                  <SubmitButton
                    label={`Approve version ${version.version}`}
                    confirm="Approve this version? It becomes immutable — later changes require a new version."
                  />
                  <p className="hint">
                    Approval is refused while any core field is unsupported or any claim cites no
                    available evidence.
                  </p>
                </ActionForm>

                <ActionForm
                  action={rejectPersonaAction}
                  csrfToken={csrfToken}
                  hidden={{ brandId, personaId, personaVersionId: version.id }}
                >
                  <Field label="Reject with a reason" htmlFor="reason" required>
                    <Textarea id="reason" name="reason" rows={2} maxLength={2000} />
                  </Field>
                  <SubmitButton label="Reject version" variant="danger" size="sm" />
                </ActionForm>
              </div>
            ) : null}

            {canEdit ? (
              <div className="grid gap-4 border-t border-surface-border pt-3 sm:grid-cols-3">
                {openDraft ? (
                  // A second concurrent draft is refused by the service, so the
                  // control is not offered — an open draft is where revisions go.
                  <div>
                    <p className="label">Create a new version</p>
                    <p className="hint mb-1.5">
                      Version {openDraft.version} is already an open draft, so revisions belong
                      there rather than in another copy.
                    </p>
                    {openDraft.version === version.version ? (
                      <p className="text-xs text-ink-muted">
                        You are viewing that draft. Edit its claims directly, then approve or reject
                        it.
                      </p>
                    ) : (
                      <ButtonLink
                        href={`/brands/${brandId}/personas/${personaId}?version=${openDraft.version}`}
                        size="sm"
                      >
                        Open version {openDraft.version}
                      </ButtonLink>
                    )}
                  </div>
                ) : (
                  <ActionForm
                    action={createVersionAction}
                    csrfToken={csrfToken}
                    hidden={{ brandId, personaId, fromVersionId: version.id }}
                  >
                    <Field
                      label="Create a new version"
                      htmlFor="changeSummary"
                      hint="Copies this version's fields and evidence into a fresh draft."
                      required
                    >
                      <Input
                        id="changeSummary"
                        name="changeSummary"
                        placeholder="What this revision changes"
                        maxLength={2000}
                      />
                    </Field>
                    <SubmitButton label="Create version" variant="secondary" size="sm" />
                  </ActionForm>
                )}

                <ActionForm
                  action={duplicatePersonaAction}
                  csrfToken={csrfToken}
                  hidden={{ brandId, personaId, fromVersionId: version.id }}
                >
                  <Field
                    label="Duplicate as a new persona"
                    htmlFor="duplicate-name"
                    hint="A separate identity with its own slug, not tied to this segment."
                  >
                    <Input
                      id="duplicate-name"
                      name="name"
                      placeholder={`${persona.name} (copy)`}
                      maxLength={120}
                    />
                  </Field>
                  <SubmitButton label="Duplicate" variant="secondary" size="sm" />
                </ActionForm>

                <ActionForm
                  action={renamePersonaAction}
                  csrfToken={csrfToken}
                  hidden={{ brandId, personaId }}
                >
                  <Field
                    label="Rename persona"
                    htmlFor="rename"
                    hint="The slug stays the same, so any deployed Profound tags remain valid."
                  >
                    <Input id="rename" name="name" defaultValue={persona.name} maxLength={120} />
                  </Field>
                  <SubmitButton label="Rename" variant="secondary" size="sm" />
                </ActionForm>
              </div>
            ) : null}
          </div>
        </Card>
      ) : null}
    </>
  );
}

function SegmentTab({ brandId, detail }: { brandId: string; detail: PersonaDetail }) {
  const { segment, version } = detail;

  if (!segment) {
    return (
      <Card>
        <EmptyState
          title="Not tied to a live segment"
          description="This persona was duplicated from another one, so it has no segment of its own. The segment definition captured when it was generated is shown below for reference."
        />
        <div className="border-t border-surface-border px-4 py-3">
          <p className="text-2xs font-semibold uppercase tracking-wide text-ink-muted">
            Segment definition at generation time
          </p>
          <p className="mt-1 text-sm text-ink">{version.segmentDefinition}</p>
        </div>
      </Card>
    );
  }

  const supporting = segment.evidence.filter((row) => row.relation === "supports");
  const contradicting = segment.evidence.filter((row) => row.relation === "contradicts");

  return (
    <>
      <Card>
        <CardHeader
          title={segment.label}
          description="Why this segment exists, and why it changes what gets said to it."
          actions={
            <span className="flex items-center gap-2">
              <StatusBadge status={segment.status} />
              <ButtonLink href={`/brands/${brandId}/segments/${segment.id}`} size="sm">
                Manage this segment
              </ButtonLink>
            </span>
          }
        />
        <div className="space-y-3 px-4 py-3">
          <div>
            <p className="text-2xs font-semibold uppercase tracking-wide text-ink-muted">
              Definition
            </p>
            <p className="mt-1 text-sm text-ink">{segment.definition}</p>
          </div>
          <div>
            <p className="text-2xs font-semibold uppercase tracking-wide text-ink-muted">
              Why it changes prompts or content
            </p>
            <p className="mt-1 text-sm text-ink">{segment.whyItChangesPrompts}</p>
          </div>
          {segment.distinguishingVariables.length > 0 ? (
            <div>
              <p className="text-2xs font-semibold uppercase tracking-wide text-ink-muted">
                Distinguishing variables
              </p>
              <div className="mt-1">
                <Chips values={segment.distinguishingVariables} />
              </div>
            </div>
          ) : null}
          {segment.coverageGaps.length > 0 ? (
            <div>
              <p className="text-2xs font-semibold uppercase tracking-wide text-ink-muted">
                Coverage gaps
              </p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-ink-muted">
                {segment.coverageGaps.map((gap) => (
                  <li key={gap}>{gap}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {segment.overlaps.length > 0 ? (
            <div>
              <p className="text-2xs font-semibold uppercase tracking-wide text-ink-muted">
                Overlaps with other segments
              </p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-ink-muted">
                {segment.overlaps.map((overlap) => (
                  <li key={overlap.segmentSlug}>
                    <code className="text-xs">{overlap.segmentSlug}</code> — {overlap.note}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      </Card>

      <div className="mt-4">
        <ConfidencePanel
          score={segment.confidence}
          components={segment.confidenceComponents}
          explanation={segment.confidenceExplanation}
        />
      </div>

      <Card className="mt-4">
        <CardHeader title="How this was built" />
        <div className="grid gap-4 px-4 py-3 sm:grid-cols-2">
          <div>
            <p className="mb-1.5 text-2xs font-semibold uppercase tracking-wide text-ink-muted">
              Segment generation
            </p>
            <KeyValue
              items={[
                { label: "Run", value: <code className="text-xs">{segment.runId}</code> },
                {
                  label: "Model",
                  value: `${segment.modelProvider ?? "—"} / ${segment.modelId ?? "—"}`,
                },
                { label: "Prompt template", value: segment.promptTemplateVersion ?? "—" },
                { label: "Schema version", value: segment.schemaVersion ?? "—" },
                {
                  label: "Evidence cutoff",
                  value: segment.evidenceCutoff?.toISOString().slice(0, 10) ?? "—",
                },
                {
                  label: "Evidence coverage",
                  value: `${(segment.evidenceCoverage * 100).toFixed(0)}% of approved evidence`,
                },
                {
                  label: "Created",
                  value: segment.createdAt.toISOString().slice(0, 16).replace("T", " "),
                },
              ]}
            />
          </div>
          <div>
            <p className="mb-1.5 text-2xs font-semibold uppercase tracking-wide text-ink-muted">
              Persona generation
            </p>
            <KeyValue
              items={[
                {
                  label: "Model",
                  value: `${version.modelProvider ?? "—"} / ${version.modelId ?? "—"}`,
                },
                { label: "Prompt template", value: version.promptTemplateVersion ?? "—" },
                { label: "Schema version", value: version.schemaVersion ?? "—" },
                {
                  label: "Evidence cutoff",
                  value: version.evidenceCutoff?.toISOString().slice(0, 10) ?? "—",
                },
                {
                  label: "Source mix",
                  value: (
                    <Chips
                      values={Object.entries(version.sourceMix).map(
                        ([source, n]) => `${source} (${n})`,
                      )}
                    />
                  ),
                },
              ]}
            />
          </div>
        </div>
      </Card>

      <Card className="mt-4">
        <CardHeader
          title={`Supporting evidence (${supporting.length})`}
          description="Every record the segment rests on. Open one to see it in its original source context."
        />
        {supporting.length === 0 ? (
          <EmptyState
            title="No supporting evidence"
            description="This segment has no supporting records left — usually because their sources were deleted."
          />
        ) : (
          <EvidenceTable brandId={brandId} rows={supporting} />
        )}
      </Card>

      <Card className="mt-4">
        <CardHeader
          title={`Contradicting evidence (${contradicting.length})`}
          description="Records in scope for this segment that hedge or argue against its premise. They reduce confidence rather than being averaged away."
        />
        {contradicting.length === 0 ? (
          <EmptyState
            title="No contradicting evidence"
            description="Nothing in the approved evidence argues against this segment. That is not the same as confirmation — check the coverage gaps."
          />
        ) : (
          <EvidenceTable brandId={brandId} rows={contradicting} />
        )}
      </Card>
    </>
  );
}

function PromptsTab({ brandId, promptSets }: { brandId: string; promptSets: PromptSetListRow[] }) {
  if (promptSets.length === 0) {
    return (
      <Card>
        <EmptyState
          title="No prompts generated yet"
          description="Generate a prompt set from this persona to see its prompts here."
          action={
            <ButtonLink href={`/brands/${brandId}/prompt-sets`} size="sm">
              Go to prompt sets
            </ButtonLink>
          }
        />
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader
        title="Prompt sets generated from this persona"
        description="Every prompt in these sets was derived from this persona's fields and evidence."
      />
      <ul className="divide-y divide-surface-border">
        {promptSets.map((set) => (
          <li key={set.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <div className="min-w-0">
              <Link
                href={`/brands/${brandId}/prompt-sets/${set.id}`}
                className="text-sm font-medium text-ink hover:text-accent hover:underline"
              >
                {set.name}
              </Link>
              <p className="text-xs text-ink-subtle">
                {set.promptCount} prompt{set.promptCount === 1 ? "" : "s"} ·{" "}
                {set.controlCount} control{set.controlCount === 1 ? "" : "s"}
                {set.currentVersion ? ` · version ${set.currentVersion}` : ""}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              {set.currentStatus ? <StatusBadge status={set.currentStatus} /> : null}
              {set.duplicateWarnings > 0 ? (
                <Badge tone="warn" title="Some prompts are near-duplicates of each other">
                  {set.duplicateWarnings} duplicate warning{set.duplicateWarnings === 1 ? "" : "s"}
                </Badge>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}

function FieldGroupsTab({
  groups,
  emptyDescription,
  brandId,
  personaId,
  editable,
  canApprove,
  csrfToken,
  attachable,
}: {
  groups: PersonaFieldGroup[];
  emptyDescription: string;
  brandId: string;
  personaId: string;
  editable: boolean;
  canApprove: boolean;
  csrfToken: string;
  attachable: AttachableEvidence[];
}) {
  if (groups.length === 0) {
    return (
      <Card>
        <EmptyState title="Nothing here yet" description={emptyDescription} />
      </Card>
    );
  }

  return (
    <>
      {groups.map((group, index) => {
        const meta = FIELD_TYPE_META[group.fieldType];
        return (
          <Card key={group.fieldType} className={index === 0 ? "" : "mt-4"}>
            <CardHeader
              title={
                <span className="flex flex-wrap items-center gap-2">
                  {meta.label}
                  {meta.core ? (
                    <Badge tone="accent" title="One of the five required core fields">
                      core
                    </Badge>
                  ) : null}
                  {meta.structural ? (
                    <Badge
                      tone="neutral"
                      title="A statement about scope or process rather than a claim about the buyer"
                    >
                      scope
                    </Badge>
                  ) : null}
                </span>
              }
              description={meta.description}
            />
            <ul className="divide-y divide-surface-border">
              {group.fields.map((field) => (
                <PersonaFieldRow
                  key={field.id}
                  brandId={brandId}
                  personaId={personaId}
                  field={field}
                  structural={meta.structural}
                  editable={editable}
                  canApprove={canApprove}
                  csrfToken={csrfToken}
                  attachable={attachable}
                />
              ))}
            </ul>
          </Card>
        );
      })}
    </>
  );
}

function PersonaFieldRow({
  brandId,
  personaId,
  field,
  structural,
  editable,
  canApprove,
  csrfToken,
  attachable,
}: {
  brandId: string;
  personaId: string;
  field: PersonaFieldWithEvidence;
  structural: boolean;
  editable: boolean;
  canApprove: boolean;
  csrfToken: string;
  attachable: AttachableEvidence[];
}) {
  const attachedIds = new Set(field.evidence.map((link) => link.evidenceId));
  const available = attachable.filter((item) => !attachedIds.has(item.id));

  return (
    <li className="px-4 py-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 flex-1 text-sm text-ink">{field.statement}</p>
        <div className="flex flex-wrap items-center gap-1">
          <ProvenanceBadge provenance={field.provenance} />
          {field.insufficientEvidence ? (
            <Badge tone="warn" title="No approved evidence supports this claim">
              insufficient evidence
            </Badge>
          ) : null}
          {field.markedUnsupported ? (
            <Badge tone="danger" title="A reviewer judged this claim unsupported">
              marked unsupported
            </Badge>
          ) : null}
          {field.locked ? (
            <Badge tone="neutral" title="Locked: unlock before editing">
              locked
            </Badge>
          ) : null}
          {field.editedByUser ? (
            <Badge tone="neutral" title="Edited by a reviewer after generation">
              edited
            </Badge>
          ) : null}
        </div>
      </div>

      <ConfidencePanel
        className="mt-2"
        score={field.confidence}
        components={field.confidenceComponents}
        explanation={field.confidenceExplanation}
        insufficientEvidence={field.insufficientEvidence}
      />

      {structural ? (
        <p className="mt-2 text-2xs text-ink-subtle">
          Scope statements carry no evidence by design and are excluded from the version&apos;s
          confidence.
        </p>
      ) : (
        <EvidenceDrawer
          brandId={brandId}
          personaId={personaId}
          fieldId={field.id}
          evidence={field.evidence}
          attachable={available}
          editable={editable}
          csrfToken={csrfToken}
          insufficientEvidence={field.insufficientEvidence}
        />
      )}

      {editable || canApprove ? (
        <details className="group mt-2">
          <summary className="cursor-pointer list-none text-xs font-medium text-ink-muted hover:text-ink">
            <span className="group-open:hidden">Edit claim</span>
            <span className="hidden group-open:inline">Close editor</span>
          </summary>
          <div className="mt-2 space-y-3 rounded-md border border-surface-border bg-surface-sunken/40 p-3">
            {editable && !field.locked ? (
              <ActionForm
                action={updatePersonaFieldAction}
                csrfToken={csrfToken}
                hidden={{ brandId, personaId, fieldId: field.id }}
              >
                <Field label="Statement" htmlFor={`statement-${field.id}`} required>
                  <Textarea
                    id={`statement-${field.id}`}
                    name="statement"
                    rows={3}
                    defaultValue={field.statement}
                    maxLength={800}
                  />
                </Field>
                <Field
                  label="Provenance"
                  htmlFor={`provenance-${field.id}`}
                  hint="Observed, externally supported, brand assertion or inferred. Do not upgrade a brand claim to an observation."
                >
                  <Select
                    id={`provenance-${field.id}`}
                    name="provenance"
                    defaultValue={field.provenance}
                    className="max-w-xs"
                  >
                    {PROVENANCE.map((value) => (
                      <option key={value} value={value}>
                        {value.replace(/_/g, " ")}
                      </option>
                    ))}
                  </Select>
                </Field>
                <SubmitButton label="Save claim" variant="secondary" size="sm" />
              </ActionForm>
            ) : field.locked ? (
              <p className="text-xs text-ink-muted">
                This field is locked. Unlock it below before editing.
              </p>
            ) : null}

            <div className="flex flex-wrap items-center gap-2 border-t border-surface-border pt-3">
              {editable && !field.locked ? (
                <ActionForm
                  action={markUnsupportedAction}
                  csrfToken={csrfToken}
                  hidden={{
                    brandId,
                    personaId,
                    fieldId: field.id,
                    unsupported: field.markedUnsupported ? "false" : "true",
                  }}
                  className="space-y-0"
                >
                  <SubmitButton
                    label={field.markedUnsupported ? "Remove unsupported mark" : "Mark unsupported"}
                    variant="ghost"
                    size="sm"
                  />
                </ActionForm>
              ) : null}

              {canApprove ? (
                <ActionForm
                  action={setFieldLockedAction}
                  csrfToken={csrfToken}
                  hidden={{
                    brandId,
                    personaId,
                    fieldId: field.id,
                    locked: field.locked ? "false" : "true",
                  }}
                  className="space-y-0"
                >
                  <SubmitButton
                    label={field.locked ? "Unlock field" : "Lock field"}
                    variant="ghost"
                    size="sm"
                  />
                </ActionForm>
              ) : null}
            </div>
          </div>
        </details>
      ) : null}
    </li>
  );
}

export type { PersonaDetail };
