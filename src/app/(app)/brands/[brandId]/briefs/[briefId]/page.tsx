import {
  approveBriefAction,
  generateBriefAction,
  rejectBriefAction,
} from "@/app/actions/content-briefs";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { BriefEditorForm } from "@/components/forms/brief-editor";
import {
  Badge,
  Card,
  CardHeader,
  ErrorState,
  Field,
  OriginBadge,
  PageHeader,
  Textarea,
} from "@/components/ui";
import { hasCapability, requireBrandAccess } from "@/lib/auth/context";
import { getCsrfToken } from "@/lib/auth/session";
import { getBriefDetail, parseBriefBody } from "@/services/content-brief";

export const dynamic = "force-dynamic";

export default async function BriefDetailPage({
  params,
}: {
  params: Promise<{ brandId: string; briefId: string }>;
}) {
  const { brandId, briefId } = await params;
  const ctx = await requireBrandAccess(brandId);

  const [brief, csrfToken] = await Promise.all([getBriefDetail(ctx, briefId), getCsrfToken()]);

  const parsedBody = parseBriefBody(brief.body);
  const canApprove = hasCapability(ctx, "content:approve");
  const canEdit = hasCapability(ctx, "content:generate");
  const exportBase = `/brands/${brandId}/briefs/${briefId}/export?format`;

  return (
    <>
      <PageHeader
        title={brief.workingTitle}
        breadcrumb={`${ctx.brandName} / SEO briefs / ${brief.workingTitle}`}
        actions={
          <span className="flex items-center gap-2">
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
          </span>
        }
      />

      <div className="mb-4 flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="text-ink-subtle">
          v{brief.version} · persona {brief.personaName ?? "—"} · from opportunity{" "}
          {brief.opportunityTitle ?? "—"} · {brief.evidenceIds.length} evidence link
          {brief.evidenceIds.length === 1 ? "" : "s"} · {brief.profoundPromptIds.length} Profound
          prompt
          {brief.profoundPromptIds.length === 1 ? "" : "s"}
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

      {brief.versions.length > 1 ? (
        <Card className="mb-4">
          <CardHeader title="Versions" description="This brief's revision lineage." />
          <ul className="divide-y divide-surface-border px-4 py-2 text-xs">
            {brief.versions.map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-2 py-1">
                <span>
                  v{v.version} {v.id === brief.id ? "(this version)" : ""}
                </span>
                <Badge tone={v.reviewStatus === "approved" ? "success" : "neutral"}>
                  {v.reviewStatus}
                </Badge>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {brief.reviewStatus !== "approved" && (canApprove || canEdit) ? (
        <Card className="mb-4">
          <CardHeader title="Review" />
          <div className="flex flex-wrap gap-4 px-4 py-3">
            {canApprove && brief.reviewStatus !== "rejected" ? (
              <ActionForm
                action={approveBriefAction}
                csrfToken={csrfToken}
                hidden={{ brandId, briefId }}
                className="space-y-0"
              >
                <SubmitButton label="Approve" />
              </ActionForm>
            ) : null}
            {canApprove && brief.reviewStatus !== "rejected" ? (
              <ActionForm
                action={rejectBriefAction}
                csrfToken={csrfToken}
                hidden={{ brandId, briefId }}
              >
                <Field label="Rejection reason">
                  <Textarea name="reason" rows={2} required />
                </Field>
                <SubmitButton label="Reject" variant="danger" />
              </ActionForm>
            ) : null}
          </div>
        </Card>
      ) : null}

      {brief.opportunityId ? (
        <Card className="mb-4">
          <CardHeader title="Regenerate" description="Creates a new version; this one is kept." />
          <div className="px-4 py-3">
            <ActionForm
              action={generateBriefAction}
              csrfToken={csrfToken}
              hidden={{
                brandId,
                opportunityId: brief.opportunityId,
                regenerateFromBriefId: briefId,
              }}
              className="space-y-0"
            >
              <SubmitButton
                label="Regenerate as new version"
                variant="secondary"
                pendingLabel="Queuing…"
              />
            </ActionForm>
          </div>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title="Brief editor"
          description="All 27 required sections. Evidence and Profound-prompt citations are re-validated on save."
        />
        <div className="px-4 py-3">
          {parsedBody ? (
            <BriefEditorForm
              brandId={brandId}
              briefId={briefId}
              initialBody={parsedBody}
              csrfToken={csrfToken}
              readOnly={brief.reviewStatus === "approved" || brief.reviewStatus === "rejected"}
            />
          ) : (
            <ErrorState
              title="This brief's stored body no longer matches the brief schema"
              message="It cannot be edited safely. Regenerate a new version instead."
            />
          )}
        </div>
      </Card>
    </>
  );
}
