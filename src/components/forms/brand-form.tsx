"use client";

import { useActionState } from "react";
import { useFormStatus } from "react-dom";
import { createBrandAction, updateBrandAction } from "@/app/actions/brands";
import { IDLE } from "@/app/actions/state";
import { Button, Callout, Checkbox, ErrorState, Field, Input, Textarea } from "@/components/ui";
import { CSRF_FIELD } from "@/lib/auth/constants";

export type BrandFormValues = {
  name: string;
  canonicalDomain: string;
  description: string;
  conversionActions: string[];
  markets: string[];
  languages: string[];
  regions: string[];
  approvedCrawlDomains: string[];
  strategicQuestions: string[];
  regulatedDomain: boolean;
  retentionDays: number | null;
};

const EMPTY: BrandFormValues = {
  name: "",
  canonicalDomain: "",
  description: "",
  conversionActions: [],
  markets: [],
  languages: [],
  regions: [],
  approvedCrawlDomains: [],
  strategicQuestions: [],
  regulatedDomain: false,
  retentionDays: null,
};

function Submit({ label }: { label: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" disabled={pending}>
      {pending ? "Saving…" : label}
    </Button>
  );
}

export function BrandForm({
  csrfToken,
  mode,
  organizationId,
  brandId,
  values = EMPTY,
}: {
  csrfToken: string;
  mode: "create" | "edit";
  organizationId?: string;
  brandId?: string;
  values?: BrandFormValues;
}) {
  const action = mode === "create" ? createBrandAction : updateBrandAction;
  const [state, formAction] = useActionState(action, IDLE);
  const err = (field: string) => state.fieldErrors?.[field]?.[0];

  return (
    <form action={formAction} className="space-y-5">
      <input type="hidden" name={CSRF_FIELD} value={csrfToken} />
      {organizationId ? <input type="hidden" name="organizationId" value={organizationId} /> : null}
      {brandId ? <input type="hidden" name="brandId" value={brandId} /> : null}

      {state.status === "error" && state.message ? (
        <ErrorState title="Could not save" message={state.message} />
      ) : null}
      {state.status === "ok" && state.message ? (
        <Callout tone="success">{state.message}</Callout>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Brand name" htmlFor="name" required error={err("name")}>
          <Input id="name" name="name" defaultValue={values.name} required maxLength={120} />
        </Field>

        <Field
          label="Canonical domain"
          htmlFor="canonicalDomain"
          required
          hint="Bare domain, no scheme. Automatically added to the crawl allowlist."
          error={err("canonicalDomain")}
        >
          <Input
            id="canonicalDomain"
            name="canonicalDomain"
            defaultValue={values.canonicalDomain}
            required
            placeholder="northwind-analytics.example"
          />
        </Field>
      </div>

      <Field
        label="Product or service description"
        htmlFor="description"
        required
        hint="What the company sells and to whom. Used as brand context in every generation step — and treated as a brand assertion, not customer belief."
        error={err("description")}
      >
        <Textarea
          id="description"
          name="description"
          rows={4}
          defaultValue={values.description}
          required
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <ListField
          label="Primary conversion actions"
          name="conversionActions"
          hint="One per line. Connects personas to desired outcomes."
          values={values.conversionActions}
          placeholder={"Book a demo\nStart a trial"}
        />
        <ListField
          label="Markets"
          name="markets"
          hint="One per line."
          values={values.markets}
          placeholder={"United States\nUnited Kingdom"}
        />
        <ListField
          label="Languages"
          name="languages"
          hint="BCP-47 codes, one per line. Defaults to en."
          values={values.languages}
          placeholder="en"
        />
        <ListField
          label="Regions"
          name="regions"
          hint="Profound region identifiers where known."
          values={values.regions}
          placeholder={"us\nuk"}
        />
      </div>

      <ListField
        label="Approved crawl domains"
        name="approvedCrawlDomains"
        hint="Only these domains may be fetched during URL ingestion. Everything else is rejected by the SSRF guard."
        values={values.approvedCrawlDomains}
        placeholder={"docs.northwind-analytics.example"}
      />

      <ListField
        label="Current strategic questions"
        name="strategicQuestions"
        hint="Helps prioritise evidence review. Does not determine the persona."
        values={values.strategicQuestions}
        placeholder={"Why do security-led evaluations stall?"}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Source retention (days)"
          htmlFor="retentionDays"
          hint="Leave blank to keep sources indefinitely."
          error={err("retentionDays")}
        >
          <Input
            id="retentionDays"
            name="retentionDays"
            type="number"
            min={1}
            max={3650}
            defaultValue={values.retentionDays ?? ""}
          />
        </Field>

        <div className="pt-6">
          <Checkbox
            name="regulatedDomain"
            defaultChecked={values.regulatedDomain}
            label="Regulated or sensitive domain"
            hint="Applies extra review warnings across evidence, personas and content."
          />
        </div>
      </div>

      <Callout tone="warn" title="Before uploading customer data">
        Automated PII detection in this product is best-effort pattern matching. It is not a
        substitute for legal or compliance review. Do not upload data you are not entitled to
        process.
      </Callout>

      <Submit label={mode === "create" ? "Create brand" : "Save changes"} />
    </form>
  );
}

function ListField({
  label,
  name,
  hint,
  values,
  placeholder,
}: {
  label: string;
  name: string;
  hint: string;
  values: string[];
  placeholder?: string;
}) {
  return (
    <Field label={label} htmlFor={name} hint={hint}>
      <Textarea
        id={name}
        name={name}
        rows={3}
        defaultValue={values.join("\n")}
        placeholder={placeholder}
      />
    </Field>
  );
}
