"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOrgAccess } from "@/lib/auth/context";
import { integrationUpdateSchema, updateIntegration } from "@/services/integrations";
import { runAction, type ActionState } from "./types";

const updateForm = integrationUpdateSchema
  .omit({ credentials: true })
  .extend({ organizationId: z.string().min(1) });

/**
 * Credential fields arrive as `credential.<fieldName>` inputs so one form can
 * carry a variable field set per vendor (OpenAI needs `apiKey`; DataForSEO
 * needs `login` and `password`) without a schema per vendor.
 */
export async function updateIntegrationAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const credentials: Record<string, string> = {};
  for (const [key, value] of formData.entries()) {
    if (key.startsWith("credential.") && typeof value === "string") {
      credentials[key.slice("credential.".length)] = value;
    }
  }

  return runAction(
    formData,
    updateForm,
    async (input) => {
      const ctx = await requireOrgAccess(input.organizationId);
      await updateIntegration(ctx, { vendor: input.vendor, mode: input.mode, credentials });
      revalidatePath(`/orgs/${input.organizationId}/settings/integrations`);
      return {
        status: "ok",
        message:
          input.mode === "live"
            ? `${input.vendor} switched to live mode. Test the connection to confirm the credentials work.`
            : `${input.vendor} switched to mock mode. Everything it produces will be labelled Mock.`,
      };
    },
    {
      raw: {
        organizationId: formData.get("organizationId"),
        vendor: formData.get("vendor"),
        mode: formData.get("mode"),
      },
    },
  );
}

export type { ActionState } from "./types";
