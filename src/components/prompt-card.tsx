import Link from "next/link";
import {
  removeControlAction,
  setControlAction,
  updatePromptAction,
} from "@/app/actions/prompt-sets";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import {
  Badge,
  Field,
  Input,
  ProvenanceBadge,
  Select,
  StatusBadge,
  Textarea,
} from "@/components/ui";
import { LOCAL_ONLY_FIELDS } from "@/lib/profound-tags";
import {
  INTENT_ORDER,
  PROMPT_INTENT_LABELS,
  STAGE_ORDER,
  type PromptMetadataView,
  type PromptRow,
} from "@/lib/prompt-display";

/**
 * One prompt in the editor (§18).
 *
 * Three disclosures hang off every prompt — evidence, persona fields, Profound
 * metadata — because those are the three questions a reviewer asks: where did
 * this come from, which part of the persona does it test, and what will actually
 * be sent to the vendor. They are `<details>` rather than modals so several can
 * be open side by side and the whole page stays printable.
 */
export function PromptCard({
  brandId,
  promptSetId,
  prompt,
  editable,
  csrfToken,
  selectable,
}: {
  brandId: string;
  promptSetId: string;
  prompt: PromptRow;
  editable: boolean;
  csrfToken: string;
  selectable: boolean;
}) {
  const metadata = prompt.profoundMetadata as PromptMetadataView;
  const warning = prompt.similarityWarning;

  return (
    <li className="px-4 py-3" id={prompt.id}>
      <div className="flex items-start gap-3">
        {selectable ? (
          <input
            type="checkbox"
            name="promptIds"
            value={prompt.id}
            form="bulk-review"
            aria-label={`Select prompt: ${prompt.promptText}`}
            className="mt-1 h-4 w-4 shrink-0 rounded border-surface-border text-accent focus:ring-accent"
          />
        ) : null}

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <p className="min-w-0 flex-1 text-sm font-medium text-ink">{prompt.promptText}</p>
            <div className="flex flex-wrap items-center gap-1.5">
              <StatusBadge status={prompt.reviewStatus} />
              <Badge
                tone={
                  prompt.trackingPriority === "high"
                    ? "accent"
                    : prompt.trackingPriority === "low"
                      ? "neutral"
                      : "external"
                }
                title="How much this prompt matters relative to the rest of the set"
              >
                {prompt.trackingPriority} priority
              </Badge>
              {prompt.editedByUser ? (
                <Badge tone="neutral" title="Rewritten by a reviewer rather than generated">
                  edited
                </Badge>
              ) : null}
            </div>
          </div>

          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-subtle">
            <span>{PROMPT_INTENT_LABELS[prompt.intent] ?? prompt.intent}</span>
            <span>· {prompt.journeyStage.replace(/_/g, " ")}</span>
            <span>· {prompt.executionMode.replace(/_/g, " ")}</span>
            <span>· topic: {prompt.topic}</span>
            <code className="text-ink-subtle/80">{prompt.id}</code>
          </div>

          <p className="mt-2 text-xs text-ink-muted">
            <span className="font-medium text-ink">Information need:</span> {prompt.informationNeed}
          </p>
          <p className="mt-1 text-xs text-ink-muted">
            <span className="font-medium text-ink">Why it was included:</span>{" "}
            {prompt.inclusionRationale}
          </p>

          {warning ? (
            <p className="mt-2 rounded border border-warn/30 bg-warn-soft px-2 py-1.5 text-xs text-ink">
              <span className="font-semibold">
                {warning.kind === "exact"
                  ? "Exact duplicate"
                  : warning.kind === "semantic"
                    ? "Near duplicate"
                    : "Overlapping wording"}
              </span>{" "}
              ({(warning.score * 100).toFixed(0)}%
              {warning.promptSetLabel ? ` · ${warning.promptSetLabel}` : ""}):{" "}
              <Link href={`#${warning.promptId}`} className="underline">
                {warning.text}
              </Link>
              {warning.kind === "exact" ? (
                <span className="block text-ink-muted">
                  An exact duplicate blocks approval — deploying both would split the same
                  question&rsquo;s results across two Profound rows.
                </span>
              ) : (
                <span className="block text-ink-muted">
                  A warning, not a block. Keep both if they genuinely ask different things.
                </span>
              )}
            </p>
          ) : null}

          <ControlPanel
            brandId={brandId}
            promptSetId={promptSetId}
            prompt={prompt}
            editable={editable}
            csrfToken={csrfToken}
          />

          {prompt.expectedAnswerElements.length > 0 ? (
            <div className="mt-2">
              <p className="text-2xs font-semibold uppercase tracking-wide text-ink-muted">
                A useful answer contains
              </p>
              <ul className="mt-0.5 list-inside list-disc text-xs text-ink-muted">
                {prompt.expectedAnswerElements.map((element) => (
                  <li key={element}>{element}</li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className="mt-2 flex flex-wrap gap-2">
            <EvidenceDisclosure brandId={brandId} prompt={prompt} />
            <PersonaFieldDisclosure prompt={prompt} />
            <MetadataDisclosure metadata={metadata} />
            {editable ? (
              <EditDisclosure
                brandId={brandId}
                promptSetId={promptSetId}
                prompt={prompt}
                csrfToken={csrfToken}
              />
            ) : null}
          </div>
        </div>
      </div>
    </li>
  );
}

function ControlPanel({
  brandId,
  promptSetId,
  prompt,
  editable,
  csrfToken,
}: {
  brandId: string;
  promptSetId: string;
  prompt: PromptRow;
  editable: boolean;
  csrfToken: string;
}) {
  if (prompt.promptType === "generic_control") {
    return (
      <p className="mt-2 rounded border border-surface-border bg-surface-sunken px-2 py-1.5 text-xs text-ink-muted">
        Generic control
        {prompt.pairedTo ? (
          <>
            {" "}
            for{" "}
            <Link href={`#${prompt.pairedTo.id}`} className="font-medium text-accent underline">
              {prompt.pairedTo.promptText}
            </Link>
          </>
        ) : (
          " — currently paired to nothing"
        )}
        .
      </p>
    );
  }

  return (
    <div className="mt-2 rounded border border-surface-border bg-surface-sunken px-2 py-1.5">
      {prompt.control ? (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span className="font-medium text-ink">Generic control:</span>
          <span className="text-ink-muted">{prompt.control.promptText}</span>
          {editable ? (
            <ActionForm
              action={removeControlAction}
              csrfToken={csrfToken}
              hidden={{ brandId, promptSetId, promptId: prompt.id }}
              className="ml-auto space-y-0"
            >
              <SubmitButton
                label="Remove control"
                variant="ghost"
                size="sm"
                confirm="Remove the control? This prompt can still be tracked, but no lift can be measured for it."
              />
            </ActionForm>
          ) : null}
        </div>
      ) : (
        <div className="text-xs">
          <p className="text-ink-muted">
            <span className="font-medium text-ink">No generic control.</span> This prompt can be
            tracked, but without a control there is nothing to measure the persona framing against.
          </p>
          {editable ? (
            <ActionForm
              action={setControlAction}
              csrfToken={csrfToken}
              hidden={{ brandId, promptSetId, promptId: prompt.id }}
              className="mt-1.5 space-y-1.5"
            >
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  name="controlText"
                  placeholder="The same question without the persona's qualifier"
                  className="max-w-lg flex-1 text-xs"
                  maxLength={300}
                  required
                />
                <SubmitButton label="Pair control" variant="secondary" size="sm" />
              </div>
            </ActionForm>
          ) : null}
        </div>
      )}
    </div>
  );
}

function EvidenceDisclosure({ brandId, prompt }: { brandId: string; prompt: PromptRow }) {
  return (
    <details className="group flex-1 basis-full rounded-md border border-surface-border bg-surface">
      <summary className="cursor-pointer list-none px-3 py-1.5 text-xs font-medium text-ink-muted hover:bg-surface-sunken">
        <span className="group-open:hidden">Show evidence</span>
        <span className="hidden group-open:inline">Hide evidence</span>
        <span className="ml-2 text-ink-subtle">
          {prompt.evidence.length} record{prompt.evidence.length === 1 ? "" : "s"}
        </span>
      </summary>
      <div className="border-t border-surface-border px-3 py-2">
        {prompt.evidence.length === 0 ? (
          <p className="text-xs text-ink-muted">
            No evidence is attached. A prompt with no available evidence cannot be part of an
            approved set — reject it, or restore the source it came from.
          </p>
        ) : (
          <ul className="divide-y divide-surface-border">
            {prompt.evidence.map((link) => {
              const unavailable = link.unavailable || link.availability !== "available";
              return (
                <li key={link.evidenceId} className="py-1.5">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <Link
                      href={`/brands/${brandId}/evidence/${link.evidenceId}`}
                      className="min-w-0 flex-1 text-xs font-medium text-ink hover:text-accent hover:underline"
                    >
                      {link.normalizedClaim}
                    </Link>
                    <div className="flex flex-wrap items-center gap-1">
                      <ProvenanceBadge provenance={link.provenance} />
                      <Badge tone="neutral">{link.category.replace(/_/g, " ")}</Badge>
                      {unavailable ? (
                        <Badge tone="danger" title="The source was deleted.">
                          unavailable
                        </Badge>
                      ) : null}
                    </div>
                  </div>
                  <p className="mt-0.5 line-clamp-2 text-xs italic text-ink-muted">
                    “{link.redactedText}”
                  </p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-2xs text-ink-subtle">
                    <span>{link.sourceLabel}</span>
                    <span>· {link.sourceLocation}</span>
                    {link.speaker ? <span>· {link.speaker}</span> : null}
                    {link.observedAt ? (
                      <span>· {link.observedAt.toISOString().slice(0, 10)}</span>
                    ) : null}
                    <code className="text-ink-subtle/80">{link.evidenceId}</code>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </details>
  );
}

/** §18 persona-field drawer: which part of the persona this prompt tests. */
function PersonaFieldDisclosure({ prompt }: { prompt: PromptRow }) {
  const hasFields = prompt.personaFieldStatements.length > 0;
  const hasText = prompt.constraintsUsed.length > 0 || prompt.decisionCriteriaUsed.length > 0;
  if (!hasFields && !hasText && prompt.vocabularyUsed.length === 0) return null;

  return (
    <details className="group flex-1 basis-full rounded-md border border-surface-border bg-surface">
      <summary className="cursor-pointer list-none px-3 py-1.5 text-xs font-medium text-ink-muted hover:bg-surface-sunken">
        <span className="group-open:hidden">Show persona fields</span>
        <span className="hidden group-open:inline">Hide persona fields</span>
        <span className="ml-2 text-ink-subtle">
          {prompt.personaFieldStatements.length > 0
            ? `${prompt.personaFieldStatements.length} field${prompt.personaFieldStatements.length === 1 ? "" : "s"}`
            : "vocabulary only"}
        </span>
      </summary>
      <div className="space-y-2 border-t border-surface-border px-3 py-2 text-xs">
        {prompt.personaFieldStatements.map((field) => (
          <p key={field.id}>
            <Badge tone="accent">{field.fieldType.replace(/_/g, " ")}</Badge>{" "}
            <span className="text-ink">{field.statement}</span>
          </p>
        ))}
        {prompt.constraintsUsed.length > 0 ? (
          <p className="text-ink-muted">
            <span className="font-medium text-ink">Constraints used:</span>{" "}
            {prompt.constraintsUsed.join("; ")}
          </p>
        ) : null}
        {prompt.decisionCriteriaUsed.length > 0 ? (
          <p className="text-ink-muted">
            <span className="font-medium text-ink">Decision criteria used:</span>{" "}
            {prompt.decisionCriteriaUsed.join("; ")}
          </p>
        ) : null}
        {prompt.vocabularyUsed.length > 0 ? (
          <p className="text-ink-muted">
            <span className="font-medium text-ink">Customer vocabulary preserved:</span>{" "}
            {prompt.vocabularyUsed.join(", ")}
          </p>
        ) : null}
      </div>
    </details>
  );
}

function MetadataDisclosure({ metadata }: { metadata: PromptMetadataView }) {
  return (
    <details className="group flex-1 basis-full rounded-md border border-surface-border bg-surface">
      <summary className="cursor-pointer list-none px-3 py-1.5 text-xs font-medium text-ink-muted hover:bg-surface-sunken">
        <span className="group-open:hidden">Show Profound metadata</span>
        <span className="hidden group-open:inline">Hide Profound metadata</span>
        <span className="ml-2 text-ink-subtle">{(metadata.tags ?? []).length} tags</span>
      </summary>
      <div className="space-y-2 border-t border-surface-border px-3 py-2 text-xs">
        <p className="text-ink-muted">
          A preview of what would be sent. Regions, platforms and analysis types are defaults until
          the live Profound configuration is loaded during deployment, and the persona is mapped
          then too.
        </p>
        <p className="flex flex-wrap gap-1">
          {(metadata.tags ?? []).map((tag) => (
            <code key={tag} className="rounded bg-surface-sunken px-1.5 py-0.5 text-ink-muted">
              {tag}
            </code>
          ))}
        </p>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
          <div>
            <dt className="text-2xs uppercase tracking-wide text-ink-muted">Language</dt>
            <dd className="text-ink">{metadata.language ?? "—"}</dd>
          </div>
          <div>
            <dt className="text-2xs uppercase tracking-wide text-ink-muted">Regions</dt>
            <dd className="text-ink">{(metadata.regions ?? []).join(", ") || "—"}</dd>
          </div>
          <div>
            <dt className="text-2xs uppercase tracking-wide text-ink-muted">Platforms</dt>
            <dd className="text-ink">{(metadata.platforms ?? []).join(", ") || "—"}</dd>
          </div>
          <div>
            <dt className="text-2xs uppercase tracking-wide text-ink-muted">Analysis types</dt>
            <dd className="text-ink">{(metadata.analysis_types ?? []).join(", ") || "—"}</dd>
          </div>
          <div>
            <dt className="text-2xs uppercase tracking-wide text-ink-muted">Profound persona</dt>
            <dd className="text-ink">
              {metadata.persona_id ?? (
                <>
                  not mapped — falls back to{" "}
                  <code className="rounded bg-surface-sunken px-1">
                    {metadata.persona_tag_fallback}
                  </code>
                </>
              )}
            </dd>
          </div>
        </dl>
        <div>
          <p className="text-2xs font-semibold uppercase tracking-wide text-ink-muted">
            Kept here, never sent
          </p>
          <p className="text-ink-muted">{LOCAL_ONLY_FIELDS.join(" · ")}</p>
        </div>
      </div>
    </details>
  );
}

function EditDisclosure({
  brandId,
  promptSetId,
  prompt,
  csrfToken,
}: {
  brandId: string;
  promptSetId: string;
  prompt: PromptRow;
  csrfToken: string;
}) {
  return (
    <details className="group flex-1 basis-full rounded-md border border-surface-border bg-surface">
      <summary className="cursor-pointer list-none px-3 py-1.5 text-xs font-medium text-ink-muted hover:bg-surface-sunken">
        <span className="group-open:hidden">Edit prompt</span>
        <span className="hidden group-open:inline">Cancel edit</span>
      </summary>
      <div className="border-t border-surface-border px-3 py-3">
        <ActionForm
          action={updatePromptAction}
          csrfToken={csrfToken}
          hidden={{ brandId, promptSetId, promptId: prompt.id }}
        >
          <Field
            label="Prompt text"
            htmlFor={`text-${prompt.id}`}
            hint="Keep the customer's wording. Rewriting this recomputes the prompt's hash, its Profound tags and its duplicate warnings."
            required
          >
            <Textarea
              id={`text-${prompt.id}`}
              name="promptText"
              rows={2}
              maxLength={600}
              defaultValue={prompt.promptText}
              required
            />
          </Field>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Topic" htmlFor={`topic-${prompt.id}`} required>
              <Input
                id={`topic-${prompt.id}`}
                name="topic"
                maxLength={160}
                defaultValue={prompt.topic}
                required
              />
            </Field>
            <Field label="Intent" htmlFor={`intent-${prompt.id}`} required>
              <Select id={`intent-${prompt.id}`} name="intent" defaultValue={prompt.intent}>
                {INTENT_ORDER.map((intent) => (
                  <option key={intent} value={intent}>
                    {PROMPT_INTENT_LABELS[intent] ?? intent}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Journey stage" htmlFor={`stage-${prompt.id}`} required>
              <Select
                id={`stage-${prompt.id}`}
                name="journeyStage"
                defaultValue={prompt.journeyStage}
              >
                {STAGE_ORDER.map((stage) => (
                  <option key={stage} value={stage}>
                    {stage.replace(/_/g, " ")}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Tracking priority" htmlFor={`priority-${prompt.id}`} required>
              <Select
                id={`priority-${prompt.id}`}
                name="trackingPriority"
                defaultValue={prompt.trackingPriority}
              >
                <option value="high">high</option>
                <option value="medium">medium</option>
                <option value="low">low</option>
              </Select>
            </Field>
            <Field label="Execution mode" htmlFor={`mode-${prompt.id}`} required>
              <Select
                id={`mode-${prompt.id}`}
                name="executionMode"
                defaultValue={prompt.executionMode}
              >
                <option value="standalone">standalone</option>
                <option value="conversational">conversational</option>
                <option value="both">both</option>
              </Select>
            </Field>
          </div>

          <Field label="Information need" htmlFor={`need-${prompt.id}`} required>
            <Textarea
              id={`need-${prompt.id}`}
              name="informationNeed"
              rows={2}
              maxLength={400}
              defaultValue={prompt.informationNeed}
              required
            />
          </Field>

          <Field
            label="Expected answer elements"
            htmlFor={`expected-${prompt.id}`}
            hint="One per line. These are what a useful answer must contain — the basis for the content-gap analysis later."
          >
            <Textarea
              id={`expected-${prompt.id}`}
              name="expectedAnswerElements"
              rows={3}
              maxLength={2000}
              defaultValue={prompt.expectedAnswerElements.join("\n")}
            />
          </Field>

          <SubmitButton label="Save prompt" variant="secondary" size="sm" />
        </ActionForm>
      </div>
    </details>
  );
}
