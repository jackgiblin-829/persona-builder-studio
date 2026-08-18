"use client";

import { savePersonaAction } from "@/app/actions/projects";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { Field, Input, Textarea } from "@/components/ui";
import {
  resolvePersonaPresentationProfile,
  type PersonaInsight,
  type PersonaProfile,
} from "@/contracts/studio";

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
  const deckProfile = resolvePersonaPresentationProfile(profile);
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
      <section className="space-y-4 rounded-lg border border-accent/30 bg-accent-soft p-4">
        <div>
          <h3 className="text-sm font-semibold text-ink">Client deck profile</h3>
          <p className="mt-1 text-xs leading-5 text-ink-muted">
            These fields map directly to the two presentation slides exported for this persona. Keep
            the language polished, specific, and ready to show a client.
          </p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Title / role" htmlFor="deckRole" required>
            <Input
              id="deckRole"
              name="deckRole"
              defaultValue={deckProfile.role.text}
              required
              maxLength={160}
            />
          </Field>
          <Field label="Industry" htmlFor="deckIndustry" required>
            <Input
              id="deckIndustry"
              name="deckIndustry"
              defaultValue={deckProfile.industry.text}
              required
              maxLength={180}
            />
          </Field>
          <Field label="Expertise level" htmlFor="deckExpertiseLevel" required>
            <Input
              id="deckExpertiseLevel"
              name="deckExpertiseLevel"
              defaultValue={deckProfile.expertiseLevel.text}
              required
              maxLength={100}
            />
          </Field>
        </div>
        <Field
          label="Tone"
          htmlFor="deckTone"
          required
          hint="Describe how content should sound for this audience."
        >
          <Textarea
            id="deckTone"
            name="deckTone"
            defaultValue={deckProfile.tone.text}
            required
            rows={3}
            maxLength={420}
          />
        </Field>
        <Field
          label="POV / lens"
          htmlFor="deckPovLens"
          required
          hint="Explain how this persona evaluates the category and makes decisions."
        >
          <Textarea
            id="deckPovLens"
            name="deckPovLens"
            defaultValue={deckProfile.povLens.text}
            required
            rows={4}
            maxLength={900}
          />
        </Field>
        <div className="grid gap-4 lg:grid-cols-3">
          <Field
            label="What they care about"
            htmlFor="deckCaresAbout"
            required
            hint="Three to five concise, client-facing points; one per line."
          >
            <Textarea
              id="deckCaresAbout"
              name="deckCaresAbout"
              defaultValue={lines(deckProfile.caresAbout)}
              required
              rows={8}
            />
          </Field>
          <Field
            label="What they would never say"
            htmlFor="deckNeverSay"
            required
            hint="Three to four phrases or framing choices to avoid; one per line."
          >
            <Textarea
              id="deckNeverSay"
              name="deckNeverSay"
              defaultValue={lines(deckProfile.neverSay)}
              required
              rows={8}
            />
          </Field>
          <Field
            label="Content best suited for"
            htmlFor="deckContentBestSuitedFor"
            required
            hint="Two to three recommendations or paragraphs; one per line."
          >
            <Textarea
              id="deckContentBestSuitedFor"
              name="deckContentBestSuitedFor"
              defaultValue={lines(deckProfile.contentBestSuitedFor)}
              required
              rows={8}
            />
          </Field>
        </div>
      </section>
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
