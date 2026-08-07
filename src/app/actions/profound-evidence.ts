"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireBrandAccess } from "@/lib/auth/context";
import { requestProfoundEvidencePull } from "@/services/profound-evidence";
import { runAction, type ActionState } from "./types";

const requestForm = z.object({
  brandId: z.string().min(1),
  startDate: z.string().min(1),
  endDate: z.string().min(1),
});

export async function requestProfoundEvidencePullAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(formData, requestForm, async (input) => {
    const ctx = await requireBrandAccess(input.brandId);
    await requestProfoundEvidencePull(ctx, { startDate: input.startDate, endDate: input.endDate });
    revalidatePath(`/brands/${input.brandId}/sources`);
    return {
      status: "ok",
      message:
        "Profound AI-visibility pull queued. It feeds the evidence pipeline once it completes.",
    };
  });
}
