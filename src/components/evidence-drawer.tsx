import Link from "next/link";
import { attachEvidenceAction, detachEvidenceAction } from "@/app/actions/personas";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { Badge, ProvenanceBadge, Select, cn } from "@/components/ui";

export type DrawerEvidence = {
  evidenceId: string;
  relation: "supports" | "contradicts";
  normalizedClaim: string;
  redactedText: string;
  category: string;
  provenance: string;
  journeyStage: string;
  sourceLabel: string;
  sourceLocation: string;
  speaker: string | null;
  observedAt: Date | null;
  unavailable: boolean;
  availability: string;
};

export type AttachableEvidence = {
  id: string;
  normalizedClaim: string;
  category: string;
  provenance: string;
  sourceLabel: string;
};

/**
 * The per-field evidence drawer (§31.14).
 *
 * A `<details>` disclosure rather than a modal: it works without client-side
 * state, several can be open at once for comparison, and the open drawer is part
 * of the page so it prints and copies. Every claim on a persona has one, so
 * "where did this come from?" is always one click away.
 */
export function EvidenceDrawer({
  brandId,
  personaId,
  fieldId,
  evidence,
  attachable,
  editable,
  csrfToken,
  insufficientEvidence,
}: {
  brandId: string;
  personaId: string;
  fieldId: string;
  evidence: DrawerEvidence[];
  attachable: AttachableEvidence[];
  editable: boolean;
  csrfToken: string;
  insufficientEvidence: boolean;
}) {
  const supporting = evidence.filter((item) => item.relation === "supports");
  const contradicting = evidence.filter((item) => item.relation === "contradicts");

  return (
    <details className="group mt-2 rounded-md border border-surface-border bg-surface">
      <summary className="cursor-pointer list-none px-3 py-2 text-xs font-medium text-ink-muted hover:bg-surface-sunken">
        <span className="group-open:hidden">Show evidence</span>
        <span className="hidden group-open:inline">Hide evidence</span>
        <span className="ml-2 text-ink-subtle">
          {supporting.length} supporting
          {contradicting.length > 0 ? `, ${contradicting.length} contradicting` : ""}
          {insufficientEvidence ? " · marked insufficient" : ""}
        </span>
      </summary>

      <div className="space-y-3 border-t border-surface-border px-3 py-3">
        {supporting.length === 0 && contradicting.length === 0 ? (
          <p className="text-xs text-ink-muted">
            {insufficientEvidence
              ? "No evidence is attached, which is why this field is marked insufficient. Attach a record below to turn it into a supported claim."
              : "No evidence is attached to this field."}
          </p>
        ) : null}

        {supporting.length > 0 ? (
          <EvidenceList
            title="Supporting"
            items={supporting}
            brandId={brandId}
            personaId={personaId}
            fieldId={fieldId}
            editable={editable}
            csrfToken={csrfToken}
          />
        ) : null}

        {contradicting.length > 0 ? (
          <EvidenceList
            title="Contradicting"
            items={contradicting}
            brandId={brandId}
            personaId={personaId}
            fieldId={fieldId}
            editable={editable}
            csrfToken={csrfToken}
            tone="danger"
          />
        ) : null}

        {editable ? (
          <div className="rounded border border-dashed border-surface-border p-2">
            {attachable.length === 0 ? (
              <p className="text-xs text-ink-muted">
                No further approved evidence is available to attach. Approve more evidence in the
                explorer first.
              </p>
            ) : (
              <ActionForm
                action={attachEvidenceAction}
                csrfToken={csrfToken}
                hidden={{ brandId, personaId, fieldId }}
                className="space-y-2"
              >
                <label className="label" htmlFor={`attach-${fieldId}`}>
                  Attach approved evidence
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <Select id={`attach-${fieldId}`} name="evidenceId" className="max-w-md flex-1">
                    {attachable.map((item) => (
                      <option key={item.id} value={item.id}>
                        {item.category.replace(/_/g, " ")} · {item.sourceLabel} —{" "}
                        {item.normalizedClaim.slice(0, 90)}
                      </option>
                    ))}
                  </Select>
                  <Select name="relation" className="w-40" defaultValue="supports">
                    <option value="supports">as supporting</option>
                    <option value="contradicts">as contradicting</option>
                  </Select>
                  <SubmitButton label="Attach" variant="secondary" size="sm" />
                </div>
                <p className="hint">
                  The highest-quality approved records for this brand, whose sources still exist. To
                  attach something further down the list, find it in the{" "}
                  <Link
                    href={`/brands/${brandId}/evidence`}
                    className="font-medium text-accent hover:underline"
                  >
                    evidence explorer
                  </Link>{" "}
                  and raise its review status or quality first.
                </p>
              </ActionForm>
            )}
          </div>
        ) : null}
      </div>
    </details>
  );
}

function EvidenceList({
  title,
  items,
  brandId,
  personaId,
  fieldId,
  editable,
  csrfToken,
  tone = "neutral",
}: {
  title: string;
  items: DrawerEvidence[];
  brandId: string;
  personaId: string;
  fieldId: string;
  editable: boolean;
  csrfToken: string;
  tone?: "neutral" | "danger";
}) {
  return (
    <div>
      <p
        className={cn(
          "mb-1 text-2xs font-semibold uppercase tracking-wide",
          tone === "danger" ? "text-danger" : "text-ink-muted",
        )}
      >
        {title} ({items.length})
      </p>
      <ul className="divide-y divide-surface-border rounded border border-surface-border">
        {items.map((item) => {
          const unavailable = item.unavailable || item.availability !== "available";
          return (
            <li key={`${item.evidenceId}-${item.relation}`} className="px-2.5 py-2">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <Link
                  href={`/brands/${brandId}/evidence/${item.evidenceId}`}
                  className="min-w-0 flex-1 text-xs font-medium text-ink hover:text-accent hover:underline"
                >
                  {item.normalizedClaim}
                </Link>
                <div className="flex flex-wrap items-center gap-1">
                  <ProvenanceBadge provenance={item.provenance} />
                  <Badge tone="neutral">{item.category.replace(/_/g, " ")}</Badge>
                  {unavailable ? (
                    <Badge
                      tone="danger"
                      title="The source was deleted. The link is kept for auditability but no longer contributes to confidence."
                    >
                      unavailable
                    </Badge>
                  ) : null}
                </div>
              </div>

              <p className="mt-1 line-clamp-2 text-xs italic text-ink-muted">
                “{item.redactedText}”
              </p>

              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-2xs text-ink-subtle">
                <span>{item.sourceLabel}</span>
                <span>· {item.sourceLocation}</span>
                {item.speaker ? <span>· {item.speaker}</span> : null}
                {item.observedAt ? (
                  <span>· {item.observedAt.toISOString().slice(0, 10)}</span>
                ) : null}
                <code className="text-ink-subtle/80">{item.evidenceId}</code>

                {editable ? (
                  <ActionForm
                    action={detachEvidenceAction}
                    csrfToken={csrfToken}
                    hidden={{
                      brandId,
                      personaId,
                      fieldId,
                      evidenceId: item.evidenceId,
                      relation: item.relation,
                    }}
                    className="ml-auto space-y-0"
                  >
                    <SubmitButton
                      label="Detach"
                      variant="ghost"
                      size="sm"
                      confirm="Detach this evidence record from the claim? Confidence will be recomputed."
                    />
                  </ActionForm>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
