/**
 * Client-safe action types. Kept free of server imports so client components
 * can consume `ActionState` without pulling the server-only action runner
 * (and, transitively, the database and session modules) into the browser
 * bundle. The runner itself lives in ./types.ts.
 */
export type ActionState = {
  status: "idle" | "ok" | "error";
  message?: string;
  fieldErrors?: Record<string, string[]>;
  /** Set on success, or on validation errors when an action whitelists preserved fields. */
  data?: Record<string, unknown>;
};

export const IDLE: ActionState = { status: "idle" };
