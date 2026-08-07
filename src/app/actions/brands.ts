"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireBrandAccess, requireOrgAccess } from "@/lib/auth/context";
import {
  addBrandProduct,
  addCompetitor,
  brandInputSchema,
  brandProductSchema,
  competitorSchema,
  createBrand,
  removeBrandProduct,
  removeCompetitor,
  updateBrand,
} from "@/services/brands";
import { runAction, type ActionState } from "./types";

const withOrg = brandInputSchema.extend({ organizationId: z.string().min(1) });
const withBrand = brandInputSchema.extend({ brandId: z.string().min(1) });

export async function createBrandAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let destination: string | null = null;

  const result = await runAction(formData, withOrg, async (input) => {
    const ctx = await requireOrgAccess(input.organizationId);
    const brand = await createBrand(ctx, input);
    destination = `/brands/${brand.id}`;
    return { status: "ok" };
  });

  if (destination) redirect(destination);
  return result;
}

export async function updateBrandAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(formData, withBrand, async (input) => {
    const ctx = await requireBrandAccess(input.brandId);
    await updateBrand(ctx, input.brandId, input);
    revalidatePath(`/brands/${input.brandId}/setup`);
    revalidatePath(`/brands/${input.brandId}`);
    return { status: "ok", message: "Brand updated." };
  });
}

const productForm = brandProductSchema.extend({ brandId: z.string().min(1) });

export async function addProductAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(formData, productForm, async (input) => {
    const ctx = await requireBrandAccess(input.brandId);
    await addBrandProduct(ctx, input.brandId, input);
    revalidatePath(`/brands/${input.brandId}/setup`);
    return { status: "ok", message: `Added ${input.name}.` };
  });
}

const removeForm = z.object({ brandId: z.string().min(1), id: z.string().min(1) });

export async function removeProductAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(formData, removeForm, async (input) => {
    const ctx = await requireBrandAccess(input.brandId);
    await removeBrandProduct(ctx, input.brandId, input.id);
    revalidatePath(`/brands/${input.brandId}/setup`);
    return { status: "ok", message: "Removed." };
  });
}

const competitorForm = competitorSchema.extend({ brandId: z.string().min(1) });

export async function addCompetitorAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(formData, competitorForm, async (input) => {
    const ctx = await requireBrandAccess(input.brandId);
    await addCompetitor(ctx, input.brandId, input);
    revalidatePath(`/brands/${input.brandId}/setup`);
    return { status: "ok", message: `Added ${input.name}.` };
  });
}

export async function removeCompetitorAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  return runAction(formData, removeForm, async (input) => {
    const ctx = await requireBrandAccess(input.brandId);
    await removeCompetitor(ctx, input.brandId, input.id);
    revalidatePath(`/brands/${input.brandId}/setup`);
    return { status: "ok", message: "Removed." };
  });
}
