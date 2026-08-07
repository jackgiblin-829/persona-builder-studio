import Link from "next/link";
import { deleteSourceAction, retrySourceAction } from "@/app/actions/sources";
import { requestWebResearchAction } from "@/app/actions/web-research";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { SourceUploadForms } from "@/components/forms/source-forms";
import {
  Badge,
  Callout,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  Stat,
  StatusBadge,
} from "@/components/ui";
import { hasCapability, requireBrandAccess } from "@/lib/auth/context";
import { getCsrfToken } from "@/lib/auth/session";
import { SOURCE_TYPE_LABELS, listSources } from "@/services/sources";
import { getEvidenceCounts } from "@/services/evidence";

export const dynamic = "force-dynamic";

export default async function SourcesPage({ params }: { params: Promise<{ brandId: string }> }) {
  const { brandId } = await params;
  const ctx = await requireBrandAccess(brandId);
  const [sources, csrfToken, evidenceCounts] = await Promise.all([
    listSources(ctx),
    getCsrfToken(),
    getEvidenceCounts(ctx),
  ]);

  const canUpload = hasCapability(ctx, "source:upload");
  const canDelete = hasCapability(ctx, "source:delete");
  const totalRedactions = sources.reduce((sum, s) => sum + s.piiRedactionCount, 0);

  return (
    <>
      <PageHeader
        title="Data sources"
        description="Raw sources are kept separate from the evidence derived from them. Only redacted text is ever sent to a model provider."
        breadcrumb={`${ctx.brandName} / Data sources`}
      />

      <div className="mb-4">
        <Callout tone="warn" title="Before uploading customer data">
          Automated PII detection is best-effort pattern matching. It is not a substitute for legal
          or compliance review. Do not upload data you are not entitled to process.
        </Callout>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Sources" value={sources.length} />
        <Stat
          label="Documents"
          value={sources.reduce((sum, s) => sum + s.documentCount, 0)}
          hint="parsed units"
        />
        <Stat
          label="Evidence records"
          value={evidenceCounts.total ?? 0}
          hint={`${evidenceCounts.approved ?? 0} approved`}
        />
        <Stat label="PII redactions" value={totalRedactions} hint="pattern matches replaced" />
      </div>

      {canUpload ? (
        <div className="mb-5">
          <SourceUploadForms brandId={brandId} csrfToken={csrfToken} />
        </div>
      ) : (
        <p className="mb-5 text-sm text-ink-muted">
          Your role ({ctx.role}) can view sources but not upload them.
        </p>
      )}

      {canUpload ? (
        <div className="mb-5">
          <Card>
            <CardHeader
              title="Deep research"
              description="Plans a few research questions from this brand's own context — competitors, description — and runs a web search for each. Findings feed the evidence pipeline like any other source."
            />
            <div className="px-4 py-4">
              <ActionForm
                action={requestWebResearchAction}
                csrfToken={csrfToken}
                hidden={{ brandId }}
              >
                <SubmitButton label="Run deep research" pendingLabel="Queuing…" />
              </ActionForm>
            </div>
          </Card>
        </div>
      ) : null}

      <Card>
        <CardHeader
          title="Ingested sources"
          description="Each source runs parse → redact → chunk → extract → embed. Stages report independently, so one failure never discards the others."
        />
        {sources.length === 0 ? (
          <EmptyState
            title="No sources yet"
            description="Upload a CSV, JSON, TXT, Markdown or DOCX file, or paste transcript text directly. Run npm run db:seed to load the demo corpus."
          />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Source</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th className="text-right">Docs</th>
                  <th className="text-right">Evidence</th>
                  <th className="text-right">Redactions</th>
                  <th>Observed</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sources.map((source) => (
                  <tr key={source.id} className="hover:bg-surface-sunken">
                    <td>
                      <Link
                        href={`/brands/${brandId}/sources/${source.id}`}
                        className="font-medium text-accent hover:underline"
                      >
                        {source.label}
                      </Link>
                      <div className="mt-0.5 flex flex-wrap gap-1">
                        <Badge tone="neutral">{source.sourceSystem.replace(/_/g, " ")}</Badge>
                        {source.excludeFromModelCalls ? (
                          <Badge
                            tone="warn"
                            title="Parsed and stored, but never sent to a model provider"
                          >
                            excluded from model calls
                          </Badge>
                        ) : null}
                      </div>
                    </td>
                    <td className="text-ink-muted">
                      {SOURCE_TYPE_LABELS[source.sourceType] ?? source.sourceType}
                    </td>
                    <td>
                      <StatusBadge status={source.status} />
                    </td>
                    <td className="text-right tabular-nums">{source.documentCount}</td>
                    <td className="text-right tabular-nums">{source.evidenceCount}</td>
                    <td className="text-right tabular-nums">{source.piiRedactionCount}</td>
                    <td className="whitespace-nowrap text-xs text-ink-muted">
                      {source.observedAt ? source.observedAt.toISOString().slice(0, 10) : "—"}
                    </td>
                    <td>
                      <div className="flex justify-end gap-1">
                        {canUpload ? (
                          <ActionForm
                            action={retrySourceAction}
                            csrfToken={csrfToken}
                            hidden={{ brandId, sourceId: source.id }}
                          >
                            <SubmitButton label="Retry" variant="ghost" size="sm" />
                          </ActionForm>
                        ) : null}
                        {canDelete ? (
                          <ActionForm
                            action={deleteSourceAction}
                            csrfToken={csrfToken}
                            hidden={{ brandId, sourceId: source.id }}
                          >
                            <SubmitButton
                              label="Delete"
                              variant="ghost"
                              size="sm"
                              confirm={`Delete "${source.label}"? Derived evidence is marked unavailable and embeddings are deleted. Approved persona versions are kept and queued for review.`}
                            />
                          </ActionForm>
                        ) : null}
                      </div>
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
