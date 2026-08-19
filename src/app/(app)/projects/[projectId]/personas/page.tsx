import { PersonaEditor } from "@/components/forms/persona-editor";
import {
  ButtonLink,
  Callout,
  Card,
  CardHeader,
  ConfidenceBar,
  EmptyState,
  PageHeader,
} from "@/components/ui";
import {
  resolvePersonaPresentationProfile,
  type AudienceDistribution,
  type PersonaInsight,
} from "@/contracts/studio";
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
  const canExport = hasCapability(ctx, "export:read");
  return (
    <>
      <PageHeader
        title="Personas"
        description="Review the audiences that will become the foundation of your SEO and GEO prompt strategy."
        breadcrumb={`${summary.project.name} / Personas`}
        actions={
          <div className="flex flex-wrap gap-2">
            {items.length ? (
              <>
                {canExport ? (
                  <ButtonLink
                    href={`/projects/${projectId}/personas/export.pptx`}
                    variant="secondary"
                    download
                  >
                    Export client deck
                  </ButtonLink>
                ) : null}
                <ButtonLink href={`/projects/${projectId}/prompts`} variant="primary">
                  Continue to prompts
                </ButtonLink>
              </>
            ) : null}
          </div>
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
      {latest?.status === "completed_with_warnings" && latest.warnings.length ? (
        <div className="mb-4">
          <Callout tone="warn" title="Personas built with evidence cleanup">
            {latest.warnings.join(" ")}
          </Callout>
        </div>
      ) : null}
      {!items.length ? (
        <Card>
          <EmptyState
            title="No personas yet"
            description="Add at least one brand source in Data, then build an adaptive set of three to five profiles."
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
            const deckProfile = resolvePersonaPresentationProfile(profile);
            return (
              <Card key={persona.id}>
                <CardHeader
                  title={version.name}
                  description={version.description}
                  actions={<ConfidenceBar value={version.overallConfidence} />}
                />
                <div className="space-y-4 p-5">
                  <details className="rounded-lg border border-accent/30 bg-accent-soft" open>
                    <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-ink">
                      Client deck profile
                    </summary>
                    <div className="space-y-4 border-t border-accent/20 bg-surface p-4">
                      <dl className="grid gap-3 md:grid-cols-3">
                        <DeckField label="Title / role" value={deckProfile.role.text} />
                        <DeckField label="Industry" value={deckProfile.industry.text} />
                        <DeckField
                          label="Expertise level"
                          value={deckProfile.expertiseLevel.text}
                        />
                        <DeckField label="Tone" value={deckProfile.tone.text} wide />
                        <DeckField label="POV / lens" value={deckProfile.povLens.text} wide />
                      </dl>
                      <SectionGrid
                        sections={[
                          ["What they care about", deckProfile.caresAbout],
                          ["What they would never say", deckProfile.neverSay],
                          ["Content best suited for", deckProfile.contentBestSuitedFor],
                        ]}
                      />
                    </div>
                  </details>
                  <details className="rounded-lg border border-surface-border bg-surface-sunken">
                    <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-ink">
                      Research insights
                    </summary>
                    <div className="border-t border-surface-border bg-surface p-4">
                      <p className="mb-4 text-sm leading-6 text-ink">{profile.summary}</p>
                      <SectionGrid
                        sections={[
                          ["Jobs to be done", profile.jobsToBeDone],
                          ["Goals", profile.goals],
                          ["Pain points", profile.painPoints],
                          ["Decision criteria", profile.decisionCriteria],
                          ["Common questions", profile.commonQuestions],
                          ["Proof needs", profile.proofNeeds],
                          ["Vocabulary", profile.vocabulary],
                          ["AI prompt topics", profile.aiPromptTopics],
                        ]}
                      />
                    </div>
                  </details>
                  <details className="rounded-lg border border-surface-border bg-surface-sunken">
                    <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-ink">
                      SparkToro audience behavior and demographics
                    </summary>
                    <div className="border-t border-surface-border bg-surface p-4">
                      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                        <Distribution title="Age" rows={profile.demographics.age} />
                        <Distribution title="Gender" rows={profile.demographics.gender} />
                        <Distribution title="Income" rows={profile.demographics.income} />
                        <Distribution title="Education" rows={profile.demographics.education} />
                        <Distribution title="Geography" rows={profile.demographics.geography} />
                      </div>
                      <SectionGrid
                        sections={[
                          ["Channels", profile.channels],
                          ["Communities", profile.communities],
                          ["Websites", profile.websites],
                          ["Content preferences", profile.contentPreferences],
                        ]}
                      />
                      <p className="mt-3 text-xs text-ink-subtle">
                        Demographics are aggregate audience distributions, not asserted traits of an
                        individual.
                      </p>
                    </div>
                  </details>
                  <details className="rounded-lg border border-surface-border bg-surface-sunken">
                    <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-ink">
                      Full persona profile
                    </summary>
                    <div className="border-t border-surface-border bg-surface p-4">
                      <SectionGrid
                        sections={[
                          ["Roles", profile.firmographics.roles],
                          ["Seniority", profile.firmographics.seniority],
                          ["Departments", profile.firmographics.departments],
                          ["Industries", profile.firmographics.industries],
                          ["Company size", profile.firmographics.companySize],
                          ["Experience", profile.firmographics.experience],
                          ["Motivations", profile.motivations],
                          ["Constraints", profile.constraints],
                          ["Success measures", profile.successMeasures],
                          ["Objections", profile.objections],
                          ["Buying triggers", profile.buyingTriggers],
                          ["Keywords", profile.keywords],
                        ]}
                        showEvidence
                      />
                    </div>
                  </details>
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

function DeckField({
  label,
  value,
  wide = false,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <div className={wide ? "md:col-span-3" : undefined}>
      <dt className="text-2xs font-bold uppercase text-ink-muted">{label}</dt>
      <dd className="mt-1 text-sm leading-6 text-ink">{value}</dd>
    </div>
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

function SectionGrid({
  sections,
  showEvidence = false,
}: {
  sections: [string, PersonaInsight[]][];
  showEvidence?: boolean;
}) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {sections.map(([title, items]) => (
        <section key={title} className="rounded-lg border border-surface-border p-4">
          <h3 className="text-sm font-semibold text-ink">{title}</h3>
          <ul className="mt-2 space-y-2">
            {items.length ? (
              items.map((item, index) => (
                <li key={`${item.text}-${index}`} className="text-sm text-ink">
                  <span>{item.text}</span>
                  {showEvidence ? (
                    <span className="ml-2 whitespace-nowrap text-2xs text-ink-subtle">
                      {item.signalIds.length} refs · {Math.round(item.confidence * 100)}%
                    </span>
                  ) : null}
                </li>
              ))
            ) : (
              <li className="text-sm text-ink-muted">No supported evidence in this section.</li>
            )}
          </ul>
        </section>
      ))}
    </div>
  );
}
