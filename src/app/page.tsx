import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";

export default async function RootPage() {
  const session = await getSession();
  if (!session) redirect("/sign-in");

  if (!session.memberships[0]) redirect("/no-organization");
  redirect("/projects");
}
