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
        description={`${startDate} to ${endDate} · ${detail.buckets.length} bucket${detail.buckets.length === 1 ? "" : "s"}`}
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

      <Card className="mb-4">
        <CardHeader
          title="Answer coverage estimate"
          description="Estimated by this app — not confirmed by Profound. Profound exposes no raw answer text, so this product judges likely coverage itself from the prompt's expected elements and its own retrieved evidence."
          actions={<OriginBadge origin="local" />}
        />
        <div className="space-y-3 px-4 py-3">
          {detail.answerCoverageEstimate ? (
            <>
              <KeyValue
                items={[
                  {
                    label: "Confidence",
                    value: formatPercent(detail.answerCoverageEstimate.confidence),
                  },
                  { label: "Model", value: detail.answerCoverageEstimate.modelId ?? "—" },
                  {
                    label: "Estimated at",
                    value: detail.answerCoverageEstimate.createdAt.toISOString().slice(0, 10),
                  },
                ]}
              />
              <p className="text-sm text-ink">{detail.answerCoverageEstimate.rationale}</p>
              <div>
                <p className="mb-1 text-2xs font-medium uppercase tracking-wide text-ink-muted">
                  Likely covered
                </p>
                {detail.answerCoverageEstimate.covered.length > 0 ? (
                  <Chips values={detail.answerCoverageEstimate.covered} />
                ) : (
                  <p className="text-sm text-ink-muted">None estimated as covered.</p>
                )}
              </div>
              <div>
                <p className="mb-1 text-2xs font-medium uppercase tracking-wide text-ink-muted">
                  Likely missing
                </p>
                {detail.answerCoverageEstimate.missing.length > 0 ? (
                  <Chips values={detail.answerCoverageEstimate.missing} tone="accent" />
                ) : (
                  <p className="text-sm text-ink-muted">None estimated as missing.</p>
                )}
              </div>
            </>
          ) : (
            <p className="text-sm text-ink-muted">
              No estimate yet for this prompt&apos;s current expected answer elements. It is
              computed by a background job after results are retrieved.
            </p>
          )}
        </div>
      </Card>

      {detail.buckets.length === 0 ? (
        <Card>
          <div className="px-4 py-6 text-sm text-ink-muted">
            No buckets in this range. Retrieve results from the performance page, or widen the date
            range.
          </div>
        </Card>
      ) : (
        <div className="space-y-4">
          {detail.buckets.map((bucket) => (
            <Card key={bucket.id}>
              <CardHeader
                title={`${bucket.bucketDate.toISOString().slice(0, 10)} · ${bucket.model ?? bucket.modelId}`}
                description={`${bucket.topic ?? "—"}${bucket.region ? ` · ${bucket.region}` : ""} · ${bucket.asset}`}
              />
              <div className="space-y-3 px-4 py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={bucket.classification === "brand_absent" ? "danger" : "success"}>
                    {CLASSIFICATION_LABEL[bucket.classification]}
                  </Badge>
                  <OriginBadge origin={bucket.dataOrigin} />
                  {bucket.competitorVisible === true ? (
                    <Badge tone="warn">Competitor visible</Badge>
                  ) : bucket.competitorVisible === null ? (
                    <Badge
                      tone="neutral"
                      title="Competitor asset scope was not requested for this retrieval"
                    >
                      Competitor visibility not measured
                    </Badge>
                  ) : null}
                </div>

                <KeyValue
                  items={[
                    { label: "Visibility score", value: formatPercent(bucket.visibilityScore) },
                    { label: "Share of voice", value: formatPercent(bucket.shareOfVoice) },
                    {
                      label: "Average position",
                      value: bucket.averagePosition != null ? bucket.averagePosition.toFixed(2) : "—",
                    },
                    { label: "Citations", value: bucket.citationCount ?? 0 },
                    { label: "Citation share", value: formatPercent(bucket.citationShare) },
                  ]}
                />

                {bucket.citations.length > 0 ? (
                  <div>
                    <p className="mb-1 text-2xs font-medium uppercase tracking-wide text-ink-muted">
                      Citations
                    </p>
                    <ul className="list-inside list-disc text-sm text-ink">
                      {bucket.citations.map((citation, index) => {
                        const domain = String((citation as { domain?: unknown }).domain ?? "—");
                        const count = (citation as { count?: unknown }).count;
                        return (
                          <li key={`${domain}-${index}`}>
                            {domain} — {typeof count === "number" ? count : 0} citation
                            {count === 1 ? "" : "s"}
                          </li>
                        );
                      })}
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
