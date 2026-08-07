import { startResultRetrievalAction } from "@/app/actions/profound-results";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import {
  Badge,
  Button,
  ButtonLink,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  Stat,
} from "@/components/ui";
import { hasCapability, requireBrandAccess } from "@/lib/auth/context";
import { getCsrfToken } from "@/lib/auth/session";
import { getProfoundConnection } from "@/services/profound-config";
import { listDeployableSets } from "@/services/profound-links";
import { getControlComparison, getPerformancePanel } from "@/services/profound-results";

export const dynamic = "force-dynamic";

function defaultDate(daysAgo: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

function formatPercent(value: number | null): string {
  return value == null ? "—" : `${(value * 100).toFixed(1)}%`;
}

export default async function ProfoundPerformancePage({
  params,
  searchParams,
}: {
  params: Promise<{ brandId: string }>;
  searchParams: Promise<{
    startDate?: string;
    endDate?: string;
    modelId?: string;
    region?: string;
    personaVersionId?: string;
    promptSetVersionId?: string;
  }>;
}) {
  const { brandId } = await params;
  const sp = await searchParams;
  const ctx = await requireBrandAccess(brandId);

  const startDate = sp.startDate ?? defaultDate(29);
  const endDate = sp.endDate ?? defaultDate(0);
  const base = `/brands/${brandId}/profound/performance`;

  const [connection, deployableSets, csrfToken] = await Promise.all([
    getProfoundConnection(ctx),
    listDeployableSets(ctx),
    getCsrfToken(),
  ]);

  if (!connection || !connection.configuration) {
    return (
      <>
        <PageHeader
          title="Persona performance"
          description="Retrieve what Profound measured for the prompts this brand has deployed."
          breadcrumb={`${ctx.brandName} / Profound / Performance`}
        />
        <Card>
          <EmptyState
            title="Profound is not connected"
            description="Connect Profound and retrieve its configuration on the mapping screen before results can be retrieved."
          />
        </Card>
      </>
    );
  }

  const canRetrieve = hasCapability(ctx, "profound:retrieve_results");

  const panel = await getPerformancePanel(ctx, {
    startDate,
    endDate,
    modelId: sp.modelId || undefined,
    region: sp.region || undefined,
    personaVersionId: sp.personaVersionId || undefined,
  });

  const promptSetVersionId = sp.promptSetVersionId || deployableSets[0]?.versionId;
  const comparison = promptSetVersionId
    ? await getControlComparison(ctx, { promptSetVersionId, startDate, endDate })
    : { pairs: [] };

  const promptCount = panel.personas.reduce((sum, group) => sum + group.prompts.length, 0);

  return (
    <>
      <PageHeader
        title="Persona performance"
        description="Retrieval only ever covers prompts this brand has actually deployed to Profound. Snapshots are immutable — retrieving an overlapping range again never changes a run once stored."
        breadcrumb={`${ctx.brandName} / Profound / Performance`}
      />

      <Card className="mb-4">
        <CardHeader
          title="Retrieve results"
          description="Pulls visibility, citations, sentiment and raw answers for every linked prompt over the range below."
        />
        <div className="px-4 py-3">
          {canRetrieve ? (
            <ActionForm
              action={startResultRetrievalAction}
              csrfToken={csrfToken}
              hidden={{ brandId, startDate, endDate }}
              className="space-y-0"
            >
              <SubmitButton label={`Retrieve ${startDate} to ${endDate}`} />
            </ActionForm>
          ) : (
            <p className="text-sm text-ink-muted">
              Retrieving results requires an editor-level role.
            </p>
          )}
        </div>
      </Card>

      <Card className="mb-4">
        <CardHeader title="Filters" />
        <form method="GET" className="grid grid-cols-2 gap-3 px-4 py-3 sm:grid-cols-5">
          <Field label="Start date" htmlFor="startDate">
            <Input type="date" id="startDate" name="startDate" defaultValue={startDate} />
          </Field>
          <Field label="End date" htmlFor="endDate">
            <Input type="date" id="endDate" name="endDate" defaultValue={endDate} />
          </Field>
          <Field label="Model" htmlFor="modelId">
            <Select id="modelId" name="modelId" defaultValue={sp.modelId ?? ""}>
              <option value="">All models</option>
              {connection.configuration.models.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Region" htmlFor="region">
            <Select id="region" name="region" defaultValue={sp.region ?? ""}>
              <option value="">All regions</option>
              {connection.configuration.regions.map((region) => (
                <option key={region.code} value={region.code}>
                  {region.name}
                </option>
              ))}
            </Select>
          </Field>
          <div className="flex items-end">
            <Button type="submit" variant="secondary" size="sm">
              Apply filters
            </Button>
          </div>
        </form>
      </Card>

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Prompts with results" value={promptCount} />
        <Stat label="Brand-absent" value={panel.brandAbsentCount} />
        <Stat label="Competitor-dominated" value={panel.competitorDominatedCount} />
        <Stat label="Missing expected elements" value={panel.missingElementsCount} />
      </div>

      {panel.personas.length === 0 ? (
        <Card className="mb-4">
          <EmptyState
            title="No results yet"
            description="Retrieve results for this range, or widen the date range if results already exist."
          />
        </Card>
      ) : (
        panel.personas.map((group) => (
          <Card key={group.personaId} className="mb-4">
            <CardHeader
              title={group.personaName}
              description={`${group.metrics.runCount} run${group.metrics.runCount === 1 ? "" : "s"} · avg visibility ${formatPercent(group.metrics.visibilityScore)} · avg share of voice ${formatPercent(group.metrics.shareOfVoice)}`}
            />
            <ul className="divide-y divide-surface-border">
              {group.prompts.map((prompt) => (
                <li key={prompt.promptId} className="px-4 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <Badge tone={prompt.promptType === "persona" ? "accent" : "neutral"}>
                          {prompt.promptType === "persona" ? "Persona" : "Generic control"}
                        </Badge>
                        {prompt.classification === "brand_absent" ? (
                          <Badge tone="danger">Brand absent</Badge>
                        ) : null}
                        {prompt.classification === "competitor_dominated" ? (
                          <Badge tone="warn">Competitor-dominated</Badge>
                        ) : null}
                        {prompt.missingElements.length > 0 ? (
                          <Badge tone="warn">
                            {prompt.missingElements.length} missing element
                            {prompt.missingElements.length === 1 ? "" : "s"}
                          </Badge>
                        ) : null}
                      </div>
                      <p className="text-sm text-ink">{prompt.promptText}</p>
                      <p className="mt-1 text-xs text-ink-subtle">
                        Visibility {formatPercent(prompt.metrics.visibilityScore)} · Share of voice{" "}
                        {formatPercent(prompt.metrics.shareOfVoice)} · Mentions{" "}
                        {prompt.metrics.mentionCount} · Citations {prompt.metrics.citationCount} ·{" "}
                        {prompt.metrics.runCount} run{prompt.metrics.runCount === 1 ? "" : "s"} ·
                        Profound id {prompt.profoundPromptId}
                      </p>
                    </div>
                    <ButtonLink
                      href={`${base}/prompts/${prompt.promptId}?startDate=${startDate}&endDate=${endDate}`}
                      size="sm"
                    >
                      Inspect answers
                    </ButtonLink>
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        ))
      )}

      <Card>
        <CardHeader
          title="Persona vs generic-control comparison"
          description="Each persona prompt against its paired generic-control question over the same window."
        />
        <div className="px-4 py-3">
          {deployableSets.length === 0 ? (
            <p className="text-sm text-ink-muted">No approved prompt sets to compare yet.</p>
          ) : (
            <>
              <form method="GET" className="mb-3 flex flex-wrap items-end gap-2">
                <input type="hidden" name="startDate" value={startDate} />
                <input type="hidden" name="endDate" value={endDate} />
                <Field label="Prompt set" htmlFor="promptSetVersionId">
                  <Select
                    id="promptSetVersionId"
                    name="promptSetVersionId"
                    defaultValue={promptSetVersionId ?? ""}
                  >
                    {deployableSets.map((set) => (
                      <option key={set.versionId} value={set.versionId}>
                        {set.promptSetName} v{set.version} — {set.personaName}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Button type="submit" variant="secondary" size="sm">
                  Load comparison
                </Button>
              </form>

              {comparison.pairs.length === 0 ? (
                <p className="text-sm text-ink-muted">
                  No persona/control pairs have results in this range yet.
                </p>
              ) : (
                <ul className="divide-y divide-surface-border">
                  {comparison.pairs.map((pair) => (
                    <li key={pair.personaPromptId} className="py-3">
                      <p className="text-sm text-ink">{pair.personaPromptText}</p>
                      <p className="text-xs text-ink-subtle">
                        vs. control: {pair.controlPromptText}
                      </p>
                      <p className="mt-1 text-xs">
                        Persona share of voice {formatPercent(pair.persona.shareOfVoice)} vs control{" "}
                        {formatPercent(pair.control.shareOfVoice)}
                        {" · "}
                        {pair.personaOutperforms ? (
                          <Badge tone="success">
                            Outperforms control
                            {pair.liftPercent != null ? ` (+${pair.liftPercent.toFixed(0)}%)` : ""}
                          </Badge>
                        ) : (
                          <Badge tone="warn">Does not outperform control</Badge>
                        )}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      </Card>
    </>
  );
}
