"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireBrandAccess } from "@/lib/auth/context";
import {
  approvePromptSetVersion,
  createNewPromptSetVersion,
  promptUpdateSchema,
  rejectPromptSetVersion,
  removeGenericControl,
  reviewPrompts,
  setGenericControl,
  setTrackingPriority,
  startPromptGeneration,
  updatePrompt,
} from "@/services/prompt-sets";
import { runAction, type ActionState } from "./types";

function revalidatePromptSet(brandId: string, promptSetId?: string) {
  revalidatePath(`/brands/${brandId}/prompt-sets`);
  if (promptSetId) revalidatePath(`/brands/${brandId}/prompt-sets/${promptSetId}`);
  revalidatePath(`/brands/${brandId}`);
}

const generateForm = z.object({
  brandId: z.string().min(1),
  personaId: z.string().min(1),
});

export async function generatePromptsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(formData, generateForm, async (input) => {
    const ctx = await requireBrandAccess(input.brandId);
    const { personaName, personaVersion } = await startPromptGeneration(ctx, input.personaId);
    revalidatePromptSet(input.brandId);
    return {
      status: "ok",
      message: `Prompt generation queued for ${personaName} v${personaVersion}. Prompts are derived from the persona's evidence-backed fields; a field with no evidence produces no prompt. Refresh once the job completes.`,
    };
  });
}

const promptRef = z.object({
  brandId: z.string().min(1),
  promptSetId: z.string().min(1),
  promptId: z.string().min(1),
});

const updateForm = promptUpdateSchema.merge(promptRef);

export async function updatePromptAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(formData, updateForm, async (input) => {
    const ctx = await requireBrandAccess(input.brandId);
    await updatePrompt(ctx, input.promptId, input);
    revalidatePromptSet(input.brandId, input.promptSetId);
    return {
      status: "ok",
      message:
        "Prompt updated and marked as reviewer-edited. Its Profound tags and duplicate warnings were recomputed from the new text.",
    };
  });
}

/**
 * Bulk review and bulk priority, in one action.
 *
 * A checkbox can only belong to one form, so approve, reject, un-review and
 * set-priority all submit the same selection and are told apart by the
 * `operation` value on the button that was pressed. Ids arrive as repeated
 * `promptIds` fields, which the default FormData entry map would collapse to
 * one value, so `getAll` is passed in as the raw source instead.
 */
const bulkForm = z.object({
  brandId: z.string().min(1),
  promptSetId: z.string().min(1),
  operation: z.enum(["approve", "reject", "unreview", "priority"]),
  trackingPriority: z.enum(["low", "medium", "high"]).optional(),
  promptIds: z.array(z.string().min(1)).min(1, "Select at least one prompt first"),
});

const REVIEW_STATUS = {
  approve: "approved",
  reject: "rejected",
  unreview: "pending_review",
} as const;

export async function bulkPromptAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(
    formData,
    bulkForm,
    async (input) => {
      const ctx = await requireBrandAccess(input.brandId);

      if (input.operation === "priority") {
        const priority = input.trackingPriority ?? "medium";
        const updated = await setTrackingPriority(ctx, input.promptIds, priority);
        revalidatePromptSet(input.brandId, input.promptSetId);
        return {
          status: "ok",
          message: `Tracking priority set to ${priority} on ${updated} prompt${updated === 1 ? "" : "s"}.`,
        };
      }

      const status = REVIEW_STATUS[input.operation];
      const { updated, cascadedControls } = await reviewPrompts(ctx, input.promptIds, status);
      revalidatePromptSet(input.brandId, input.promptSetId);
      return {
        status: "ok",
        message:
          `${updated} prompt${updated === 1 ? "" : "s"} set to ${status.replace(/_/g, " ")}.` +
          (cascadedControls > 0
            ? ` ${cascadedControls} generic control${cascadedControls === 1 ? "" : "s"} rejected too, because nothing is left for ${cascadedControls === 1 ? "it" : "them"} to control for.`
            : ""),
      };
    },
    {
      raw: {
        brandId: formData.get("brandId"),
        promptSetId: formData.get("promptSetId"),
        operation: formData.get("operation"),
        trackingPriority: formData.get("trackingPriority") ?? undefined,
        promptIds: formData.getAll("promptIds"),
      },
    },
  );
}

const controlForm = promptRef.extend({
  controlText: z.string().trim().min(5, "The control needs to be a real question").max(300),
});

export async function setControlAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(formData, controlForm, async (input) => {
    const ctx = await requireBrandAccess(input.brandId);
    const { replaced } = await setGenericControl(ctx, input.promptId, input.controlText);
    revalidatePromptSet(input.brandId, input.promptSetId);
    return {
      status: "ok",
      message: replaced
        ? "Control replaced. The previous control was removed because nothing else was paired to it."
        : "Control paired. Its results will be compared against the persona prompt to isolate the persona framing.",
    };
  });
}

export async function removeControlAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(formData, promptRef, async (input) => {
    const ctx = await requireBrandAccess(input.brandId);
    await removeGenericControl(ctx, input.promptId);
    revalidatePromptSet(input.brandId, input.promptSetId);
    return {
      status: "ok",
      message:
        "Control removed. This prompt can still be tracked, but no lift can be measured for it.",
    };
  });
}

const versionRef = z.object({
  brandId: z.string().min(1),
  promptSetId: z.string().min(1),
  promptSetVersionId: z.string().min(1),
});

export async function approvePromptSetAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(formData, versionRef, async (input) => {
    const ctx = await requireBrandAccess(input.brandId);
    const { blockers } = await approvePromptSetVersion(ctx, input.promptSetVersionId);
    revalidatePromptSet(input.brandId, input.promptSetId);

    if (blockers.length > 0) {
      return {
        status: "error",
        message: `Not approved — ${blockers.length} problem${blockers.length === 1 ? "" : "s"} must be resolved first: ${blockers.join(" ")}`,
      };
    }

    return {
      status: "ok",
      message:
        "Prompt set approved. This version is now immutable, and its approved prompts are ready for the Profound deployment path.",
    };
  });
}

const rejectForm = versionRef.extend({
  reason: z.string().trim().min(5, "Say why it was rejected").max(2000),
});

export async function rejectPromptSetAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(formData, rejectForm, async (input) => {
    const ctx = await requireBrandAccess(input.brandId);
    await rejectPromptSetVersion(ctx, input.promptSetVersionId, input.reason);
    revalidatePromptSet(input.brandId, input.promptSetId);
    return { status: "ok", message: "Version rejected. The reason is recorded on the version." };
  });
}

const newVersionForm = z.object({
  brandId: z.string().min(1),
  promptSetId: z.string().min(1),
  fromVersionId: z.string().min(1).optional(),
  changeSummary: z.string().trim().min(5, "Describe what this revision changes").max(2000),
});

export async function createPromptSetVersionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(formData, newVersionForm, async (input) => {
    const ctx = await requireBrandAccess(input.brandId);
    const { version } = await createNewPromptSetVersion(ctx, input.promptSetId, {
      fromVersionId: input.fromVersionId,
      changeSummary: input.changeSummary,
    });
    revalidatePromptSet(input.brandId, input.promptSetId);
    return {
      status: "ok",
      message: `Version ${version} created as a draft copy, including the prompts a previous round rejected. The source version is unchanged.`,
    };
  });
}
