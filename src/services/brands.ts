import "server-only";
import { and, asc, count, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import {
  brandProducts,
  brands,
  competitors,
  dataSources,
  evidenceRecords,
  personas,
  promptSets,
} from "@/db/schema";
import { requireCapability, type ScopeContext } from "@/lib/auth/context";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { newId, ID_PREFIXES, slugify } from "@/lib/ids";
import { recordAudit } from "./audit";

// ── Input schemas ───────────────────────────────────────────────────────────

const domain = z
  .string()
  .trim()
  .min(3)
  .max(253)
  .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i, {
    message: "Enter a bare domain such as northwind-analytics.example",
  })
  .transform((v) => v.toLowerCase().replace(/^www\./, ""));

const list = (max = 40) =>
  z
    .string()
    .optional()
    .transform((v) =>
      (v ?? "")
        .split(/[\n,]/)
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, max),
    );

export const brandInputSchema = z.object({
  name: z.string().trim().min(2, "Brand name is required").max(120),
  canonicalDomain: domain,
  description: z.string().trim().min(10, "Describe the product or service").max(4000),
  conversionActions: list(),
  markets: list(),
  languages: list(),
  regions: list(),
  approvedCrawlDomains: list(),
  strategicQuestions: list(),
  regulatedDomain: z
    .union([z.literal("on"), z.literal("true"), z.literal("false"), z.boolean(), z.undefined()])
    .transform((v) => v === true || v === "on" || v === "true"),
  retentionDays: z
    .string()
    .optional()
    .transform((v) => {
      if (!v || v.trim() === "") return null;
      const n = Number(v);
      if (!Number.isFinite(n) || n < 1 || n > 3650) return null;
      return Math.round(n);
    }),
});

export type BrandInput = z.infer<typeof brandInputSchema>;

export const brandProductSchema = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
  url: z.string().trim().url().max(2000).optional().or(z.literal("")),
  priority: z.coerce.number().int().min(0).max(100).default(0),
});

export const competitorSchema = z.object({
  name: z.string().trim().min(1).max(200),
  domain: z.string().trim().max(253).optional().or(z.literal("")),
  notes: z.string().trim().max(2000).optional(),
});

// ── Reads ───────────────────────────────────────────────────────────────────

export type BrandListItem = {
  id: string;
  name: string;
  slug: string;
  canonicalDomain: string;
  regulatedDomain: boolean;
  createdAt: Date;
  sourceCount: number;
  evidenceCount: number;
  personaCount: number;
  promptSetCount: number;
};

export async function listBrands(ctx: ScopeContext): Promise<BrandListItem[]> {
  const rows = await db
    .select()
    .from(brands)
    .where(eq(brands.organizationId, ctx.organizationId))
    .orderBy(asc(brands.name));

  return Promise.all(
    rows.map(async (brand) => {
      const [sources, evidence, personaRows, promptSetRows] = await Promise.all([
        db.select({ n: count() }).from(dataSources).where(eq(dataSources.brandId, brand.id)),
        db
          .select({ n: count() })
          .from(evidenceRecords)
          .where(eq(evidenceRecords.brandId, brand.id)),
        db.select({ n: count() }).from(personas).where(eq(personas.brandId, brand.id)),
        db.select({ n: count() }).from(promptSets).where(eq(promptSets.brandId, brand.id)),
      ]);
      return {
        id: brand.id,
        name: brand.name,
        slug: brand.slug,
        canonicalDomain: brand.canonicalDomain,
        regulatedDomain: brand.regulatedDomain,
        createdAt: brand.createdAt,
        sourceCount: sources[0]?.n ?? 0,
        evidenceCount: evidence[0]?.n ?? 0,
        personaCount: personaRows[0]?.n ?? 0,
        promptSetCount: promptSetRows[0]?.n ?? 0,
      };
    }),
  );
}

export async function getBrand(ctx: ScopeContext, brandId: string) {
  const [brand] = await db
    .select()
    .from(brands)
    .where(and(eq(brands.id, brandId), eq(brands.organizationId, ctx.organizationId)))
    .limit(1);
  if (!brand) throw new NotFoundError("Brand");
  return brand;
}

export async function getBrandDetail(ctx: ScopeContext, brandId: string) {
  const brand = await getBrand(ctx, brandId);
  const [products, competitorRows] = await Promise.all([
    db
      .select()
      .from(brandProducts)
      .where(eq(brandProducts.brandId, brandId))
      .orderBy(asc(brandProducts.priority), asc(brandProducts.name)),
    db
      .select()
      .from(competitors)
      .where(eq(competitors.brandId, brandId))
      .orderBy(asc(competitors.name)),
  ]);
  return { brand, products, competitors: competitorRows };
}

// ── Writes ──────────────────────────────────────────────────────────────────

async function uniqueSlug(organizationId: string, name: string): Promise<string> {
  const base = slugify(name);
  for (let i = 0; i < 50; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const [existing] = await db
      .select({ id: brands.id })
      .from(brands)
      .where(and(eq(brands.organizationId, organizationId), eq(brands.slug, candidate)))
      .limit(1);
    if (!existing) return candidate;
  }
  throw new ValidationError("Could not derive a unique slug for this brand name.");
}

