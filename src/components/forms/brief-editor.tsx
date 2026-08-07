"use client";

import { useMemo, useState } from "react";
import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { updateBriefAction } from "@/app/actions/content-briefs";
import { IDLE } from "@/app/actions/state";
import { Button, Callout, ErrorState, Field, Input, Select, Textarea } from "@/components/ui";
import { CSRF_FIELD } from "@/lib/auth/constants";
import type { BriefOutput } from "@/prompts/schemas";

/**
 * The SEO brief editor (§29, spec screen 23).
 *
 * Every one of the 27 sections is its own labeled control here — the JSON
 * blob this posts to `updateBriefAction` is a wire format the reviewer never
 * sees, not the editing surface itself. Evidence ids and Profound prompt ids
 * are edited as plain id lists because `updateBriefBody` re-validates them
 * against what is actually available before saving; an id that does not
 * resolve is dropped server-side rather than silently kept.
 */

type ClaimItem = { statement: string; evidence_ids: string[] };
type OutlineItem = BriefOutput["recommended_outline"][number];
type LinkItem = BriefOutput["internal_links"][number];

function SaveButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : "Save brief"}
    </Button>
  );
}

function linesToList(value: string): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

function idsToList(value: string): string[] {
  return value
    .split(/[,\s]+/)
    .map((id) => id.trim())
    .filter(Boolean);
}

function ListField({
  label,
  hint,
  value,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string[];
  onChange: (next: string[]) => void;
}) {
  return (
    <Field label={label} hint={hint ?? "One per line."}>
      <Textarea
        rows={Math.min(8, Math.max(3, value.length + 1))}
        defaultValue={value.join("\n")}
        onBlur={(e) => onChange(linesToList(e.target.value))}
      />
    </Field>
  );
}

function ClaimListEditor({
  label,
  items,
  onChange,
}: {
  label: string;
  items: ClaimItem[];
  onChange: (items: ClaimItem[]) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="label">{label}</p>
      {items.length === 0 ? <p className="text-xs text-ink-subtle">None.</p> : null}
      {items.map((item, index) => (
        <div
          key={index}
          className="grid grid-cols-1 gap-2 rounded-md border border-surface-border p-2 sm:grid-cols-3"
        >
          <div className="sm:col-span-2">
            <Textarea
              rows={2}
              defaultValue={item.statement}
              onBlur={(e) => {
                const next = [...items];
                next[index] = { ...item, statement: e.target.value };
                onChange(next);
              }}
            />
          </div>
          <div className="flex items-start gap-2">
            <Input
              defaultValue={item.evidence_ids.join(" ")}
              placeholder="evidence ids"
              onBlur={(e) => {
                const next = [...items];
                next[index] = { ...item, evidence_ids: idsToList(e.target.value) };
                onChange(next);
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onChange(items.filter((_, i) => i !== index))}
            >
              Remove
            </Button>
          </div>
        </div>
      ))}
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => onChange([...items, { statement: "", evidence_ids: [] }])}
      >
        Add {label.toLowerCase().replace(/s$/, "")}
      </Button>
    </div>
  );
}

function OutlineEditor({
  items,
  onChange,
}: {
  items: OutlineItem[];
  onChange: (items: OutlineItem[]) => void;
}) {
  return (
    <div className="space-y-3">
      {items.map((item, index) => (
        <div key={index} className="space-y-2 rounded-md border border-surface-border p-3">
          <div className="flex items-center justify-between gap-2">
            <Input
              defaultValue={item.heading}
              placeholder="Section heading"
              className="flex-1 font-medium"
              onBlur={(e) => {
                const next = [...items];
                next[index] = { ...item, heading: e.target.value };
                onChange(next);
              }}
            />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onChange(items.filter((_, i) => i !== index))}
            >
              Remove section
            </Button>
          </div>
          <Field label="Purpose">
            <Textarea
              rows={2}
              defaultValue={item.purpose}
              onBlur={(e) => {
                const next = [...items];
                next[index] = { ...item, purpose: e.target.value };
                onChange(next);
              }}
            />
          </Field>
          <Field label="Must cover" hint="One per line.">
            <Textarea
              rows={3}
              defaultValue={item.must_cover.join("\n")}
              onBlur={(e) => {
                const next = [...items];
                next[index] = { ...item, must_cover: linesToList(e.target.value) };
                onChange(next);
              }}
            />
          </Field>
          <Field label="Evidence ids" hint="Space or comma separated — required.">
            <Input
              defaultValue={item.evidence_ids.join(" ")}
              onBlur={(e) => {
                const next = [...items];
                next[index] = { ...item, evidence_ids: idsToList(e.target.value) };
                onChange(next);
              }}
            />
          </Field>
        </div>
      ))}
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() =>
          onChange([...items, { heading: "", purpose: "", must_cover: [], evidence_ids: [] }])
        }
      >
        Add outline section
      </Button>
    </div>
  );
}

