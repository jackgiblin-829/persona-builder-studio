import Link from "next/link";
import { ButtonLink, Badge, Card, EmptyState, PageHeader } from "@/components/ui";
import { requireOrgAccess, hasCapability } from "@/lib/auth/context";
import { listBrands } from "@/services/brands";

export const dynamic = "force-dynamic";

export default async function BrandListPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const ctx = await requireOrgAccess(orgId);
  const brands = await listBrands(ctx);
  const canCreate = hasCapability(ctx, "brand:write");

  return (
    <>
      <PageHeader
        title="Brands"
        description="Each brand has its own evidence, personas, prompt sets and Profound mappings. Data never crosses a brand or an organization."
        actions={
          canCreate ? (
            <ButtonLink href={`/orgs/${orgId}/brands/new`} variant="primary">
              New brand
            </ButtonLink>
          ) : null
        }
      />

      <Card>
        {brands.length === 0 ? (
          <EmptyState
            title="No brands yet"
            description={
              canCreate
                ? "Create a brand to start ingesting customer evidence. The seeded demo brand appears here after running npm run db:seed."
                : "No brands have been created in this organization yet. Ask an editor or admin to create one."
            }
            action={
              canCreate ? (
                <ButtonLink href={`/orgs/${orgId}/brands/new`} variant="primary" size="sm">
                  Create the first brand
                </ButtonLink>
              ) : null
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Brand</th>
                  <th>Domain</th>
                  <th className="text-right">Sources</th>
                  <th className="text-right">Evidence</th>
                  <th className="text-right">Personas</th>
                  <th className="text-right">Prompt sets</th>
                </tr>
              </thead>
              <tbody>
                {brands.map((brand) => (
                  <tr key={brand.id} className="hover:bg-surface-sunken">
                    <td>
                      <Link
                        href={`/brands/${brand.id}`}
                        className="font-medium text-accent hover:underline"
                      >
                        {brand.name}
                      </Link>
                      {brand.regulatedDomain ? (
                        <span className="ml-2">
                          <Badge
                            tone="warn"
                            title="Regulated or sensitive domain — extra review applies"
                          >
                            regulated
                          </Badge>
                        </span>
                      ) : null}
                    </td>
                    <td className="font-mono text-xs text-ink-muted">{brand.canonicalDomain}</td>
                    <td className="text-right tabular-nums">{brand.sourceCount}</td>
                    <td className="text-right tabular-nums">{brand.evidenceCount}</td>
                    <td className="text-right tabular-nums">{brand.personaCount}</td>
                    <td className="text-right tabular-nums">{brand.promptSetCount}</td>
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
