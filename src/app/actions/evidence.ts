"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireBrandAccess } from "@/lib/auth/context";
import {
  addEvidenceNote,
  evidenceUpdateSchema,
  reviewEvidence,
  setSegmentLabels,
  updateEvidence,
} from "@/services/evidence";
import { runAction, type ActionState } from "./types";

const updateForm = evidenceUpdateSchema.extend({
  brandId: z.string().min(1),
  evidenceId: z.string().min(1),
});

export async function updateEvidenceAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(formData, updateForm, async (input) => {
    const ctx = await requireBrandAccess(input.brandId);
    await updateEvidence(ctx, input.evidenceId, input);
    revalidatePath(`/brands/${input.brandId}/evidence/${input.evidenceId}`);
    revalidatePath(`/brands/${input.brandId}/evidence`);
    return { status: "ok", message: "Evidence record updated." };
  });
}

const reviewForm = z.object({
  brandId: z.string().min(1),
  decision: z.enum(["approved", "rejected", "pending_review"]),
  evidenceIds: z
    .string()
    .min(1)
    .transform((value) =>
      value
        .split(",")
        .map((id) => id.trim())
        .filter(Boolean),
    ),
});

export async function reviewEvidenceAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(formData, reviewForm, async (input) => {
    const ctx = await requireBrandAccess(input.brandId);
    const n = await reviewEvidence(ctx, input.evidenceIds, input.decision);
    revalidatePath(`/brands/${input.brandId}/evidence`);
    for (const id of input.evidenceIds) revalidatePath(`/brands/${input.brandId}/evidence/${id}`);
    return {
      status: "ok",
      message: `${n} record${n === 1 ? "" : "s"} marked ${input.decision.replace(/_/g, " ")}.`,
    };
  });
}

const noteForm = z.object({
  brandId: z.string().min(1),
  evidenceId: z.string().min(1),
  body: z.string().trim().min(1, "Write a note first").max(4000),
});

export async function addEvidenceNoteAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(formData, noteForm, async (input) => {
    const ctx = await requireBrandAccess(input.brandId);
    await addEvidenceNote(ctx, input.evidenceId, input.body);
    revalidatePath(`/brands/${input.brandId}/evidence/${input.evidenceId}`);
    return { status: "ok", message: "Note added." };
  });
}

const labelsForm = z.object({
  brandId: z.string().min(1),
  evidenceId: z.string().min(1),
  labels: z
    .string()
    .optional()
    .transform((value) =>
      (value ?? "")
        .split(",")
        .map((l) => l.trim())
        .filter(Boolean),
    ),
});

export async function setSegmentLabelsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(formData, labelsForm, async (input) => {
    const ctx = await requireBrandAccess(input.brandId);
    await setSegmentLabels(ctx, input.evidenceId, input.labels);
    revalidatePath(`/brands/${input.brandId}/evidence/${input.evidenceId}`);
    return {
      status: "ok",
      message:
        input.labels.length === 0
          ? "Segment labels cleared."
          : `Labels set: ${input.labels.join(", ")}.`,
    };
  });
}
