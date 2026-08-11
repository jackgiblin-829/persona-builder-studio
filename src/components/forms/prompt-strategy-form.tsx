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
}: {
  projectId: string;
  csrfToken: string;
  strategy: PromptStrategy;
}) {
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
        <h3 className="mb-1 text-sm font-semibold text-ink">Query Funnel shape</h3>
        <p className="mb-3 text-xs text-ink-muted">
          Generation starts with purchase-ready anchors, then projects upward into evaluation and
          awareness questions for every persona.
        </p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <CountField
            label="Pathways per persona"
            name="pathwaysPerPersona"
            value={strategy.pathwaysPerPersona}
          />
          <CountField
            label="Bottom of funnel"
            name="decisionTarget"
            value={strategy.funnelTargets.decision}
          />
          <CountField
            label="Middle of funnel"
            name="considerationTarget"
            value={strategy.funnelTargets.consideration}
          />
          <CountField
            label="Top of funnel"
            name="awarenessTarget"
            value={strategy.funnelTargets.awareness}
          />
        </div>
        <p className="mt-2 text-xs text-ink-subtle">
          Current baseline: {strategy.targetPromptCount} prompts per persona.
        </p>
      </div>
      <SubmitButton label="Save prompt strategy" pendingLabel="Saving…" />
    </ActionForm>
  );
}

function CountField({ label, name, value }: { label: string; name: string; value: number }) {
  return (
    <Field label={label} htmlFor={name}>
      <Input id={name} name={name} type="number" min={1} max={100} defaultValue={value} required />
    </Field>
  );
}
