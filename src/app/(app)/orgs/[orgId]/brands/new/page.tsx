import { BrandForm } from "@/components/forms/brand-form";
import { Card, PageHeader } from "@/components/ui";
import { requireOrgAccess, requireCapability } from "@/lib/auth/context";
import { getCsrfToken } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export default async function NewBrandPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const ctx = await requireOrgAccess(orgId);
  requireCapability(ctx, "brand:write");
  const csrfToken = await getCsrfToken();

  return (
    <>
      <PageHeader
        title="New brand"
        description="A brand is the isolation boundary for evidence, personas, prompts and Profound mappings."
        breadcrumb="Brands / New"
      />
      <Card className="p-5">
        <BrandForm csrfToken={csrfToken} mode="create" organizationId={orgId} />
      </Card>
    </>
  );
}
