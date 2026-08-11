"use client";

import { updatePromptStrategyAction } from "@/app/actions/projects";
import type { PromptStrategy } from "@/contracts/prompt-strategy";
import { ActionForm, SubmitButton } from "./action-form";
import { Field, Input, Textarea } from "@/components/ui";

const lines = (values: string[]) => values.join("\n");

export function PromptStrategyForm({
  projectId,
  csrfToken,
  strategy,
  personaSlugs,
}: {
  projectId: string;
  csrfToken: string;
  strategy: PromptStrategy;
  personaSlugs: string[];
}) {
  const personaTargets = Object.entries(strategy.personaPromptTargets)
    .map(([slug, count]) => `${slug}=${count}`)
    .join("\n");
  return (
    <ActionForm
      action={updatePromptStrategyAction}
      csrfToken={csrfToken}
      hidden={{ projectId }}
      className="space-y-5"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Canonical brand" htmlFor="canonicalBrand" required>
          <Input
            id="canonicalBrand"
            name="canonicalBrand"
            defaultValue={strategy.canonicalBrand}
            required
          />
        </Field>
        <Field label="Parent company" htmlFor="parentCompany">
          <Input id="parentCompany" name="parentCompany" defaultValue={strategy.parentCompany} />
        </Field>
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Field
          label="Category terms"
          htmlFor="categoryTerms"
          hint="One approved term per line."
          required
        >
          <Textarea
            id="categoryTerms"
            name="categoryTerms"
            rows={5}
            defaultValue={lines(strategy.categoryTerms)}
            required
          />
        </Field>
        <Field
          label="Business lines"
          htmlFor="businessLines"
          hint="One product or use case per line."
          required
        >
          <Textarea
            id="businessLines"
            name="businessLines"
            rows={5}
            defaultValue={lines(strategy.businessLines)}
            required
          />
        </Field>
        <Field
          label="Competitors"
          htmlFor="competitors"
          hint="Required when comparison target is above zero."
        >
          <Textarea
            id="competitors"
            name="competitors"
            rows={5}
            defaultValue={lines(strategy.competitors)}
          />
        </Field>
      </div>
      <div className="grid gap-4 lg:grid-cols-4">
        <Field label="Aliases" htmlFor="aliases" hint="One name per line.">
          <Textarea id="aliases" name="aliases" rows={4} defaultValue={lines(strategy.aliases)} />
        </Field>
        <Field
          label="Entity collisions"
          htmlFor="entityCollisions"
          hint="Names the model must distinguish."
        >
          <Textarea
            id="entityCollisions"
            name="entityCollisions"
            rows={4}
            defaultValue={lines(strategy.entityCollisions)}
          />
        </Field>
        <Field
          label="Buyer qualifiers"
          htmlFor="buyerQualifiers"
          hint="Stage, size, urgency, or context."
        >
          <Textarea
            id="buyerQualifiers"
            name="buyerQualifiers"
            rows={4}
            defaultValue={lines(strategy.buyerQualifiers)}
          />
        </Field>
        <Field
          label="Freshness checks"
          htmlFor="freshnessFacts"
          hint="Facts that may change over time."
        >
          <Textarea
            id="freshnessFacts"
            name="freshnessFacts"
            rows={4}
            defaultValue={lines(strategy.freshnessFacts)}
          />
        </Field>
      </div>
      <div>
        <h3 className="mb-3 text-sm font-semibold text-ink">Coverage targets</h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <CountField
            label="Total prompts"
            name="targetPromptCount"
            value={strategy.targetPromptCount}
          />
          <CountField
            label="Brand and entity"
            name="brandEntityTarget"
            value={strategy.topicTargets.brand_entity_authority}
          />
          <CountField
            label="Category discovery"
            name="categoryDiscoveryTarget"
            value={strategy.topicTargets.unbranded_category_discovery}
          />
          <CountField
            label="Competitive comparison"
            name="competitiveComparisonTarget"
            value={strategy.topicTargets.competitive_comparison}
          />
          <CountField
            label="Buyer education"
            name="buyerEducationTarget"
            value={strategy.topicTargets.buyer_education}
          />
          <CountField
            label="Reputation and risk"
            name="reputationRiskTarget"
            value={strategy.topicTargets.reputation_risk}
          />
          <CountField
            label="Product-line use cases"
            name="productLineTarget"
            value={strategy.topicTargets.product_line_use_cases}
          />
        </div>
      </div>
      <Field
        label="Persona targets"
        htmlFor="personaPromptTargets"
        hint={`Optional. Use persona-slug=count and make the counts total ${strategy.targetPromptCount}. Active slugs: ${personaSlugs.join(", ") || "none yet"}. Leave blank for an even allocation.`}
      >
        <Textarea
          id="personaPromptTargets"
          name="personaPromptTargets"
          rows={Math.max(3, personaSlugs.length)}
          defaultValue={personaTargets}
          placeholder="founder-ceo=20"
        />
      </Field>
      <SubmitButton label="Save prompt strategy" pendingLabel="Saving…" />
    </ActionForm>
  );
}

function CountField({ label, name, value }: { label: string; name: string; value: number }) {
  return (
    <Field label={label} htmlFor={name}>
      <Input id={name} name={name} type="number" min={0} max={100} defaultValue={value} required />
    </Field>
  );
}
