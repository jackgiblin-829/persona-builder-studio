import Link from "next/link";
import { generatePromptsAction } from "@/app/actions/prompt-sets";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import {
  Badge,
  Callout,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  Stat,
  StatusBadge,
} from "@/components/ui";
import { hasCapability, requireBrandAccess } from "@/lib/auth/context";
import { getCsrfToken } from "@/lib/auth/session";
import {
  activePromptJobs,
  listPersonasAwaitingPrompts,
  listPromptSets,
} from "@/services/prompt-sets";

export const dynamic = "force-dynamic";

export default async function PromptSetsPage({ params }: { params: Promise<{ brandId: string }> }) {
  const { brandId } = await params;
  const ctx = await requireBrandAccess(brandId);

  const [sets, personas, jobsInFlight, csrfToken] = await Promise.all([
    listPromptSets(ctx),
    listPersonasAwaitingPrompts(ctx),
    activePromptJobs(ctx),
    getCsrfToken(),
  ]);

  const canGenerate = hasCapability(ctx, "prompt:generate");
  const awaiting = personas.filter((persona) => !persona.promptSetId);
  const approvedSets = sets.filter((set) => set.approvedVersion !== null).length;
  const totalPending = sets.reduce((sum, set) => sum + set.pendingPrompts, 0);
  const totalWarnings = sets.reduce((sum, set) => sum + set.duplicateWarnings, 0);

  return (
    <>
      <PageHeader
        title="Prompt sets"
        description="Trackable questions derived from an approved persona's information needs — never from a brand keyword list. Each persona prompt carries the evidence it came from, and most are paired with a generic control so the persona framing can be measured on its own."
        breadcrumb={`${ctx.brandName} / Prompt sets`}
      />

      {jobsInFlight.length > 0 ? (
        <div className="mb-4">
          <Callout
            tone={jobsInFlight.some((job) => job.status === "failed") ? "danger" : "info"}
            title="Generation in progress"
          >
            {jobsInFlight.map((job) => (
              <p key={job.id} className="text-xs">
                <StatusBadge status={job.status} /> {job.type.replace(/_/g, " ")} · {job.id}
                {job.lastError ? ` · ${job.lastError}` : ""}
              </p>
            ))}
          </Callout>
        </div>
      ) : null}

      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Prompt sets" value={sets.length} />
        <Stat label="Approved version" value={approvedSets} />
        <Stat label="Awaiting review" value={totalPending} hint="prompts still undecided" />
        <Stat label="Duplicate warnings" value={totalWarnings} hint="advisory, never blocking" />
      </div>

      <Card className="mb-4">
        <CardHeader
          title={`${sets.length} prompt set${sets.length === 1 ? "" : "s"}`}
          description="A version becomes immutable when it is approved; revising it creates a new version with the approved one as its parent."
        />

        {sets.length === 0 ? (
          <EmptyState
            title="No prompt sets yet"
            description={
              personas.length === 0
                ? "Approve a persona version first — prompts are derived from an approved persona's evidence-backed fields."
                : "Generate a prompt set from one of the approved personas below."
            }
            action={
              personas.length === 0 ? (
                <Link
                  href={`/brands/${brandId}/personas`}
                  className="text-sm font-medium text-accent hover:underline"
                >
                  Go to personas
                </Link>
              ) : null
            }
          />
        ) : (
          <ul className="divide-y divide-surface-border">
            {sets.map((set) => (
              <li key={set.id} className="px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <Link
                    href={`/brands/${brandId}/prompt-sets/${set.id}`}
                    className="min-w-0 flex-1 text-sm font-semibold text-ink hover:text-accent hover:underline"
                  >
                    {set.name}
                  </Link>
                  <div className="flex flex-wrap items-center gap-2">
                    {set.currentStatus ? <StatusBadge status={set.currentStatus} /> : null}
                    {set.approvedVersion ? (
                      <Badge tone="success" title="An approved, immutable version exists">
                        v{set.approvedVersion} approved
                      </Badge>
                    ) : null}
                    {set.duplicateWarnings > 0 ? (
                      <Badge
                        tone="warn"
                        title="Prompts that closely resemble another tracked prompt. A warning, not a block — a persona prompt and its control are similar by design."
                      >
                        {set.duplicateWarnings} duplicate warning
                        {set.duplicateWarnings === 1 ? "" : "s"}
                      </Badge>
                    ) : null}
                  </div>
                </div>

                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-subtle">
                  <code>{set.slug}</code>
                  <span>
                    · version {set.currentVersion ?? "—"} of {set.versionCount}
                  </span>
                  <span>· persona: {set.personaName}</span>
                  <span>
                    · {set.promptCount} prompt{set.promptCount === 1 ? "" : "s"}, {set.controlCount}{" "}
                    control{set.controlCount === 1 ? "" : "s"}
                  </span>
                  <span>
                    · {set.approvedPrompts} approved
                    {set.pendingPrompts > 0 ? `, ${set.pendingPrompts} pending` : ""}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {canGenerate && personas.length > 0 ? (
        <Card>
          <CardHeader
            title={
              awaiting.length > 0
                ? "Approved personas awaiting a prompt set"
                : "Regenerate from an approved persona"
            }
            description="Generating always creates a new draft version. Nothing that already exists is modified."
          />
          <ul className="divide-y divide-surface-border">
            {personas.map((persona) => (
              <li
                key={persona.id}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5"
              >
                <span className="min-w-0">
                  <Link
                    href={`/brands/${brandId}/personas/${persona.id}`}
                    className="text-sm font-medium text-ink hover:text-accent hover:underline"
                  >
                    {persona.name}
                  </Link>
                  <span className="ml-2 text-xs text-ink-subtle">
                    v{persona.approvedVersion} approved · confidence{" "}
                    {(persona.overallConfidence * 100).toFixed(0)}%
                    {persona.promptSetId ? " · already has a prompt set" : ""}
                  </span>
                </span>
                <ActionForm
                  action={generatePromptsAction}
                  csrfToken={csrfToken}
                  hidden={{ brandId, personaId: persona.id }}
                  className="space-y-0"
                >
                  <SubmitButton
                    label={persona.promptSetId ? "Regenerate" : "Generate prompts"}
                    variant="secondary"
                    size="sm"
                  />
                </ActionForm>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}
    </>
  );
}
