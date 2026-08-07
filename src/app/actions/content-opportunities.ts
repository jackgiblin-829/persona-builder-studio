"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireBrandAccess } from "@/lib/auth/context";
import {
  approveOpportunity,
  opportunityUpdateSchema,
  rejectOpportunity,
  startOpportunityGeneration,
  updateOpportunity,
} from "@/services/content-opportunities";
import { runAction, type ActionState } from "./types";

function revalidateOpportunities(brandId: string, opportunityId?: string) {
  revalidatePath(`/brands/${brandId}/opportunities`);
  if (opportunityId) revalidatePath(`/brands/${brandId}/opportunities/${opportunityId}`);
  revalidatePath(`/brands/${brandId}`);
}

const generateForm = z.object({
  brandId: z.string().min(1),
  personaVersionId: z.string().min(1),
  promptSetVersionId: z.string().min(1),
});

export async function generateOpportunitiesAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(formData, generateForm, async (input) => {
    const ctx = await requireBrandAccess(input.brandId);
    const { jobId } = await startOpportunityGeneration(ctx, {
      personaVersionId: input.personaVersionId,
      promptSetVersionId: input.promptSetVersionId,
    });
    revalidateOpportunities(input.brandId);
    return {
      status: "ok",
      message: `Content-gap analysis queued (job ${jobId}). This does not touch previously generated opportunities. Refresh once the job completes.`,
    };
  });
}

const opportunityRef = z.object({ brandId: z.string().min(1), opportunityId: z.string().min(1) });

export async function approveOpportunityAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(formData, opportunityRef, async (input) => {
    const ctx = await requireBrandAccess(input.brandId);
    await approveOpportunity(ctx, input.opportunityId);
    revalidateOpportunities(input.brandId, input.opportunityId);
    return {
      status: "ok",
      message: "Opportunity approved. You can now generate an SEO brief from it.",
    };
  });
}

const rejectForm = opportunityRef.extend({ reason: z.string().trim().min(1).max(2000) });

export async function rejectOpportunityAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(formData, rejectForm, async (input) => {
    const ctx = await requireBrandAccess(input.brandId);
    await rejectOpportunity(ctx, input.opportunityId, input.reason);
    revalidateOpportunities(input.brandId, input.opportunityId);
    return {
      status: "ok",
      message: "Opportunity rejected. It stays visible with its reason for the record.",
    };
  });
}

const updateForm = opportunityUpdateSchema.extend({
  brandId: z.string().min(1),
  opportunityId: z.string().min(1),
});

export async function updateOpportunityAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(formData, updateForm, async (input) => {
    const ctx = await requireBrandAccess(input.brandId);
    await updateOpportunity(ctx, input.opportunityId, {
      title: input.title,
      problemStatement: input.problemStatement,
      recommendation: input.recommendation,
      priority: input.priority,
      estimatedEffort: input.estimatedEffort,
      validationMethod: input.validationMethod,
    });
    revalidateOpportunities(input.brandId, input.opportunityId);
    return { status: "ok", message: "Opportunity updated." };
  });
}
