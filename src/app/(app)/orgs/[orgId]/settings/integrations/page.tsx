import { refreshProfoundConfigAction, testProfoundConnectionAction } from "@/app/actions/profound";
import { updateIntegrationAction } from "@/app/actions/integrations";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import {
  Badge,
  Callout,
  Card,
  CardHeader,
  Field,
  Input,
  OriginBadge,
  PageHeader,
  Select,
} from "@/components/ui";
import { hasCapability, requireOrgAccess } from "@/lib/auth/context";
import { getCsrfToken } from "@/lib/auth/session";
import { getProfoundConnection } from "@/services/profound-config";
import { listIntegrations, VENDOR_CREDENTIAL_FIELDS } from "@/services/integrations";

export const dynamic = "force-dynamic";

const CREDENTIAL_FIELD_LABELS: Record<string, string> = {
  apiKey: "API key",
  login: "Login",
  password: "Password",
};

export default async function IntegrationsSettingsPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  const ctx = await requireOrgAccess(orgId);

  const [integrations, connection, csrfToken] = await Promise.all([
    listIntegrations(ctx),
    getProfoundConnection(ctx),
    getCsrfToken(),
  ]);

  const canManage = hasCapability(ctx, "integration:manage");
  const canConfigureProfound = hasCapability(ctx, "profound:configure");

  return (
    <>
      <PageHeader
        title="Integrations"
        description="Every vendor call is either live or mock, and the mode is a stored decision — never inferred from whether a request happened to succeed. A live vendor that fails throws; it never falls back to mock data."
        breadcrumb="Settings / Integrations"
      />

      {!canManage ? (
        <div className="mb-4">
          <Callout tone="info">
            Your role can view integration status but cannot change credentials or mode. That
            requires an admin.
          </Callout>
        </div>
      ) : null}

      <div className="space-y-5">
        {integrations.map((integration) => {
          const fields = VENDOR_CREDENTIAL_FIELDS[integration.vendor];
          return (
            <Card key={integration.vendor}>
              <CardHeader
                title={integration.label}
                description={integration.role}
                actions={
                  <>
                    <OriginBadge origin={integration.mode} />
                    {integration.configured ? (
                      <Badge tone="success">credentials configured</Badge>
                    ) : (
                      <Badge tone="warn">not configured</Badge>
                    )}
                  </>
                }
              />
              <div className="space-y-4 px-4 py-4">
                {integration.lastTestedAt ? (
                  <Callout tone={integration.lastTestOutcome === "success" ? "success" : "danger"}>
                    Last connection test {integration.lastTestOutcome} at{" "}
                    {integration.lastTestedAt.toISOString()}
                    {integration.lastTestMessage ? ` — ${integration.lastTestMessage}` : ""}
                  </Callout>
                ) : null}

                <ActionForm
                  action={updateIntegrationAction}
                  csrfToken={csrfToken}
                  hidden={{ organizationId: orgId, vendor: integration.vendor }}
                  className="grid gap-3 sm:grid-cols-2"
                >
                  <Field label="Mode" htmlFor={`${integration.vendor}-mode`}>
                    <Select
                      id={`${integration.vendor}-mode`}
                      name="mode"
                      defaultValue={integration.mode}
                      disabled={!canManage}
                    >
                      <option value="mock">Mock — deterministic fixture data</option>
                      <option value="live">Live — real vendor API</option>
                    </Select>
                  </Field>

                  {fields.length > 0 ? (
                    fields.map((field) => (
                      <Field
                        key={field}
                        label={CREDENTIAL_FIELD_LABELS[field] ?? field}
                        htmlFor={`${integration.vendor}-${field}`}
                        hint={
                          integration.maskedHints[field]
                            ? `Currently ${integration.maskedHints[field]}`
                            : "Not set"
                        }
                      >
                        <Input
                          id={`${integration.vendor}-${field}`}
                          name={`credential.${field}`}
                          type={field === "password" ? "password" : "text"}
                          placeholder="Leave blank to keep the current value"
                          disabled={!canManage}
                          autoComplete="off"
                        />
                      </Field>
                    ))
                  ) : (
                    <p className="self-end text-sm text-ink-muted">
                      This vendor has no credentials — it is always available.
                    </p>
                  )}

                  {canManage ? (
                    <div className="sm:col-span-2">
                      <SubmitButton label="Save" variant="secondary" size="sm" />
                    </div>
                  ) : null}
                </ActionForm>

                {integration.vendor === "profound" && canConfigureProfound ? (
                  <div className="flex flex-wrap items-center gap-2 border-t border-surface-border pt-3">
                    <ActionForm
                      action={testProfoundConnectionAction}
                      csrfToken={csrfToken}
                      hidden={{ organizationId: orgId }}
                      className="space-y-0"
                    >
                      <SubmitButton label="Test connection" variant="secondary" size="sm" />
                    </ActionForm>
                    <ActionForm
                      action={refreshProfoundConfigAction}
                      csrfToken={csrfToken}
                      hidden={{ organizationId: orgId }}
                      className="space-y-0"
                    >
                      <SubmitButton
                        label="Retrieve configuration"
                        variant="secondary"
                        size="sm"
                        pendingLabel="Retrieving…"
                      />
                    </ActionForm>
                    {connection ? (
                      <span className="text-xs text-ink-muted">
                        {connection.profoundOrganizationName
                          ? `Connected to ${connection.profoundOrganizationName}`
                          : "Not yet connected"}
                        {connection.lastSyncedConfigAt
                          ? ` · configuration retrieved ${connection.lastSyncedConfigAt.toISOString().slice(0, 16).replace("T", " ")}`
                          : " · configuration not yet retrieved"}
                      </span>
                    ) : (
                      <span className="text-xs text-ink-muted">Not yet connected</span>
                    )}
                  </div>
                ) : null}
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}
