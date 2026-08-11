import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { projects } from "@/db/schema";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { can, type Capability, type Role } from "./rbac";
import { getSession, requireSession, type AuthSession } from "./session";

export type ScopeContext = {
  userId: string;
  userName: string;
  userEmail: string;
  organizationId: string;
  role: Role;
};

export type ProjectContext = ScopeContext & {
  projectId: string;
  projectName: string;
  projectSlug: string;
};

export async function requireOrgAccess(organizationId: string): Promise<ScopeContext> {
  return orgContextFromSession(await requireSession(), organizationId);
}

export function orgContextFromSession(session: AuthSession, organizationId: string): ScopeContext {
  const membership = session.memberships.find((item) => item.organizationId === organizationId);
  if (!membership) throw new ForbiddenError("You are not a member of this organization.");
  return {
    userId: session.user.id,
    userName: session.user.name,
    userEmail: session.user.email,
    organizationId,
    role: membership.role,
  };
}

export async function requireProjectAccess(projectId: string): Promise<ProjectContext> {
  const session = await requireSession();
  const [project] = await db
    .select({
      id: projects.id,
      name: projects.name,
      slug: projects.slug,
      organizationId: projects.organizationId,
    })
    .from(projects)
    .where(eq(projects.id, projectId))
    .limit(1);
  if (!project) throw new NotFoundError("Project");
  return {
    ...orgContextFromSession(session, project.organizationId),
    projectId: project.id,
    projectName: project.name,
    projectSlug: project.slug,
  };
}

export async function requireProjectAccessBySlug(organizationId: string, slug: string) {
  const scope = await requireOrgAccess(organizationId);
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.organizationId, organizationId), eq(projects.slug, slug)))
    .limit(1);
  if (!project) throw new NotFoundError("Project");
  return { ...scope, projectId: project.id, projectName: project.name, projectSlug: project.slug };
}

export function requireCapability(ctx: ScopeContext, capability: Capability): void {
  if (!can(ctx.role, capability)) {
    throw new ForbiddenError(`Your role (${ctx.role}) cannot perform this action (${capability}).`);
  }
}

export function hasCapability(ctx: ScopeContext, capability: Capability): boolean {
  return can(ctx.role, capability);
}

export async function getOptionalSession(): Promise<AuthSession | null> {
  return getSession();
}
