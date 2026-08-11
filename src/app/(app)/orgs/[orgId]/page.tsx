import { redirect } from "next/navigation";

export default async function OrgIndex({ params }: { params: Promise<{ orgId: string }> }) {
  const { orgId } = await params;
  void orgId;
  redirect("/projects");
}
