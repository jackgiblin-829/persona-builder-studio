import Link from "next/link";
import { reviewEvidenceAction } from "@/app/actions/evidence";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { EvidenceFilters } from "@/components/evidence-filters";
import {
  Badge,
  Callout,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  ProvenanceBadge,
  Stat,
  StatusBadge,
} from "@/components/ui";
import { hasCapability, requireBrandAccess } from "@/lib/auth/context";
import { getCsrfToken } from "@/lib/auth/session";
import {
  evidenceFilterSchema,
  getEvidenceCounts,
  getEvidenceFacets,
  listEvidence,
} from "@/services/evidence";

export const dynamic = "force-dynamic";

export default async function EvidenceExplorerPage({
  params,
  searchParams,
}: {
  params: Promise<{ brandId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { brandId } = await params;
  const rawParams = await searchParams;
  const ctx = await requireBrandAccess(brandId);

  const parsed = evidenceFilterSchema.safeParse(
    Object.fromEntries(
      Object.entries(rawParams)
        .map(([key, value]) => [key, Array.isArray(value) ? value[0] : value])
        .filter(([, value]) => value !== undefined && value !== ""),
    ),
  );
  const filter = parsed.success ? parsed.data : evidenceFilterSchema.parse({});

  const [result, facets, counts, csrfToken] = await Promise.all([
    listEvidence(ctx, filter),
    getEvidenceFacets(ctx),
    getEvidenceCounts(ctx),
    getCsrfToken(),
  ]);

  const canReview = hasCapability(ctx, "evidence:review");
  const totalPages = Math.max(1, Math.ceil(result.total / result.pageSize));

  return (
    <>
      <PageHeader
        title="Evidence explorer"
        description="Every persona claim and every prompt traces back to records here. Provenance is never inferred from convenience — observed evidence, external support and model inference stay distinct."
        breadcrumb={`${ctx.brandName} / Evidence`}
      />

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Total" value={counts.total ?? 0} />
        <Stat label="Approved" value={counts.approved ?? 0} />
        <Stat label="Pending review" value={counts.pending_review ?? 0} />
        <Stat label="Rejected" value={counts.rejected ?? 0} />
        <Stat label="Needs review" value={counts.needs_review ?? 0} />
      </div>

      <div className="mb-4">
        <EvidenceFilters brandId={brandId} facets={facets} current={filter} />
      </div>

      {result.notice ? (
        <div className="mb-4">
          <Callout tone="info">{result.notice}</Callout>
        </div>
      ) : null}

      <Card>
        <CardHeader
          title={`${result.total} record${result.total === 1 ? "" : "s"}`}
          description={
            filter.searchMode === "semantic" && filter.q
              ? "Ranked by embedding similarity. Only records embedded with the current model are comparable."
              : "Ranked by observed date."
          }
          actions={
            canReview && result.rows.length > 0 ? (
              <ActionForm
                action={reviewEvidenceAction}
                csrfToken={csrfToken}
                hidden={{
                  brandId,
                  decision: "approved",
                  evidenceIds: result.rows.map((row) => row.id).join(","),
                }}
                className="space-y-0"
              >
                <SubmitButton
                  label={`Approve all ${result.rows.length} shown`}
                  variant="secondary"
                  size="sm"
                  confirm={`Approve all ${result.rows.length} records currently shown?`}
                />
              </ActionForm>
            ) : null
          }
        />

        {result.rows.length === 0 ? (
          <EmptyState
            title="No matching evidence"
            description={
              (counts.total ?? 0) === 0
                ? "No evidence has been extracted yet. Add a data source and the pipeline will parse, redact, chunk, extract and embed it."
                : "No records match these filters. Clear a filter or widen the search."
            }
          />
        ) : (
          <ul className="divide-y divide-surface-border">
            {result.rows.map((row) => (
              <li key={row.id} className="px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <Link
                    href={`/brands/${brandId}/evidence/${row.id}`}
                    className="min-w-0 flex-1 text-sm font-medium text-ink hover:text-accent hover:underline"
                  >
                    {row.normalizedClaim}
                  </Link>
                  <div className="flex flex-wrap items-center gap-1">
                    {typeof row.similarity === "number" ? (
                      <Badge tone="accent" title="Cosine similarity to your query">
                        {(row.similarity * 100).toFixed(0)}% match
                      </Badge>
                    ) : null}
                    <ProvenanceBadge provenance={row.provenance} />
                    <Badge tone="neutral">{row.category.replace(/_/g, " ")}</Badge>
                    <StatusBadge status={row.reviewStatus} />
                    {row.availability === "source_deleted" ? (
                      <Badge
                        tone="danger"
                        title="The source was deleted; this record is retained but unavailable"
                      >
                        source deleted
                      </Badge>
                    ) : null}
                  </div>
                </div>

                <p className="mt-1 line-clamp-2 text-sm text-ink-muted">“{row.redactedText}”</p>

                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-subtle">
                  <span>{row.sourceLabel}</span>
                  <span>· {row.sourceLocation}</span>
                  {row.speaker ? <span>· {row.speaker}</span> : null}
                  <span>· {row.journeyStage.replace(/_/g, " ")}</span>
                  <span>· {row.sentiment}</span>
                  {row.observedAt ? (
                    <span>· {row.observedAt.toISOString().slice(0, 10)}</span>
                  ) : null}
                  {row.piiStatus !== "none" ? (
                    <Badge tone="warn" title="Personal information was detected and replaced">
                      pii {row.piiStatus}
                    </Badge>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}

        {totalPages > 1 ? (
          <nav
            className="flex items-center justify-between border-t border-surface-border px-4 py-2 text-sm"
            aria-label="Pagination"
          >
            <span className="text-ink-muted">
              Page {result.page} of {totalPages}
            </span>
            <span className="flex gap-2">
              {result.page > 1 ? (
                <Link
                  href={pageHref(brandId, rawParams, result.page - 1)}
                  className="font-medium text-accent hover:underline"
                >
                  Previous
                </Link>
              ) : null}
              {result.page < totalPages ? (
                <Link
                  href={pageHref(brandId, rawParams, result.page + 1)}
                  className="font-medium text-accent hover:underline"
                >
                  Next
                </Link>
              ) : null}
            </span>
          </nav>
        ) : null}
      </Card>
    </>
  );
}

function pageHref(
  brandId: string,
  params: Record<string, string | string[] | undefined>,
  page: number,
): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (key === "page" || value === undefined) continue;
    search.set(key, Array.isArray(value) ? (value[0] ?? "") : value);
  }
  search.set("page", String(page));
  return `/brands/${brandId}/evidence?${search.toString()}`;
}
