import "server-only";
import { cookies, headers } from "next/headers";
import { and, eq, gt, lt } from "drizzle-orm";
import { db } from "@/db/client";
import { memberships, organizations, sessions, users } from "@/db/schema";
import { generateToken, hashPassword, safeEqual, sha256, verifyPassword } from "@/lib/crypto";
import { env } from "@/lib/env";
import { newId, ID_PREFIXES } from "@/lib/ids";
import { UnauthenticatedError, ValidationError } from "@/lib/errors";
import type { Role } from "./rbac";

import { CSRF_COOKIE, CSRF_FIELD, SESSION_COOKIE } from "./constants";

export { CSRF_COOKIE, CSRF_FIELD, SESSION_COOKIE };

export type SessionUser = {
  id: string;
  email: string;
  name: string;
};

export type OrgMembership = {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  role: Role;
};

export type AuthSession = {
  sessionId: string;
  user: SessionUser;
  memberships: OrgMembership[];
};

function cookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: env.isProduction,
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

// ── Sign in / out ───────────────────────────────────────────────────────────

export async function createSessionForUser(userId: string): Promise<string> {
  const token = generateToken(32);
  const expiresAt = new Date(Date.now() + env.SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);

  const headerList = await headers();
  await db.insert(sessions).values({
    id: newId(ID_PREFIXES.session),
    tokenHash: sha256(token),
    userId,
    expiresAt,
    ip: headerList.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null,
    userAgent: headerList.get("user-agent")?.slice(0, 500) ?? null,
  });

  const store = await cookies();
  store.set(SESSION_COOKIE, token, cookieOptions(env.SESSION_TTL_DAYS * 24 * 60 * 60));
  // Rotate the CSRF token alongside the session.
  store.set(CSRF_COOKIE, generateToken(24), {
    ...cookieOptions(env.SESSION_TTL_DAYS * 24 * 60 * 60),
    httpOnly: false,
  });
  return token;
}

export async function authenticate(email: string, password: string): Promise<string> {
  const normalized = email.trim().toLowerCase();
  const [user] = await db.select().from(users).where(eq(users.email, normalized)).limit(1);

  if (!user) {
    // Constant-ish work so a missing account is not distinguishable by timing.
    hashPassword(password);
    throw new ValidationError("Incorrect email or password.");
  }
  if (!verifyPassword(password, user.passwordHash)) {
    throw new ValidationError("Incorrect email or password.");
  }
  return user.id;
}

export async function destroyCurrentSession(): Promise<void> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (token) await db.delete(sessions).where(eq(sessions.tokenHash, sha256(token)));
  store.delete(SESSION_COOKIE);
  store.delete(CSRF_COOKIE);
}

// ── Reading the current session ─────────────────────────────────────────────

export async function getSession(): Promise<AuthSession | null> {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const rows = await db
    .select({
      sessionId: sessions.id,
      userId: users.id,
      email: users.email,
      name: users.name,
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .where(and(eq(sessions.tokenHash, sha256(token)), gt(sessions.expiresAt, new Date())))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  const orgRows = await db
    .select({
      organizationId: organizations.id,
      organizationName: organizations.name,
      organizationSlug: organizations.slug,
      role: memberships.role,
    })
    .from(memberships)
    .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
    .where(eq(memberships.userId, row.userId))
    .orderBy(organizations.name);

  return {
    sessionId: row.sessionId,
    user: { id: row.userId, email: row.email, name: row.name },
    memberships: orgRows,
  };
}

export async function requireSession(): Promise<AuthSession> {
  const session = await getSession();
  if (!session) throw new UnauthenticatedError();
  return session;
}

export async function purgeExpiredSessions(): Promise<number> {
  const deleted = await db
    .delete(sessions)
    .where(lt(sessions.expiresAt, new Date()))
    .returning({ id: sessions.id });
  return deleted.length;
}

// ── CSRF (double-submit) ────────────────────────────────────────────────────

/**
 * Reads the CSRF token minted by middleware. Server Components cannot set
 * cookies during render, so this never writes — see src/middleware.ts.
 */
export async function getCsrfToken(): Promise<string> {
  const store = await cookies();
  return store.get(CSRF_COOKIE)?.value ?? "";
}

/**
 * Verifies the token submitted with a mutating action against the cookie.
 * Called by every server action through `src/app/actions/guard.ts`.
 */
export async function assertCsrf(submitted: FormData | string | null | undefined): Promise<void> {
  const value =
    typeof submitted === "string"
      ? submitted
      : submitted instanceof FormData
        ? String(submitted.get(CSRF_FIELD) ?? "")
        : "";
  const store = await cookies();
  const expected = store.get(CSRF_COOKIE)?.value ?? "";
  if (!value || !expected || !safeEqual(value, expected)) {
    throw new ValidationError("Your session expired or the form was stale. Reload and try again.");
  }
}
