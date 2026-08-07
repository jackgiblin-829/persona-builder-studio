import Link from "next/link";
import { notFound } from "next/navigation";
import {
  approvePromptSetAction,
  bulkPromptAction,
  createPromptSetVersionAction,
  rejectPromptSetAction,
} from "@/app/actions/prompt-sets";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { PromptCard } from "@/components/prompt-card";
import {
  Badge,
  ButtonLink,
  Callout,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  KeyValue,
  OriginBadge,
  PageHeader,
  Select,
  Stat,
  StatusBadge,
  Textarea,
} from "@/components/ui";
import { hasCapability, requireBrandAccess } from "@/lib/auth/context";
import { getCsrfToken } from "@/lib/auth/session";
import { NotFoundError } from "@/lib/errors";
import { getPromptSetDetail, type PromptRow } from "@/services/prompt-sets";

export const dynamic = "force-dynamic";

export default async function PromptSetPage({
  params,
  searchParams,
}: {
  params: Promise<{ brandId: string; promptSetId: string }>;
  searchParams: Promise<{ version?: string; group?: string }>;
}) {
  const { brandId, promptSetId } = await params;
  const { version: versionParam, group } = await searchParams;
  const ctx = await requireBrandAccess(brandId);

  const requestedVersion =
    versionParam && /^\d+$/.test(versionParam) ? Number(versionParam) : undefined;

  let detail;
  try {
    detail = await getPromptSetDetail(ctx, promptSetId, requestedVersion);
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  const csrfToken = await getCsrfToken();
  const canEdit = hasCapability(ctx, "prompt:generate") && detail.editable;
  const canApprove = hasCapability(ctx, "prompt:approve") && detail.editable;
  const groupBy = group === "stage" ? "stage" : "intent";
  const base = `/brands/${brandId}/prompt-sets/${promptSetId}`;
  const versionQuery = requestedVersion ? `&version=${requestedVersion}` : "";

  const groups: { key: string; label: string; prompts: PromptRow[] }[] =
    groupBy === "stage"
      ? detail.byStage.map((entry) => ({
          key: entry.stage,
          label: entry.stage.replace(/_/g, " "),
          prompts: entry.prompts,
        }))
      : detail.byIntent.map((entry) => ({
          key: entry.intent,
          label: entry.label,
          prompts: entry.prompts,
        }));

  const hasOpenDraft = detail.versions.some((row) => row.status === "draft");

  return (
    <>
      <PageHeader
        title={detail.set.name}
        description={
          <>
            Derived from{" "}
            <Link
              href={`/brands/${brandId}/personas/${detail.persona.id}`}
              className="font-medium text-accent hover:underline"
            >
              {detail.persona.name}
            </Link>{" "}
            v{detail.personaVersion.version}. Every prompt here started from a persona field that
            cites evidence — none of them was written to make the brand appear.
          </>
        }
        breadcrumb={
          <>
            <Link href={`/brands/${brandId}/prompt-sets`} className="hover:underline">
              {ctx.brandName} / Prompt sets
            </Link>{" "}
            / {detail.set.slug}
          </>
        }
        actions={
          <>
            <ButtonLink href={`${base}/export?format=json${versionQuery}`} size="sm">
              JSON
            </ButtonLink>
            <ButtonLink href={`${base}/export?format=csv${versionQuery}`} size="sm">
              CSV
            </ButtonLink>
            <ButtonLink href={`${base}/export?format=md${versionQuery}`} size="sm">
              Markdown
            </ButtonLink>
          </>
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Persona prompts" value={detail.counts.persona} />
        <Stat
          label="Generic controls"
          value={detail.counts.controls}
          hint={`${detail.counts.paired} of ${detail.counts.persona} paired`}
        />
        <Stat label="Approved" value={detail.counts.approved} />
        <Stat label="Awaiting review" value={detail.counts.pending} />
        <Stat
          label="Duplicate warnings"
          value={detail.counts.duplicateWarnings}
          hint={
            detail.counts.exactDuplicates > 0
              ? `${detail.counts.exactDuplicates} exact`
              : "none exact"
          }
        />
      </div>

      {detail.counts.persona < 15 && detail.version.status === "draft" ? (
        <div className="mb-4">
          <Callout tone="warn" title="Fewer than 15 prompts">
            §17 targets 15–30 prompts per persona. This set has {detail.counts.persona}, which
            usually means the persona has few evidence-backed fields to derive from. Approving it is
            allowed — a small set of well-traced prompts beats a padded one — but the coverage will
            be narrow.
          </Callout>
        </div>
      ) : null}

      {detail.version.status === "approved" ? (
        <div className="mb-4">
          <Callout tone="success" title={`Version ${detail.version.version} is approved`}>
            This version is immutable. Its approved prompts are ready for the Profound deployment
            path. To change anything, create a new version — the approved one stays exactly as it
            was reviewed.
          </Callout>
        </div>
      ) : null}

      {detail.version.rejectedReason ? (
        <div className="mb-4">
          <Callout tone="danger" title="This version was rejected">
            {detail.version.rejectedReason}
          </Callout>
        </div>
      ) : null}

      <Card className="mb-4">
        <CardHeader
          title={`Version ${detail.version.version}`}
          description="Everything a reviewer needs to judge whether this set can be trusted."
          actions={
            <>
              <StatusBadge status={detail.version.status} />
              <OriginBadge origin={detail.version.dataOrigin} />
            </>
          }
        />
        <div className="px-4 py-3">
          <KeyValue
            items={[
              {
                label: "Persona version",
                value: `${detail.personaVersion.name} v${detail.personaVersion.version} (${detail.personaVersion.status})`,
              },
              {
                label: "Evidence cutoff",
                value: detail.version.evidenceCutoff?.toISOString().slice(0, 10) ?? "—",
              },
              { label: "Generated at", value: detail.version.generatedAt.toISOString() },
              { label: "Generated by", value: detail.generatedByName ?? "—" },
              { label: "Approved by", value: detail.approvedByName ?? "—" },
              {
                label: "Model",
                value: `${detail.version.modelProvider ?? "—"} / ${detail.version.modelId ?? "—"}`,
              },
              { label: "Prompt template", value: detail.version.promptTemplateVersion ?? "—" },
              { label: "Schema version", value: detail.version.schemaVersion ?? "—" },
              { label: "Change summary", value: detail.version.changeSummary ?? "—" },
              {
                label: "Reviewer-edited prompts",
                value: `${detail.counts.edited} of ${detail.counts.total}`,
              },
            ]}
          />

          {detail.versions.length > 1 ? (
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-surface-border pt-3 text-xs">
              <span className="text-ink-muted">Versions:</span>
              {detail.versions.map((row) => (
                <Link
                  key={row.id}
                  href={`${base}?version=${row.version}&group=${groupBy}`}
                  className={
                    row.id === detail.version.id
                      ? "rounded bg-accent-soft px-1.5 py-0.5 font-medium text-accent-ink"
                      : "rounded px-1.5 py-0.5 text-ink-muted hover:bg-surface-sunken"
                  }
                >
                  v{row.version} ({row.status.replace(/_/g, " ")})
                </Link>
              ))}
            </div>
          ) : null}
        </div>
      </Card>

      {canApprove ? (
        <Card className="mb-4">
          <CardHeader
            title="Approve or reject this version"
            description="Approving freezes the version and marks its approved prompts ready to deploy. Every prompt must be reviewed first, must cite available evidence, and must not be an exact duplicate of another tracked prompt."
          />
          <div className="grid grid-cols-1 gap-4 px-4 py-3 lg:grid-cols-2">
            <ActionForm
              action={approvePromptSetAction}
              csrfToken={csrfToken}
              hidden={{ brandId, promptSetId, promptSetVersionId: detail.version.id }}
            >
              <SubmitButton
                label={`Approve version ${detail.version.version}`}
                confirm="Approve this prompt set? The version becomes immutable — revising it later creates a new version."
              />
            </ActionForm>

            <ActionForm
              action={rejectPromptSetAction}
              csrfToken={csrfToken}
              hidden={{ brandId, promptSetId, promptSetVersionId: detail.version.id }}
            >
              <Field label="Reason for rejection" htmlFor="reject-reason" required>
                <Input
                  id="reject-reason"
                  name="reason"
                  maxLength={2000}
                  placeholder="What is wrong with this set?"
                  required
                />
              </Field>
              <SubmitButton label="Reject version" variant="danger" size="sm" />
            </ActionForm>
          </div>
        </Card>
      ) : null}

      {!detail.editable && hasCapability(ctx, "prompt:generate") ? (
        <Card className="mb-4">
          <CardHeader
            title="Revise this prompt set"
            description="An approved version is never rewritten. A new version copies every prompt — including the ones a previous round rejected — into an editable draft."
          />
          <div className="px-4 py-3">
            {hasOpenDraft ? (
              <p className="text-sm text-ink-muted">
                A draft version already exists, and only one draft is allowed at a time so
                &ldquo;the draft&rdquo; is never ambiguous. Approve or reject it first:{" "}
                {detail.versions
                  .filter((row) => row.status === "draft")
                  .map((row) => (
                    <Link
                      key={row.id}
                      href={`${base}?version=${row.version}`}
                      className="font-medium text-accent hover:underline"
                    >
                      version {row.version}
                    </Link>
                  ))}
                .
              </p>
            ) : (
              <ActionForm
                action={createPromptSetVersionAction}
                csrfToken={csrfToken}
                hidden={{ brandId, promptSetId, fromVersionId: detail.version.id }}
              >
                <Field label="What does this revision change?" htmlFor="change-summary" required>
                  <Textarea
                    id="change-summary"
                    name="changeSummary"
                    rows={2}
                    maxLength={2000}
                    required
                  />
                </Field>
                <SubmitButton label="Create a new version" variant="secondary" size="sm" />
              </ActionForm>
            )}
          </div>
        </Card>
      ) : null}

      <Card className="mb-4">
        <CardHeader
          title="Prompts"
          description={`Grouped by ${groupBy === "stage" ? "journey stage" : "intent"}. Every prompt shows the evidence it came from, the persona fields it tests and the metadata that would reach Profound.`}
          actions={
            <div className="flex items-center gap-2 text-xs">
              <Link
                href={`${base}?group=intent${versionQuery}`}
                className={
                  groupBy === "intent"
                    ? "rounded bg-accent-soft px-2 py-1 font-medium text-accent-ink"
                    : "rounded px-2 py-1 text-ink-muted hover:bg-surface-sunken"
                }
              >
                By intent
              </Link>
              <Link
                href={`${base}?group=stage${versionQuery}`}
                className={
                  groupBy === "stage"
                    ? "rounded bg-accent-soft px-2 py-1 font-medium text-accent-ink"
                    : "rounded px-2 py-1 text-ink-muted hover:bg-surface-sunken"
                }
              >
                By journey stage
              </Link>
            </div>
          }
        />

        {canApprove || canEdit ? (
          <div className="border-b border-surface-border bg-surface-sunken px-4 py-2.5">
            <ActionForm
              id="bulk-review"
              action={bulkPromptAction}
              csrfToken={csrfToken}
              hidden={{ brandId, promptSetId }}
              className="space-y-2"
            >
              <p className="text-xs text-ink-muted">
                Tick prompts below, then apply an action to all of them. Rejecting a persona prompt
                also rejects a control that exists only to serve it.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                {canApprove ? (
                  <>
                    <SubmitButton
                      label="Approve selected"
                      variant="secondary"
                      size="sm"
                      name="operation"
                      value="approve"
                    />
                    <SubmitButton
                      label="Reject selected"
                      variant="danger"
                      size="sm"
                      name="operation"
                      value="reject"
                    />
                    <SubmitButton
                      label="Return to pending"
                      variant="ghost"
                      size="sm"
                      name="operation"
                      value="unreview"
                    />
                  </>
                ) : null}
                {canEdit ? (
                  <span className="ml-auto flex items-center gap-2">
                    <label className="text-xs text-ink-muted" htmlFor="bulk-priority">
                      Tracking priority
                    </label>
                    <Select
                      id="bulk-priority"
                      name="trackingPriority"
                      defaultValue="high"
                      className="w-28 text-xs"
                    >
                      <option value="high">high</option>
                      <option value="medium">medium</option>
                      <option value="low">low</option>
                    </Select>
                    <SubmitButton
                      label="Apply"
                      variant="secondary"
                      size="sm"
                      name="operation"
                      value="priority"
                    />
                  </span>
                ) : null}
              </div>
            </ActionForm>
          </div>
        ) : null}

        {groups.length === 0 ? (
          <EmptyState
            title="This version has no prompts"
            description="Generation produced nothing that survived the citation and brand-insertion checks. Review the persona's evidence and regenerate."
          />
        ) : (
          groups.map((entry) => (
            <section key={entry.key}>
              <h3 className="flex items-center gap-2 border-b border-surface-border bg-surface-sunken px-4 py-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                {entry.label}
                <Badge tone="neutral">{entry.prompts.length}</Badge>
              </h3>
              <ul className="divide-y divide-surface-border">
                {entry.prompts.map((prompt) => (
                  <PromptCard
                    key={prompt.id}
                    brandId={brandId}
                    promptSetId={promptSetId}
                    prompt={prompt}
                    editable={canEdit}
                    csrfToken={csrfToken}
                    selectable={canApprove || canEdit}
                  />
                ))}
              </ul>
            </section>
          ))
        )}
      </Card>

      {detail.controls.length > 0 ? (
        <Card>
          <CardHeader
            title={`${detail.controls.length} generic control${detail.controls.length === 1 ? "" : "s"}`}
            description="Each control is its paired prompt with the persona's qualifier removed. If a persona prompt does not outperform its control, the persona hypothesis failed rather than the content."
          />
          <ul className="divide-y divide-surface-border">
            {detail.controls.map((control) => (
              <PromptCard
                key={control.id}
                brandId={brandId}
                promptSetId={promptSetId}
                prompt={control}
                editable={canEdit}
                csrfToken={csrfToken}
                selectable={canApprove || canEdit}
              />
            ))}
          </ul>
        </Card>
      ) : null}
    </>
  );
}
