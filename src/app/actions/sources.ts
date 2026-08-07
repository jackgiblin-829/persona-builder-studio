"use server";

import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { requireBrandAccess } from "@/lib/auth/context";
import { checkRateLimit } from "@/lib/rate-limit";
import {
  createSourceFromPaste,
  createSourceFromUpload,
  deleteSource,
  pasteInputSchema,
  retrySource,
  uploadInputSchema,
} from "@/services/sources";
import { runAction, type ActionState } from "./types";

const uploadForm = uploadInputSchema.extend({ brandId: z.string().min(1) });

export async function uploadSourceAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const file = formData.get("file");

  return runAction(formData, uploadForm, async (input) => {
    const ctx = await requireBrandAccess(input.brandId);

    const headerList = await headers();
    const ip = headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
    const limit = checkRateLimit(`upload:${ip}:${ctx.organizationId}`, {
      limit: 30,
      windowMs: 60 * 1000,
    });
    if (!limit.allowed) {
      return {
        status: "error",
        message: `Too many uploads. Try again in ${Math.ceil(limit.retryAfterMs / 1000)} seconds.`,
      };
    }

    if (!(file instanceof File) || file.size === 0) {
      return { status: "error", message: "Choose a file to upload." };
    }

    const bytes = Buffer.from(await file.arrayBuffer());
    const source = await createSourceFromUpload(ctx, input, {
      name: file.name,
      type: file.type,
      bytes,
    });

    revalidatePath(`/brands/${input.brandId}/sources`);
    return {
      status: "ok",
      message: `"${source?.label}" uploaded. Parsing, redaction and extraction are queued — the status updates as each stage completes.`,
    };
  });
}

const pasteForm = pasteInputSchema.extend({ brandId: z.string().min(1) });

export async function pasteSourceAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(formData, pasteForm, async (input) => {
    const ctx = await requireBrandAccess(input.brandId);
    const source = await createSourceFromPaste(ctx, input);
    revalidatePath(`/brands/${input.brandId}/sources`);
    return {
      status: "ok",
      message: `"${source?.label}" added. Parsing, redaction and extraction are queued.`,
    };
  });
}

const sourceRef = z.object({ brandId: z.string().min(1), sourceId: z.string().min(1) });

export async function retrySourceAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(formData, sourceRef, async (input) => {
    const ctx = await requireBrandAccess(input.brandId);
    await retrySource(ctx, input.sourceId);
    revalidatePath(`/brands/${input.brandId}/sources`);
    return { status: "ok", message: "Re-queued. The pipeline will run again from parsing." };
  });
}

export async function deleteSourceAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(formData, sourceRef, async (input) => {
    const ctx = await requireBrandAccess(input.brandId);
    const impact = await deleteSource(ctx, input.sourceId);
    revalidatePath(`/brands/${input.brandId}/sources`);
    revalidatePath(`/brands/${input.brandId}/evidence`);
    return {
      status: "ok",
      message:
        `Source deleted. ${impact.evidenceCount} evidence record(s) marked unavailable, ` +
        `${impact.embeddingCount} embedding(s) deleted. ` +
        (impact.personaVersionsAffected.length > 0
          ? `${impact.personaVersionsAffected.length} persona version(s) were kept and queued for review.`
          : "No persona versions were affected."),
    };
  });
}
