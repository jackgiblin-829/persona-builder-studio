import Link from "next/link";
import { refreshProfoundConfigAction, setCategoryMappingAction } from "@/app/actions/profound";
import {
  linkPromptManuallyAction,
  reconcilePromptSetVersionAction,
} from "@/app/actions/profound-reconcile";
import { requestProfoundEvidencePullAction } from "@/app/actions/profound-evidence";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import {
  Badge,
  Button,
  Callout,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  PageHeader,
  Select,
  StatusBadge,
} from "@/components/ui";
import { hasCapability, requireBrandAccess } from "@/lib/auth/context";
import { getCsrfToken } from "@/lib/auth/session";
import { getProfoundConnection } from "@/services/profound-config";
import { listDeployableSets } from "@/services/profound-links";
import { getCategoryMapping } from "@/services/profound-mapping";
import { getReconciliationStatus } from "@/services/profound-reconcile";

export const dynamic = "force-dynamic";

function defaultDate(daysAgo: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

export default async function ProfoundExportPage({
  params,
  searchParams,
}: {
  params: Promise<{ brandId: string }>;
  searchParams: Promise<{ promptSetVersionId?: string }>;
}) {
  const { brandId } = await params;
  const sp = await searchParams;
  const ctx = await requireBrandAccess(brandId);

  const [connection, category, deployableSets, csrfToken] = await Promise.all([
    getProfoundConnection(ctx),
    getCategoryMapping(ctx),
    listDeployableSets(ctx),
    getCsrfToken(),
  ]);

  const canConfigure = hasCapability(ctx, "profound:configure");
  const canRetrieve = hasCapability(ctx, "profound:retrieve_results");
  const promptSetVersionId = sp.promptSetVersionId || deployableSets[0]?.versionId;
  const selectedSet = deployableSets.find((set) => set.versionId === promptSetVersionId);
  const statusRows = promptSetVersionId
    ? await getReconciliationStatus(ctx, promptSetVersionId)
    : [];

  if (!connection || !connection.configuration) {
    return (
      <>
        <PageHeader
          title="Export & reconcile"
          breadcrumb={`${ctx.brandName} / Profound / Export & reconcile`}
        />
        <Card>
          <EmptyState
            title="Profound is not connected yet"
            description={
              !connection
                ? "This organization has not connected Profound, or the connection has not been tested."
                : "Profound is connected but its configuration has not been retrieved yet. Categories are read from the account, never typed in."
            }
            action={
              <Link
                href={`/orgs/${ctx.organizationId}/settings/integrations`}
                className="text-sm font-medium text-accent hover:underline"
              >
                Go to integration settings
              </Link>
            }
          />
        </Card>
      </>
    );
  }

  const { configuration } = connection;

  return (
    <>
      <PageHeader
        title="Export & reconcile"
        description="Export a prompt set for manual upload into Profound, then reconcile — the tool matches your approved prompts back to Profound's records by text and tag, so results retrieval and content workflows keep working without an automated push."
        breadcrumb={`${ctx.brandName} / Profound / Export & reconcile`}
        actions={
          <ActionForm
            action={refreshProfoundConfigAction}
            csrfToken={csrfToken}
            hidden={{ organizationId: ctx.organizationId, brandId }}
            className="space-y-0"
          >
            <SubmitButton
              label="Retrieve configuration"
              variant="secondary"
              size="sm"
              pendingLabel="Retrieving…"
            />
          </ActionForm>
        }
      />

      <Card className="mb-4">
        <CardHeader
          title="Category mapping"
          description="One brand maps to one Profound category. Reconciliation looks for matches only within this category."
          actions={category ? <StatusBadge status={category.status} /> : undefined}
        />
        <div className="space-y-3 px-4 py-4">
          {category ? (
            <p className="text-sm text-ink">
              Currently mapped to{" "}
              <span className="font-medium">{category.profoundCategoryName}</span>
              {category.status === "invalid" ? (
                <span className="ml-2">
                  <Callout tone="danger">
                    This category no longer exists in the Profound account. Choose a category that
                    is currently in the retrieved configuration.
                  </Callout>
                </span>
              ) : null}
            </p>
          ) : (
            <p className="text-sm text-ink-muted">This brand has no Profound category yet.</p>
          )}

          {canConfigure ? (
            <ActionForm
              action={setCategoryMappingAction}
              csrfToken={csrfToken}
              hidden={{ brandId }}
              className="flex flex-wrap items-end gap-3"
            >
              <div className="min-w-64">
                <Field label="Profound category" htmlFor="profoundCategoryId">
                  <Select
                    id="profoundCategoryId"
                    name="profoundCategoryId"
                    defaultValue={category?.profoundCategoryId ?? ""}
                  >
                    <option value="" disabled>
                      Choose a category…
                    </option>
                    {configuration.categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.name}
                        {c.domain ? ` — ${c.domain}` : ""}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              <SubmitButton label="Save category" variant="secondary" size="sm" />
            </ActionForm>
          ) : null}
        </div>
      </Card>

      <Card className="mb-4">
        <CardHeader
          title="Pull AI-visibility evidence"
          description="Reads the brand's existing Profound data for the mapped category — visibility, citations and sentiment by topic — and turns it into evidence for persona building. Distinct from results retrieval: this is not scoped to prompts this product deployed."
        />
        <div className="px-4 py-4">
          {canRetrieve ? (
            <ActionForm
              action={requestProfoundEvidencePullAction}
              csrfToken={csrfToken}
              hidden={{ brandId, startDate: defaultDate(29), endDate: defaultDate(0) }}
              className="space-y-0"
            >
              <SubmitButton
                label={`Pull ${defaultDate(29)} to ${defaultDate(0)}`}
                pendingLabel="Queuing…"
              />
            </ActionForm>
          ) : (
            <p className="text-sm text-ink-muted">
              Pulling evidence requires an editor-level role.
            </p>
          )}
        </div>
      </Card>

      <Card className="mb-4">
        <CardHeader
          title="Export"
          description="Download a prompt-set version in a Profound-ready shape, then upload it manually in Profound's own UI."
        />
        <div className="px-4 py-4">
          {deployableSets.length === 0 ? (
            <p className="text-sm text-ink-muted">No approved prompt sets yet.</p>
          ) : (
            <form method="GET" className="flex flex-wrap items-end gap-3">
              <Field label="Prompt set" htmlFor="promptSetVersionId">
                <Select
                  id="promptSetVersionId"
                  name="promptSetVersionId"
                  defaultValue={promptSetVersionId ?? ""}
                >
                  {deployableSets.map((set) => (
                    <option key={set.versionId} value={set.versionId}>
                      {set.promptSetName} v{set.version} — {set.personaName}
                    </option>
                  ))}
                </Select>
              </Field>
              <Button type="submit" variant="secondary" size="sm">
                Load
              </Button>
              {selectedSet ? (
                <span className="flex flex-wrap gap-2">
                  {(["json", "csv", "md"] as const).map((format) => (
                    <Link
                      key={format}
                      href={`/brands/${brandId}/prompt-sets/${selectedSet.promptSetId}/export?format=${format}&version=${selectedSet.version}`}
                      className="rounded-md border border-surface-border px-3 py-1.5 text-sm font-medium text-accent hover:bg-accent-soft"
                    >
                      Download {format.toUpperCase()}
                    </Link>
                  ))}
                </span>
              ) : null}
            </form>
          )}
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Reconcile"
          description="After uploading in Profound, match your approved prompts to Profound's prompt records by normalized text and tag. A confident match links automatically; anything ambiguous or unmatched needs a manual decision."
        />
        <div className="px-4 py-4">
          {selectedSet && canConfigure ? (
            <ActionForm
              action={reconcilePromptSetVersionAction}
              csrfToken={csrfToken}
              hidden={{ brandId, promptSetVersionId: selectedSet.versionId }}
              className="mb-4"
            >
              <SubmitButton label="Reconcile now" pendingLabel="Reconciling…" />
            </ActionForm>
          ) : null}

          {statusRows.length === 0 ? (
            <p className="text-sm text-ink-muted">
              Load a prompt set above to see its link status.
            </p>
          ) : (
            <ul className="divide-y divide-surface-border">
              {statusRows.map((row) => (
                <li key={row.promptId} className="space-y-1 py-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <span className="min-w-0 flex-1 text-sm text-ink">{row.promptText}</span>
                    {row.linked ? (
                      <Badge tone="success">Linked</Badge>
                    ) : (
                      <Badge tone="warn">Not linked</Badge>
                    )}
                  </div>
                  {row.linked ? (
                    <p className="text-xs text-ink-subtle">Profound id {row.profoundPromptId}</p>
                  ) : canConfigure ? (
                    <ActionForm
                      action={linkPromptManuallyAction}
                      csrfToken={csrfToken}
                      hidden={{
                        brandId,
                        promptSetVersionId: selectedSet?.versionId ?? "",
                        promptId: row.promptId,
                      }}
                      className="flex flex-wrap items-end gap-2"
                    >
                      <Field
                        label="Profound prompt id"
                        htmlFor={`profoundPromptId-${row.promptId}`}
                      >
                        <Input
                          id={`profoundPromptId-${row.promptId}`}
                          name="profoundPromptId"
                          placeholder="Paste the id from Profound"
                          required
                        />
                      </Field>
                      <SubmitButton label="Link manually" variant="secondary" size="sm" />
                    </ActionForm>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </Card>
    </>
  );
}
