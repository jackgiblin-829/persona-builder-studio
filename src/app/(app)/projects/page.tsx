import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { AppShell, globalNav } from "@/components/app-shell";
import {
  Badge,
  ButtonLink,
  Card,
  EmptyState,
  MetricStrip,
  PageHeader,
  StatusBadge,
} from "@/components/ui";
import { getSession } from "@/lib/auth/session";
import { listProjectsForSession } from "@/services/projects";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const first = session.memberships[0];
  if (!first) redirect("/no-organization");
  const pathname = (await headers()).get("x-pathname") ?? "/projects";
  const items = await listProjectsForSession(session.memberships);
  return (
    <AppShell
      session={session}
      organizationId={first.organizationId}
      nav={globalNav(first.organizationId)}
      currentPath={pathname}
    >
      <PageHeader
        title="Projects"
        description="Each project turns first-party research and SparkToro audience data into editable personas and export-ready GEO prompts."
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
                className="block p-5 hover:bg-surface-sunken"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <h2 className="text-lg font-semibold text-ink">{project.name}</h2>
                    <p className="mt-1 text-sm text-ink-muted">{project.canonicalDomain}</p>
                  </div>
                  {project.latestRun ? (
                    <StatusBadge status={project.latestRun.status} />
                  ) : (
                    <Badge>not started</Badge>
                  )}
                </div>
                <p className="mt-3 line-clamp-2 text-sm text-ink-muted">{project.description}</p>
                <div className="mt-4">
                  <MetricStrip
                    metrics={[
                      { label: "Sources", value: project.sourceCount },
                      { label: "Personas", value: project.personaCount },
                      { label: "Prompts", value: project.promptCount },
                      { label: "Market", value: project.primaryMarket },
                    ]}
                    className="lg:grid-cols-4"
                  />
                </div>
                <p className="mt-3 text-xs text-ink-subtle">
                  {project.organizationName} · {project.languageLocale}
                </p>
              </Link>
            </Card>
          ))}
        </div>
      )}
    </AppShell>
  );
}
