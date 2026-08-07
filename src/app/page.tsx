import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";

export default async function RootPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  const first = session.memberships[0];
  if (!first) redirect("/no-organization");
  redirect(`/orgs/${first.organizationId}/brands`);
}
