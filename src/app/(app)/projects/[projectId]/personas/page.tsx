import { generatePersonasAction } from "@/app/actions/projects";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { PersonaEditor } from "@/components/forms/persona-editor";
import {
  Badge,
  ButtonLink,
  Callout,
  Card,
  CardHeader,
  ConfidenceBar,
  EmptyState,
  MetricStrip,
  PageHeader,
  StatusBadge,
} from "@/components/ui";
import type { AudienceDistribution, PersonaInsight } from "@/contracts/studio";
import { hasCapability, requireProjectAccess } from "@/lib/auth/context";
import { getCsrfToken } from "@/lib/auth/session";
import { listActivePersonas } from "@/services/personas";
import { getProjectWorkflowSummary } from "@/services/projects";

export const dynamic = "force-dynamic";

export default async function PersonasPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params;
  const ctx = await requireProjectAccess(projectId);
  const [items, summary, csrfToken] = await Promise.all([
    listActivePersonas(ctx),
    getProjectWorkflowSummary(ctx),
    getCsrfToken(),
  ]);
  const latest = summary.runs.find((run) => run.workflowType === "persona_generation") ?? null;
  const canEdit = hasCapability(ctx, "persona:edit");
  return (
    <>
      <PageHeader
        title="Personas"
        description="Traditional persona profiles with SparkToro audience distributions, evidence references, and immutable edit history."
        breadcrumb={`${summary.project.name} / Personas`}
        actions={
          canEdit ? (
            <ActionForm
              action={generatePersonasAction}
              csrfToken={csrfToken}
              hidden={{ projectId }}
              className="space-y-0"
            >
              <SubmitButton
                label={items.length ? "Regenerate personas" : "Generate personas"}
                pendingLabel="Starting…"
                disabled={summary.completedSourceCount === 0}
              />
            </ActionForm>
          ) : null
        }
      />
      {summary.newDataAvailable ? (
        <div className="mb-4">
          <Callout tone="warn" title="New data available">
            These personas still represent source revision {summary.project.activePersonaRevision}.
            Regenerate once to include revision {summary.project.sourceRevision}.
          </Callout>
        </div>
      ) : null}
      {latest && (latest.status === "running" || latest.status === "queued") ? (
        <div className="mb-4">
          <Callout tone="info" title="Generating personas">
            {latest.stage.replaceAll("_", " ")} · {latest.progress}%. The current set remains active
            until this run finishes.
          </Callout>
        </div>
      ) : null}
      {latest?.status === "failed" ? (
        <div className="mb-4">
          <Callout tone="danger" title="Latest run failed">
            {latest.errorMessage}. No active persona was replaced.
          </Callout>
        </div>
      ) : null}
      <MetricStrip
        className="mb-5"
        metrics={[
          { label: "Active personas", value: items.length },
          { label: "Source revision", value: summary.project.sourceRevision },
          { label: "Persona revision", value: summary.project.activePersonaRevision },
          { label: "Latest run", value: latest ? <StatusBadge status={latest.status} /> : "—" },
        ]}
      />
      {!items.length ? (
        <Card>
          <EmptyState
            title="No personas yet"
            description="Complete at least one source in Data, then use Generate personas to create an adaptive set of three to five profiles."
            action={
              <ButtonLink href={`/projects/${projectId}/data`} variant="primary" size="sm">
                Go to Data
              </ButtonLink>
            }
          />
        </Card>
      ) : (
        <div className="space-y-5">
          {items.map(({ persona, version }) => {
            const profile = version.profile;
            return (
              <Card key={persona.id}>
                <CardHeader
                  title={
                    <span className="flex flex-wrap items-center gap-2">
                      {version.name}
                      <Badge tone="accent">v{version.version}</Badge>
                    </span>
                  }
                  description={version.description}
                  actions={<ConfidenceBar value={version.overallConfidence} />}
                />
                <div className="space-y-6 p-5">
                  <p className="text-sm leading-6 text-ink">{profile.summary}</p>
                  <section>
                    <h3 className="mb-3 text-sm font-semibold text-ink">
                      SparkToro audience distributions
                    </h3>
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                      <Distribution title="Age" rows={profile.demographics.age} />
                      <Distribution title="Gender" rows={profile.demographics.gender} />
                      <Distribution title="Income" rows={profile.demographics.income} />
                      <Distribution title="Education" rows={profile.demographics.education} />
                      <Distribution title="Geography" rows={profile.demographics.geography} />
                    </div>
                    <p className="mt-2 text-xs text-ink-subtle">
                      These are aggregate audience distributions, not asserted characteristics of an
                      individual.
                    </p>
                  </section>
                  <SectionGrid
                    sections={[
                      ["Roles", profile.firmographics.roles],
                      ["Seniority", profile.firmographics.seniority],
                      ["Departments", profile.firmographics.departments],
                      ["Industries", profile.firmographics.industries],
                      ["Company size", profile.firmographics.companySize],
                      ["Experience", profile.firmographics.experience],
                      ["Jobs to be done", profile.jobsToBeDone],
                      ["Motivations", profile.motivations],
                      ["Goals", profile.goals],
                      ["Pain points", profile.painPoints],
                      ["Constraints", profile.constraints],
                      ["Success measures", profile.successMeasures],
                      ["Decision criteria", profile.decisionCriteria],
                      ["Objections", profile.objections],
                      ["Common questions", profile.commonQuestions],
                      ["Proof needs", profile.proofNeeds],
                      ["Vocabulary", profile.vocabulary],
                      ["Buying triggers", profile.buyingTriggers],
                      ["Channels", profile.channels],
                      ["Communities", profile.communities],
                      ["Websites", profile.websites],
                      ["Content preferences", profile.contentPreferences],
                      ["Keywords", profile.keywords],
                      ["AI prompt topics", profile.aiPromptTopics],
                    ]}
                  />
                  {canEdit ? (
                    <details className="rounded-lg border border-surface-border bg-surface-sunken">
                      <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-ink">
                        Edit sections and create version {version.version + 1}
                      </summary>
                      <div className="border-t border-surface-border bg-surface p-4">
                        <PersonaEditor
                          projectId={projectId}
                          personaId={persona.id}
                          version={version.version}
                          name={version.name}
                          description={version.description}
                          profile={profile}
                          csrfToken={csrfToken}
                        />
                      </div>
                    </details>
                  ) : null}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}

function Distribution({ title, rows }: { title: string; rows: AudienceDistribution[] }) {
  return (
    <div className="rounded-lg border border-surface-border bg-surface-sunken p-3">
      <h4 className="text-2xs font-bold uppercase text-ink-muted">{title}</h4>
      {rows.length ? (
        <ul className="mt-2 space-y-1">
          {rows.slice(0, 5).map((row) => (
            <li key={`${row.label}-${row.value}`} className="flex justify-between gap-2 text-xs">
              <span className="truncate text-ink">{row.label}</span>
              <span className="tabular-nums text-ink-muted">
                {row.value}
                {row.unit === "percent" ? "%" : ""}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-xs text-ink-subtle">Not supplied</p>
      )}
    </div>
  );
}

function SectionGrid({ sections }: { sections: [string, PersonaInsight[]][] }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {sections.map(([title, items]) => (
        <section key={title} className="rounded-lg border border-surface-border p-4">
          <h3 className="text-sm font-semibold text-ink">{title}</h3>
          <ul className="mt-2 space-y-2">
            {items.map((item, index) => (
              <li key={`${item.text}-${index}`} className="text-sm text-ink">
                <span>{item.text}</span>
                <span className="ml-2 whitespace-nowrap text-2xs text-ink-subtle">
                  {item.signalIds.length} refs · {Math.round(item.confidence * 100)}%
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
