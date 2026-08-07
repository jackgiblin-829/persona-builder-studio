import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { brands } from "@/db/schema";
import { ForbiddenError, NotFoundError } from "@/lib/errors";
import { can, type Capability, type Role } from "./rbac";
import { getSession, requireSession, type AuthSession } from "./session";

/**
 * The scope object threaded through every service call. Services take a
 * ScopeContext rather than raw ids, which makes an unscoped query awkward to
 * write by accident — see docs/architecture.md §5.
 */
export type ScopeContext = {
  userId: string;
  userName: string;
  userEmail: string;
  organizationId: string;
  role: Role;
};

export type BrandContext = ScopeContext & {
  brandId: string;
  brandName: string;
  brandSlug: string;
  regulatedDomain: boolean;
};

export async function requireOrgAccess(organizationId: string): Promise<ScopeContext> {
  const session = await requireSession();
  return orgContextFromSession(session, organizationId);
}

export function orgContextFromSession(session: AuthSession, organizationId: string): ScopeContext {
  const membership = session.memberships.find((m) => m.organizationId === organizationId);
  if (!membership) throw new ForbiddenError("You are not a member of this organization.");
  return {
    userId: session.user.id,
    userName: session.user.name,
    userEmail: session.user.email,
    organizationId,
    role: membership.role,
  };
}

/**
 * Resolves a brand id to a full context, verifying the caller is a member of
 * the brand's organization. Cross-tenant ids produce ForbiddenError, never a
 * partial read.
 */
export async function requireBrandAccess(brandId: string): Promise<BrandContext> {
  const session = await requireSession();
  const [brand] = await db
    .select({
      id: brands.id,
      name: brands.name,
      slug: brands.slug,
      organizationId: brands.organizationId,
      regulatedDomain: brands.regulatedDomain,
    })
    .from(brands)
    .where(eq(brands.id, brandId))
    .limit(1);

  if (!brand) throw new NotFoundError("Brand");

  const scope = orgContextFromSession(session, brand.organizationId);
  return {
    ...scope,
    brandId: brand.id,
    brandName: brand.name,
    brandSlug: brand.slug,
    regulatedDomain: brand.regulatedDomain,
  };
}

export async function requireBrandAccessBySlug(
  organizationId: string,
  slug: string,
): Promise<BrandContext> {
  const scope = await requireOrgAccess(organizationId);
  const [brand] = await db
    .select()
    .from(brands)
    .where(and(eq(brands.organizationId, organizationId), eq(brands.slug, slug)))
    .limit(1);
  if (!brand) throw new NotFoundError("Brand");
  return {
    ...scope,
    brandId: brand.id,
    brandName: brand.name,
    brandSlug: brand.slug,
    regulatedDomain: brand.regulatedDomain,
  };
}

export function requireCapability(ctx: ScopeContext, capability: Capability): void {
  if (!can(ctx.role, capability)) {
    throw new ForbiddenError(`Your role (${ctx.role}) cannot perform this action (${capability}).`);
  }
}

export function hasCapability(ctx: ScopeContext, capability: Capability): boolean {
  return can(ctx.role, capability);
}

/** For layouts that need to render something for signed-out users. */
export async function getOptionalSession(): Promise<AuthSession | null> {
  return getSession();
}
