"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireBrandAccess } from "@/lib/auth/context";
import {
  decideSegment,
  editSegment,
  mergeSegments,
  segmentEditSchema,
  segmentSplitSchema,
  splitSegment,
  startSegmentation,
} from "@/services/segments";
import { startPersonaGeneration } from "@/services/personas";
import { runAction, type ActionState } from "./types";

const brandRef = z.object({ brandId: z.string().min(1) });

function revalidateSegments(brandId: string) {
  revalidatePath(`/brands/${brandId}/segments`);
  revalidatePath(`/brands/${brandId}`);
}

export async function generateSegmentsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(formData, brandRef, async (input) => {
    const ctx = await requireBrandAccess(input.brandId);
    const { evidenceCount } = await startSegmentation(ctx);
    revalidateSegments(input.brandId);
    return {
      status: "ok",
      message: `Segmentation queued against ${evidenceCount} approved evidence records. This run is stored separately — the previous run's candidates are not modified. Refresh once the job completes.`,
    };
  });
}

const decisionForm = z.object({
  brandId: z.string().min(1),
  segmentId: z.string().min(1),
  decision: z.enum(["approved", "rejected", "candidate"]),
});

export async function decideSegmentAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(formData, decisionForm, async (input) => {
    const ctx = await requireBrandAccess(input.brandId);
    await decideSegment(ctx, input.segmentId, input.decision);
    revalidateSegments(input.brandId);
    return {
      status: "ok",
      message:
        input.decision === "approved"
          ? "Candidate approved. You can now generate a persona from it."
          : input.decision === "rejected"
            ? "Candidate rejected. It stays in the run so the decision is auditable."
            : "Candidate returned to undecided.",
    };
  });
}

const editForm = segmentEditSchema.omit({ distinguishingVariables: true }).extend({
  brandId: z.string().min(1),
  segmentId: z.string().min(1),
  distinguishingVariables: z
    .string()
    .optional()
    .transform((value) =>
      (value ?? "")
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean)
        .slice(0, 10),
    ),
});

export async function editSegmentAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(formData, editForm, async (input) => {
    const ctx = await requireBrandAccess(input.brandId);
    await editSegment(ctx, input.segmentId, input);
    revalidateSegments(input.brandId);
    return { status: "ok", message: "Candidate updated." };
  });
}

const mergeForm = z.object({
  brandId: z.string().min(1),
  targetId: z.string().min(1),
  sourceIds: z.union([z.string(), z.array(z.string())]).transform((value) =>
    (Array.isArray(value) ? value : [value])
      .flatMap((entry) => entry.split(","))
      .map((id) => id.trim())
      .filter(Boolean),
  ),
});

export async function mergeSegmentsAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const sourceIds = formData.getAll("sourceIds").map(String);

  return runAction(
    formData,
    mergeForm,
    async (input) => {
      const ctx = await requireBrandAccess(input.brandId);
      const { merged, confidence } = await mergeSegments(ctx, input.targetId, input.sourceIds);
      revalidateSegments(input.brandId);
      return {
        status: "ok",
        message: `${merged} candidate${merged === 1 ? "" : "s"} merged in. Confidence recomputed from the combined evidence: ${(confidence * 100).toFixed(0)}%.`,
      };
    },
    {
      raw: {
        brandId: formData.get("brandId"),
        targetId: formData.get("targetId"),
        sourceIds,
      },
    },
  );
}

const splitForm = segmentSplitSchema.omit({ evidenceIdsForB: true }).extend({
  brandId: z.string().min(1),
  segmentId: z.string().min(1),
  evidenceIdsForB: z
    .array(z.string().min(1))
    .min(1, "Assign at least one record to the second part"),
});

export async function splitSegmentAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const evidenceIdsForB = formData.getAll("evidenceIdsForB").map(String).filter(Boolean);

  return runAction(
    formData,
    splitForm,
    async (input) => {
      const ctx = await requireBrandAccess(input.brandId);
      await splitSegment(ctx, input.segmentId, input);
      revalidateSegments(input.brandId);
      return {
        status: "ok",
        message: `Split into "${input.labelA}" and "${input.labelB}". The original candidate is kept and marked split.`,
      };
    },
    {
      raw: {
        brandId: formData.get("brandId"),
        segmentId: formData.get("segmentId"),
        labelA: formData.get("labelA"),
        labelB: formData.get("labelB"),
        evidenceIdsForB,
      },
    },
  );
}

const personaForm = z.object({
  brandId: z.string().min(1),
  segmentId: z.string().min(1),
});

export async function generatePersonaAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(formData, personaForm, async (input) => {
    const ctx = await requireBrandAccess(input.brandId);
    const { segmentLabel } = await startPersonaGeneration(ctx, input.segmentId);
    revalidateSegments(input.brandId);
    revalidatePath(`/brands/${input.brandId}/personas`);
    return {
      status: "ok",
      message: `Persona synthesis queued for "${segmentLabel}". A new draft version is created — no existing version is modified. Refresh the personas screen once the job completes.`,
    };
  });
}
