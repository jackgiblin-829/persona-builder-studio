import Link from "next/link";
import { editSegmentAction, splitSegmentAction } from "@/app/actions/segments";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { ConfidencePanel } from "@/components/confidence-panel";
import {
  Badge,
  Callout,
  Card,
  CardHeader,
  Checkbox,
  EmptyState,
  Field,
  Input,
  KeyValue,
  OriginBadge,
  PageHeader,
  ProvenanceBadge,
  StatusBadge,
  Textarea,
} from "@/components/ui";
import { hasCapability, requireBrandAccess } from "@/lib/auth/context";
import { getCsrfToken } from "@/lib/auth/session";
import { getSegment } from "@/services/segments";

export const dynamic = "force-dynamic";

export default async function SegmentDetailPage({
  params,
}: {
  params: Promise<{ brandId: string; segmentId: string }>;
}) {
  const { brandId, segmentId } = await params;
  const ctx = await requireBrandAccess(brandId);
  const [{ segment, evidence }, csrfToken] = await Promise.all([
    getSegment(ctx, segmentId),
    getCsrfToken(),
  ]);

  const canEdit = hasCapability(ctx, "segment:generate");
  const supporting = evidence.filter((row) => row.relation === "supports");
  const contradicting = evidence.filter((row) => row.relation === "contradicts");
  const settled = segment.status === "merged" || segment.status === "split";

  return (
    <>
      <PageHeader
        title={segment.label}
        description={segment.definition}
        breadcrumb={
          <>
            {ctx.brandName} /{" "}
            <Link href={`/brands/${brandId}/segments`} className="hover:underline">
              Candidate segments
            </Link>
          </>
        }
        actions={
          <span className="flex items-center gap-2">
            <StatusBadge status={segment.status} />
            <OriginBadge origin={segment.dataOrigin} />
          </span>
        }
      />

      {settled ? (
        <div className="mb-4">
          <Callout tone="info">
            This candidate was {segment.status} and is kept read-only so the decision stays
            auditable.
            {segment.mergedIntoId ? (
              <>
                {" "}
                It was merged into{" "}
                <Link
                  href={`/brands/${brandId}/segments/${segment.mergedIntoId}`}
                  className="font-medium underline"
                >
                  another candidate
                </Link>
                .
              </>
            ) : null}
          </Callout>
        </div>
      ) : null}

      <Card className="mb-4">
        <CardHeader title="Provenance" />
        <div className="px-4 py-3">
          <KeyValue
            items={[
              { label: "Slug", value: <code className="text-xs">{segment.slug}</code> },
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
      </Card>

      <div className="mb-4">
        <ConfidencePanel
          score={segment.confidence}
          components={segment.confidenceComponents}
          explanation={segment.confidenceExplanation}
        />
      </div>

      <Card className="mb-4">
        <CardHeader
          title={`Supporting evidence (${supporting.length})`}
          description="Every record the candidate rests on. Open one to see it in its original source context."
        />
        {supporting.length === 0 ? (
          <EmptyState
            title="No supporting evidence"
            description="This candidate has no supporting records left — usually because their sources were deleted."
          />
        ) : (
          <EvidenceTable brandId={brandId} rows={supporting} />
        )}
      </Card>

      <Card className="mb-4">
        <CardHeader
          title={`Contradicting evidence (${contradicting.length})`}
          description="Records in scope for this segment that hedge or argue against its premise. They reduce confidence rather than being averaged away."
        />
        {contradicting.length === 0 ? (
          <EmptyState
            title="No contradicting evidence"
            description="Nothing in the approved evidence argues against this candidate. That is not the same as confirmation — check the coverage gaps."
          />
        ) : (
          <EvidenceTable brandId={brandId} rows={contradicting} />
        )}
      </Card>

      {canEdit && !settled ? (
        <>
          <Card className="mb-4">
            <CardHeader
              title="Edit candidate"
              description="Editing the wording does not change the evidence or the confidence — it changes how the segment is described to the people who use it."
            />
            <div className="px-4 py-3">
              <ActionForm
                action={editSegmentAction}
                csrfToken={csrfToken}
                hidden={{ brandId, segmentId }}
              >
                <Field label="Label" htmlFor="label" required>
                  <Input id="label" name="label" defaultValue={segment.label} maxLength={120} />
                </Field>
                <Field label="Definition" htmlFor="definition" required>
                  <Textarea
                    id="definition"
                    name="definition"
                    rows={4}
                    defaultValue={segment.definition}
                    maxLength={1200}
                  />
                </Field>
                <Field
                  label="Distinguishing variables"
                  htmlFor="distinguishingVariables"
                  hint="One per line. These are what make the segment a real difference rather than a label."
                >
                  <Textarea
                    id="distinguishingVariables"
                    name="distinguishingVariables"
                    rows={4}
                    defaultValue={segment.distinguishingVariables.join("\n")}
                  />
                </Field>
                <Field
                  label="Why it changes prompts or content"
                  htmlFor="whyItChangesPrompts"
                  required
                >
                  <Textarea
                    id="whyItChangesPrompts"
                    name="whyItChangesPrompts"
                    rows={4}
                    defaultValue={segment.whyItChangesPrompts}
                    maxLength={1200}
                  />
                </Field>
                <SubmitButton label="Save changes" />
              </ActionForm>
            </div>
          </Card>

          {supporting.length >= 2 ? (
            <Card>
              <CardHeader
                title="Split into two candidates"
                description="Assign the supporting evidence explicitly. The application does not guess a partition, because a wrong guess would silently change what each new segment claims."
              />
              <div className="px-4 py-3">
                <ActionForm
                  action={splitSegmentAction}
                  csrfToken={csrfToken}
                  hidden={{ brandId, segmentId }}
                >
                  <div className="grid gap-3 sm:grid-cols-2">
                    <Field label="First part" htmlFor="labelA" required>
                      <Input
                        id="labelA"
                        name="labelA"
                        defaultValue={`${segment.label} (A)`}
                        maxLength={120}
                      />
                    </Field>
                    <Field label="Second part" htmlFor="labelB" required>
                      <Input
                        id="labelB"
                        name="labelB"
                        defaultValue={`${segment.label} (B)`}
                        maxLength={120}
                      />
                    </Field>
                  </div>

                  <fieldset>
                    <legend className="label">Records that move to the second part</legend>
                    <p className="hint mb-1.5">
                      Everything left unchecked stays in the first part. Contradicting evidence is
                      copied to both, because it still argues against each. Both parts need at least
                      one supporting record.
                    </p>
                    <div className="max-h-80 space-y-1.5 overflow-y-auto rounded border border-surface-border p-2">
                      {supporting.map((row) => (
                        <Checkbox
                          key={row.id}
                          name="evidenceIdsForB"
                          value={row.id}
                          label={row.normalizedClaim}
                          hint={`${row.category.replace(/_/g, " ")} · ${row.sourceLabel}`}
                        />
                      ))}
                    </div>
                  </fieldset>

                  <SubmitButton
                    label="Split candidate"
                    variant="secondary"
                    confirm="Split this candidate into two? The original is kept and marked split."
                  />
                </ActionForm>
              </div>
            </Card>
          ) : null}
        </>
      ) : null}
    </>
  );
}

function EvidenceTable({
  brandId,
  rows,
}: {
  brandId: string;
  rows: Awaited<ReturnType<typeof getSegment>>["evidence"];
}) {
  return (
    <ul className="divide-y divide-surface-border">
      {rows.map((row) => (
        <li key={`${row.id}-${row.relation}`} className="px-4 py-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <Link
              href={`/brands/${brandId}/evidence/${row.id}`}
              className="min-w-0 flex-1 text-sm font-medium text-ink hover:text-accent hover:underline"
            >
              {row.normalizedClaim}
            </Link>
            <div className="flex flex-wrap items-center gap-1">
              <ProvenanceBadge provenance={row.provenance} />
              <Badge tone="neutral">{row.category.replace(/_/g, " ")}</Badge>
              {row.availability !== "available" ? (
                <Badge tone="danger" title="Source deleted; excluded from confidence">
                  unavailable
                </Badge>
              ) : null}
            </div>
          </div>
          <p className="mt-1 line-clamp-2 text-sm italic text-ink-muted">“{row.redactedText}”</p>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-ink-subtle">
            <span>{row.sourceLabel}</span>
            <span>· {row.sourceLocation}</span>
            <span>· {row.journeyStage.replace(/_/g, " ")}</span>
            {row.observedAt ? <span>· {row.observedAt.toISOString().slice(0, 10)}</span> : null}
            <code>{row.id}</code>
          </div>
        </li>
      ))}
    </ul>
  );
}
