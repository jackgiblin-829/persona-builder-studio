"use client";

import { savePersonaAction } from "@/app/actions/projects";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { Field, Input, Textarea } from "@/components/ui";
import type { PersonaInsight, PersonaProfile } from "@/contracts/studio";

const lines = (items: PersonaInsight[]) => items.map((item) => item.text).join("\n");

export function PersonaEditor({
  projectId,
  personaId,
  version,
  name,
  description,
  profile,
  csrfToken,
}: {
  projectId: string;
  personaId: string;
  version: number;
  name: string;
  description: string;
  profile: PersonaProfile;
  csrfToken: string;
}) {
  const fields: { name: string; label: string; items: PersonaInsight[] }[] = [
    { name: "roles", label: "Roles", items: profile.firmographics.roles },
    { name: "seniority", label: "Seniority", items: profile.firmographics.seniority },
    { name: "departments", label: "Departments", items: profile.firmographics.departments },
    { name: "industries", label: "Industries", items: profile.firmographics.industries },
    { name: "companySize", label: "Company size", items: profile.firmographics.companySize },
    { name: "experience", label: "Experience", items: profile.firmographics.experience },
    { name: "jobsToBeDone", label: "Jobs to be done", items: profile.jobsToBeDone },
    { name: "motivations", label: "Motivations", items: profile.motivations },
    { name: "goals", label: "Goals", items: profile.goals },
    { name: "painPoints", label: "Pain points", items: profile.painPoints },
    { name: "constraints", label: "Constraints", items: profile.constraints },
    { name: "successMeasures", label: "Success measures", items: profile.successMeasures },
    { name: "decisionCriteria", label: "Decision criteria", items: profile.decisionCriteria },
    { name: "objections", label: "Objections", items: profile.objections },
    { name: "commonQuestions", label: "Common questions", items: profile.commonQuestions },
    { name: "proofNeeds", label: "Proof needs", items: profile.proofNeeds },
    { name: "vocabulary", label: "Vocabulary", items: profile.vocabulary },
    { name: "buyingTriggers", label: "Buying triggers", items: profile.buyingTriggers },
    { name: "channels", label: "Channels", items: profile.channels },
    { name: "communities", label: "Communities", items: profile.communities },
    { name: "websites", label: "Websites", items: profile.websites },
    { name: "contentPreferences", label: "Content preferences", items: profile.contentPreferences },
    { name: "keywords", label: "Keywords", items: profile.keywords },
    { name: "aiPromptTopics", label: "AI prompt topics", items: profile.aiPromptTopics },
  ];
  return (
    <ActionForm
      action={savePersonaAction}
      csrfToken={csrfToken}
      hidden={{ projectId, personaId, expectedVersion: version }}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Descriptive name" htmlFor="name" required>
          <Input id="name" name="name" defaultValue={name} required minLength={5} maxLength={100} />
        </Field>
        <Field label="Segment description" htmlFor="description" required>
          <Textarea
            id="description"
            name="description"
            defaultValue={description}
            required
            rows={3}
          />
        </Field>
      </div>
      <Field label="Summary" htmlFor="summary" required>
        <Textarea id="summary" name="summary" defaultValue={profile.summary} required rows={4} />
      </Field>
      <div className="grid gap-4 lg:grid-cols-2">
        {fields.map((field) => (
          <Field
            key={field.name}
            label={field.label}
            htmlFor={field.name}
            hint="One insight per line. Existing source references stay attached by position."
          >
            <Textarea
              id={field.name}
              name={field.name}
              defaultValue={lines(field.items)}
              rows={5}
              required
            />
          </Field>
        ))}
      </div>
      <SubmitButton label="Save new version" pendingLabel="Saving…" />
    </ActionForm>
  );
}
