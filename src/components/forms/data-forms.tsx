"use client";

import { useState } from "react";
import {
  pasteTranscriptAction,
  updateAudienceAction,
  uploadProjectFilesAction,
} from "@/app/actions/projects";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { Card, CardHeader, Field, Input, Select, Textarea, cn } from "@/components/ui";

export function AudienceDescriptionForm({
  projectId,
  csrfToken,
  value,
}: {
  projectId: string;
  csrfToken: string;
  value: string;
}) {
  return (
    <ActionForm action={updateAudienceAction} csrfToken={csrfToken} hidden={{ projectId }}>
      <Field
        label="SparkToro audience description"
        htmlFor="audienceDescription"
        hint="Describe people, not a topic. This is editable before every persona run."
      >
        <Textarea
          id="audienceDescription"
          name="audienceDescription"
          rows={4}
          defaultValue={value}
          required
          minLength={20}
          maxLength={1200}
        />
      </Field>
      <SubmitButton label="Save description" variant="secondary" size="sm" />
    </ActionForm>
  );
}

export function DataUploadForms({
  projectId,
  csrfToken,
}: {
  projectId: string;
  csrfToken: string;
}) {
  const [tab, setTab] = useState<"files" | "transcript">("files");
  return (
    <Card>
      <CardHeader
        title="Add research"
        description="Sources are parsed, redacted, and converted to research signals automatically."
        actions={
          <div
            role="tablist"
            className="flex rounded-full border border-surface-border bg-surface-sunken p-1"
          >
            {(["files", "transcript"] as const).map((value) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={tab === value}
                onClick={() => setTab(value)}
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs font-medium",
                  tab === value ? "bg-ink text-white" : "text-ink-muted",
                )}
              >
                {value === "files" ? "Upload files" : "Paste transcript"}
              </button>
            ))}
          </div>
        }
      />
      <div className="p-4">
        {tab === "files" ? (
          <ActionForm
            action={uploadProjectFilesAction}
            csrfToken={csrfToken}
            hidden={{ projectId }}
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Source type" htmlFor="sourceType">
                <Select id="sourceType" name="sourceType" defaultValue="sales_transcript">
                  <option value="sales_transcript">Call transcripts</option>
                  <option value="customer_interview">Customer interviews</option>
                  <option value="support_conversation">Support conversations</option>
                  <option value="survey">Survey research</option>
                  <option value="review">Reviews</option>
                  <option value="research_note">Research notes</option>
                  <option value="other">Other</option>
                </Select>
              </Field>
              <Field
                label="Observed date"
                htmlFor="observedAt"
                hint="Optional; used as source context."
              >
                <Input id="observedAt" name="observedAt" type="date" />
              </Field>
            </div>
            <label className="block cursor-pointer rounded-xl border-2 border-dashed border-surface-border bg-surface-sunken px-6 py-10 text-center hover:border-ink">
              <span className="block text-sm font-semibold text-ink">
                Drop files here or choose files
              </span>
              <span className="mt-1 block text-xs text-ink-muted">
                PDF, DOCX, TXT, Markdown, CSV, and JSON · up to 25 files
              </span>
              <input
                name="files"
                type="file"
                multiple
                required
                accept=".pdf,.docx,.txt,.md,.markdown,.csv,.json,application/pdf,text/plain,text/markdown,text/csv,application/json"
                className="mx-auto mt-4 block max-w-full text-sm"
              />
            </label>
            <SubmitButton label="Upload and process" pendingLabel="Uploading…" />
          </ActionForm>
        ) : (
          <ActionForm
            action={pasteTranscriptAction}
            csrfToken={csrfToken}
            hidden={{ projectId, sourceType: "sales_transcript" }}
          >
            <Field label="Transcript label" htmlFor="transcript-label" required>
              <Input
                id="transcript-label"
                name="label"
                required
                maxLength={200}
                placeholder="Discovery call — August 11"
              />
            </Field>
            <Field
              label="Transcript"
              htmlFor="transcript-content"
              required
              hint="Speaker-labelled text is preserved. PII is redacted before any model call."
            >
              <Textarea id="transcript-content" name="content" required minLength={20} rows={12} />
            </Field>
            <Field label="Observed date" htmlFor="transcript-date">
              <Input id="transcript-date" name="observedAt" type="date" />
            </Field>
            <SubmitButton label="Add and process" pendingLabel="Adding…" />
          </ActionForm>
        )}
      </div>
    </Card>
  );
}
