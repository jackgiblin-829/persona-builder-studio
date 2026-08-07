"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireBrandAccess } from "@/lib/auth/context";
import { requestWebResearch } from "@/services/web-research";
import { runAction, type ActionState } from "./types";

const requestForm = z.object({ brandId: z.string().min(1) });

export async function requestWebResearchAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(formData, requestForm, async (input) => {
    const ctx = await requireBrandAccess(input.brandId);
    await requestWebResearch(ctx);
    revalidatePath(`/brands/${input.brandId}/sources`);
    return {
      status: "ok",
      message:
        "Deep research queued: the brand's context is used to plan a few research questions, each run as a web search, and the findings feed the evidence pipeline.",
    };
  });
}
