import Link from "next/link";
import {
  decideSegmentAction,
  generatePersonaAction,
  generateSegmentsAction,
  mergeSegmentsAction,
} from "@/app/actions/segments";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { ConfidencePanel } from "@/components/confidence-panel";
import {
  Badge,
  Callout,
  Card,
  CardHeader,
  Checkbox,
  Chips,
  EmptyState,
  OriginBadge,
  PageHeader,
  Select,
  Stat,
  StatusBadge,
} from "@/components/ui";
import { hasCapability, requireBrandAccess } from "@/lib/auth/context";
import { getCsrfToken } from "@/lib/auth/session";
import { getEvidenceCounts } from "@/services/evidence";
import {
  activeSegmentationJobs,
  getRunCoverage,
  listSegmentRuns,
  listSegments,
  MIN_APPROVED_EVIDENCE_FOR_SEGMENTATION,
} from "@/services/segments";

export const dynamic = "force-dynamic";

export default async function SegmentsPage({
  params,
  searchParams,
}: {
  params: Promise<{ brandId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { brandId } = await params;
  const query = await searchParams;
  const requestedRun = typeof query.runId === "string" ? query.runId : undefined;

  const ctx = await requireBrandAccess(brandId);
  const [runs, evidenceCounts, jobsInFlight, csrfToken] = await Promise.all([
    listSegmentRuns(ctx),
    getEvidenceCounts(ctx),
    activeSegmentationJobs(ctx),
    getCsrfToken(),
  ]);

  const { runId, segments } = await listSegments(ctx, requestedRun);
  const coverage = runId ? await getRunCoverage(ctx, runId) : null;
  const canGenerate = hasCapability(ctx, "segment:generate");
  const approvedEvidence = evidenceCounts.approved ?? 0;
  const enoughEvidence = approvedEvidence >= MIN_APPROVED_EVIDENCE_FOR_SEGMENTATION;

  const live = segments.filter(
    (segment) => segment.status !== "merged" && segment.status !== "split",
  );
  const mergeCandidates = live.filter((segment) => segment.status !== "rejected");

  return (
    <>
      <PageHeader
        title="Candidate segments"
        description="A segment is a recurring difference that changes what someone needs to know — not a demographic label. Each candidate shows the evidence for and against it, what it does not cover, and why it would change the prompts you track."
        breadcrumb={`${ctx.brandName} / Personas`}
        actions={
          canGenerate ? (
            <ActionForm
              action={generateSegmentsAction}
              csrfToken={csrfToken}
              hidden={{ brandId }}
              className="space-y-0"
            >
              <SubmitButton
                label={runs.length === 0 ? "Generate candidate segments" : "Generate a new run"}
                pendingLabel="Queueing…"
                confirm={
                  runs.length === 0
                    ? undefined
                    : "Start a new segmentation run? Previous runs and their decisions are kept."
                }
              />
            </ActionForm>
          ) : null
        }
      />

      {!enoughEvidence ? (
        <div className="mb-4">
          <Callout tone="warn" title="Not enough approved evidence yet">
            Segmentation needs at least {MIN_APPROVED_EVIDENCE_FOR_SEGMENTATION} approved evidence
            records; this brand has {approvedEvidence}. Approve evidence in the{" "}
            <Link href={`/brands/${brandId}/evidence`} className="font-medium underline">
              evidence explorer
            </Link>{" "}
            first — segmenting a handful of records produces noise, not insight.
          </Callout>
        </div>
      ) : null}

      {jobsInFlight.length > 0 ? (
        <div className="mb-4">
          <Callout
            tone={jobsInFlight.some((job) => job.status === "failed") ? "danger" : "info"}
            title="Generation in progress"
          >
            <ul className="space-y-0.5">
              {jobsInFlight.map((job) => (
                <li key={job.id} className="text-xs">
                  <StatusBadge status={job.status} /> {job.id} · attempt {job.attempts}
                  {job.lastError ? ` · ${job.lastError}` : ""}
                </li>
              ))}
            </ul>
            <p className="mt-1 text-xs">
              The worker processes these in the background. Reload this page, or watch{" "}
              <Link href={`/brands/${brandId}/jobs`} className="font-medium underline">
                job status
              </Link>
              .
            </p>
          </Callout>
        </div>
      ) : null}

      {runs.length === 0 ? (
        <Card>
          <EmptyState
            title="No segmentation run yet"
            description={
              enoughEvidence
                ? "Generate a run to see between three and seven candidate segments, each with its supporting and contradicting evidence, coverage gaps and overlap with the others."
                : `Approve at least ${MIN_APPROVED_EVIDENCE_FOR_SEGMENTATION} evidence records, then generate a run.`
            }
          />
        </Card>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Stat label="Candidates" value={segments.length} />
            <Stat
              label="Approved"
              value={segments.filter((segment) => segment.status === "approved").length}
            />
            <Stat
              label="Rejected"
              value={segments.filter((segment) => segment.status === "rejected").length}
            />
            <Stat
              label="Evidence assigned"
              value={coverage ? coverage.assigned : "—"}
              hint={coverage ? `of ${coverage.approved} approved` : undefined}
            />
            <Stat
              label="Unassigned"
              value={coverage ? coverage.unassigned : "—"}
              hint="never forced into a segment"
            />
          </div>

          {runs.length > 1 ? (
            <Card className="mb-4">
              <CardHeader
                title="Runs"
                description="Each run is stored separately. Selecting an older run shows exactly what was proposed then."
              />
              <ul className="divide-y divide-surface-border">
                {runs.map((run) => (
                  <li
                    key={run.runId}
                    className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm"
                  >
                    <Link
                      href={`/brands/${brandId}/segments?runId=${run.runId}`}
                      className={
                        run.runId === runId
                          ? "font-semibold text-accent-ink"
                          : "text-ink hover:text-accent hover:underline"
                      }
                    >
                      {run.generatedAt.toISOString().slice(0, 16).replace("T", " ")}
                    </Link>
                    <span className="text-xs text-ink-muted">
                      {run.candidateCount} candidates · {run.approvedCount} approved ·{" "}
                      {run.rejectedCount} rejected
                    </span>
                    <OriginBadge origin={run.dataOrigin} />
                    {run.runId === runId ? <Badge tone="accent">viewing</Badge> : null}
                    <span className="ml-auto text-2xs text-ink-subtle">
                      {run.modelId ?? "—"}
                      {run.generatedByName ? ` · ${run.generatedByName}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          {coverage && coverage.unassigned > 0 ? (
            <div className="mb-4">
              <Callout tone="info">
                {coverage.unassigned} approved record
                {coverage.unassigned === 1 ? "" : "s"} support no candidate in this run. That is the
                intended behaviour: aggregate search demand and one-off observations are evidence of
                interest, not of a distinct buyer.{" "}
                <Link
                  href={`/brands/${brandId}/evidence?segmentLabel=`}
                  className="font-medium underline"
                >
                  Review them in the explorer
                </Link>
                .
              </Callout>
            </div>
          ) : null}

          <div className="space-y-4">
            {segments.map((segment) => (
              <Card key={segment.id}>
                <CardHeader
                  title={
                    <span className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/brands/${brandId}/segments/${segment.id}`}
                        className="hover:text-accent hover:underline"
                      >
                        {segment.label}
                      </Link>
                      <StatusBadge status={segment.status} />
                      <code className="text-2xs font-normal text-ink-subtle">{segment.slug}</code>
                    </span>
                  }
                  description={`${segment.supportingCount} supporting · ${segment.contradictingCount} contradicting · covers ${(segment.evidenceCoverage * 100).toFixed(0)}% of approved evidence${segment.unavailableCount > 0 ? ` · ${segment.unavailableCount} cited record(s) unavailable` : ""}`}
                  actions={
                    <div className="flex flex-wrap items-center gap-2">
                      {segment.personaId ? (
                        <Link
                          href={`/brands/${brandId}/personas/${segment.personaId}`}
                          className="text-xs font-medium text-accent hover:underline"
                        >
                          Persona: {segment.personaName}
                        </Link>
                      ) : null}

                      {canGenerate && segment.status === "candidate" ? (
                        <>
                          <ActionForm
                            action={decideSegmentAction}
                            csrfToken={csrfToken}
                            hidden={{ brandId, segmentId: segment.id, decision: "approved" }}
                            className="space-y-0"
                          >
                            <SubmitButton label="Approve" variant="secondary" size="sm" />
                          </ActionForm>
                          <ActionForm
                            action={decideSegmentAction}
                            csrfToken={csrfToken}
                            hidden={{ brandId, segmentId: segment.id, decision: "rejected" }}
                            className="space-y-0"
                          >
                            <SubmitButton label="Reject" variant="ghost" size="sm" />
                          </ActionForm>
                        </>
                      ) : null}

                      {canGenerate &&
                      (segment.status === "approved" || segment.status === "rejected") ? (
                        <ActionForm
                          action={decideSegmentAction}
                          csrfToken={csrfToken}
                          hidden={{ brandId, segmentId: segment.id, decision: "candidate" }}
                          className="space-y-0"
                        >
                          <SubmitButton label="Undo decision" variant="ghost" size="sm" />
                        </ActionForm>
                      ) : null}

                      {canGenerate && segment.status === "approved" ? (
                        <ActionForm
                          action={generatePersonaAction}
                          csrfToken={csrfToken}
                          hidden={{ brandId, segmentId: segment.id }}
                          className="space-y-0"
                        >
                          <SubmitButton
                            label={segment.personaId ? "Regenerate persona" : "Generate persona"}
                            size="sm"
                            confirm={
                              segment.personaId
                                ? "Generate a new persona version from this segment? Existing versions are kept."
                                : undefined
                            }
                          />
                        </ActionForm>
                      ) : null}
                    </div>
                  }
                />

                <div className="space-y-3 px-4 py-3">
                  <p className="text-sm text-ink">{segment.definition}</p>

                  <div>
                    <p className="text-2xs font-semibold uppercase tracking-wide text-ink-muted">
                      Distinguishing variables
                    </p>
                    <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-ink-muted">
                      {segment.distinguishingVariables.map((variable) => (
                        <li key={variable}>{variable}</li>
                      ))}
                    </ul>
                  </div>

                  <div>
                    <p className="text-2xs font-semibold uppercase tracking-wide text-ink-muted">
                      Why it changes prompts or content
                    </p>
                    <p className="mt-1 text-sm text-ink-muted">{segment.whyItChangesPrompts}</p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div>
                      <p className="text-2xs font-semibold uppercase tracking-wide text-ink-muted">
                        Source distribution
                      </p>
                      {Object.keys(segment.sourceDistribution).length === 0 ? (
                        <p className="mt-1 text-sm text-ink-subtle">—</p>
                      ) : (
                        <Chips
                          values={Object.entries(segment.sourceDistribution).map(
                            ([source, n]) => `${source} (${n})`,
                          )}
                        />
                      )}
                    </div>
                    <div>
                      <p className="text-2xs font-semibold uppercase tracking-wide text-ink-muted">
                        Overlap with other candidates
                      </p>
                      {segment.overlaps.length === 0 ? (
                        <p className="mt-1 text-sm text-ink-subtle">
                          No meaningful overlap with the other candidates.
                        </p>
                      ) : (
                        <ul className="mt-1 space-y-0.5 text-sm text-ink-muted">
                          {segment.overlaps.map((overlap) => (
                            <li key={overlap.segmentSlug}>
                              <code className="text-xs">{overlap.segmentSlug}</code> —{" "}
                              {(overlap.degree * 100).toFixed(0)}% shared. {overlap.note}
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </div>

                  {segment.coverageGaps.length > 0 ? (
                    <div>
                      <p className="text-2xs font-semibold uppercase tracking-wide text-warn">
                        Coverage gaps
                      </p>
                      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm text-ink-muted">
                        {segment.coverageGaps.map((gap) => (
                          <li key={gap}>{gap}</li>
                        ))}
                      </ul>
                    </div>
                  ) : null}

                  {segment.mergeSplitRecommendation ? (
                    <Callout tone="info" title="Merge or split recommendation">
                      {segment.mergeSplitRecommendation}
                    </Callout>
                  ) : null}

                  <ConfidencePanel
                    score={segment.confidence}
                    components={segment.confidenceComponents}
                    explanation={segment.confidenceExplanation}
                  />

                  <p className="text-2xs text-ink-subtle">
                    Model {segment.modelId ?? "—"} · template {segment.promptTemplateVersion ?? "—"}{" "}
                    · schema {segment.schemaVersion ?? "—"} · cutoff{" "}
                    {segment.evidenceCutoff?.toISOString().slice(0, 10) ?? "—"} ·{" "}
                    <Link
                      href={`/brands/${brandId}/segments/${segment.id}`}
                      className="font-medium text-accent hover:underline"
                    >
                      open to edit, split or read the evidence
                    </Link>
                  </p>
                </div>
              </Card>
            ))}
          </div>

          {canGenerate && mergeCandidates.length >= 2 ? (
            <Card className="mt-4">
              <CardHeader
                title="Merge candidates"
                description="Merging unions the evidence onto the target and marks the others merged. Nothing is deleted, and the target's confidence is recomputed from the combined evidence."
              />
              <div className="px-4 py-3">
                <ActionForm action={mergeSegmentsAction} csrfToken={csrfToken} hidden={{ brandId }}>
                  <div>
                    <label className="label" htmlFor="merge-target">
                      Merge into
                    </label>
                    <Select id="merge-target" name="targetId" className="max-w-md">
                      {mergeCandidates.map((segment) => (
                        <option key={segment.id} value={segment.id}>
                          {segment.label}
                        </option>
                      ))}
                    </Select>
                  </div>

                  <fieldset>
                    <legend className="label">Candidates to merge in</legend>
                    <div className="mt-1 space-y-1.5">
                      {mergeCandidates.map((segment) => (
                        <Checkbox
                          key={segment.id}
                          name="sourceIds"
                          value={segment.id}
                          label={segment.label}
                          hint={`${segment.supportingCount} supporting records`}
                        />
                      ))}
                    </div>
                  </fieldset>

                  <SubmitButton
                    label="Merge selected"
                    variant="secondary"
                    confirm="Merge the selected candidates into the target? The sources are kept and marked merged."
                  />
                </ActionForm>
              </div>
            </Card>
          ) : null}
        </>
      )}
    </>
  );
}
