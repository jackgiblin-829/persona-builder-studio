"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { z } from "zod";
import {
  authenticate,
  createSessionForUser,
  destroyCurrentSession,
  getSession,
} from "@/lib/auth/session";
import { checkRateLimit } from "@/lib/rate-limit";
import { recordAudit } from "@/services/audit";
import { runAction, type ActionState } from "./types";

const signInSchema = z.object({
  email: z.string().trim().email("Enter a valid email address"),
  password: z.string().min(1, "Enter your password"),
});

export async function signInAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let destination: string | null = null;

  const result = await runAction(formData, signInSchema, async (input) => {
    const headerList = await headers();
    const ip = headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";

    // Per IP+email so one attacker cannot lock out every account from one IP,
    // and one account cannot be brute-forced from one IP.
    const limit = checkRateLimit(`signin:${ip}:${input.email.toLowerCase()}`, {
      limit: 10,
      windowMs: 15 * 60 * 1000,
    });
    if (!limit.allowed) {
      return {
        status: "error",
        message: `Too many sign-in attempts. Try again in ${Math.ceil(limit.retryAfterMs / 1000)} seconds.`,
      };
    }

    const userId = await authenticate(input.email, input.password);
    await createSessionForUser(userId);
    await recordAudit({ actorUserId: userId, action: "auth.sign_in", ip });
    destination = "/";
    return { status: "ok" };
  });

  if (destination) redirect(destination);
  return result;
}

export async function signOutAction(): Promise<void> {
  const session = await getSession();
  if (session) {
    await recordAudit({ actorUserId: session.user.id, action: "auth.sign_out" });
  }
  await destroyCurrentSession();
  redirect("/sign-in");
}
