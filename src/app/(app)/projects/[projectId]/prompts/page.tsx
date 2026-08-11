import Link from "next/link";
import type { ReactNode } from "react";
import {
  applyPromptStrategySuggestionsAction,
  approveMarketResearchAction,
  approvePromptLibraryAction,
  editPromptAction,
  generatePromptsAction,
  regeneratePromptAction,
  refreshMarketResearchAction,
  reviewPromptAction,
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
  Select,
  StatusBadge,
  Textarea,
} from "@/components/ui";
import {
  buildCoverageBlueprint,
  FUNNEL_STAGE_LABELS,
  strategyReadiness,
} from "@/contracts/prompt-strategy";
import { researchBriefIsStale } from "@/contracts/market-research";
import { hasCapability, requireProjectAccess } from "@/lib/auth/context";
import { getCsrfToken } from "@/lib/auth/session";
import { listIntegrations } from "@/services/integrations";
import { listActivePersonas } from "@/services/personas";
import { getProjectWorkflowSummary } from "@/services/projects";
import { listLatestPromptSets } from "@/services/prompts";

export const dynamic = "force-dynamic";

const GEO_LABELS: Record<string, string> = {
  problem_discovery: "Problem discovery",
  foundational_education: "Foundational education",
  solution_recommendations: "Solution recommendations",
  comparisons_and_alternatives: "Comparisons and alternatives",
  evaluation_trust_and_proof: "Evaluation, trust, and proof",
  objections_and_risk: "Objections and risk",
  purchase_and_selection: "Purchase and selection",
  implementation_and_optimization: "Implementation and optimization",
};

function queryValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? (value[0] ?? "") : (value ?? "");
}

