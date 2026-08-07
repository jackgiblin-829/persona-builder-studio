import Link from "next/link";
import { generateBriefAction } from "@/app/actions/content-briefs";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  Field,
  OriginBadge,
  PageHeader,
  Select,
} from "@/components/ui";
import { hasCapability, requireBrandAccess } from "@/lib/auth/context";
import { getCsrfToken } from "@/lib/auth/session";
import { listBriefs } from "@/services/content-brief";
import { listOpportunities } from "@/services/content-opportunities";

export const dynamic = "force-dynamic";

export default async function BriefsPage({ params }: { params: Promise<{ brandId: string }> }) {
  const { brandId } = await params;
  const ctx = await requireBrandAccess(brandId);

  const [briefs, opportunities, csrfToken] = await Promise.all([
    listBriefs(ctx),
    listOpportunities(ctx, { reviewStatus: "approved" }),
    getCsrfToken(),
  ]);

  const canGenerate = hasCapability(ctx, "content:generate");

  return (
    <>
      <PageHeader
        title="SEO briefs"
        description="An evidence-backed SEO and AI-search brief generated from one approved content opportunity. Every persona-specific section cites evidence ids; every Profound-specific section cites Profound prompt ids."
        breadcrumb={`${ctx.brandName} / SEO briefs`}
      />

      {canGenerate ? (
        <Card className="mb-4">
          <CardHeader
            title="Generate a brief"
            description="Requires an approved content opportunity."
          />
          <div className="px-4 py-3">
            {opportunities.length === 0 ? (
              <p className="text-sm text-ink-muted">
                Approve a content opportunity first, on the{" "}
                <Link
                  href={`/brands/${brandId}/opportunities`}
                  className="text-accent hover:underline"
                >
                  Content opportunities
                </Link>{" "}
                screen.
              </p>
            ) : (
              <ActionForm action={generateBriefAction} csrfToken={csrfToken} hidden={{ brandId }}>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <Field label="Approved opportunity">
                    <Select name="opportunityId" required>
                      {opportunities.map((o) => (
                        <option key={o.id} value={o.id}>
                          {o.title}
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <div className="flex items-end">
                    <SubmitButton label="Generate brief" pendingLabel="Queuing…" />
                  </div>
                </div>
              </ActionForm>
            )}
          </div>
        </Card>
      ) : null}

      <Card>
        <CardHeader title={`${briefs.length} brief${briefs.length === 1 ? "" : "s"}`} />
        {briefs.length === 0 ? (
          <EmptyState
            title="No briefs yet"
            description="Generate one from an approved content opportunity above."
          />
        ) : (
          <ul className="divide-y divide-surface-border">
            {briefs.map((brief) => (
              <li key={brief.id} className="px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <Link
                    href={`/brands/${brandId}/briefs/${brief.id}`}
                    className="min-w-0 flex-1 text-sm font-semibold text-ink hover:text-accent hover:underline"
                  >
                    {brief.workingTitle}
                  </Link>
                  <div className="flex items-center gap-1.5">
                    <OriginBadge origin={brief.dataOrigin} />
                    <Badge
                      tone={
                        brief.reviewStatus === "approved"
                          ? "success"
                          : brief.reviewStatus === "rejected"
                            ? "danger"
                            : "neutral"
                      }
                    >
                      {brief.reviewStatus.replace(/_/g, " ")}
                    </Badge>
                  </div>
                </div>
                <p className="mt-1 text-2xs text-ink-subtle">
                  {brief.personaName ?? "—"} · v{brief.version} · from opportunity:{" "}
                  {brief.opportunityTitle ?? "—"} · {brief.evidenceIds.length} evidence link
                  {brief.evidenceIds.length === 1 ? "" : "s"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
