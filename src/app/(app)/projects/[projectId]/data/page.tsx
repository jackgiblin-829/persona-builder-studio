import { generatePersonasAction, retrySourceAction } from "@/app/actions/projects";
import { AutoRefresh } from "@/components/auto-refresh";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { AudienceDescriptionForm, DataUploadForms } from "@/components/forms/data-forms";
import {
  Badge,
  BrandIcon,
  Callout,
  Card,
  CardHeader,
  PageHeader,
  StatusBadge,
} from "@/components/ui";
import { hasCapability, requireProjectAccess } from "@/lib/auth/context";
import { getCsrfToken } from "@/lib/auth/session";
import { getProjectWorkflowSummary } from "@/services/projects";
import { getPersonaGenerationPreflight } from "@/services/studio";

export const dynamic = "force-dynamic";

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
  const shouldRefresh =
    summary.sources.some((source) => source.progress < 100 && source.status !== "failed") ||
    latestRun?.status === "queued" ||
    latestRun?.status === "running";
  let preflight: Awaited<ReturnType<typeof getPersonaGenerationPreflight>> | null = null;
  let preflightError: string | null = null;
  if (summary.sources.length > 0) {
    try {
      preflight = await getPersonaGenerationPreflight(ctx);
    } catch (error) {
      preflightError = error instanceof Error ? error.message : "SparkToro preflight failed.";
    }
  }
  return (
    <>
      {shouldRefresh ? <AutoRefresh /> : null}
      <PageHeader
        title="Build personas"
        description="Add brand knowledge, define the audience in SparkToro, and let the studio do the rest."
        breadcrumb={`${summary.project.name} / Data`}
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

      <div className="mb-5 flex items-center gap-3 rounded-xl border border-surface-border bg-surface px-4 py-3">
        <span
          className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full ${
            summary.brandReadiness.score === 100
              ? "bg-observed-soft text-observed"
              : "bg-warn-soft text-warn"
          }`}
        >
          <BrandIcon
            name={summary.brandReadiness.score === 100 ? "check-circle" : "upload"}
            className="h-5 w-5"
          />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">
            {summary.brandReadiness.score === 100 ? "Ready to build" : "Research in progress"}
          </p>
          <p className="text-xs text-ink-muted">
            {summary.completedSourceCount} of {summary.sources.length} sources processed
            {summary.activePersonas.length
              ? ` · ${summary.activePersonas.length} current personas`
              : ""}
          </p>
        </div>
        <Badge tone={summary.brandReadiness.score === 100 ? "success" : "warn"}>
          {summary.brandReadiness.score === 100
            ? "ready"
            : `${summary.brandReadiness.score}% ready`}
        </Badge>
      </div>

      {canEdit ? (
        <div className="mb-5">
          <DataUploadForms projectId={projectId} csrfToken={csrfToken} />
        </div>
      ) : null}

      <Card className="mb-5">
        <CardHeader
          title="Sources"
          description="Uploads are parsed, redacted, and converted into usable evidence automatically. Build personas will also finish anything still pending."
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

      <Card className="mb-5">
        <CardHeader
          title="2. Define the SparkToro audience"
          description="SparkToro is the audience-research layer. Its aggregate behavior enriches your uploaded brand evidence."
        />
        <div className="p-4">
          <AudienceDescriptionForm
            projectId={projectId}
            csrfToken={csrfToken}
            value={summary.project.sparktoroAudienceDescription}
          />
        </div>
      </Card>

      <Card>
        <CardHeader
          title="3. Build personas"
          description="One action finishes pending sources, gathers SparkToro audience behavior, and creates three to five evidence-backed personas."
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
              <p>{preflightError ?? "Add a source to start."}</p>
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
                label={summary.activePersonas.length ? "Rebuild personas" : "Build personas"}
                pendingLabel="Processing evidence and building personas…"
                disabled={
                  summary.sources.length === 0 || Boolean(preflight && !preflight.sufficient)
                }
              />
            </ActionForm>
          ) : null}
        </div>
      </Card>
    </>
  );
}
