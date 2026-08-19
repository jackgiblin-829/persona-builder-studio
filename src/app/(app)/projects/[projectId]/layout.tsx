import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell, globalNav } from "@/components/app-shell";
import { ProjectNav } from "@/components/project-nav";
import { requireProjectAccess } from "@/lib/auth/context";
import { getSession } from "@/lib/auth/session";

export default async function ProjectLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;
  const session = await getSession();
  if (!session) redirect("/sign-in");
  const ctx = await requireProjectAccess(projectId);
  const pathname = (await headers()).get("x-pathname") ?? `/projects/${projectId}`;
  return (
    <AppShell
      nav={globalNav(ctx.organizationId)}
      currentPath={pathname}
      projectName={ctx.projectName}
    >
      <ProjectNav projectId={projectId} />
      {children}
    </AppShell>
  );
}
