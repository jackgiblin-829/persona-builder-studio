import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { profoundCategoryMappings } from "@/db/schema";
import { requireCapability, type BrandContext } from "@/lib/auth/context";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { newId, ID_PREFIXES } from "@/lib/ids";
import { recordAudit } from "./audit";
import { getProfoundConnection } from "./profound-config";

/**
 * Category mapping.
 *
 * Persona identity is the tool's, not Profound's — every prompt already
 * carries a deterministic `persona:<slug>` tag at generation time
 * (`src/lib/profound-tags.ts`), so there is no Profound-side persona object
 * to map to here. Category mapping is the one decision that still needs
 * making: which Profound category this brand's prompts belong to, so
 * reconciliation and account-evidence pulls know where to look.
 */

export type CategoryMapping = {
  id: string;
  profoundCategoryId: string;
  profoundCategoryName: string;
  status: string;
  lastValidatedAt: Date | null;
};

export async function getCategoryMapping(ctx: BrandContext): Promise<CategoryMapping | null> {
  const connection = await getProfoundConnection(ctx);
  const configuration = connection?.configuration ?? null;

  const [categoryRow] = await db
    .select()
    .from(profoundCategoryMappings)
    .where(
      and(
        eq(profoundCategoryMappings.organizationId, ctx.organizationId),
        eq(profoundCategoryMappings.brandId, ctx.brandId),
      ),
    )
    .orderBy(desc(profoundCategoryMappings.updatedAt))
    .limit(1);

  if (!categoryRow) return null;

  // A category that has vanished from the account invalidates the mapping. The
  // row is not deleted — deployment/reconciliation history still refers to it.
  const categoryStillExists =
    !configuration ||
    configuration.categories.some((row) => row.id === categoryRow.profoundCategoryId);

  return {
    id: categoryRow.id,
    profoundCategoryId: categoryRow.profoundCategoryId,
    profoundCategoryName: categoryRow.profoundCategoryName,
    status: categoryStillExists ? categoryRow.status : "invalid",
    lastValidatedAt: categoryRow.lastValidatedAt,
  };
}

export const categoryMappingSchema = z.object({
  profoundCategoryId: z.string().min(1, "Choose a Profound category"),
});

export async function setCategoryMapping(
  ctx: BrandContext,
  input: z.infer<typeof categoryMappingSchema>,
): Promise<{ categoryName: string }> {
  requireCapability(ctx, "profound:configure");

  const connection = await getProfoundConnection(ctx);
  if (!connection?.configuration) {
    throw new ValidationError(
      "Retrieve Profound's configuration before mapping a category — the category list is read from the account.",
    );
  }

  const category = connection.configuration.categories.find(
    (row) => row.id === input.profoundCategoryId,
  );
  if (!category) throw new NotFoundError("Profound category");

  // One brand maps to one category. Replacing the mapping does not touch
  // reconciliations already made against the previous one — their links keep
  // their own category id.
  await db
    .delete(profoundCategoryMappings)
    .where(
      and(
        eq(profoundCategoryMappings.organizationId, ctx.organizationId),
        eq(profoundCategoryMappings.brandId, ctx.brandId),
      ),
    );

  await db.insert(profoundCategoryMappings).values({
    id: newId(ID_PREFIXES.profoundCategoryMapping),
    organizationId: ctx.organizationId,
    brandId: ctx.brandId,
    connectionId: connection.id,
    profoundCategoryId: category.id,
    profoundCategoryName: category.name,
    status: "mapped",
    lastValidatedAt: new Date(),
  });

  await recordAudit({
    organizationId: ctx.organizationId,
    brandId: ctx.brandId,
    actorUserId: ctx.userId,
    action: "profound.mapping_update",
    entityType: "brand",
    entityId: ctx.brandId,
    metadata: { profoundCategoryId: category.id, profoundCategoryName: category.name },
  });

  return { categoryName: category.name };
}
