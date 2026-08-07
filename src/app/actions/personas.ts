"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireBrandAccess } from "@/lib/auth/context";
import {
  approvePersonaVersion,
  attachFieldEvidence,
  createNewVersion,
  detachFieldEvidence,
  duplicatePersona,
  fieldUpdateSchema,
  markFieldUnsupported,
  rejectPersonaVersion,
  renamePersona,
  setFieldLocked,
  updatePersonaField,
} from "@/services/personas";
import { runAction, type ActionState } from "./types";

function revalidatePersona(brandId: string, personaId: string) {
  revalidatePath(`/brands/${brandId}/personas`);
  revalidatePath(`/brands/${brandId}/personas/${personaId}`);
  revalidatePath(`/brands/${brandId}`);
}

const fieldRef = z.object({
  brandId: z.string().min(1),
  personaId: z.string().min(1),
  fieldId: z.string().min(1),
});

const updateFieldForm = fieldUpdateSchema.merge(fieldRef);

export async function updatePersonaFieldAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(formData, updateFieldForm, async (input) => {
    const ctx = await requireBrandAccess(input.brandId);
    await updatePersonaField(ctx, input.fieldId, input);
    revalidatePersona(input.brandId, input.personaId);
    return { status: "ok", message: "Claim updated and marked as reviewer-edited." };
  });
}

const evidenceForm = fieldRef.extend({
  evidenceId: z.string().min(1),
  relation: z.enum(["supports", "contradicts"]),
});

export async function attachEvidenceAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(formData, evidenceForm, async (input) => {
    const ctx = await requireBrandAccess(input.brandId);
    await attachFieldEvidence(ctx, input.fieldId, input.evidenceId, input.relation);
    revalidatePersona(input.brandId, input.personaId);
    return {
      status: "ok",
      message: `Evidence attached as ${input.relation}. Confidence recomputed from the new evidence set.`,
    };
  });
}

export async function detachEvidenceAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(formData, evidenceForm, async (input) => {
    const ctx = await requireBrandAccess(input.brandId);
    await detachFieldEvidence(ctx, input.fieldId, input.evidenceId, input.relation);
    revalidatePersona(input.brandId, input.personaId);
    return {
      status: "ok",
      message:
        "Evidence detached. If nothing supports the claim any more it is now marked insufficient evidence.",
    };
  });
}

const unsupportedForm = fieldRef.extend({
  unsupported: z.enum(["true", "false"]).transform((value) => value === "true"),
});

export async function markUnsupportedAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(formData, unsupportedForm, async (input) => {
    const ctx = await requireBrandAccess(input.brandId);
    await markFieldUnsupported(ctx, input.fieldId, input.unsupported);
    revalidatePersona(input.brandId, input.personaId);
    return {
      status: "ok",
      message: input.unsupported
        ? "Claim marked unsupported. It scores zero and reads as a gap, but stays on the persona so the judgement is visible."
        : "Unsupported marker removed. Confidence recomputed from the attached evidence.",
    };
  });
}

const lockForm = fieldRef.extend({
  locked: z.enum(["true", "false"]).transform((value) => value === "true"),
});

export async function setFieldLockedAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(formData, lockForm, async (input) => {
    const ctx = await requireBrandAccess(input.brandId);
    await setFieldLocked(ctx, input.fieldId, input.locked);
    revalidatePersona(input.brandId, input.personaId);
    return {
      status: "ok",
      message: input.locked
        ? "Field locked. It cannot be edited without unlocking, and the lock carries into the next version."
        : "Field unlocked.",
    };
  });
}

const versionRef = z.object({
  brandId: z.string().min(1),
  personaId: z.string().min(1),
  personaVersionId: z.string().min(1),
});

export async function approvePersonaAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(formData, versionRef, async (input) => {
    const ctx = await requireBrandAccess(input.brandId);
    const { blockers } = await approvePersonaVersion(ctx, input.personaVersionId);
    revalidatePersona(input.brandId, input.personaId);

    if (blockers.length > 0) {
      return {
        status: "error",
        message: `Not approved — ${blockers.length} traceability problem${blockers.length === 1 ? "" : "s"} must be resolved first: ${blockers.join(" ")}`,
      };
    }

    return {
      status: "ok",
      message:
        "Version approved. It is now immutable — revising it creates a new version with this one as its parent.",
    };
  });
}

const rejectForm = versionRef.extend({
  reason: z.string().trim().min(5, "Say why it was rejected").max(2000),
});

export async function rejectPersonaAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(formData, rejectForm, async (input) => {
    const ctx = await requireBrandAccess(input.brandId);
    await rejectPersonaVersion(ctx, input.personaVersionId, input.reason);
    revalidatePersona(input.brandId, input.personaId);
    return { status: "ok", message: "Version rejected. The reason is recorded on the version." };
  });
}

const newVersionForm = z.object({
  brandId: z.string().min(1),
  personaId: z.string().min(1),
  fromVersionId: z.string().min(1).optional(),
  changeSummary: z.string().trim().min(5, "Describe what this revision changes").max(2000),
});

export async function createVersionAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(formData, newVersionForm, async (input) => {
    const ctx = await requireBrandAccess(input.brandId);
    const { version } = await createNewVersion(ctx, input.personaId, {
      fromVersionId: input.fromVersionId,
      changeSummary: input.changeSummary,
    });
    revalidatePersona(input.brandId, input.personaId);
    return {
      status: "ok",
      message: `Version ${version} created as a draft copy. The source version is unchanged.`,
    };
  });
}

const duplicateForm = z.object({
  brandId: z.string().min(1),
  personaId: z.string().min(1),
  fromVersionId: z.string().min(1).optional(),
  name: z.string().trim().max(120).optional(),
});

export async function duplicatePersonaAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let target: { brandId: string; personaId: string } | null = null;

  const state = await runAction(formData, duplicateForm, async (input) => {
    const ctx = await requireBrandAccess(input.brandId);
    const { personaId } = await duplicatePersona(ctx, input.personaId, {
      fromVersionId: input.fromVersionId,
      name: input.name,
    });
    revalidatePath(`/brands/${input.brandId}/personas`);
    target = { brandId: input.brandId, personaId };
    return { status: "ok", message: "Persona duplicated as a new draft." };
  });

  // Redirect outside the try/catch in runAction so the NEXT_REDIRECT signal is
  // not swallowed as an action error.
  if (state.status === "ok" && target) {
    const { brandId, personaId } = target as { brandId: string; personaId: string };
    redirect(`/brands/${brandId}/personas/${personaId}`);
  }
  return state;
}

const renameForm = z.object({
  brandId: z.string().min(1),
  personaId: z.string().min(1),
  name: z.string().trim().min(3).max(120),
});

export async function renamePersonaAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(formData, renameForm, async (input) => {
    const ctx = await requireBrandAccess(input.brandId);
    await renamePersona(ctx, input.personaId, input.name);
    revalidatePersona(input.brandId, input.personaId);
    return {
      status: "ok",
      message: "Persona renamed. The slug is unchanged so deployed Profound tags stay valid.",
    };
  });
}