export default async function PromptsPage({
  params,
  searchParams,
}: {
  params: Promise<{ projectId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { projectId } = await params;
  const query = await searchParams;
  const ctx = await requireProjectAccess(projectId);
  const [sets, activePersonas, summary, csrfToken, integrations] = await Promise.all([
    listLatestPromptSets(ctx),
    listActivePersonas(ctx),
    getProjectWorkflowSummary(ctx),
    getCsrfToken(),
    listIntegrations(ctx),
  ]);
  const latest = summary.runs.find((run) => run.workflowType === "prompt_generation") ?? null;
  const latestResearch = summary.runs.find((run) => run.workflowType === "market_research") ?? null;
  const canGenerate = hasCapability(ctx, "prompt:generate");
  const canEditStrategy = hasCapability(ctx, "project:write");
  const totalPrompts = sets.reduce((total, set) => total + set.version.promptCount, 0);
  const totalClusters = sets.reduce((total, set) => total + set.version.clusterCount, 0);
  const promptRows = sets.flatMap((set) => set.clusters.flatMap((cluster) => cluster.prompts));
  const approvedCount = promptRows.filter((prompt) => prompt.reviewStatus === "approved").length;
  const needsRevisionCount = promptRows.filter(
    (prompt) => prompt.reviewStatus === "needs_revision",
  ).length;
  const readyCount = promptRows.filter((prompt) => prompt.reviewStatus === "ready").length;
  const averageQualityScore = promptRows.length
    ? Math.round(
        (promptRows.reduce((sum, prompt) => sum + prompt.qualityScore, 0) / promptRows.length) * 10,
      ) / 10
    : 0;
  const semanticRiskCount = promptRows.filter((prompt) => prompt.maximumSimilarity >= 0.86).length;
  const filters = {
    persona: queryValue(query.persona),
    funnelStage: queryValue(query.funnel_stage),
    promptType: queryValue(query.prompt_type),
    businessLine: queryValue(query.business_line),
    reviewStatus: queryValue(query.review_status),
  };
  const visibleSets = sets
    .filter((set) => !filters.persona || set.persona.slug === filters.persona)
    .map((set) => ({
      ...set,
      clusters: set.clusters
        .map((group) => ({
          ...group,
          prompts: group.prompts.filter(
            (prompt) =>
              (!filters.funnelStage || prompt.journeyStage === filters.funnelStage) &&
              (!filters.promptType || prompt.promptType === filters.promptType) &&
              (!filters.businessLine || prompt.businessLine === filters.businessLine) &&
              (!filters.reviewStatus || prompt.reviewStatus === filters.reviewStatus),
          ),
        }))
        .filter((group) => group.prompts.length > 0),
    }))
    .filter((set) => set.clusters.length > 0);
  const visiblePromptCount = visibleSets.reduce(
    (total, set) =>
      total +
      set.clusters.reduce((clusterTotal, cluster) => clusterTotal + cluster.prompts.length, 0),
    0,
  );
  const containsMock = sets.some((set) => set.version.dataOrigin === "mock");
  const openAiMode = integrations.find((item) => item.vendor === "openai")?.mode ?? "mock";
  const strategy = summary.project.promptStrategy;
  const expectedPromptCount = activePersonas.length * strategy.targetPromptCount;
  const approvedBrief = summary.approvedResearchBrief;
  const draftBrief = summary.draftResearchBrief;
  const researchIsStale = approvedBrief ? researchBriefIsStale(approvedBrief.staleAt) : false;
  const readiness = strategyReadiness(strategy);
  let blueprint = null;
  if (readiness.ready && activePersonas.length) {
    try {
      blueprint = buildCoverageBlueprint(
        strategy,
        activePersonas.map((item) => ({ slug: item.persona.slug, name: item.version.name })),
      );
    } catch {
      blueprint = null;
    }
  }
  return (
    <>
      <PageHeader
        title="Query Funnel baseline"
        description="Turn each evidence-backed persona into connected BOFU, MOFU, and TOFU prompts for downstream SEO and GEO strategy."
        breadcrumb={`${summary.project.name} / Query Funnels`}
        actions={
          <div className="flex gap-2">
            {sets.length &&
            (containsMock ||
              (approvedCount === expectedPromptCount &&
                totalPrompts === expectedPromptCount &&
                needsRevisionCount === 0)) ? (
              <ButtonLink
                href={`/projects/${projectId}/prompts/export.csv${containsMock ? "?demo=1" : ""}`}
                variant="secondary"
              >
                {containsMock ? "Download demo baseline" : "Export baseline CSV"}
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
                    openAiMode === "mock"
                      ? sets.length
                        ? "Refresh demo baseline"
                        : "Generate demo baseline"
                      : sets.length
                        ? "Refresh baseline"
                        : "Generate baseline"
                  }
                  pendingLabel="Starting…"
                  disabled={
                    !activePersonas.length ||
                    !readiness.ready ||
                    !blueprint ||
                    !approvedBrief ||
                    summary.project.promptStrategyEdited
                  }
                />
              </ActionForm>
            ) : null}
          </div>
        }
      />
      {openAiMode === "mock" ? (
        <div className="mb-4">
          <Callout tone="warn" title="Generation is in demo mode">
            Generation will use deterministic sample phrasing rather than a live model. Demo
            baselines can be downloaded for product testing, but are clearly labeled as mock data.
          </Callout>
        </div>
      ) : null}
      {latest && (latest.status === "running" || latest.status === "queued") ? (
        <div className="mb-4">
          <Callout tone="info" title="Generating Query Funnels">
            {latest.stage.replaceAll("_", " ")} · {latest.progress}%. Current completed sets remain
            exportable during generation.
          </Callout>
        </div>
      ) : null}
      {latestResearch &&
      (latestResearch.status === "running" || latestResearch.status === "queued") ? (
        <div className="mb-4">
          <Callout tone="info" title="Refreshing market research">
            The approved brief remains active while the cited replacement is built.
          </Callout>
        </div>
      ) : null}
      {latest?.status === "failed" ? (
        <div className="mb-4">
          <Callout tone="danger" title="Latest prompt run failed">
            {latest.errorMessage}. The previous completed sets are still active.
          </Callout>
        </div>
      ) : null}
      <MetricStrip
        className="mb-5"
        metrics={[
          { label: "Personas", value: activePersonas.length },
          { label: "Persona baselines", value: sets.length },
          { label: "Query pathways", value: totalClusters },
          { label: "Prompts", value: totalPrompts },
          { label: "Approved", value: approvedCount },
          {
            label: "Needs revision",
            value: needsRevisionCount,
            tone: needsRevisionCount ? "warn" : "success",
          },
          {
            label: "Average quality",
            value: promptRows.length ? `${averageQualityScore}/100` : "—",
          },
          { label: "Latest run", value: latest ? <StatusBadge status={latest.status} /> : "—" },
        ]}
      />
      <Card className="mb-5">
        <CardHeader
          title="Prompt grounding brief"
          description="Freeze the brand, category, competitor, and customer context used to generate the baseline. Refresh manually when the evidence changes."
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                tone={
                  draftBrief
                    ? "warn"
                    : approvedBrief && !researchIsStale && !summary.project.promptStrategyEdited
                      ? "success"
                      : "warn"
                }
              >
                {draftBrief
                  ? "draft ready"
                  : !approvedBrief
                    ? "approval required"
                    : researchIsStale
                      ? "stale"
                      : summary.project.promptStrategyEdited
                        ? "strategy changed"
                        : `approved v${approvedBrief.version}`}
              </Badge>
              {canEditStrategy ? (
                <ActionForm
                  action={refreshMarketResearchAction}
                  csrfToken={csrfToken}
                  hidden={{ projectId }}
                  className="space-y-0"
                >
                  <SubmitButton
                    label={approvedBrief ? "Refresh grounding" : "Build grounding brief"}
                    pendingLabel="Starting…"
                    size="sm"
                    variant="secondary"
                    disabled={Boolean(
                      latestResearch &&
                      (latestResearch.status === "running" || latestResearch.status === "queued"),
                    )}
                  />
                </ActionForm>
              ) : null}
            </div>
          }
        />
        <div className="space-y-4 p-4">
          {researchIsStale ? (
            <Callout tone="warn" title="Research is more than 30 days old">
              Refresh it before the next production baseline if competitors or product facts may
              have changed.
            </Callout>
          ) : null}
          {summary.project.promptStrategyEdited && approvedBrief ? (
            <Callout tone="warn" title="Strategy changed after approval">
              Refresh and approve the brief again before generating a production baseline.
            </Callout>
          ) : null}
          {draftBrief ? (
            <div className="rounded-lg border border-surface-border bg-surface-sunken p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-ink">Draft v{draftBrief.version}</p>
                  <p className="mt-1 max-w-4xl text-sm text-ink-muted">
                    {draftBrief.content.summary}
                  </p>
                  <p className="mt-2 text-xs text-ink-subtle">
                    {draftBrief.content.facts.length} cited facts · {draftBrief.dataOrigin} research
                  </p>
                </div>
                {canEditStrategy ? (
                  <ActionForm
                    action={approveMarketResearchAction}
                    csrfToken={csrfToken}
                    hidden={{ projectId, briefId: draftBrief.id }}
                    className="space-y-0"
                  >
                    <SubmitButton label="Approve and freeze" pendingLabel="Approving…" size="sm" />
                  </ActionForm>
                ) : null}
              </div>
              <div className="mt-3 grid gap-2 md:grid-cols-2">
                {draftBrief.content.facts.slice(0, 8).map((fact) => (
                  <a
                    key={fact.id}
                    href={fact.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded border border-surface-border bg-surface px-3 py-2 text-xs text-ink hover:underline"
                  >
                    {fact.claim}
                  </a>
                ))}
              </div>
            </div>
          ) : approvedBrief ? (
            <div>
              <p className="text-sm text-ink-muted">{approvedBrief.content.summary}</p>
              <p className="mt-2 text-xs text-ink-subtle">
                {approvedBrief.content.facts.length} cited facts · captured{" "}
                {approvedBrief.capturedAt.toLocaleDateString()} · stale warning{" "}
                {approvedBrief.staleAt.toLocaleDateString()}
              </p>
            </div>
          ) : (
            <Callout tone="warn" title="Grounding and approval required">
              Build and approve a cited grounding brief before generating production prompts.
            </Callout>
          )}
        </div>
      </Card>
      {sets.length ? (
        <Card className="mb-5">
          <CardHeader
            title="Baseline quality gate"
            description={`Production export requires ${strategy.targetPromptCount} linked prompts per persona, every prompt scoring 80 or higher, and human approval.`}
            actions={
              <Badge
                tone={
                  !containsMock &&
                  totalPrompts === expectedPromptCount &&
                  approvedCount === expectedPromptCount &&
                  needsRevisionCount === 0
                    ? "success"
                    : "warn"
                }
              >
                {!containsMock &&
                totalPrompts === expectedPromptCount &&
                approvedCount === expectedPromptCount &&
                needsRevisionCount === 0
                  ? "export ready"
                  : "blocked"}
              </Badge>
            }
          />
          <div className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-5">
            <QualityMetric
              label="Funnel cells"
              value={`${new Set(promptRows.map((prompt) => prompt.coverageKey)).size}/${expectedPromptCount}`}
            />
            <QualityMetric label="Passing drafts" value={String(readyCount + approvedCount)} />
            <QualityMetric label="Needs revision" value={String(needsRevisionCount)} />
            <QualityMetric label="Semantic risks" value={String(semanticRiskCount)} />
            <QualityMetric
              label="Human approved"
              value={`${approvedCount}/${expectedPromptCount}`}
            />
          </div>
        </Card>
      ) : null}
      {sets.length && canGenerate ? (
        <div className="mb-5 flex justify-end">
          <ActionForm
            action={approvePromptLibraryAction}
            csrfToken={csrfToken}
            hidden={{ projectId }}
            className="space-y-0"
          >
            <SubmitButton
              label="Approve all quality-passed prompts"
              pendingLabel="Approving…"
              variant="secondary"
            />
          </ActionForm>
        </div>
      ) : null}
      <Card className="mb-5">
        <CardHeader
          title="Query Funnel strategy"
          description="Approve the brand, category, competitor, buyer context, and bottom-up funnel shape used for every persona."
          actions={
            <Badge tone={readiness.ready && blueprint ? "success" : "warn"}>
              {readiness.ready && blueprint ? "ready" : "needs review"}
            </Badge>
          }
        />
        <div className="border-b border-surface-border p-4">
          {canEditStrategy ? (
            <div className="mb-4 flex justify-end">
              <ActionForm
                action={applyPromptStrategySuggestionsAction}
                csrfToken={csrfToken}
                hidden={{ projectId }}
                className="space-y-0"
              >
                <SubmitButton
                  label="Apply suggestions from research"
                  pendingLabel="Reviewing signals…"
                  variant="secondary"
                  size="sm"
                />
              </ActionForm>
            </div>
          ) : null}
          {readiness.blockers.length ? (
            <div className="mb-4">
              <Callout tone="warn" title="Complete before generating">
                {readiness.blockers.join(" ")}
              </Callout>
            </div>
          ) : null}
          {blueprint ? (
            <div className="mb-5 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
              <QualityMetric
                label="Pathways per persona"
                value={String(strategy.pathwaysPerPersona)}
              />
              <QualityMetric label="BOFU anchors" value={String(strategy.funnelTargets.decision)} />
              <QualityMetric
                label="MOFU evaluations"
                value={String(strategy.funnelTargets.consideration)}
              />
              <QualityMetric
                label="TOFU awareness"
                value={String(strategy.funnelTargets.awareness)}
              />
            </div>
          ) : null}
          {canEditStrategy ? (
            <PromptStrategyForm projectId={projectId} csrfToken={csrfToken} strategy={strategy} />
          ) : (
            <p className="text-sm text-ink-muted">
              Your role can review this strategy and export approved live prompts, but cannot edit
              generation inputs.
            </p>
          )}
        </div>
      </Card>
      {sets.length ? (
        <Card className="mb-5">
          <div className="p-4">
            <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-6 lg:items-end">
              <FilterField label="Persona" name="persona" value={filters.persona}>
                {sets.map((set) => (
                  <option key={set.persona.slug} value={set.persona.slug}>
                    {set.persona.name}
                  </option>
                ))}
              </FilterField>
              <FilterField label="Funnel stage" name="funnel_stage" value={filters.funnelStage}>
                {Object.entries(FUNNEL_STAGE_LABELS).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </FilterField>
              <FilterField label="Prompt type" name="prompt_type" value={filters.promptType}>
                {[...new Set(promptRows.map((prompt) => prompt.promptType))].sort().map((value) => (
                  <option key={value} value={value}>
                    {value.replaceAll("_", " ")}
                  </option>
                ))}
              </FilterField>
              <FilterField label="Business line" name="business_line" value={filters.businessLine}>
                {[...new Set(promptRows.map((prompt) => prompt.businessLine))]
                  .sort()
                  .map((value) => (
                    <option key={value} value={value}>
                      {value}
                    </option>
                  ))}
              </FilterField>
              <FilterField label="Review status" name="review_status" value={filters.reviewStatus}>
                {["ready", "needs_revision", "approved", "excluded"].map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </FilterField>
              <div className="flex items-center gap-2">
                <Button type="submit" size="sm" variant="secondary">
                  Filter
                </Button>
                <Link className="text-xs underline" href={`/projects/${projectId}/prompts`}>
                  Clear
                </Link>
              </div>
            </form>
            <p className="mt-3 text-xs text-ink-subtle">
              Showing {visiblePromptCount} of {totalPrompts} prompts.
            </p>
          </div>
        </Card>
      ) : null}
      {!activePersonas.length ? (
        <Card>
          <EmptyState
            title="Generate personas first"
            description="Query Funnel generation uses the active persona profiles and their linked research signals."
            action={
              <ButtonLink href={`/projects/${projectId}/personas`} variant="primary" size="sm">
                Go to Personas
              </ButtonLink>
            }
          />
        </Card>
      ) : !sets.length ? (
        <Card>
          <EmptyState
            title="No Query Funnels yet"
            description="Approve the grounding brief and strategy, then generate a linked prompt baseline for every active persona."
          />
        </Card>
      ) : !visibleSets.length ? (
        <Card>
          <EmptyState
            title="No prompts match these filters"
            description="Clear one or more filters to return to the complete baseline."
            action={
              <ButtonLink href={`/projects/${projectId}/prompts`} variant="secondary" size="sm">
                Clear filters
              </ButtonLink>
            }
          />
        </Card>
      ) : (
        <div className="space-y-5">
          {visibleSets.map((set, setIndex) => (
            <details key={set.set.id} className="card overflow-hidden" open={setIndex === 0}>
              <summary className="flex cursor-pointer list-none flex-wrap items-start justify-between gap-3 px-4 py-4">
                <div>
                  <h2 className="text-sm font-semibold text-ink">{set.persona.name}</h2>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    {set.version.clusterCount} query pathways · {set.version.promptCount} prompts ·
                    baseline v{set.version.version} · {set.version.dataOrigin} generation
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={set.version.dataOrigin === "mock" ? "warn" : "success"}>
                    latest completed
                  </Badge>
                  <span className="text-xs font-medium text-ink-muted">View pathways</span>
                </div>
              </summary>
              <div className="divide-y divide-surface-border">
                {set.clusters.map(({ cluster, prompts }, pathwayIndex) => (
                  <details
                    key={cluster.id}
                    className="border-t border-surface-border"
                    open={setIndex === 0 && pathwayIndex === 0}
                  >
                    <summary className="cursor-pointer list-none bg-surface px-4 py-4 hover:bg-surface-sunken">
                      <h3 className="text-sm font-semibold text-ink">{cluster.title}</h3>
                      <p className="mt-0.5 text-xs text-ink-muted">{cluster.informationNeed}</p>
                      <div className="mt-2 flex flex-wrap gap-2">
                        {(["decision", "consideration", "awareness"] as const).map((stage) => (
                          <Badge key={stage} tone={stage === "decision" ? "accent" : "neutral"}>
                            {FUNNEL_STAGE_LABELS[stage]} ·{" "}
                            {prompts.filter((prompt) => prompt.journeyStage === stage).length}
                          </Badge>
                        ))}
                      </div>
                    </summary>
                    <ol className="space-y-2 border-t border-surface-border bg-surface p-4">
                      {prompts.map((prompt) => (
                        <li
                          key={prompt.id}
                          className="rounded-lg border border-surface-border bg-surface-sunken px-3 py-3"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <p className="max-w-4xl text-sm leading-6 text-ink">
                              {prompt.promptText}
                            </p>
                            <Badge tone="accent">
                              {FUNNEL_STAGE_LABELS[
                                prompt.journeyStage as keyof typeof FUNNEL_STAGE_LABELS
                              ] ?? prompt.journeyStage}
                            </Badge>
                          </div>
                          <p className="mt-1 text-2xs text-ink-subtle">
                            {prompt.parentCoverageKey
                              ? `follows ${prompt.parentCoverageKey} · `
                              : "conversion anchor · "}
                            {prompt.signalIds.length} research refs ·{" "}
                            {prompt.promptType.replaceAll("_", " ")} ·{" "}
                            {prompt.questionArchetype.replaceAll("_", " ")} ·{" "}
                            {GEO_LABELS[prompt.geoCategory] ?? prompt.geoCategory} ·{" "}
                            {prompt.businessLine}
                          </p>
                          <p className="mt-1 text-2xs text-ink-subtle">
                            Quality {Math.round(prompt.qualityScore)}/100 · maximum similarity{" "}
                            {Math.round(prompt.maximumSimilarity * 100)}%
                          </p>
                          {prompt.evaluatorExplanation ? (
                            <p className="mt-1 text-xs text-ink-muted">
                              {prompt.evaluatorExplanation}
                            </p>
                          ) : null}
                          {canGenerate ? (
                            <details className="mt-2 rounded border border-surface-border bg-surface p-2">
                              <summary className="cursor-pointer text-xs font-medium text-ink">
                                Edit or regenerate this prompt
                              </summary>
                              <div className="mt-3 grid gap-3 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
                                <ActionForm
                                  action={editPromptAction}
                                  csrfToken={csrfToken}
                                  hidden={{ projectId, promptId: prompt.id }}
                                >
                                  <Textarea
                                    name="promptText"
                                    defaultValue={prompt.promptText}
                                    rows={3}
                                    aria-label="Prompt text"
                                  />
                                  <SubmitButton
                                    label="Save draft"
                                    pendingLabel="Saving…"
                                    size="sm"
                                    variant="secondary"
                                  />
                                </ActionForm>
                                <ActionForm
                                  action={regeneratePromptAction}
                                  csrfToken={csrfToken}
                                  hidden={{ projectId, promptId: prompt.id }}
                                  className="space-y-0"
                                >
                                  <SubmitButton
                                    label="Regenerate and score"
                                    pendingLabel="Generating…"
                                    size="sm"
                                    variant="secondary"
                                  />
                                </ActionForm>
                              </div>
                            </details>
                          ) : null}
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <Badge
                              tone={
                                prompt.reviewStatus === "approved"
                                  ? "success"
                                  : prompt.reviewStatus === "excluded"
                                    ? "danger"
                                    : "neutral"
                              }
                            >
                              {prompt.reviewStatus}
                            </Badge>
                            {canGenerate ? (
                              <>
                                {prompt.reviewStatus !== "approved" &&
                                prompt.reviewStatus !== "needs_revision" &&
                                prompt.qualityScore >= 80 ? (
                                  <ActionForm
                                    action={reviewPromptAction}
                                    csrfToken={csrfToken}
                                    hidden={{ projectId, promptId: prompt.id, status: "approved" }}
                                    className="space-y-0"
                                  >
                                    <SubmitButton label="Approve" size="sm" variant="secondary" />
                                  </ActionForm>
                                ) : null}
                                {prompt.reviewStatus !== "excluded" ? (
                                  <ActionForm
                                    action={reviewPromptAction}
                                    csrfToken={csrfToken}
                                    hidden={{ projectId, promptId: prompt.id, status: "excluded" }}
                                    className="space-y-0"
                                  >
                                    <SubmitButton label="Exclude" size="sm" variant="secondary" />
                                  </ActionForm>
                                ) : (
                                  <ActionForm
                                    action={reviewPromptAction}
                                    csrfToken={csrfToken}
                                    hidden={{ projectId, promptId: prompt.id, status: "ready" }}
                                    className="space-y-0"
                                  >
                                    <SubmitButton label="Restore" size="sm" variant="secondary" />
                                  </ActionForm>
                                )}
                              </>
                            ) : null}
                          </div>
                        </li>
                      ))}
                    </ol>
                  </details>
                ))}
              </div>
            </details>
          ))}
        </div>
      )}
      <p className="mt-4 text-xs text-ink-subtle">
        The baseline CSV preserves persona, pathway, prompt and parent IDs, funnel stage, intent,
        brand mode, business line, evidence references, quality score, research snapshot, version,
        market, and language. CSV values use RFC 4180 quoting and spreadsheet-formula protection.
      </p>
    </>
  );
}

function FilterField({
  label,
  name,
  value,
  children,
}: {
  label: string;
  name: string;
  value: string;
  children: ReactNode;
}) {
  return (
    <label className="text-xs font-medium text-ink">
      <span className="mb-1 block">{label}</span>
      <Select name={name} defaultValue={value}>
        <option value="">All</option>
        {children}
      </Select>
    </label>
  );
}

function QualityMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-surface-border px-3 py-2">
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="text-lg font-semibold text-ink">{value}</p>
    </div>
  );
}
