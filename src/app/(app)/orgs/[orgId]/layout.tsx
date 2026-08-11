import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { AppShell, globalNav } from "@/components/app-shell";
import { getSession } from "@/lib/auth/session";

export default async function OrgLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  const session = await getSession();
  if (!session) redirect("/sign-in");
  if (!session.memberships.some((m) => m.organizationId === orgId)) redirect("/");

  const pathname = (await headers()).get("x-pathname") ?? "";

  return (
    <AppShell
      session={session}
      organizationId={orgId}
      nav={globalNav(orgId)}
      currentPath={pathname}
    >
      {children}
    </AppShell>
  );
}
