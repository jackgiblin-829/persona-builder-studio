"use client";

import { useState } from "react";
import { pasteSourceAction, uploadSourceAction } from "@/app/actions/sources";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { Card, CardHeader, Checkbox, Field, Input, Select, Textarea, cn } from "@/components/ui";

const SOURCE_TYPES: { value: string; label: string }[] = [
  { value: "sales_transcript", label: "Sales call transcript" },
  { value: "interview", label: "Customer interview" },
  { value: "support_ticket", label: "Support tickets" },
  { value: "survey", label: "Survey responses" },
  { value: "review", label: "Product reviews" },
  { value: "community", label: "Community discussion" },
  { value: "search_console", label: "Search Console export" },
  { value: "onsite_search", label: "On-site search log" },
  { value: "crm_note", label: "CRM notes" },
  { value: "brand_page", label: "Brand page copy" },
  { value: "documentation", label: "Documentation" },
  { value: "other", label: "Other" },
];

export function SourceUploadForms({ brandId, csrfToken }: { brandId: string; csrfToken: string }) {
  const [tab, setTab] = useState<"upload" | "paste">("upload");

  return (
    <Card>
      <CardHeader
        title="Add a source"
        description="CSV, JSON, TXT, Markdown and DOCX up to 25 MB, or paste text directly."
        actions={
          <div className="flex rounded-md border border-surface-border p-0.5" role="tablist">
            {(["upload", "paste"] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={tab === value}
                onClick={() => setTab(value)}
                className={cn(
                  "rounded px-2.5 py-1 text-xs font-medium capitalize transition-colors",
                  tab === value
                    ? "bg-accent-soft text-accent-ink"
                    : "text-ink-muted hover:text-ink",
                )}
              >
                {value === "upload" ? "Upload file" : "Paste text"}
              </button>
            ))}
          </div>
        }
      />

      <div className="px-4 py-4">
        {tab === "upload" ? (
          <ActionForm action={uploadSourceAction} csrfToken={csrfToken} hidden={{ brandId }}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Label"
                htmlFor="label"
                required
                hint="How this source will appear in the evidence explorer."
              >
                <Input
                  id="label"
                  name="label"
                  required
                  maxLength={200}
                  placeholder="Q2 support tickets"
                />
              </Field>
              <Field
                label="Source type"
                htmlFor="sourceType"
                required
                hint="Drives provenance and the confidence source weight."
              >
                <Select id="sourceType" name="sourceType" required defaultValue="support_ticket">
                  {SOURCE_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="File" htmlFor="file" required hint="CSV, JSON, TXT, MD or DOCX.">
                <input
                  id="file"
                  name="file"
                  type="file"
                  required
                  accept=".csv,.json,.txt,.md,.markdown,.docx,text/csv,application/json,text/plain,text/markdown"
                  className="block w-full text-sm file:mr-3 file:rounded-md file:border-0 file:bg-accent-soft file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-accent-ink"
                />
              </Field>
              <Field
                label="Observed date"
                htmlFor="observedAt"
                hint="When the evidence was created. Used for the recency component of confidence."
              >
                <Input id="observedAt" name="observedAt" type="date" />
              </Field>
            </div>
            <Checkbox
              name="excludeFromModelCalls"
              label="Exclude from model calls"
              hint="Parse and store this source, but never send it to a model provider. No evidence will be extracted."
            />
            <SubmitButton label="Upload and ingest" pendingLabel="Uploading…" />
          </ActionForm>
        ) : (
          <ActionForm action={pasteSourceAction} csrfToken={csrfToken} hidden={{ brandId }}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Label" htmlFor="paste-label" required>
                <Input
                  id="paste-label"
                  name="label"
                  required
                  maxLength={200}
                  placeholder="Discovery call — 14 July"
                />
              </Field>
              <Field label="Source type" htmlFor="paste-type" required>
                <Select id="paste-type" name="sourceType" required defaultValue="sales_transcript">
                  {SOURCE_TYPES.map((type) => (
                    <option key={type.value} value={type.value}>
                      {type.label}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
            <Field
              label="Text"
              htmlFor="content"
              required
              hint="Paste transcript or note text. Personal information is redacted before extraction."
            >
              <Textarea id="content" name="content" rows={10} required minLength={20} />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Observed date" htmlFor="paste-date">
                <Input id="paste-date" name="observedAt" type="date" />
              </Field>
              <div className="space-y-2 pt-6">
                <Checkbox
                  name="isTranscript"
                  label="This is a speaker-labelled transcript"
                  hint="Splits on `Speaker:` turns so each turn keeps its speaker."
                />
                <Checkbox
                  name="excludeFromModelCalls"
                  label="Exclude from model calls"
                  hint="Store but never send to a model provider."
                />
              </div>
            </div>
            <SubmitButton label="Add and ingest" pendingLabel="Adding…" />
          </ActionForm>
        )}
      </div>
    </Card>
  );
}
