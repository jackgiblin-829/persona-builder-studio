import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { deleteProjectAction } from "@/app/actions/projects";
import { AppShell, globalNav } from "@/components/app-shell";
import { ActionForm, SubmitButton } from "@/components/forms/action-form";
import { BrandIcon, ButtonLink, Card, EmptyState, PageHeader } from "@/components/ui";
import { getCsrfToken, getSession } from "@/lib/auth/session";
import { listProjectsForSession } from "@/services/projects";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const first = session.memberships[0];
  if (!first) redirect("/no-organization");
  const pathname = (await headers()).get("x-pathname") ?? "/projects";
  const [items, csrfToken] = await Promise.all([
    listProjectsForSession(session.memberships),
    getCsrfToken(),
  ]);
  return (
    <AppShell nav={globalNav(first.organizationId)} currentPath={pathname}>
      <PageHeader
        title="Projects"
        description="Turn research into personas and a client-ready prompt taxonomy."
        actions={
          <ButtonLink href="/projects/new" variant="primary">
            New project
          </ButtonLink>
        }
      />
      {items.length === 0 ? (
        <Card>
          <EmptyState
            title="No projects yet"
            description="Create a project, add call transcripts or research files, then generate the full persona set in one click."
            action={
              <ButtonLink href="/projects/new" variant="primary" size="sm">
                Create the first project
              </ButtonLink>
            }
          />
        </Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-2">
          {items.map((project) => (
            <Card key={project.id} className="overflow-hidden">
              <Link
                href={`/projects/${project.id}/data`}
                className="group block p-5 transition-colors hover:bg-surface-sunken"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-ink">{project.name}</h2>
                    <p className="mt-1 text-sm text-ink-muted">{project.canonicalDomain}</p>
                  </div>
                  <BrandIcon
                    name="arrow"
                    className="mt-1 h-4 w-4 text-ink-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-ink"
                  />
                </div>
                <p className="mt-4 line-clamp-2 text-sm leading-6 text-ink-muted">
                  {project.description}
                </p>
                <div className="mt-4 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-muted">
                  <span>
                    {project.sourceCount} source{project.sourceCount === 1 ? "" : "s"}
                  </span>
                  <span>
                    {project.personaCount} persona{project.personaCount === 1 ? "" : "s"}
                  </span>
                  <span>
                    {project.promptCount} prompt{project.promptCount === 1 ? "" : "s"}
                  </span>
                  <span>{project.primaryMarket}</span>
                </div>
              </Link>
              {project.canDelete ? (
                <details className="border-t border-surface-border bg-surface-sunken">
                  <summary className="cursor-pointer px-5 py-2.5 text-xs text-ink-muted">
                    Project options
                  </summary>
                  <div className="flex flex-wrap items-center justify-between gap-3 border-t border-surface-border bg-surface px-5 py-3">
                    <p className="text-xs text-ink-muted">
                      Deleting a project permanently removes its research and outputs.
                    </p>
                    <ActionForm
                      action={deleteProjectAction}
                      csrfToken={csrfToken}
                      hidden={{ projectId: project.id }}
                      className="space-y-0"
                    >
                      <SubmitButton
                        label="Delete project"
                        pendingLabel="Deleting…"
                        variant="danger"
                        size="sm"
                        confirm={`Delete “${project.name}” and all of its research, personas, and prompts? This cannot be undone.`}
                      />
                    </ActionForm>
                  </div>
                </details>
              ) : null}
            </Card>
          ))}
        </div>
      )}
    </AppShell>
  );
}
