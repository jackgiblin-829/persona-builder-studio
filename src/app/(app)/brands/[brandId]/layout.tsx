import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { AppShell, brandNav } from "@/components/app-shell";
import { getSession } from "@/lib/auth/session";
import { requireBrandAccess } from "@/lib/auth/context";

export default async function BrandLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ brandId: string }>;
}) {
  const { brandId } = await params;
  const session = await getSession();
  if (!session) redirect("/sign-in");

  const ctx = await requireBrandAccess(brandId);
  const pathname = (await headers()).get("x-pathname") ?? "";

  return (
    <AppShell
      session={session}
      organizationId={ctx.organizationId}
      nav={brandNav(brandId)}
      currentPath={pathname}
      brandName={ctx.brandName}
    >
      {children}
    </AppShell>
  );
}
