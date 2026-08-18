"use client";

import { updatePromptStrategyAction } from "@/app/actions/projects";
import { resolvePromptWorkbookProfile, type PromptStrategy } from "@/contracts/prompt-strategy";
import { ActionForm, SubmitButton } from "./action-form";
import { Field, Input, Textarea } from "@/components/ui";

const lines = (values: string[]) => values.join("\n");

export function PromptStrategyForm({
  projectId,
  csrfToken,
  strategy,
  primaryMarket,
}: {
  projectId: string;
  csrfToken: string;
  strategy: PromptStrategy;
  primaryMarket: string;
}) {
  const workbookProfile = resolvePromptWorkbookProfile(strategy, primaryMarket);
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
      <div className="rounded-xl border border-surface-border bg-surface-sunken p-4">
        <h3 className="text-sm font-semibold text-ink">Client workbook brief</h3>
        <p className="mt-1 text-xs leading-5 text-ink-muted">
          These fields drive the strategic framing, competitor configuration, entity watchlist, and
          rollout guidance in the final prompt-taxonomy workbook.
        </p>
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Field label="Prepared by" htmlFor="preparedBy" required>
            <Input
              id="preparedBy"
              name="preparedBy"
              defaultValue={workbookProfile.preparedBy}
              required
            />
          </Field>
          <Field
            label="Target regions"
            htmlFor="targetRegions"
            hint="One market per line."
            required
          >
            <Textarea
              id="targetRegions"
              name="targetRegions"
              rows={3}
              defaultValue={lines(workbookProfile.targetRegions)}
              required
            />
          </Field>
        </div>
        <div className="mt-4">
          <Field
            label="Primary commercial job"
            htmlFor="primaryCommercialJob"
            hint="What should stronger AI visibility change commercially?"
            required
          >
            <Textarea
              id="primaryCommercialJob"
              name="primaryCommercialJob"
              rows={3}
              defaultValue={workbookProfile.primaryCommercialJob}
              required
            />
          </Field>
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-3">
          <Field
            label="Tracking surfaces"
            htmlFor="trackingSurfaces"
            hint="One answer engine per line."
            required
          >
            <Textarea
              id="trackingSurfaces"
              name="trackingSurfaces"
              rows={7}
              defaultValue={lines(workbookProfile.trackingSurfaces)}
              required
            />
          </Field>
          <Field
            label="Competitor tracking context"
            htmlFor="competitorContext"
            hint="Competitor | Business line | Why track | Phase"
          >
            <Textarea
              id="competitorContext"
              name="competitorContext"
              rows={7}
              defaultValue={lines(workbookProfile.competitorContext)}
            />
          </Field>
          <Field
            label="Entity watchlist"
            htmlFor="entityRiskRows"
            hint="Issue | Severity | Why it distorts results | Recommended action"
          >
            <Textarea
              id="entityRiskRows"
              name="entityRiskRows"
              rows={7}
              defaultValue={lines(workbookProfile.entityRiskRows)}
            />
          </Field>
        </div>
      </div>
      <div className="rounded-xl border border-surface-border p-4">
        <h3 className="mb-1 text-sm font-semibold text-ink">Search-question volume</h3>
        <p className="mb-3 max-w-3xl text-xs leading-5 text-ink-muted">
          Choose the number of realistic questions to create for each persona. The studio balances
          discovery, comparison, selection, brand, competitor, and risk searches automatically.
        </p>
        <div className="max-w-xs">
          <Field label="Prompts per persona" htmlFor="targetPromptCount" hint="Recommended: 40–60">
            <Input
              id="targetPromptCount"
              name="targetPromptCount"
              type="number"
              min={12}
              max={100}
              defaultValue={strategy.targetPromptCount}
              required
            />
          </Field>
        </div>
      </div>
      <SubmitButton label="Save workbook settings" pendingLabel="Saving…" />
    </ActionForm>
  );
}