function LinksEditor({
  items,
  onChange,
}: {
  items: LinkItem[];
  onChange: (items: LinkItem[]) => void;
}) {
  return (
    <div className="space-y-2">
      {items.map((item, index) => (
        <div key={index} className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          <Input
            defaultValue={item.url}
            placeholder="URL"
            onBlur={(e) => {
              const next = [...items];
              next[index] = { ...item, url: e.target.value };
              onChange(next);
            }}
          />
          <Input
            defaultValue={item.rationale}
            placeholder="Rationale"
            className="sm:col-span-2"
            onBlur={(e) => {
              const next = [...items];
              next[index] = { ...item, rationale: e.target.value };
              onChange(next);
            }}
          />
        </div>
      ))}
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => onChange([...items, { url: "", rationale: "" }])}
      >
        Add internal link
      </Button>
    </div>
  );
}

export function BriefEditorForm({
  brandId,
  briefId,
  initialBody,
  csrfToken,
  readOnly,
}: {
  brandId: string;
  briefId: string;
  initialBody: BriefOutput;
  csrfToken: string;
  readOnly: boolean;
}) {
  const [body, setBody] = useState<BriefOutput>(initialBody);
  const [state, formAction] = useActionState(updateBriefAction, IDLE);
  const bodyJson = useMemo(() => JSON.stringify(body), [body]);

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name={CSRF_FIELD} value={csrfToken} />
      <input type="hidden" name="brandId" value={brandId} />
      <input type="hidden" name="briefId" value={briefId} />
      <input type="hidden" name="body" value={bodyJson} />

      {state.status === "error" && state.message ? (
        <ErrorState title="Could not save" message={state.message} />
      ) : null}
      {state.status === "ok" ? <Callout tone="success">{state.message}</Callout> : null}

      <fieldset disabled={readOnly} className="space-y-5 disabled:opacity-70">
        <Field label="Working title">
          <Input
            defaultValue={body.working_title}
            onBlur={(e) => setBody({ ...body, working_title: e.target.value })}
          />
        </Field>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Target persona">
            <Input
              defaultValue={body.target_persona}
              onBlur={(e) => setBody({ ...body, target_persona: e.target.value })}
            />
          </Field>
          <Field label="Primary query">
            <Input
              defaultValue={body.primary_query}
              onBlur={(e) => setBody({ ...body, primary_query: e.target.value })}
            />
          </Field>
        </div>

        <Field label="Job to be done">
          <Textarea
            rows={2}
            defaultValue={body.job_to_be_done}
            onBlur={(e) => setBody({ ...body, job_to_be_done: e.target.value })}
          />
        </Field>

        <Field label="Primary information need">
          <Textarea
            rows={2}
            defaultValue={body.primary_information_need}
            onBlur={(e) => setBody({ ...body, primary_information_need: e.target.value })}
          />
        </Field>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Intent">
            <Select
              defaultValue={body.intent}
              onChange={(e) =>
                setBody({ ...body, intent: e.target.value as BriefOutput["intent"] })
              }
            >
              {[
                "problem_discovery",
                "education",
                "solution_exploration",
                "comparison",
                "evaluation",
                "risk_reduction",
                "purchase",
                "implementation",
                "optimization",
                "troubleshooting",
              ].map((v) => (
                <option key={v} value={v}>
                  {v.replace(/_/g, " ")}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Journey stage">
            <Select
              defaultValue={body.journey_stage}
              onChange={(e) =>
                setBody({ ...body, journey_stage: e.target.value as BriefOutput["journey_stage"] })
              }
            >
              {[
                "unaware",
                "problem_discovery",
                "education",
                "solution_exploration",
                "consideration",
                "evaluation",
                "purchase",
                "implementation",
                "optimization",
                "troubleshooting",
                "retention",
                "unknown",
              ].map((v) => (
                <option key={v} value={v}>
                  {v.replace(/_/g, " ")}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <ListField
          label="Supporting queries"
          value={body.supporting_queries}
          onChange={(v) => setBody({ ...body, supporting_queries: v })}
        />

        <div>
          <p className="label">
            Relevant Profound prompts (not editable here — traced from the source opportunity)
          </p>
          <ul className="mt-1 space-y-1 text-xs text-ink-muted">
            {body.relevant_profound_prompts.map((p) => (
              <li key={p.profound_prompt_id}>
                <code>{p.profound_prompt_id}</code> — {p.prompt_text} (gap: {p.gap})
              </li>
            ))}
          </ul>
        </div>

        <Field label="Profound gap summary">
          <Textarea
            rows={2}
            defaultValue={body.profound_gap_summary}
            onBlur={(e) => setBody({ ...body, profound_gap_summary: e.target.value })}
          />
        </Field>

        <Field label="Reader's existing knowledge">
          <Textarea
            rows={2}
            defaultValue={body.reader_existing_knowledge}
            onBlur={(e) => setBody({ ...body, reader_existing_knowledge: e.target.value })}
          />
        </Field>

        <ClaimListEditor
          label="Constraints"
          items={body.constraints}
          onChange={(v) => setBody({ ...body, constraints: v })}
        />
        <ClaimListEditor
          label="Objections"
          items={body.objections}
          onChange={(v) => setBody({ ...body, objections: v })}
        />
        <ClaimListEditor
          label="Decision criteria"
          items={body.decision_criteria}
          onChange={(v) => setBody({ ...body, decision_criteria: v })}
        />

        <ListField
          label="Expected answer elements"
          value={body.expected_answer_elements}
          onChange={(v) => setBody({ ...body, expected_answer_elements: v })}
        />

        <Field label="Recommended content type">
          <Input
            defaultValue={body.recommended_content_type}
            onBlur={(e) => setBody({ ...body, recommended_content_type: e.target.value })}
          />
        </Field>

        <div>
          <p className="label">Recommended outline</p>
          <OutlineEditor
            items={body.recommended_outline}
            onChange={(v) => setBody({ ...body, recommended_outline: v })}
          />
        </div>

        <ListField
          label="Customer vocabulary"
          value={body.customer_vocabulary}
          onChange={(v) => setBody({ ...body, customer_vocabulary: v })}
        />
        <ListField
          label="Concepts and entities"
          value={body.concepts_and_entities}
          onChange={(v) => setBody({ ...body, concepts_and_entities: v })}
        />
        <ListField
          label="Required evidence"
          value={body.required_evidence}
          onChange={(v) => setBody({ ...body, required_evidence: v })}
        />
        <ListField
          label="Required examples"
          value={body.required_examples}
          onChange={(v) => setBody({ ...body, required_examples: v })}
        />
        <ListField
          label="Source requirements"
          value={body.source_requirements}
          onChange={(v) => setBody({ ...body, source_requirements: v })}
        />
        <ListField
          label="Product proof"
          value={body.product_proof}
          onChange={(v) => setBody({ ...body, product_proof: v })}
        />
        <ListField
          label="Competitor coverage"
          value={body.competitor_coverage}
          onChange={(v) => setBody({ ...body, competitor_coverage: v })}
        />

        <div>
          <p className="label">Internal links</p>
          <LinksEditor
            items={body.internal_links}
            onChange={(v) => setBody({ ...body, internal_links: v })}
          />
        </div>

        <Field label="Conversion action">
          <Input
            defaultValue={body.conversion_action}
            onBlur={(e) => setBody({ ...body, conversion_action: e.target.value })}
          />
        </Field>

        <ListField
          label="Unsupported claims to avoid"
          value={body.unsupported_claims_to_avoid}
          onChange={(v) => setBody({ ...body, unsupported_claims_to_avoid: v })}
        />
        <ListField
          label="Final quality checklist"
          value={body.final_quality_checklist}
          onChange={(v) => setBody({ ...body, final_quality_checklist: v })}
        />
      </fieldset>

      {readOnly ? (
        <p className="text-xs text-ink-subtle">
          This brief is approved or rejected and can no longer be edited. Regenerate a new version
          to revise it.
        </p>
      ) : (
        <SaveButton />
      )}
    </form>
  );
}
