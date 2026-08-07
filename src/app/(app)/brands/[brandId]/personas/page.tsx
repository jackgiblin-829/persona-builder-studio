import Link from "next/link";
import { generatePersonaAction } from "@/app/actions/segments";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import {
  Badge,
  Callout,
  Card,
  CardHeader,
  ConfidenceBar,
  EmptyState,
  PageHeader,
  Stat,
  StatusBadge,
} from "@/components/ui";
import { hasCapability, requireBrandAccess } from "@/lib/auth/context";
import { getCsrfToken } from "@/lib/auth/session";
import { listPersonas } from "@/services/personas";
import { activeSegmentationJobs, listApprovedSegments } from "@/services/segments";

export const dynamic = "force-dynamic";

export default async function PersonasPage({ params }: { params: Promise<{ brandId: string }> }) {
  const { brandId } = await params;
  const ctx = await requireBrandAccess(brandId);

  const [personaRows, approvedSegments, jobsInFlight, csrfToken] = await Promise.all([
    listPersonas(ctx),
    listApprovedSegments(ctx),
    activeSegmentationJobs(ctx),
    getCsrfToken(),
  ]);

  const canGenerate = hasCapability(ctx, "persona:generate");
  const withoutPersona = approvedSegments.filter((segment) => !segment.personaId);
  const approvedCount = personaRows.filter((row) => row.currentStatus === "approved").length;
  const needsReview = personaRows.filter((row) => row.needsReviewReason);

  return (
    <>
      <PageHeader
        title="Personas"
        description="An internal, evidence-backed hypothesis about a segment's information needs — never a real person and never a digital twin. Every claim carries its evidence or an explicit insufficient-evidence marker."
        breadcrumb={`${ctx.brandName} / Personas`}
      />

      {jobsInFlight.length > 0 ? (
        <div className="mb-4">
          <Callout
            tone={jobsInFlight.some((job) => job.status === "failed") ? "danger" : "info"}
            title="Generation in progress"
          >
            {jobsInFlight.map((job) => (
              <p key={job.id} className="text-xs">
                <StatusBadge status={job.status} /> {job.id}
                {job.lastError ? ` · ${job.lastError}` : ""}
              </p>
            ))}
          </Callout>
        </div>
      ) : null}

      {needsReview.length > 0 ? (
        <div className="mb-4">
          <Callout tone="warn" title="Some personas need review">
            <ul className="space-y-0.5 text-xs">
              {needsReview.map((row) => (
                <li key={row.id}>
                  <Link
                    href={`/brands/${brandId}/personas/${row.id}`}
                    className="font-medium underline"
                  >
                    {row.name}
                  </Link>{" "}
                  — {row.needsReviewReason}
                </li>
              ))}
            </ul>
          </Callout>
        </div>
      ) : null}

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Personas" value={personaRows.length} />
        <Stat label="Approved version" value={approvedCount} />
        <Stat label="Approved segments" value={approvedSegments.length} />
        <Stat
          label="Awaiting a persona"
          value={withoutPersona.length}
          hint="approved segments with none yet"
        />
      </div>

      <Card className="mb-4">
        <CardHeader
          title={`${personaRows.length} persona${personaRows.length === 1 ? "" : "s"}`}
          description="Versions are immutable once approved; revising one creates a new version with the approved one as its parent."
        />

        {personaRows.length === 0 ? (
          <EmptyState
            title="No personas yet"
            description={
              approvedSegments.length === 0
                ? "Approve a candidate segment first — a persona inherits its segment's evidence and its coverage gaps."
                : "Generate a persona from one of the approved segments below."
            }
            action={
              approvedSegments.length === 0 ? (
                <Link
                  href={`/brands/${brandId}/segments`}
                  className="text-sm font-medium text-accent hover:underline"
                >
                  Go to candidate segments
                </Link>
              ) : null
            }
          />
        ) : (
          <ul className="divide-y divide-surface-border">
            {personaRows.map((row) => (
              <li key={row.id} className="px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <Link
                    href={`/brands/${brandId}/personas/${row.id}`}
                    className="min-w-0 flex-1 text-sm font-semibold text-ink hover:text-accent hover:underline"
                  >
                    {row.name}
                  </Link>
                  <div className="flex flex-wrap items-center gap-2">
                    <ConfidenceBar value={row.overallConfidence} />
                    {row.currentStatus ? <StatusBadge status={row.currentStatus} /> : null}
                    {row.approvedVersion ? (
                      <Badge tone="success" title="An approved, immutable version exists">
                        v{row.approvedVersion} approved
                      </Badge>
                    ) : null}
                  </div>
                </div>

                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-subtle">
                  <code>{row.slug}</code>
                  <span>
                    · version {row.currentVersion ?? "—"} of {row.versionCount}
                  </span>
                  {row.segmentLabel ? <span>· segment: {row.segmentLabel}</span> : null}
                  <span>
                    · {row.fieldCount} field{row.fieldCount === 1 ? "" : "s"}
                  </span>
                  {row.insufficientCount > 0 ? (
                    <Badge
                      tone="warn"
                      title="Fields with no supporting evidence, shown as gaps rather than filled in"
                    >
                      {row.insufficientCount} insufficient
                    </Badge>
                  ) : null}
                  {row.versionCount > 1 ? (
                    <Link
                      href={`/brands/${brandId}/personas/${row.id}/compare`}
                      className="font-medium text-accent hover:underline"
                    >
                      compare versions
                    </Link>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {canGenerate && withoutPersona.length > 0 ? (
        <Card>
          <CardHeader
            title="Approved segments awaiting a persona"
            description="Generating creates a draft version. Nothing that already exists is modified."
          />
          <ul className="divide-y divide-surface-border">
            {withoutPersona.map((segment) => (
              <li
                key={segment.id}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5"
              >
                <span className="min-w-0">
                  <Link
                    href={`/brands/${brandId}/segments/${segment.id}`}
                    className="text-sm font-medium text-ink hover:text-accent hover:underline"
                  >
                    {segment.label}
                  </Link>
                  <span className="ml-2 text-xs text-ink-subtle">
                    confidence {(segment.confidence * 100).toFixed(0)}%
                  </span>
                </span>
                <ActionForm
                  action={generatePersonaAction}
                  csrfToken={csrfToken}
                  hidden={{ brandId, segmentId: segment.id }}
                  className="space-y-0"
                >
                  <SubmitButton label="Generate persona" variant="secondary" size="sm" />
                </ActionForm>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </>
  );
}
