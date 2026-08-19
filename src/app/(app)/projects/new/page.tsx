import { headers } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { AppShell, globalNav } from "@/components/app-shell";
import { ProjectForm } from "@/components/forms/project-form";
import { Card, PageHeader } from "@/components/ui";
import { getCsrfToken, getSession } from "@/lib/auth/session";

export default async function NewProjectPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const available = session.memberships.filter((item) => item.role !== "viewer");
  const first = available[0] ?? session.memberships[0];
  if (!first) redirect("/no-organization");
  const csrfToken = await getCsrfToken();
  const pathname = (await headers()).get("x-pathname") ?? "/projects/new";
  return (
    <AppShell nav={globalNav(first.organizationId)} currentPath={pathname}>
      <PageHeader
        title="New project"
        description="Add the basics now. You can refine the audience before building personas."
        breadcrumb={<Link href="/projects">Projects</Link>}
      />
      <Card className="p-5">
        <ProjectForm
          csrfToken={csrfToken}
          organizations={available.map((item) => ({
            id: item.organizationId,
            name: item.organizationName,
          }))}
        />
      </Card>
    </AppShell>
  );
}
