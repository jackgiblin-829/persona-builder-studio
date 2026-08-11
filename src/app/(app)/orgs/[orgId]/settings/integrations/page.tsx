import { updateIntegrationAction } from "@/app/actions/integrations";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import {
  Badge,
  Callout,
  Card,
  CardHeader,
  Field,
  Input,
  PageHeader,
  Select,
} from "@/components/ui";
import { hasCapability, requireOrgAccess } from "@/lib/auth/context";
import { getCsrfToken } from "@/lib/auth/session";
import { listIntegrations } from "@/services/integrations";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  const ctx = await requireOrgAccess(orgId);
  const [items, csrfToken] = await Promise.all([listIntegrations(ctx), getCsrfToken()]);
  const canManage = hasCapability(ctx, "integration:manage");

  return (
    <>
      <PageHeader
        title="Integrations"
        description="Choose deterministic mock mode or connect the live APIs used by the two one-click workflows. Live failures never fall back to mock data."
        breadcrumb="Settings / Integrations"
      />
      {!canManage ? (
        <div className="mb-4">
          <Callout tone="info">Only owners and admins can change integrations.</Callout>
        </div>
      ) : null}
      <div className="space-y-4">
        {items.map((item) => (
          <Card key={item.vendor}>
            <CardHeader
              title={item.label}
              description={item.role}
              actions={
                <Badge tone={item.configured ? "success" : "warn"}>
                  {item.configured ? "configured" : "API key needed"}
                </Badge>
              }
            />
            <div className="p-4">
              <ActionForm
                action={updateIntegrationAction}
                csrfToken={csrfToken}
                hidden={{ organizationId: orgId, vendor: item.vendor }}
                className="grid gap-4 sm:grid-cols-[12rem_minmax(16rem,1fr)_auto] sm:items-end"
              >
                <Field label="Mode" htmlFor={`${item.vendor}-mode`}>
                  <Select
                    id={`${item.vendor}-mode`}
                    name="mode"
                    defaultValue={item.mode}
                    disabled={!canManage}
                  >
                    <option value="mock">Mock</option>
                    <option value="live">Live</option>
                  </Select>
                </Field>
                <Field
                  label="API key"
                  htmlFor={`${item.vendor}-key`}
                  hint={
                    item.maskedHints.apiKey
                      ? `Current: ${item.maskedHints.apiKey}`
                      : "Stored encrypted; leave blank to keep the current key."
                  }
                >
                  <Input
                    id={`${item.vendor}-key`}
                    name="apiKey"
                    type="password"
                    autoComplete="off"
                    disabled={!canManage}
                  />
                </Field>
                {canManage ? <SubmitButton label="Save" variant="secondary" /> : null}
              </ActionForm>
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
