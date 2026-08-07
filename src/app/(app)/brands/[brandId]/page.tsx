import Link from "next/link";
import {
  Badge,
  ButtonLink,
  Callout,
  Card,
  CardHeader,
  KeyValue,
  PageHeader,
  Stat,
  StatusBadge,
} from "@/components/ui";
import { requireBrandAccess } from "@/lib/auth/context";
import { getBrandDetail } from "@/services/brands";
import { listIntegrations } from "@/services/integrations";
import { getRecentJobs, getWorkflowStatus } from "@/services/overview";

export const dynamic = "force-dynamic";

export default async function BrandOverviewPage({
  params,
}: {
  params: Promise<{ brandId: string }>;
}) {
  const { brandId } = await params;
  const ctx = await requireBrandAccess(brandId);
  const [{ brand, products, competitors }, { steps, counts }, integrations, recentJobs] =
    await Promise.all([
      getBrandDetail(ctx, brandId),
      getWorkflowStatus(ctx),
      listIntegrations(ctx),
      getRecentJobs(brandId),
    ]);

  const mockVendors = integrations.filter((i) => i.mode === "mock").map((i) => i.label);
  const completed = steps.filter((s) => s.done).length;

  return (
    <>
      <PageHeader
        title={brand.name}
        description={brand.description}
        actions={<ButtonLink href={`/brands/${brandId}/setup`}>Brand setup</ButtonLink>}
      />

      {mockVendors.length > 0 ? (
        <div className="mb-4">
          <Callout tone="warn" title="Mock mode is active">
            {mockVendors.join(", ")} {mockVendors.length === 1 ? "is" : "are"} running with
            deterministic fixture data. Everything produced from{" "}
            {mockVendors.length === 1 ? "it" : "them"} is labelled <Badge tone="warn">Mock</Badge>{" "}
            and is not live vendor data.{" "}
            <Link
              href={`/orgs/${ctx.organizationId}/settings/integrations`}
              className="font-medium text-accent hover:underline"
            >
              Configure integrations
            </Link>
          </Callout>
        </div>
      ) : null}

      {brand.regulatedDomain ? (
        <div className="mb-4">
          <Callout tone="danger" title="Regulated or sensitive domain">
            Extra review applies. Automated PII detection is not a substitute for legal or
            compliance review.
          </Callout>
        </div>
      ) : null}

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Sources" value={counts.sources} />
        <Stat
          label="Evidence"
          value={counts.evidence}
          hint={`${counts.reviewedEvidence} approved`}
        />
        <Stat
          label="Personas"
          value={counts.personas}
          hint={`${counts.approvedPersonas} approved`}
        />
        <Stat
          label="Prompts"
          value={counts.personaPrompts}
          hint={`${counts.controlPrompts} controls`}
        />
        <Stat label="Profound links" value={counts.profoundLinks} />
        <Stat label="Result snapshots" value={counts.resultSnapshots} />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Workflow"
            description={`${completed} of ${steps.length} stages have produced data for this brand.`}
          />
          <ol className="divide-y divide-surface-border">
            {steps.map((step, index) => (
              <li key={step.key}>
                <Link
                  href={step.href}
                  className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-sunken"
                >
                  <span
                    aria-hidden
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-2xs font-semibold ${
                      step.done ? "bg-observed text-white" : "bg-surface-sunken text-ink-subtle"
                    }`}
                  >
                    {step.done ? "✓" : index + 1}
                  </span>
                  <span className="min-w-0 flex-1 text-sm text-ink">{step.label}</span>
                  <span className="text-xs text-ink-muted">{step.detail}</span>
                </Link>
              </li>
            ))}
          </ol>
        </Card>

        <div className="space-y-5">
          <Card>
            <CardHeader title="Brand profile" />
            <div className="px-4 py-3">
              <KeyValue
                items={[
                  {
                    label: "Domain",
                    value: <span className="font-mono text-xs">{brand.canonicalDomain}</span>,
                  },
                  { label: "Markets", value: brand.markets.join(", ") || "—" },
                  { label: "Languages", value: brand.languages.join(", ") || "—" },
                  { label: "Regions", value: brand.regions.join(", ") || "—" },
                  { label: "Conversion actions", value: brand.conversionActions.join(", ") || "—" },
                  { label: "Products", value: products.length },
                  { label: "Competitors", value: competitors.length },
                  {
                    label: "Crawl allowlist",
                    value: (
                      <span className="font-mono text-xs">
                        {brand.approvedCrawlDomains.join(", ")}
                      </span>
                    ),
                  },
                  {
                    label: "Retention",
                    value: brand.retentionDays ? `${brand.retentionDays} days` : "Indefinite",
                  },
                ]}
              />
            </div>
          </Card>

          <Card>
            <CardHeader
              title="Recent jobs"
              description={
                counts.activeJobs > 0 ? `${counts.activeJobs} in progress` : "Nothing running"
              }
              actions={
                <Link
                  href={`/brands/${brandId}/jobs`}
                  className="text-xs font-medium text-accent hover:underline"
                >
                  All jobs
                </Link>
              }
            />
            {recentJobs.length === 0 ? (
              <p className="px-4 py-4 text-sm text-ink-muted">
                No jobs have run for this brand yet.
              </p>
            ) : (
              <ul className="divide-y divide-surface-border">
                {recentJobs.map((job) => (
                  <li
                    key={job.id}
                    className="flex items-center justify-between gap-2 px-4 py-2 text-sm"
                  >
                    <span className="truncate font-mono text-xs">{job.type}</span>
                    <StatusBadge status={job.status} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
