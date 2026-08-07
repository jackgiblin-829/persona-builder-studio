import { approvePageAuditAction, rejectPageAuditAction } from "@/app/actions/page-audits";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import {
  Badge,
  Card,
  CardHeader,
  Chips,
  Field,
  KeyValue,
  OriginBadge,
  PageHeader,
  Textarea,
} from "@/components/ui";
import { hasCapability, requireBrandAccess } from "@/lib/auth/context";
import { getCsrfToken } from "@/lib/auth/session";
import { getPageAuditDetail, type AuditFindingRow } from "@/services/page-audit";

export const dynamic = "force-dynamic";

const SEVERITY_TONE: Record<string, "danger" | "warn" | "accent" | "neutral"> = {
  critical: "danger",
  high: "danger",
  medium: "warn",
  low: "accent",
  info: "neutral",
};

function FindingCard({ finding }: { finding: AuditFindingRow }) {
  return (
    <div className="border-b border-surface-border px-4 py-3 last:border-0">
      <div className="mb-1 flex flex-wrap items-center gap-2">
        <Badge tone={SEVERITY_TONE[finding.severity] ?? "neutral"}>{finding.severity}</Badge>
        <span className="text-sm font-medium text-ink">{finding.pageElement}</span>
      </div>
      <p className="text-xs text-ink-muted">
        <strong>Persona requirement:</strong> {finding.personaRequirement}
      </p>
      {finding.pageExcerpt ? (
        <p className="mt-1 rounded bg-surface-sunken px-2 py-1 text-xs italic text-ink-subtle">
          &ldquo;{finding.pageExcerpt}&rdquo;
        </p>
      ) : null}
      <p className="mt-1 text-xs text-ink">{finding.explanation}</p>
      <p className="mt-1 text-xs text-ink">
        <strong>Recommended change:</strong> {finding.recommendedChange}
      </p>
      {finding.suggestedReplacement ? (
        <p className="mt-1 text-xs text-ink">
          <strong>Suggested replacement:</strong> {finding.suggestedReplacement}
        </p>
      ) : null}
      <p className="mt-1 text-2xs text-ink-subtle">
        Validation: {finding.validationMethod} · Evidence:{" "}
        {finding.evidenceIds.join(", ") || "none"} · Profound prompts:{" "}
        {finding.relatedProfoundPromptIds.join(", ") || "none"}
      </p>
    </div>
  );
}

export default async function AuditDetailPage({
  params,
}: {
  params: Promise<{ brandId: string; auditId: string }>;
}) {
  const { brandId, auditId } = await params;
  const ctx = await requireBrandAccess(brandId);

  const [audit, csrfToken] = await Promise.all([getPageAuditDetail(ctx, auditId), getCsrfToken()]);

  const canApprove = hasCapability(ctx, "content:approve");
  const exportBase = `/brands/${brandId}/audits/${auditId}/export?format`;
  const bySeverity = (rows: AuditFindingRow[]) =>
    [...rows].sort(
      (a, b) =>
        ["critical", "high", "medium", "low", "info"].indexOf(a.severity) -
        ["critical", "high", "medium", "low", "info"].indexOf(b.severity),
    );

  return (
    <>
      <PageHeader
        title={audit.pageTitle ?? audit.url ?? `${audit.scope} audit`}
        breadcrumb={`${ctx.brandName} / Page audits / ${audit.pageTitle ?? audit.scope}`}
        actions={
          <span className="flex items-center gap-2">
            <OriginBadge origin={audit.dataOrigin} />
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
          </span>
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="text-ink-subtle">
          Persona {audit.personaName ?? "—"} · scope {audit.scope.replace("_", " ")}
          {audit.url ? ` · ${audit.url}` : ""}
        </span>
        <span className="flex gap-2">
          <a className="text-accent hover:underline" href={`${exportBase}=json`}>
            Export JSON
          </a>
          <a className="text-accent hover:underline" href={`${exportBase}=csv`}>
            CSV
          </a>
          <a className="text-accent hover:underline" href={`${exportBase}=md`}>
            Markdown
          </a>
        </span>
      </div>

      <Card className="mb-4">
        <CardHeader title="Summary" />
        <div className="px-4 py-3">
          <p className="mb-3 text-sm text-ink">{audit.summary}</p>
          <KeyValue
            items={Object.entries(audit.scores).map(([key, value]) => ({
              label: key.replace(/_/g, " "),
              value: `${(value * 100).toFixed(0)}%`,
            }))}
          />
        </div>
      </Card>

      {audit.reviewStatus !== "approved" && canApprove ? (
        <Card className="mb-4">
          <CardHeader title="Review" />
          <div className="flex flex-wrap gap-4 px-4 py-3">
            <ActionForm
              action={approvePageAuditAction}
              csrfToken={csrfToken}
              hidden={{ brandId, auditId }}
              className="space-y-0"
            >
              <SubmitButton label="Approve" />
            </ActionForm>
            <ActionForm
              action={rejectPageAuditAction}
              csrfToken={csrfToken}
              hidden={{ brandId, auditId }}
            >
              <Field label="Rejection reason">
                <Textarea name="reason" rows={2} required />
              </Field>
              <SubmitButton label="Reject" variant="danger" />
            </ActionForm>
          </div>
        </Card>
      ) : null}

      <Card className="mb-4">
        <CardHeader
          title={`Findings on this page (${audit.homepageFindings.length})`}
          description="§30: these are the concerns that belong on this exact page."
        />
        {audit.homepageFindings.length === 0 ? (
          <p className="px-4 py-3 text-sm text-ink-muted">No findings against this page.</p>
        ) : (
          bySeverity(audit.homepageFindings).map((finding) => (
            <FindingCard key={finding.id} finding={finding} />
          ))
        )}
      </Card>

      <Card className="mb-4">
        <CardHeader
          title={`Findings that belong elsewhere (${audit.supportingPageFindings.length})`}
          description="Real persona concerns this audit deliberately did not recommend adding to this page."
        />
        {audit.supportingPageFindings.length === 0 ? (
          <p className="px-4 py-3 text-sm text-ink-muted">
            Nothing was deferred to a supporting page.
          </p>
        ) : (
          bySeverity(audit.supportingPageFindings).map((finding) => (
            <FindingCard key={finding.id} finding={finding} />
          ))
        )}
      </Card>

      {audit.supportingPageRecommendations.length > 0 ? (
        <Card>
          <CardHeader title="Supporting-page recommendations" />
          <ul className="divide-y divide-surface-border px-4 py-2 text-sm">
            {audit.supportingPageRecommendations.map((rec, index) => (
              <li key={index} className="py-2">
                <Chips values={[rec.suggestedPageType]} tone="accent" /> <span>{rec.need}</span>
                <p className="text-xs text-ink-subtle">{rec.rationale}</p>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </>
  );
}
