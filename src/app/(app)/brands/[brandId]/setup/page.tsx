import {
  addCompetitorAction,
  addProductAction,
  removeCompetitorAction,
  removeProductAction,
} from "@/app/actions/brands";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { BrandForm } from "@/components/forms/brand-form";
import { Card, CardHeader, EmptyState, Input, PageHeader } from "@/components/ui";
import { hasCapability, requireBrandAccess } from "@/lib/auth/context";
import { getCsrfToken } from "@/lib/auth/session";
import { getBrandDetail } from "@/services/brands";

export const dynamic = "force-dynamic";

export default async function BrandSetupPage({ params }: { params: Promise<{ brandId: string }> }) {
  const { brandId } = await params;
  const ctx = await requireBrandAccess(brandId);
  const { brand, products, competitors } = await getBrandDetail(ctx, brandId);
  const csrfToken = await getCsrfToken();
  const canEdit = hasCapability(ctx, "brand:write");

  return (
    <>
      <PageHeader
        title="Brand setup"
        description="Configuration that shapes ingestion, crawling and every generation step."
        breadcrumb={`${brand.name} / Setup`}
      />

      {!canEdit ? (
        <p className="mb-4 text-sm text-ink-muted">
          Your role ({ctx.role}) can view this configuration but not change it.
        </p>
      ) : null}

      <div className="space-y-5">
        <Card className="p-5">
          {canEdit ? (
            <BrandForm
              csrfToken={csrfToken}
              mode="edit"
              brandId={brandId}
              values={{
                name: brand.name,
                canonicalDomain: brand.canonicalDomain,
                description: brand.description,
                conversionActions: brand.conversionActions,
                markets: brand.markets,
                languages: brand.languages,
                regions: brand.regions,
                approvedCrawlDomains: brand.approvedCrawlDomains,
                strategicQuestions: brand.strategicQuestions,
                regulatedDomain: brand.regulatedDomain,
                retentionDays: brand.retentionDays,
              }}
            />
          ) : (
            <dl className="grid gap-3 sm:grid-cols-2">
              <ReadOnly label="Domain" value={brand.canonicalDomain} />
              <ReadOnly label="Markets" value={brand.markets.join(", ")} />
              <ReadOnly label="Languages" value={brand.languages.join(", ")} />
              <ReadOnly label="Conversion actions" value={brand.conversionActions.join(", ")} />
            </dl>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Priority products"
            description="Constrains keyword and content analysis. Ordered by priority."
          />
          {products.length === 0 ? (
            <EmptyState
              title="No products"
              description="Add the products or categories that matter most for this brand."
            />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Description</th>
                    <th>Priority</th>
                    {canEdit ? <th /> : null}
                  </tr>
                </thead>
                <tbody>
                  {products.map((product) => (
                    <tr key={product.id}>
                      <td className="font-medium">{product.name}</td>
                      <td className="text-ink-muted">{product.description ?? "—"}</td>
                      <td className="tabular-nums">{product.priority}</td>
                      {canEdit ? (
                        <td className="text-right">
                          <ActionForm
                            action={removeProductAction}
                            csrfToken={csrfToken}
                            hidden={{ brandId, id: product.id }}
                          >
                            <SubmitButton label="Remove" variant="ghost" size="sm" />
                          </ActionForm>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {canEdit ? (
            <div className="border-t border-surface-border px-4 py-3">
              <ActionForm action={addProductAction} csrfToken={csrfToken} hidden={{ brandId }}>
                <div className="flex flex-wrap items-end gap-2">
                  <Input
                    name="name"
                    placeholder="Product name"
                    required
                    className="w-52"
                    aria-label="Product name"
                  />
                  <Input
                    name="description"
                    placeholder="Short description"
                    className="w-72"
                    aria-label="Product description"
                  />
                  <Input
                    name="priority"
                    type="number"
                    min={0}
                    max={100}
                    defaultValue={0}
                    className="w-24"
                    aria-label="Priority"
                  />
                  <SubmitButton label="Add product" size="sm" />
                </div>
              </ActionForm>
            </div>
          ) : null}
        </Card>

        <Card>
          <CardHeader
            title="Competitors"
            description="Used for comparison analysis and to interpret Profound mentions and citations."
          />
          {competitors.length === 0 ? (
            <EmptyState
              title="No competitors"
              description="Add known competitors to enable comparison analysis."
            />
          ) : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Domain</th>
                    <th>Notes</th>
                    {canEdit ? <th /> : null}
                  </tr>
                </thead>
                <tbody>
                  {competitors.map((competitor) => (
                    <tr key={competitor.id}>
                      <td className="font-medium">{competitor.name}</td>
                      <td className="font-mono text-xs text-ink-muted">
                        {competitor.domain ?? "—"}
                      </td>
                      <td className="text-ink-muted">{competitor.notes ?? "—"}</td>
                      {canEdit ? (
                        <td className="text-right">
                          <ActionForm
                            action={removeCompetitorAction}
                            csrfToken={csrfToken}
                            hidden={{ brandId, id: competitor.id }}
                          >
                            <SubmitButton label="Remove" variant="ghost" size="sm" />
                          </ActionForm>
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {canEdit ? (
            <div className="border-t border-surface-border px-4 py-3">
              <ActionForm action={addCompetitorAction} csrfToken={csrfToken} hidden={{ brandId }}>
                <div className="flex flex-wrap items-end gap-2">
                  <Input
                    name="name"
                    placeholder="Competitor name"
                    required
                    className="w-52"
                    aria-label="Competitor name"
                  />
                  <Input
                    name="domain"
                    placeholder="domain.example"
                    className="w-52"
                    aria-label="Competitor domain"
                  />
                  <Input name="notes" placeholder="Notes" className="w-72" aria-label="Notes" />
                  <SubmitButton label="Add competitor" size="sm" />
                </div>
              </ActionForm>
            </div>
          ) : null}
        </Card>
      </div>
    </>
  );
}

function ReadOnly({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-2xs font-medium uppercase tracking-wide text-ink-muted">{label}</dt>
      <dd className="mt-0.5 text-sm">{value || "—"}</dd>
    </div>
  );
}
