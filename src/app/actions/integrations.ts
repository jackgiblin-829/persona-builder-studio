"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOrgAccess } from "@/lib/auth/context";
import { integrationUpdateSchema, updateIntegration } from "@/services/integrations";
import { runAction, type ActionState } from "./types";

const formSchema = integrationUpdateSchema.extend({ organizationId: z.string().min(1) });

export async function updateIntegrationAction(_previous: ActionState, formData: FormData) {
  return runAction(formData, formSchema, async (input) => {
    const ctx = await requireOrgAccess(input.organizationId);
    await updateIntegration(ctx, input);
    revalidatePath(`/orgs/${input.organizationId}/settings/integrations`);
    return {
      status: "ok",
      message: `${input.vendor === "openai" ? "OpenAI" : "SparkToro"} is now in ${input.mode} mode.`,
    };
  });
}
