"use client";

import { requestAudienceReportAction } from "@/app/actions/audience-research";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { Card, CardHeader, Checkbox, Field, Input } from "@/components/ui";

const SPARKTORO_SECTIONS: { value: string; label: string }[] = [
  { value: "demographics", label: "Demographics" },
  { value: "bio_keywords", label: "Bio keywords" },
  { value: "websites", label: "Websites" },
  { value: "social_accounts", label: "Social accounts" },
  { value: "networks", label: "Social networks" },
  { value: "youtube", label: "YouTube channels" },
  { value: "podcasts", label: "Podcasts" },
  { value: "reddit", label: "Subreddits" },
  { value: "press", label: "Press & publications" },
  { value: "apps_and_ai_tools", label: "Apps & AI tools" },
  { value: "keywords", label: "Keywords" },
  { value: "prompt_topics", label: "AI prompt topics" },
  { value: "audience_size", label: "Audience size" },
];

/**
 * Vendor-sourced evidence requests: SparkToro today, Profound account data
 * and deep web research join this card as their jobs land.
 */
export function ResearchForms({ brandId, csrfToken }: { brandId: string; csrfToken: string }) {
  return (
    <Card>
      <CardHeader
        title="Research this audience"
        description="Pull aggregated, externally-supported evidence in instead of only uploading it. Each section runs as its own job."
      />
      <div className="px-4 py-4">
        <ActionForm action={requestAudienceReportAction} csrfToken={csrfToken} hidden={{ brandId }}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Audience description"
              htmlFor="description"
              required
              hint="Who this audience is, in SparkToro's free-text format."
            >
              <Input
                id="description"
                name="description"
                required
                maxLength={500}
                placeholder="Product managers at B2B SaaS companies"
              />
            </Field>
            <Field label="Location" htmlFor="location" hint="Optional, e.g. United States.">
              <Input id="location" name="location" maxLength={200} placeholder="United States" />
            </Field>
          </div>
          <Field label="Sections" hint="Leave all unchecked to request every section.">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {SPARKTORO_SECTIONS.map((section) => (
                <Checkbox
                  key={section.value}
                  name="sections"
                  value={section.value}
                  label={section.label}
                />
              ))}
            </div>
          </Field>
          <SubmitButton label="Request SparkToro report" pendingLabel="Requesting…" />
        </ActionForm>
      </div>
    </Card>
  );
}
