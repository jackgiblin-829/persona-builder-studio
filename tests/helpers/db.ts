import { sql as raw } from "drizzle-orm";
import { db } from "@/db/client";
import { brands, memberships, organizations, users } from "@/db/schema";
import { hashPassword } from "@/lib/crypto";
import { newId, ID_PREFIXES } from "@/lib/ids";
import type { BrandContext, ScopeContext } from "@/lib/auth/context";
import type { Role } from "@/lib/auth/rbac";

/** Empties every table between integration tests. */
export async function truncateAll(): Promise<void> {
  await db.execute(raw`
    DO $$
    DECLARE r record;
    BEGIN
      FOR r IN
        SELECT tablename FROM pg_tables
        WHERE schemaname = 'public' AND tablename <> '__pes_migrations'
      LOOP
        EXECUTE format('TRUNCATE TABLE %I CASCADE', r.tablename);
      END LOOP;
    END $$;
  `);
}

export type TestTenant = {
  organizationId: string;
  userId: string;
  brandId: string;
  ctx: ScopeContext;
  brandCtx: BrandContext;
};

/**
 * Creates an isolated organization + user + brand and returns ready-made
 * scope contexts. Used by tenant-isolation and versioning tests, which need
 * two tenants that must never see each other's rows.
 */
export async function createTestTenant(label: string, role: Role = "owner"): Promise<TestTenant> {
  const organizationId = newId(ID_PREFIXES.organization);
  const userId = newId(ID_PREFIXES.user);
  const brandId = newId(ID_PREFIXES.brand);
  const slug = label.toLowerCase().replace(/[^a-z0-9]+/g, "-");

  await db.insert(organizations).values({ id: organizationId, name: label, slug });
  await db.insert(users).values({
    id: userId,
    email: `${slug}-${userId.slice(-6)}@test.example`,
    name: `${label} user`,
    passwordHash: hashPassword("test-password"),
  });
  await db.insert(memberships).values({
    id: newId(ID_PREFIXES.membership),
    organizationId,
    userId,
    role,
  });
  await db.insert(brands).values({
    id: brandId,
    organizationId,
    name: `${label} Brand`,
    slug: `${slug}-brand`,
    canonicalDomain: `${slug}.example`,
    description: `Test brand for ${label}. Long enough to satisfy validation.`,
    approvedCrawlDomains: [`${slug}.example`],
    languages: ["en"],
  });

  const ctx: ScopeContext = {
    userId,
    userName: `${label} user`,
    userEmail: `${slug}@test.example`,
    organizationId,
    role,
  };

  return {
    organizationId,
    userId,
    brandId,
    ctx,
    brandCtx: {
      ...ctx,
      brandId,
      brandName: `${label} Brand`,
      brandSlug: `${slug}-brand`,
      regulatedDomain: false,
    },
  };
}
