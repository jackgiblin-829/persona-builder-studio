import { notFound } from "next/navigation";
import { Badge, Card, CardHeader, Chips, KeyValue, OriginBadge, PageHeader } from "@/components/ui";
import { requireBrandAccess } from "@/lib/auth/context";
import { NotFoundError } from "@/lib/errors";
import { getPromptResultDetail } from "@/services/profound-results";

export const dynamic = "force-dynamic";

function defaultDate(daysAgo: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

function formatPercent(value: number | null): string {
  return value == null ? "—" : `${(value * 100).toFixed(1)}%`;
}

const CLASSIFICATION_LABEL: Record<string, string> = {
  brand_absent: "Brand absent",
  competitor_dominated: "Competitor-dominated",
  normal: "Normal",
};

export default async function ProfoundPromptResultDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ brandId: string; promptId: string }>;
  searchParams: Promise<{ startDate?: string; endDate?: string }>;
}) {
  const { brandId, promptId } = await params;
  const sp = await searchParams;
  const ctx = await requireBrandAccess(brandId);

  const startDate = sp.startDate ?? defaultDate(29);
  const endDate = sp.endDate ?? defaultDate(0);

  let detail;
  try {
    detail = await getPromptResultDetail(ctx, promptId, { startDate, endDate });
  } catch (error) {
    if (error instanceof NotFoundError) notFound();
    throw error;
  }

  return (
    <>
      <PageHeader
        title={detail.prompt.text}
        description={`${startDate} to ${endDate} · ${detail.runs.length} run${detail.runs.length === 1 ? "" : "s"}`}
        breadcrumb={`${ctx.brandName} / Profound / Performance / ${promptId}`}
      />

      <Card className="mb-4">
        <CardHeader
          title="Profound identifiers"
          description="For cross-referencing this prompt directly in the Profound account."
        />
        <div className="px-4 py-3">
          <KeyValue
            items={[
              { label: "Topic", value: detail.prompt.topic },
              { label: "Profound prompt id", value: detail.profoundPromptId ?? "—" },
              { label: "Profound category id", value: detail.profoundCategoryId ?? "—" },
              {
                label: "Expected answer elements",
                value: detail.prompt.expectedAnswerElements.length ? (
                  <Chips values={detail.prompt.expectedAnswerElements} />
                ) : (
                  "—"
                ),
              },
            ]}
          />
        </div>
      </Card>

      {detail.runs.length === 0 ? (
        <Card>
          <div className="px-4 py-6 text-sm text-ink-muted">
            No runs in this range. Retrieve results from the performance page, or widen the date
            range.
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          {detail.runs.map((run) => (
            <Card key={run.id}>
              <CardHeader
                title={`${run.runDate.toISOString().slice(0, 10)} · ${run.model ?? run.modelId}`}
                description={`Run ${run.runId}${run.region ? ` · ${run.region}` : ""}${run.asset ? ` · ${run.asset}` : ""}`}
              />
              <div className="space-y-3 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge
                    tone={
                      run.classification === "brand_absent"
                        ? "danger"
                        : run.classification === "competitor_dominated"
                          ? "warn"
                          : "success"
                    }
                  >
                    {CLASSIFICATION_LABEL[run.classification]}
                  </Badge>
                  <OriginBadge origin={run.dataOrigin} />
                  {run.missingElements.length > 0 ? (
                    <Badge tone="warn">Missing: {run.missingElements.join(", ")}</Badge>
                  ) : null}
                </div>

                <KeyValue
                  items={[
                    { label: "Visibility score", value: formatPercent(run.visibilityScore) },
                    { label: "Share of voice", value: formatPercent(run.shareOfVoice) },
                    { label: "Mentions", value: run.mentionCount ?? 0 },
                    { label: "Executions", value: run.executions ?? 0 },
                    {
                      label: "Average position",
                      value: run.averagePosition != null ? run.averagePosition.toFixed(2) : "—",
                    },
                    { label: "Citations", value: run.citationCount ?? 0 },
                    { label: "Citation share", value: formatPercent(run.citationShare) },
                  ]}
                />

                {run.mentions.length > 0 ? (
                  <div>
                    <p className="mb-1 text-2xs font-medium uppercase tracking-wide text-ink-muted">
                      Other entities mentioned
                    </p>
                    <ul className="text-sm text-ink">
                      {run.mentions.map((mention, index) => {
                        const entity = String((mention as { entity?: unknown }).entity ?? "—");
                        const share = (mention as { share?: unknown }).share;
                        return (
                          <li key={`${entity}-${index}`}>
                            {entity} — {typeof share === "number" ? formatPercent(share) : "—"}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : null}

                <div>
                  <p className="mb-1 text-2xs font-medium uppercase tracking-wide text-ink-muted">
                    Raw answer
                  </p>
                  <p className="whitespace-pre-wrap text-sm text-ink">
                    {run.rawAnswer ?? "No answer text was returned for this run."}
                  </p>
                </div>

                {run.citations.length > 0 ? (
                  <div>
                    <p className="mb-1 text-2xs font-medium uppercase tracking-wide text-ink-muted">
                      Citations
                    </p>
                    <ul className="list-inside list-disc text-sm text-ink">
                      {run.citations.map((citation, index) => (
                        <li key={index}>
                          {String((citation as { title?: unknown }).title ?? "Untitled")} —{" "}
                          {String((citation as { domain?: unknown }).domain ?? "")}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                {run.sentimentThemes.length > 0 ? (
                  <div>
                    <p className="mb-1 text-2xs font-medium uppercase tracking-wide text-ink-muted">
                      Sentiment themes
                    </p>
                    <ul className="text-sm text-ink">
                      {run.sentimentThemes.map((theme, index) => (
                        <li key={index}>
                          {String((theme as { theme?: unknown }).theme ?? "")} —{" "}
                          {String((theme as { sentiment?: unknown }).sentiment ?? "")}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
