/**
 * Auth constants safe to import from client components. Kept separate from
 * session.ts, which is server-only.
 */
export const SESSION_COOKIE = "pes_session";
export const CSRF_COOKIE = "pes_csrf";
export const CSRF_FIELD = "csrfToken";
