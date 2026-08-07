"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireBrandAccess, requireOrgAccess } from "@/lib/auth/context";
import { categoryMappingSchema, setCategoryMapping } from "@/services/profound-mapping";
import { refreshProfoundConfiguration, testProfoundConnection } from "@/services/profound-config";
import { runAction, type ActionState } from "./types";

function revalidateExport(brandId: string) {
  revalidatePath(`/brands/${brandId}/profound/export`);
  revalidatePath(`/brands/${brandId}`);
}

// ── Connection (organization-scoped) ────────────────────────────────────────

const orgRef = z.object({ organizationId: z.string().min(1) });

export async function testProfoundConnectionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(formData, orgRef, async (input) => {
    const ctx = await requireOrgAccess(input.organizationId);
    const { organizationName, mode } = await testProfoundConnection(ctx);
    revalidatePath(`/orgs/${input.organizationId}/settings/integrations`);
    return {
      status: "ok",
      message: `Connected to "${organizationName}" in ${mode} mode. Retrieve the configuration next to see its categories.`,
    };
  });
}

const refreshConfigForm = orgRef.extend({ brandId: z.string().min(1).optional() });

export async function refreshProfoundConfigAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(formData, refreshConfigForm, async (input) => {
    const ctx = await requireOrgAccess(input.organizationId);
    const { categoryCount, personaCount, mode } = await refreshProfoundConfiguration(ctx);
    if (input.brandId) revalidateExport(input.brandId);
    revalidatePath(`/orgs/${input.organizationId}/settings/integrations`);
    return {
      status: "ok",
      message: `Retrieved ${categoryCount} categor${categoryCount === 1 ? "y" : "ies"} and ${personaCount} persona${personaCount === 1 ? "" : "s"} from Profound in ${mode} mode.`,
    };
  });
}

// ── Category mapping (brand-scoped) ─────────────────────────────────────────

const categoryForm = categoryMappingSchema.extend({ brandId: z.string().min(1) });

export async function setCategoryMappingAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(formData, categoryForm, async (input) => {
    const ctx = await requireBrandAccess(input.brandId);
    const { categoryName } = await setCategoryMapping(ctx, input);
    revalidateExport(input.brandId);
    return {
      status: "ok",
      message: `Mapped to the Profound category "${categoryName}". Reconciliation and account-evidence pulls now target this category.`,
    };
  });
}
