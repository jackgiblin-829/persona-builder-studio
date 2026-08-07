import { ResearchForms } from "@/components/forms/research-forms";
import { Badge, Card, CardHeader, EmptyState, PageHeader, StatusBadge } from "@/components/ui";
import { hasCapability, requireBrandAccess } from "@/lib/auth/context";
import { getCsrfToken } from "@/lib/auth/session";
import { listAudienceReports } from "@/services/audience-research";

export const dynamic = "force-dynamic";

export default async function SparktoroResearchPage({
  params,
}: {
  params: Promise<{ brandId: string }>;
}) {
  const { brandId } = await params;
  const ctx = await requireBrandAccess(brandId);
  const [reports, csrfToken] = await Promise.all([listAudienceReports(ctx), getCsrfToken()]);

  const canUpload = hasCapability(ctx, "source:upload");

  return (
    <>
      <PageHeader
        title="SparkToro research"
        description="Aggregated, externally-supported audience evidence — never converted into an individual behaviour. Each section is retrieved as its own job and feeds the same evidence pipeline as an upload."
        breadcrumb={`${ctx.brandName} / Research / SparkToro`}
      />

      {canUpload ? (
        <div className="mb-5">
          <ResearchForms brandId={brandId} csrfToken={csrfToken} />
        </div>
      ) : (
        <p className="mb-5 text-sm text-ink-muted">
          Your role ({ctx.role}) can view SparkToro reports but not request new ones.
        </p>
      )}

      <Card>
        <CardHeader
          title="Reports"
          description="Every section of a report runs independently — one section failing never discards the others."
        />
        {reports.length === 0 ? (
          <EmptyState
            title="No SparkToro reports yet"
            description="Request one above to pull audience affinity data in as evidence."
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Description</th>
                  <th>Sections</th>
                  <th>Status</th>
                  <th>Origin</th>
                  <th>Requested</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((report) => (
                  <tr key={report.id}>
                    <td>
                      <span className="font-medium text-ink">{report.description}</span>
                      {report.location ? (
                        <span className="ml-2 text-xs text-ink-subtle">{report.location}</span>
                      ) : null}
                    </td>
                    <td className="text-xs text-ink-muted">
                      {report.requestedSections.length} section
                      {report.requestedSections.length === 1 ? "" : "s"}
                    </td>
                    <td>
                      <StatusBadge status={report.status} />
                    </td>
                    <td>
                      <Badge tone={report.dataOrigin === "live" ? "accent" : "neutral"}>
                        {report.dataOrigin}
                      </Badge>
                    </td>
                    <td className="whitespace-nowrap text-xs text-ink-muted">
                      {report.createdAt.toISOString().slice(0, 16).replace("T", " ")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
