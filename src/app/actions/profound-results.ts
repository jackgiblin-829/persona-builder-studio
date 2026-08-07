"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireBrandAccess } from "@/lib/auth/context";
import { startResultRetrieval } from "@/services/profound-results";
import { runAction, type ActionState } from "./types";

const retrievalForm = z.object({
  brandId: z.string().min(1),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a start date"),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose an end date"),
});

export async function startResultRetrievalAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(formData, retrievalForm, async (input) => {
    const ctx = await requireBrandAccess(input.brandId);
    const { jobId, prompts } = await startResultRetrieval(ctx, {
      startDate: input.startDate,
      endDate: input.endDate,
    });
    revalidatePath(`/brands/${input.brandId}/profound/results`);
    return {
      status: "ok",
      message: `Retrieval queued (job ${jobId}) for ${prompts} linked prompt${prompts === 1 ? "" : "s"}. Refresh once the job completes to see results.`,
    };
  });
}
