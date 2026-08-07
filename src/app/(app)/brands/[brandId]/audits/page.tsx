import Link from "next/link";
import { generatePageAuditAction } from "@/app/actions/page-audits";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  Field,
  Input,
  OriginBadge,
  PageHeader,
  Select,
  Textarea,
} from "@/components/ui";
import { hasCapability, requireBrandAccess } from "@/lib/auth/context";
import { getCsrfToken } from "@/lib/auth/session";
import { listApprovedPersonaVersions } from "@/services/personas";
import { listApprovedPromptSetVersions } from "@/services/prompt-sets";
import { listPageAudits } from "@/services/page-audit";

export const dynamic = "force-dynamic";

export default async function AuditsPage({ params }: { params: Promise<{ brandId: string }> }) {
  const { brandId } = await params;
  const ctx = await requireBrandAccess(brandId);

  const [audits, personaVersions, promptSetVersions, csrfToken] = await Promise.all([
    listPageAudits(ctx),
    listApprovedPersonaVersions(ctx),
    listApprovedPromptSetVersions(ctx),
    getCsrfToken(),
  ]);

  const canGenerate = hasCapability(ctx, "content:generate");

  return (
    <>
      <PageHeader
        title="Page audits"
        description="Evaluates a homepage or landing page against one approved persona's requirements. There is no live crawler in this build — paste the page's content directly. Findings distinguish what belongs on this page from what belongs on a supporting page."
        breadcrumb={`${ctx.brandName} / Page audits`}
      />

      {canGenerate ? (
        <Card className="mb-4">
          <CardHeader title="Run a page audit" />
          <div className="px-4 py-3">
            {personaVersions.length === 0 ? (
              <p className="text-sm text-ink-muted">Approve a persona version first.</p>
            ) : (
              <ActionForm
                action={generatePageAuditAction}
                csrfToken={csrfToken}
                hidden={{ brandId }}
              >
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <Field label="Persona version">
                    <Select name="personaVersionId" required>
                      {personaVersions.map((p) => (
                        <option key={p.personaVersionId} value={p.personaVersionId}>
                          {p.personaName} (v{p.version})
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field
                    label="Prompt-set version"
                    hint="Optional — links Profound-reported gaps into the findings."
                  >
                    <Select name="promptSetVersionId">
                      <option value="">None</option>
                      {promptSetVersions.map((s) => (
                        <option key={s.promptSetVersionId} value={s.promptSetVersionId}>
                          {s.promptSetName} (v{s.version})
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="Scope">
                    <Select name="scope" defaultValue="homepage">
                      <option value="homepage">Homepage</option>
                      <option value="landing_page">Landing page</option>
                      <option value="product_page">Product page</option>
                    </Select>
                  </Field>
                  <Field label="URL" hint="A label for reference — not fetched.">
                    <Input name="url" type="url" placeholder="https://example.com/" />
                  </Field>
                </div>
                <Field label="Page title">
                  <Input name="pageTitle" />
                </Field>
                <Field
                  label="Page content"
                  hint="Paste the page's text content (at least 50 characters)."
                >
                  <Textarea name="pageContent" rows={10} required minLength={50} />
                </Field>
                <SubmitButton label="Run audit" pendingLabel="Queuing…" />
              </ActionForm>
            )}
          </div>
        </Card>
      ) : null}

      <Card>
        <CardHeader title={`${audits.length} audit${audits.length === 1 ? "" : "s"}`} />
        {audits.length === 0 ? (
          <EmptyState
            title="No page audits yet"
            description="Run one above once a persona is approved."
          />
        ) : (
          <ul className="divide-y divide-surface-border">
            {audits.map((audit) => (
              <li key={audit.id} className="px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <Link
                    href={`/brands/${brandId}/audits/${audit.id}`}
                    className="min-w-0 flex-1 text-sm font-semibold text-ink hover:text-accent hover:underline"
                  >
                    {audit.pageTitle ?? audit.url ?? `${audit.scope} audit`}
                  </Link>
                  <div className="flex items-center gap-1.5">
                    <OriginBadge origin={audit.dataOrigin} />
                    {audit.criticalCount > 0 ? (
                      <Badge tone="danger">{audit.criticalCount} critical</Badge>
                    ) : null}
                    {audit.highCount > 0 ? <Badge tone="warn">{audit.highCount} high</Badge> : null}
                    <Badge
                      tone={
                        audit.reviewStatus === "approved"
                          ? "success"
                          : audit.reviewStatus === "rejected"
                            ? "danger"
                            : "neutral"
                      }
                    >
                      {audit.reviewStatus.replace(/_/g, " ")}
                    </Badge>
                  </div>
                </div>
                <p className="mt-1 text-2xs text-ink-subtle">
                  {audit.personaName ?? "—"} · scope {audit.scope.replace("_", " ")} ·{" "}
                  {audit.findingCount} finding{audit.findingCount === 1 ? "" : "s"}
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
