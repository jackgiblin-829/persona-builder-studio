"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireBrandAccess } from "@/lib/auth/context";
import {
  approvePageAudit,
  generateAuditInputSchema,
  rejectPageAudit,
  startPageAuditGeneration,
} from "@/services/page-audit";
import { runAction, type ActionState } from "./types";

function revalidateAudits(brandId: string, auditId?: string) {
  revalidatePath(`/brands/${brandId}/audits`);
  if (auditId) revalidatePath(`/brands/${brandId}/audits/${auditId}`);
  revalidatePath(`/brands/${brandId}`);
}

const generateForm = generateAuditInputSchema.extend({ brandId: z.string().min(1) });

export async function generatePageAuditAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(formData, generateForm, async (input) => {
    const ctx = await requireBrandAccess(input.brandId);
    const { jobId } = await startPageAuditGeneration(ctx, {
      personaVersionId: input.personaVersionId,
      promptSetVersionId: input.promptSetVersionId,
      scope: input.scope,
      url: input.url,
      pageTitle: input.pageTitle,
      pageContent: input.pageContent,
    });
    revalidateAudits(input.brandId);
    return {
      status: "ok",
      message: `Page audit queued (job ${jobId}). Refresh once the job completes to review findings.`,
    };
  });
}

const auditRef = z.object({ brandId: z.string().min(1), auditId: z.string().min(1) });

export async function approvePageAuditAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(formData, auditRef, async (input) => {
    const ctx = await requireBrandAccess(input.brandId);
    await approvePageAudit(ctx, input.auditId);
    revalidateAudits(input.brandId, input.auditId);
    return { status: "ok", message: "Page audit approved." };
  });
}

const rejectForm = auditRef.extend({ reason: z.string().trim().min(1).max(2000) });

export async function rejectPageAuditAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(formData, rejectForm, async (input) => {
    const ctx = await requireBrandAccess(input.brandId);
    await rejectPageAudit(ctx, input.auditId, input.reason);
    revalidateAudits(input.brandId, input.auditId);
    return { status: "ok", message: "Page audit rejected." };
  });
}
