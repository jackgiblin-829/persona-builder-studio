"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireBrandAccess } from "@/lib/auth/context";
import { sparktoroSectionSchema } from "@/adapters/sparktoro/types";
import { requestAudienceReport } from "@/services/audience-research";
import { runAction, type ActionState } from "./types";

const requestForm = z.object({
  brandId: z.string().min(1),
  description: z.string().min(1).max(500),
  location: z.string().max(200).optional(),
  sections: z.array(sparktoroSectionSchema).default([]),
});

export async function requestAudienceReportAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(
    formData,
    requestForm,
    async (input) => {
      const ctx = await requireBrandAccess(input.brandId);
      const { audienceReportId } = await requestAudienceReport(ctx, {
        description: input.description,
        location: input.location || null,
        sections: input.sections,
      });
      revalidatePath(`/brands/${input.brandId}/sources`);
      return {
        status: "ok",
        message: `SparkToro report requested (${audienceReportId}). Each section runs as its own job and feeds the evidence pipeline as it completes.`,
      };
    },
    {
      raw: {
        brandId: formData.get("brandId"),
        description: formData.get("description"),
        location: formData.get("location") || undefined,
        sections: formData.getAll("sections"),
      },
    },
  );
}
