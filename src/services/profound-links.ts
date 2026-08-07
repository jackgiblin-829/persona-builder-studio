import "server-only";
import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import {
  personas,
  personaVersions,
  profoundPromptLinks,
  promptSets,
  promptSetVersions,
  prompts,
} from "@/db/schema";
import type { BrandContext } from "@/lib/auth/context";

/**
 * Reads shared by milestone 6 (results) and milestone 7 (content workflows),
 * relocated out of the old deploy module — they never depended on the
 * deploy/dry-run/sync write path, only on `profoundPromptLinks` existing,
 * which reconciliation (`profound-reconcile.ts`) now populates instead.
 */

/** Every prompt this brand has linked in Profound. */
export async function listPromptLinks(ctx: BrandContext) {
  return db
    .select({
      id: profoundPromptLinks.id,
      promptId: profoundPromptLinks.promptId,
      profoundPromptId: profoundPromptLinks.profoundPromptId,
      profoundCategoryId: profoundPromptLinks.profoundCategoryId,
      promptText: prompts.promptText,
      promptType: prompts.promptType,
      dataOrigin: profoundPromptLinks.dataOrigin,
      createdAt: profoundPromptLinks.createdAt,
    })
    .from(profoundPromptLinks)
    .innerJoin(prompts, eq(prompts.id, profoundPromptLinks.promptId))
    .where(
      and(
        eq(profoundPromptLinks.organizationId, ctx.organizationId),
        eq(profoundPromptLinks.brandId, ctx.brandId),
      ),
    )
    .orderBy(desc(profoundPromptLinks.createdAt));
}

/** Approved prompt-set versions, with their persona — for pickers on the export, performance and reconciliation screens. */
export async function listDeployableSets(ctx: BrandContext) {
  return db
    .select({
      promptSetId: promptSets.id,
      promptSetName: promptSets.name,
      versionId: promptSetVersions.id,
      version: promptSetVersions.version,
      personaId: personas.id,
      personaName: personas.name,
      personaVersionId: personaVersions.id,
      personaVersion: personaVersions.version,
    })
    .from(promptSets)
    .innerJoin(promptSetVersions, eq(promptSetVersions.id, promptSets.approvedVersionId))
    .innerJoin(personaVersions, eq(personaVersions.id, promptSetVersions.personaVersionId))
    .innerJoin(personas, eq(personas.id, personaVersions.personaId))
    .where(
      and(eq(promptSets.organizationId, ctx.organizationId), eq(promptSets.brandId, ctx.brandId)),
    )
    .orderBy(asc(personas.name));
}
