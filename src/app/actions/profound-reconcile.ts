"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireBrandAccess } from "@/lib/auth/context";
import { linkPromptManually, reconcilePromptSetVersion } from "@/services/profound-reconcile";
import { runAction, type ActionState } from "./types";

function revalidateExport(brandId: string) {
  revalidatePath(`/brands/${brandId}/profound/export`);
  revalidatePath(`/brands/${brandId}`);
}

const reconcileForm = z.object({
  brandId: z.string().min(1),
  promptSetVersionId: z.string().min(1),
});

export async function reconcilePromptSetVersionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(formData, reconcileForm, async (input) => {
    const ctx = await requireBrandAccess(input.brandId);
    const summary = await reconcilePromptSetVersion(ctx, input.promptSetVersionId);
    revalidateExport(input.brandId);
    return {
      status: "ok",
      message:
        `Reconciled: ${summary.matched} newly linked, ${summary.alreadyLinked} already linked, ` +
        `${summary.ambiguous} ambiguous (need a manual decision), ${summary.unmatched} not found in Profound yet.`,
    };
  });
}

const manualLinkForm = z.object({
  brandId: z.string().min(1),
  promptSetVersionId: z.string().min(1),
  promptId: z.string().min(1),
  profoundPromptId: z.string().min(1),
});

export async function linkPromptManuallyAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(formData, manualLinkForm, async (input) => {
    const ctx = await requireBrandAccess(input.brandId);
    await linkPromptManually(ctx, {
      promptId: input.promptId,
      promptSetVersionId: input.promptSetVersionId,
      profoundPromptId: input.profoundPromptId,
    });
    revalidateExport(input.brandId);
    return { status: "ok", message: "Linked manually." };
  });
}
