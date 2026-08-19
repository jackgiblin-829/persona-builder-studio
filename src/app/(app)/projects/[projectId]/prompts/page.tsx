import {
  applyPromptStrategySuggestionsAction,
  generatePromptsAction,
} from "@/app/actions/projects";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { PromptStrategyForm } from "@/components/forms/prompt-strategy-form";
import {
  Badge,
  BrandIcon,
  ButtonLink,
  Callout,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
} from "@/components/ui";
import { SEARCH_STAGE_LABELS, strategyReadiness } from "@/contracts/prompt-strategy";
import { hasCapability, requireProjectAccess } from "@/lib/auth/context";
import { getCsrfToken } from "@/lib/auth/session";
import { listIntegrations } from "@/services/integrations";
import { listActivePersonas } from "@/services/personas";
import { getProjectWorkflowSummary } from "@/services/projects";
import { listLatestPromptDraftSets, listLatestPromptSets } from "@/services/prompts";

export const dynamic = "force-dynamic";

const GENERATION_STAGE_LABELS: Record<string, string> = {
  queued: "preparing evidence",
  creating_clusters: "planning search topics",
  creating_prompts: "writing realistic search questions",
  validating: "checking quality and duplicates",
  ready: "ready",
};

export default async function PromptsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const ctx = await requireProjectAccess(projectId);
  const [sets, draftSets, activePersonas, summary, csrfToken, integrations] = await Promise.all([
    listLatestPromptSets(ctx),
    listLatestPromptDraftSets(ctx),
    listActivePersonas(ctx),
    getProjectWorkflowSummary(ctx),
    getCsrfToken(),
    listIntegrations(ctx),
  ]);

  const latest = summary.runs.find((run) => run.workflowType === "prompt_generation") ?? null;
  const canGenerate = hasCapability(ctx, "prompt:generate");
  const canEditSettings = hasCapability(ctx, "project:write");
  const strategy = summary.project.promptStrategy;
  const readiness = strategyReadiness(strategy);
  const promptRows = sets.flatMap((set) => set.clusters.flatMap((cluster) => cluster.prompts));
  const draftRows = draftSets.flatMap((set) => set.clusters.flatMap((cluster) => cluster.prompts));
  const draftNeedsRevision = draftRows.filter(
    (prompt) => prompt.reviewStatus === "needs_revision",
  ).length;
  const draftContainsMock = draftSets.some((set) => set.version.dataOrigin === "mock");
  const totalPrompts = promptRows.length;
  const approvedCount = promptRows.filter((prompt) => prompt.reviewStatus === "approved").length;
  const needsRevisionCount = promptRows.filter(
    (prompt) => prompt.reviewStatus === "needs_revision",
  ).length;
  const unbrandedCount = promptRows.filter((prompt) => prompt.promptType === "unbranded").length;
  const unbrandedShare = totalPrompts ? Math.round((unbrandedCount / totalPrompts) * 100) : 0;
  const containsMock = sets.some((set) => set.version.dataOrigin === "mock");
  const openAiMode = integrations.find((item) => item.vendor === "openai")?.mode ?? "mock";
  const expectedPromptCount = activePersonas.length * strategy.targetPromptCount;
  const exportReady = Boolean(
    sets.length &&
    (containsMock ||
      (approvedCount === expectedPromptCount &&
        totalPrompts === expectedPromptCount &&
        needsRevisionCount === 0)),
  );
  const isRunning = Boolean(latest && (latest.status === "running" || latest.status === "queued"));
  const exportHref = `/projects/${projectId}/prompts/export.xlsx${containsMock ? "?demo=1" : ""}`;
  const draftExportHref = `/projects/${projectId}/prompts/export.xlsx?draft=1${draftContainsMock ? "&demo=1" : ""}`;

  return (
    <>
      <PageHeader
        title="Prompt Taxonomy"
        description="Create a client-ready workbook of natural questions your audiences would realistically ask in search and AI assistants."
        breadcrumb={`${summary.project.name} / Prompt Taxonomy`}
        actions={
          <div className="flex flex-wrap gap-2">
            {exportReady ? (
              <ButtonLink href={exportHref} variant="secondary" download>
                {containsMock ? "Download demo workbook" : "Download prompt workbook"}
              </ButtonLink>
            ) : draftRows.length ? (
              <ButtonLink href={draftExportHref} variant="secondary" download>
                Download draft workbook
              </ButtonLink>
            ) : null}
            {canGenerate ? (
              <ActionForm
                action={generatePromptsAction}
                csrfToken={csrfToken}
                hidden={{ projectId }}
                className="space-y-0"
              >
                <SubmitButton
                  label={
                    sets.length
                      ? "Regenerate taxonomy"
                      : openAiMode === "mock"
                        ? "Create demo prompt taxonomy"
                        : "Create prompt taxonomy"
                  }
                  pendingLabel="Writing realistic search questions…"
                  disabled={!activePersonas.length || isRunning}
                />
              </ActionForm>
            ) : null}
          </div>
        }
      />

      {openAiMode === "mock" ? (
        <div className="mb-4">
          <Callout tone="warn" title="Generation is in demo mode">
            The studio will create deterministic sample searches. The workbook remains available for
            product testing and is clearly labeled as demo data.
          </Callout>
        </div>
      ) : null}

      {isRunning && latest ? (
        <div className="mb-4">
          <Callout tone="info" title="Creating prompt taxonomy">
            {GENERATION_STAGE_LABELS[latest.stage] ?? latest.stage.replaceAll("_", " ")} ·{" "}
            {latest.progress}%. The workbook download appears automatically after quality checks
            pass.
          </Callout>
        </div>
      ) : null}

      {latest?.status === "failed" ? (
        <div className="mb-4">
          <Callout tone="danger" title="Latest prompt run failed">
            {latest.errorMessage}. Any previously completed workbook remains available.
          </Callout>
        </div>
      ) : null}

      {draftNeedsRevision ? (
        <div className="mb-4">
          <Callout tone="warn" title="Latest draft needs another pass">
            {draftNeedsRevision} search question{draftNeedsRevision === 1 ? "" : "s"} did not pass
            the realism or quality checks. Refresh the taxonomy after adjusting the workbook inputs;
            the previous approved workbook remains unchanged.
          </Callout>
        </div>
      ) : null}

      {sets.length ? (
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-surface-border bg-surface px-4 py-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-observed-soft text-observed">
            <BrandIcon name="check-circle" className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-ink">Workbook ready</p>
            <p className="text-xs text-ink-muted">
              {totalPrompts} quality-checked questions · {unbrandedShare}% unbranded ·{" "}
              {activePersonas.length} personas
            </p>
          </div>
          <Badge tone="success">approved</Badge>
        </div>
      ) : null}

      <Card className="mb-5">
        <details open={!sets.length || !readiness.ready}>
          <summary className="cursor-pointer list-none px-4 py-4 [&::-webkit-details-marker]:hidden">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-ink">Prompt workbook setup</h2>
                <p className="mt-0.5 text-xs text-ink-muted">
                  Products, audiences, markets, competitors, and tracking context.
                </p>
              </div>
              <Badge tone={readiness.ready ? "success" : "warn"}>
                {readiness.ready ? "ready" : "needs inputs"}
              </Badge>
            </div>
          </summary>
          <div className="border-t border-surface-border p-4">
            {canEditSettings ? (
              <div className="mb-4 flex justify-end">
                <ActionForm
                  action={applyPromptStrategySuggestionsAction}
                  csrfToken={csrfToken}
                  hidden={{ projectId }}
                  className="space-y-0"
                >
                  <SubmitButton
                    label="Fill from evidence"
                    pendingLabel="Reviewing evidence…"
                    variant="secondary"
                    size="sm"
                  />
                </ActionForm>
              </div>
            ) : null}
            {readiness.blockers.length ? (
              <div className="mb-4">
                <Callout tone="warn" title="Complete these inputs before creating the workbook">
                  {readiness.blockers.join(" ")}
                </Callout>
              </div>
            ) : null}
            {canEditSettings ? (
              <PromptStrategyForm
                projectId={projectId}
                csrfToken={csrfToken}
                strategy={strategy}
                primaryMarket={summary.project.primaryMarket}
              />
            ) : (
              <p className="text-sm text-ink-muted">
                Your role can review the settings and download an approved workbook, but cannot edit
                generation inputs.
              </p>
            )}
          </div>
        </details>
      </Card>

      {!activePersonas.length ? (
        <Card>
          <EmptyState
            title="Generate personas first"
            description="The prompt taxonomy uses active persona needs and customer language to create realistic searches."
            action={
              <ButtonLink href={`/projects/${projectId}/personas`} variant="primary" size="sm">
                Go to Personas
              </ButtonLink>
            }
          />
        </Card>
      ) : sets.length ? (
        <Card>
          <CardHeader
            title="Sample questions"
            description={`A preview of 8 of ${totalPrompts} deduplicated questions. The workbook contains the complete taxonomy and tracking plan.`}
          />
          <div className="divide-y divide-surface-border">
            {promptRows.slice(0, 8).map((prompt) => (
              <div
                key={prompt.id}
                className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start sm:justify-between"
              >
                <p className="max-w-4xl text-sm leading-6 text-ink">{prompt.promptText}</p>
                <div className="flex shrink-0 flex-wrap gap-2">
                  <Badge tone={prompt.promptType === "unbranded" ? "success" : "neutral"}>
                    {prompt.promptType.replaceAll("_", " ")}
                  </Badge>
                  <Badge tone="accent">
                    {SEARCH_STAGE_LABELS[prompt.journeyStage as keyof typeof SEARCH_STAGE_LABELS] ??
                      prompt.journeyStage}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : (
        <Card>
          <EmptyState
            title="No prompt workbook yet"
            description="Review the workbook setup, then use Create prompt taxonomy. The download button will appear automatically when the realistic-search and quality checks pass."
          />
        </Card>
      )}
    </>
  );
}
