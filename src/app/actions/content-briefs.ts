"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireBrandAccess } from "@/lib/auth/context";
import {
  approveBrief,
  briefBodyUpdateSchema,
  rejectBrief,
  startBriefGeneration,
  updateBriefBody,
} from "@/services/content-brief";
import { runAction, type ActionState } from "./types";

function revalidateBriefs(brandId: string, briefId?: string) {
  revalidatePath(`/brands/${brandId}/briefs`);
  if (briefId) revalidatePath(`/brands/${brandId}/briefs/${briefId}`);
  revalidatePath(`/brands/${brandId}`);
}

const generateForm = z.object({
  brandId: z.string().min(1),
  opportunityId: z.string().min(1),
  regenerateFromBriefId: z.string().optional(),
});

export async function generateBriefAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(formData, generateForm, async (input) => {
    const ctx = await requireBrandAccess(input.brandId);
    const { jobId } = await startBriefGeneration(ctx, {
      opportunityId: input.opportunityId,
      regenerateFromBriefId: input.regenerateFromBriefId || undefined,
    });
    revalidateBriefs(input.brandId);
    return {
      status: "ok",
      message: `SEO brief generation queued (job ${jobId}). Refresh once the job completes to review its 27 sections.`,
    };
  });
}

const briefRef = z.object({ brandId: z.string().min(1), briefId: z.string().min(1) });

export async function approveBriefAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(formData, briefRef, async (input) => {
    const ctx = await requireBrandAccess(input.brandId);
    await approveBrief(ctx, input.briefId);
    revalidateBriefs(input.brandId, input.briefId);
    return {
      status: "ok",
      message: "Brief approved. It is now immutable — regenerate a new version to revise it.",
    };
  });
}

const rejectForm = briefRef.extend({ reason: z.string().trim().min(1).max(2000) });

export async function rejectBriefAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(formData, rejectForm, async (input) => {
    const ctx = await requireBrandAccess(input.brandId);
    await rejectBrief(ctx, input.briefId, input.reason);
    revalidateBriefs(input.brandId, input.briefId);
    return {
      status: "ok",
      message: "Brief rejected. Generate a new version from the opportunity when ready.",
    };
  });
}

/**
 * The brief editor posts the whole body as JSON in one hidden field rather
 * than 27 separate inputs — the schema is the single source of truth for
 * what is valid, and `updateBriefBody` re-validates it server-side regardless
 * of what the client sent.
 */
const updateForm = z.object({
  brandId: z.string().min(1),
  briefId: z.string().min(1),
  body: z.string().min(1),
});

export async function updateBriefAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(formData, updateForm, async (input) => {
    const ctx = await requireBrandAccess(input.brandId);

    let parsedJson: unknown;
    try {
      parsedJson = JSON.parse(input.body);
    } catch {
      return { status: "error", message: "The brief body was not valid JSON." };
    }

    const parsed = briefBodyUpdateSchema.safeParse(parsedJson);
    if (!parsed.success) {
      return {
        status: "error",
        message: `The brief did not pass validation: ${parsed.error.issues[0]?.message ?? "unknown error"}`,
      };
    }

    await updateBriefBody(ctx, input.briefId, parsed.data);
    revalidateBriefs(input.brandId, input.briefId);
    return { status: "ok", message: "Brief updated." };
  });
}
