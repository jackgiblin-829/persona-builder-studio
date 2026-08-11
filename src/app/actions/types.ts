import { z } from "zod";
import { toPublicError } from "@/lib/errors";
import { assertCsrf } from "@/lib/auth/session";

import type { ActionState } from "./state";

export { IDLE } from "./state";
export type { ActionState } from "./state";

/**
 * Wraps a server action: verifies CSRF, parses input with Zod, and converts
 * any thrown error into a redacted ActionState. Never lets an internal error
 * message reach the browser.
 */
export async function runAction<S extends z.ZodTypeAny>(
  formData: FormData,
  schema: S,
  handler: (input: z.infer<S>) => Promise<ActionState | void>,
  options: { raw?: Record<string, unknown>; preserveFields?: string[] } = {},
): Promise<ActionState> {
  try {
    await assertCsrf(formData);
    const source = options.raw ?? Object.fromEntries(formData.entries());
    const parsed = schema.safeParse(source);
    if (!parsed.success) {
      return {
        status: "error",
        message: "Please correct the highlighted fields.",
        fieldErrors: flattenIssues(parsed.error),
        data: preservedFormData(formData, options.preserveFields),
      };
    }
    const result = await handler(parsed.data);
    return result ?? { status: "ok" };
  } catch (error) {
    if (isRedirectError(error)) throw error;
    const publicError = toPublicError(error);
    return {
      status: "error",
      message: publicError.message,
      data: preservedFormData(formData, options.preserveFields),
    };
  }
}

function flattenIssues(error: z.ZodError): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join(".") || "_form";
    (out[key] ??= []).push(issue.message);
  }
  return out;
}

function preservedFormData(
  formData: FormData,
  preserveFields: string[] | undefined,
): Record<string, unknown> | undefined {
  if (!preserveFields?.length) return undefined;
  const values: Record<string, string | string[]> = {};
  for (const field of preserveFields) {
    const entries = formData
      .getAll(field)
      .filter((value): value is string => typeof value === "string");
    if (entries.length === 0) continue;
    values[field] = entries.length === 1 ? (entries[0] ?? "") : entries;
  }
  return { formValues: values };
}

/** Next.js signals redirect() and notFound() by throwing — let those through. */
function isRedirectError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "digest" in error &&
    typeof (error as { digest?: unknown }).digest === "string" &&
    ((error as { digest: string }).digest.startsWith("NEXT_REDIRECT") ||
      (error as { digest: string }).digest === "NEXT_NOT_FOUND")
  );
}
