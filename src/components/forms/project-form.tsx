"use client";

import { createProjectAction } from "@/app/actions/projects";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { Field, Input, Select, Textarea } from "@/components/ui";

export function ProjectForm({
  csrfToken,
  organizations,
}: {
  csrfToken: string;
  organizations: { id: string; name: string }[];
}) {
  return (
    <ActionForm action={createProjectAction} csrfToken={csrfToken}>
      {organizations.length === 1 ? (
        <input type="hidden" name="organizationId" value={organizations[0]!.id} />
      ) : (
        <Field label="Organization" htmlFor="organizationId" required>
          <Select id="organizationId" name="organizationId" required>
            {organizations.map((organization) => (
              <option key={organization.id} value={organization.id}>
                {organization.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Project name" htmlFor="name" required>
          <Input
            id="name"
            name="name"
            required
            maxLength={120}
            placeholder="Enterprise platform buyers"
          />
        </Field>
        <Field label="Domain" htmlFor="canonicalDomain" required>
          <Input id="canonicalDomain" name="canonicalDomain" required placeholder="example.com" />
        </Field>
      </div>
      <Field
        label="Product or service"
        htmlFor="description"
        required
        hint="Describe what is sold, who it helps, and the outcome it creates."
      >
        <Textarea
          id="description"
          name="description"
          required
          minLength={10}
          maxLength={4000}
          rows={5}
        />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Primary market" htmlFor="primaryMarket" required>
          <Select id="primaryMarket" name="primaryMarket" defaultValue="US">
            <option value="US">United States</option>
            <option value="CA">Canada</option>
            <option value="UK">United Kingdom</option>
          </Select>
        </Field>
        <Field label="Language" htmlFor="languageLocale" required>
          <Select id="languageLocale" name="languageLocale" defaultValue="en-US">
            <option value="en-US">English (United States)</option>
            <option value="en-CA">English (Canada)</option>
            <option value="fr-CA">French (Canada)</option>
            <option value="en-GB">English (United Kingdom)</option>
          </Select>
        </Field>
      </div>
      <SubmitButton label="Create project" pendingLabel="Creating…" />
    </ActionForm>
  );
}