export async function createBrand(ctx: ScopeContext, input: BrandInput) {
  requireCapability(ctx, "brand:write");
  const slug = await uniqueSlug(ctx.organizationId, input.name);

  // A brand's own domain is always crawlable; extra domains must be listed.
  const allowlist = Array.from(
    new Set([input.canonicalDomain, ...input.approvedCrawlDomains.map((d) => d.toLowerCase())]),
  );

  const [brand] = await db
    .insert(brands)
    .values({
      id: newId(ID_PREFIXES.brand),
      organizationId: ctx.organizationId,
      name: input.name,
      slug,
      canonicalDomain: input.canonicalDomain,
      description: input.description,
      conversionActions: input.conversionActions,
      markets: input.markets,
      languages: input.languages.length > 0 ? input.languages : ["en"],
      regions: input.regions,
      approvedCrawlDomains: allowlist,
      strategicQuestions: input.strategicQuestions,
      regulatedDomain: input.regulatedDomain,
      retentionDays: input.retentionDays,
    })
    .returning();

  if (!brand) throw new ValidationError("Could not create the brand.");

  await recordAudit({
    organizationId: ctx.organizationId,
    brandId: brand.id,
    actorUserId: ctx.userId,
    action: "brand.create",
    entityType: "brand",
    entityId: brand.id,
    metadata: { name: brand.name, regulated: brand.regulatedDomain },
  });

  return brand;
}

export async function updateBrand(ctx: ScopeContext, brandId: string, input: BrandInput) {
  requireCapability(ctx, "brand:write");
  await getBrand(ctx, brandId);

  const allowlist = Array.from(
    new Set([input.canonicalDomain, ...input.approvedCrawlDomains.map((d) => d.toLowerCase())]),
  );

  const [brand] = await db
    .update(brands)
    .set({
      name: input.name,
      canonicalDomain: input.canonicalDomain,
      description: input.description,
      conversionActions: input.conversionActions,
      markets: input.markets,
      languages: input.languages.length > 0 ? input.languages : ["en"],
      regions: input.regions,
      approvedCrawlDomains: allowlist,
      strategicQuestions: input.strategicQuestions,
      regulatedDomain: input.regulatedDomain,
      retentionDays: input.retentionDays,
      updatedAt: new Date(),
    })
    .where(and(eq(brands.id, brandId), eq(brands.organizationId, ctx.organizationId)))
    .returning();

  if (!brand) throw new NotFoundError("Brand");

  await recordAudit({
    organizationId: ctx.organizationId,
    brandId,
    actorUserId: ctx.userId,
    action: "brand.update",
    entityType: "brand",
    entityId: brandId,
  });

  return brand;
}

export async function addBrandProduct(
  ctx: ScopeContext,
  brandId: string,
  input: z.infer<typeof brandProductSchema>,
) {
  requireCapability(ctx, "brand:write");
  await getBrand(ctx, brandId);
  const [row] = await db
    .insert(brandProducts)
    .values({
      id: newId(ID_PREFIXES.brandProduct),
      organizationId: ctx.organizationId,
      brandId,
      name: input.name,
      description: input.description ?? null,
      url: input.url && input.url.length > 0 ? input.url : null,
      priority: input.priority,
    })
    .returning();
  return row;
}

export async function removeBrandProduct(ctx: ScopeContext, brandId: string, productId: string) {
  requireCapability(ctx, "brand:write");
  await getBrand(ctx, brandId);
  await db
    .delete(brandProducts)
    .where(and(eq(brandProducts.id, productId), eq(brandProducts.brandId, brandId)));
}

export async function addCompetitor(
  ctx: ScopeContext,
  brandId: string,
  input: z.infer<typeof competitorSchema>,
) {
  requireCapability(ctx, "brand:write");
  await getBrand(ctx, brandId);
  const [row] = await db
    .insert(competitors)
    .values({
      id: newId(ID_PREFIXES.competitor),
      organizationId: ctx.organizationId,
      brandId,
      name: input.name,
      domain: input.domain && input.domain.length > 0 ? input.domain.toLowerCase() : null,
      notes: input.notes ?? null,
    })
    .returning();
  return row;
}

export async function removeCompetitor(ctx: ScopeContext, brandId: string, competitorId: string) {
  requireCapability(ctx, "brand:write");
  await getBrand(ctx, brandId);
  await db
    .delete(competitors)
    .where(and(eq(competitors.id, competitorId), eq(competitors.brandId, brandId)));
}

export async function deleteBrand(ctx: ScopeContext, brandId: string) {
  requireCapability(ctx, "brand:delete");
  const brand = await getBrand(ctx, brandId);
  await db.delete(brands).where(eq(brands.id, brandId));
  await recordAudit({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "brand.delete",
    entityType: "brand",
    entityId: brandId,
    metadata: { name: brand.name },
  });
}
