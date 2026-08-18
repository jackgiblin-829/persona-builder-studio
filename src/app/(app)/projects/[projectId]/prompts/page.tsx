import {
  applyPromptStrategySuggestionsAction,
  generatePromptsAction,
} from "@/app/actions/projects";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { PromptStrategyForm } from "@/components/forms/prompt-strategy-form";
import {
  Badge,
  Button,
  ButtonLink,
  Callout,
  Card,
  CardHeader,
  EmptyState,
  MetricStrip,
  PageHeader,
  StatusBadge,
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
            ) : (
              <Button
                variant="secondary"
                disabled
                title="Create the prompt taxonomy to enable the workbook download."
              >
                Download workbook
              </Button>
            )}
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
                      ? "Refresh prompt taxonomy"
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

      <MetricStrip
        className="mb-5"
        metrics={[
          { label: "Personas", value: activePersonas.length },
          { label: "Search questions", value: totalPrompts },
          { label: "Unbranded", value: totalPrompts ? `${unbrandedShare}%` : "—" },
          { label: "Approved", value: approvedCount },
          {
            label: "Needs work",
            value: needsRevisionCount + draftNeedsRevision,
            tone: needsRevisionCount + draftNeedsRevision ? "warn" : "success",
          },
          { label: "Latest run", value: latest ? <StatusBadge status={latest.status} /> : "—" },
        ]}
      />

      <Card className="mb-5">
        <div className="grid gap-3 p-4 md:grid-cols-3">
          {[
            [
              "1",
              "Use real audience language",
              "Ground topics in persona questions, uploaded research, category terms, and buyer vocabulary.",
            ],
            [
              "2",
              "Write realistic searches",
              "Create concise discovery, comparison, cost, risk, brand, and selection questions a person would actually type.",
            ],
            [
              "3",
              "Package the workbook",
              "Deduplicate, score, organize, and export the approved questions as a client-ready taxonomy.",
            ],
          ].map(([number, title, description]) => (
            <div key={number} className="rounded-lg border border-surface-border p-3">
              <p className="text-2xs font-bold uppercase tracking-wide text-accent">
                Step {number}
              </p>
              <p className="mt-1 text-sm font-semibold text-ink">{title}</p>
              <p className="mt-1 text-xs leading-5 text-ink-muted">{description}</p>
            </div>
          ))}
        </div>
      </Card>

      <Card className="mb-5">
        <CardHeader
          title="Prompt workbook setup"
          description="Define the products, audiences, markets, competitors, and tracking context the exported search questions should cover."
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={readiness.ready ? "success" : "warn"}>
                {readiness.ready ? "ready" : "needs inputs"}
              </Badge>
              {canEditSettings ? (
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
              ) : null}
            </div>
          }
        />
        <div className="p-4">
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
            title={exportReady ? "Prompt workbook ready" : "Latest approved search questions"}
            description={`${totalPrompts} deduplicated questions across ${activePersonas.length} personas. The preview is intentionally brief; the workbook contains the complete taxonomy and tracking plan.`}
            actions={
              exportReady ? (
                <ButtonLink href={exportHref} variant="primary" size="sm" download>
                  {containsMock ? "Download demo workbook" : "Download workbook"}
                </ButtonLink>
              ) : draftRows.length ? (
                <ButtonLink href={draftExportHref} variant="primary" size="sm" download>
                  Download draft workbook
                </ButtonLink>
              ) : null
            }
          />
          <div className="divide-y divide-surface-border">
            {promptRows.slice(0, 12).map((prompt) => (
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
