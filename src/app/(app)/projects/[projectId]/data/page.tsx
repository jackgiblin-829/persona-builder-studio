import Link from "next/link";
import { generatePersonasAction, retrySourceAction } from "@/app/actions/projects";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { AudienceDescriptionForm, DataUploadForms } from "@/components/forms/data-forms";
import {
  Badge,
  Callout,
  Card,
  CardHeader,
  MetricStrip,
  PageHeader,
  StatusBadge,
  WorkflowStepper,
} from "@/components/ui";
import { hasCapability, requireProjectAccess } from "@/lib/auth/context";
import { getCsrfToken } from "@/lib/auth/session";
import { getProjectWorkflowSummary } from "@/services/projects";
import { getPersonaGenerationPreflight } from "@/services/studio";

export const dynamic = "force-dynamic";

const STAGE_ORDER = [
  "processing_sources",
  "researching_audience",
  "identifying_segments",
  "creating_personas",
  "ready",
];

export default async function ProjectDataPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const ctx = await requireProjectAccess(projectId);
  const [summary, csrfToken] = await Promise.all([getProjectWorkflowSummary(ctx), getCsrfToken()]);
  const latestRun = summary.runs.find((run) => run.workflowType === "persona_generation") ?? null;
  const canEdit = hasCapability(ctx, "source:upload");
  let preflight: Awaited<ReturnType<typeof getPersonaGenerationPreflight>> | null = null;
  let preflightError: string | null = null;
  if (summary.completedSourceCount > 0) {
    try {
      preflight = await getPersonaGenerationPreflight(ctx);
    } catch (error) {
      preflightError = error instanceof Error ? error.message : "SparkToro preflight failed.";
    }
  }
  const activeStage =
    latestRun?.status === "running" || latestRun?.status === "queued" ? latestRun.stage : null;
  const activeIndex = activeStage ? STAGE_ORDER.indexOf(activeStage) : -1;
  return (
    <>
      <PageHeader
        title="Data"
        description="Upload research, refine the audience, and generate the active persona set with one intentional action."
        breadcrumb={`${summary.project.name} / Data`}
        actions={
          <Link href={`/projects/${projectId}/data`} className="text-sm text-ink-muted underline">
            Refresh status
          </Link>
        }
      />

      {summary.newDataAvailable ? (
        <div className="mb-4">
          <Callout tone="warn" title="New data available">
            New completed sources are not in the active persona set yet. Generate personas once when
            you are ready to replace it.
          </Callout>
        </div>
      ) : null}
      {latestRun?.status === "failed" ? (
        <div className="mb-4">
          <Callout tone="danger" title="Persona generation failed">
            {latestRun.errorMessage ??
              "The previous run failed. The last complete persona set is still active."}
          </Callout>
        </div>
      ) : null}

      <MetricStrip
        className="mb-4"
        metrics={[
          { label: "Sources", value: summary.sources.length },
          { label: "Ready", value: summary.completedSourceCount, tone: "success" },
          { label: "Source revision", value: summary.project.sourceRevision },
          { label: "Active persona revision", value: summary.project.activePersonaRevision },
          { label: "Market", value: summary.project.primaryMarket },
        ]}
      />

      <div className="mb-5 grid gap-4 xl:grid-cols-[minmax(0,1.4fr)_minmax(20rem,0.8fr)]">
        <Card>
          <CardHeader
            title="Workflow status"
            description="One consolidated view from source processing through an atomically switched persona set."
          />
          <WorkflowStepper
            stages={STAGE_ORDER.map((stage, index) => ({
              label: stage.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
              detail: activeStage === stage ? `${latestRun?.progress ?? 0}% complete` : undefined,
              status:
                latestRun?.status === "failed" && latestRun.stage === stage
                  ? "blocked"
                  : activeStage === stage
                    ? "running"
                    : latestRun?.status === "completed" ||
                        latestRun?.status === "completed_with_warnings" ||
                        index < activeIndex
                      ? "done"
                      : stage === "processing_sources" && summary.completedSourceCount > 0
                        ? "done"
                        : "waiting",
            }))}
          />
        </Card>
        <Card>
          <CardHeader
            title="SparkToro audience"
            description="Aggregate audience data is never presented as an individual persona trait."
          />
          <div className="p-4">
            <AudienceDescriptionForm
              projectId={projectId}
              csrfToken={csrfToken}
              value={summary.project.sparktoroAudienceDescription}
            />
          </div>
        </Card>
      </div>

      {canEdit ? (
        <div className="mb-5">
          <DataUploadForms projectId={projectId} csrfToken={csrfToken} />
        </div>
      ) : null}

      <Card className="mb-5">
        <CardHeader
          title="Sources"
          description="Each file moves through parsing, PII redaction, and research-signal extraction automatically."
        />
        {summary.sources.length ? (
          <div className="divide-y divide-surface-border">
            {summary.sources.map((source) => (
              <div
                key={source.id}
                className="grid gap-3 px-4 py-4 md:grid-cols-[minmax(0,1fr)_12rem_8rem_auto] md:items-center"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink">{source.label}</p>
                  <p className="text-xs text-ink-muted">
                    {source.sourceType.replaceAll("_", " ")} · {source.documentCount} documents ·{" "}
                    {source.signalCount} signals · {source.piiRedactionCount} redactions
                  </p>
                  {source.warningMessage ? (
                    <p className="mt-1 text-xs text-warn">{source.warningMessage}</p>
                  ) : null}
                  {source.errorMessage ? (
                    <p className="mt-1 text-xs text-danger">{source.errorMessage}</p>
                  ) : null}
                </div>
                <div>
                  <div className="h-2 overflow-hidden rounded-full bg-surface-sunken">
                    <div className="h-full bg-accent" style={{ width: `${source.progress}%` }} />
                  </div>
                  <p className="mt-1 text-xs text-ink-subtle">
                    {source.stage.replaceAll("_", " ")}
                  </p>
                </div>
                <StatusBadge status={source.status} />
                {source.status === "failed" && canEdit ? (
                  <ActionForm
                    action={retrySourceAction}
                    csrfToken={csrfToken}
                    hidden={{ projectId, sourceId: source.id }}
                    className="space-y-0"
                  >
                    <SubmitButton label="Retry" size="sm" variant="secondary" />
                  </ActionForm>
                ) : (
                  <span />
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="p-5 text-sm text-ink-muted">Add at least one source to begin.</p>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Generate personas"
          description="Creates three to five descriptive personas and replaces the active set only after the complete run succeeds."
          actions={
            preflight?.cached ? (
              <Badge tone="success">SparkToro cache hit</Badge>
            ) : (
              <Badge tone="neutral">up to 41 SparkToro credits</Badge>
            )
          }
        />
        <div className="flex flex-wrap items-center justify-between gap-4 p-4">
          <div className="text-sm text-ink-muted">
            {preflight ? (
              <p>
                {preflight.cached
                  ? "This audience report will be reused at no additional SparkToro cost."
                  : `${preflight.balance} credits available · maximum estimated spend ${preflight.maximumSpend}.`}
              </p>
            ) : (
              <p>
                {preflightError ?? "Complete a source to enable generation and credit preflight."}
              </p>
            )}
          </div>
          {canEdit ? (
            <ActionForm
              action={generatePersonasAction}
              csrfToken={csrfToken}
              hidden={{ projectId }}
              className="space-y-0"
            >
              <SubmitButton
                label={summary.activePersonas.length ? "Regenerate personas" : "Generate personas"}
                pendingLabel="Starting…"
                disabled={
                  summary.completedSourceCount === 0 || Boolean(preflight && !preflight.sufficient)
                }
              />
            </ActionForm>
          ) : null}
        </div>
      </Card>
    </>
  );
}
