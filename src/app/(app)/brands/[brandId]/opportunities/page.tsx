import Link from "next/link";
import { generateOpportunitiesAction } from "@/app/actions/content-opportunities";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  Field,
  PageHeader,
  Select,
  Stat,
} from "@/components/ui";
import { hasCapability, requireBrandAccess } from "@/lib/auth/context";
import { getCsrfToken } from "@/lib/auth/session";
import { listApprovedPersonaVersions } from "@/services/personas";
import { listApprovedPromptSetVersions } from "@/services/prompt-sets";
import { listOpportunities, type OpportunityFilters } from "@/services/content-opportunities";

export const dynamic = "force-dynamic";

const RECOMMENDATION_LABELS: Record<string, string> = {
  new_article: "New article",
  existing_article_update: "Update existing article",
  faq: "FAQ",
  comparison_page: "Comparison page",
  landing_page: "Landing page",
  product_page: "Product page",
  documentation: "Documentation",
  case_study: "Case study",
  homepage_update: "Homepage update",
  structured_information_improvement: "Structured information improvement",
  third_party_authority_or_pr: "Third-party authority / PR",
  no_content_action: "No content action",
  product_or_positioning_review: "Product / positioning review",
};

export default async function OpportunitiesPage({
  params,
  searchParams,
}: {
  params: Promise<{ brandId: string }>;
  searchParams: Promise<{ reviewStatus?: string; recommendation?: string; priority?: string }>;
}) {
  const { brandId } = await params;
  const sp = await searchParams;
  const ctx = await requireBrandAccess(brandId);

  const filters: OpportunityFilters = {
    reviewStatus: sp.reviewStatus as OpportunityFilters["reviewStatus"],
    recommendation: sp.recommendation as OpportunityFilters["recommendation"],
    priority: sp.priority as OpportunityFilters["priority"],
  };

  const [opportunities, personaVersions, promptSetVersions, csrfToken] = await Promise.all([
    listOpportunities(ctx, filters),
    listApprovedPersonaVersions(ctx),
    listApprovedPromptSetVersions(ctx),
    getCsrfToken(),
  ]);

  const canGenerate = hasCapability(ctx, "content:generate");
  const noContentActionCount = opportunities.filter(
    (o) => o.recommendation === "no_content_action",
  ).length;
  const approvedCount = opportunities.filter((o) => o.reviewStatus === "approved").length;
  const exportQuery = new URLSearchParams(
    Object.entries(sp).filter(([, v]) => v) as [string, string][],
  ).toString();

  return (
    <>
      <PageHeader
        title="Content opportunities"
        description="Content-gap analysis turns Profound performance, existing site content, evidence and search demand into reviewable recommendations. Not every gap becomes a new article — a recommendation of 'no content action' is a deliberate outcome, not a missing feature."
        breadcrumb={`${ctx.brandName} / Content opportunities`}
        actions={
          opportunities.length > 0 ? (
            <span className="flex gap-2 text-xs">
              <a
                className="text-accent hover:underline"
                href={`/brands/${brandId}/opportunities/export?format=json&${exportQuery}`}
              >
                Export JSON
              </a>
              <a
                className="text-accent hover:underline"
                href={`/brands/${brandId}/opportunities/export?format=csv&${exportQuery}`}
              >
                Export CSV
              </a>
              <a
                className="text-accent hover:underline"
                href={`/brands/${brandId}/opportunities/export?format=md&${exportQuery}`}
              >
                Export Markdown
              </a>
            </span>
          ) : null
        }
      />

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Opportunities" value={opportunities.length} />
        <Stat label="Approved" value={approvedCount} />
        <Stat
          label="No content action"
          value={noContentActionCount}
          hint="deliberate, not skipped"
        />
        <Stat label="Approved personas ready" value={personaVersions.length} />
      </div>

      {canGenerate ? (
        <Card className="mb-4">
          <CardHeader
            title="Run content-gap analysis"
            description="Requires an approved persona version and an approved prompt-set version. Analyzes every linked prompt with Profound results."
          />
          <div className="px-4 py-3">
            {personaVersions.length === 0 || promptSetVersions.length === 0 ? (
              <p className="text-sm text-ink-muted">
                Approve a persona version and a prompt-set version first.
              </p>
            ) : (
              <ActionForm
                action={generateOpportunitiesAction}
                csrfToken={csrfToken}
                hidden={{ brandId }}
              >
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <Field label="Persona version">
                    <Select name="personaVersionId" required>
                      {personaVersions.map((p) => (
                        <option key={p.personaVersionId} value={p.personaVersionId}>
                          {p.personaName} (v{p.version})
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Prompt-set version">
                    <Select name="promptSetVersionId" required>
                      {promptSetVersions.map((s) => (
                        <option key={s.promptSetVersionId} value={s.promptSetVersionId}>
                          {s.promptSetName} (v{s.version})
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <div className="flex items-end">
                    <SubmitButton label="Analyze" pendingLabel="Queuing…" />
                  </div>
                </div>
              </ActionForm>
            )}
          </div>
        </Card>
      ) : null}

      <Card className="mb-4">
        <CardHeader title="Filters" />
        <form method="GET" className="grid grid-cols-1 gap-3 px-4 py-3 sm:grid-cols-4">
          <Field label="Review status">
            <Select name="reviewStatus" defaultValue={sp.reviewStatus ?? ""}>
              <option value="">All</option>
              <option value="pending_review">Pending review</option>
              <option value="approved">Approved</option>
              <option value="rejected">Rejected</option>
            </Select>
          </Field>
          <Field label="Recommendation">
            <Select name="recommendation" defaultValue={sp.recommendation ?? ""}>
              <option value="">All</option>
              {Object.entries(RECOMMENDATION_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Priority">
            <Select name="priority" defaultValue={sp.priority ?? ""}>
              <option value="">All</option>
              <option value="p1">P1</option>
              <option value="p2">P2</option>
              <option value="p3">P3</option>
            </Select>
          </Field>
          <div className="flex items-end">
            <SubmitButton label="Apply filters" variant="secondary" size="sm" />
          </div>
        </form>
      </Card>

      <Card>
        <CardHeader
          title={`${opportunities.length} opportunit${opportunities.length === 1 ? "y" : "ies"}`}
        />
        {opportunities.length === 0 ? (
          <EmptyState
            title="No content opportunities yet"
            description="Run content-gap analysis above once a persona and prompt set are approved and Profound results have been retrieved."
          />
        ) : (
          <ul className="divide-y divide-surface-border">
            {opportunities.map((row) => (
              <li key={row.id} className="px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <Link
                    href={`/brands/${brandId}/opportunities/${row.id}`}
                    className="min-w-0 flex-1 text-sm font-semibold text-ink hover:text-accent hover:underline"
                  >
                    {row.title}
                  </Link>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone="accent">{row.gapType}</Badge>
                    <Badge tone={row.recommendation === "no_content_action" ? "neutral" : "warn"}>
                      {RECOMMENDATION_LABELS[row.recommendation] ?? row.recommendation}
                    </Badge>
                    <Badge
                      tone={
                        row.priority === "p1"
                          ? "danger"
                          : row.priority === "p2"
                            ? "warn"
                            : "neutral"
                      }
                    >
                      {row.priority.toUpperCase()}
                    </Badge>
                    <Badge
                      tone={
                        row.reviewStatus === "approved"
                          ? "success"
                          : row.reviewStatus === "rejected"
                            ? "danger"
                            : "neutral"
                      }
                    >
                      {row.reviewStatus.replace(/_/g, " ")}
                    </Badge>
                  </div>
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-ink-muted">{row.problemStatement}</p>
                <p className="mt-1 text-2xs text-ink-subtle">
                  {row.personaName ?? "—"} · effort {row.estimatedEffort} · {row.evidenceIds.length}{" "}
                  evidence link{row.evidenceIds.length === 1 ? "" : "s"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
