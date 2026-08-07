import "server-only";
import { env } from "@/lib/env";
import { VendorNotConfiguredError } from "@/lib/errors";
import { resolveIntegration } from "@/services/integrations";
import { LiveSparktoroAdapter } from "./live";
import { MockSparktoroAdapter } from "./mock";
import type { SparktoroAdapter } from "./types";

export type * from "./types";

/**
 * Resolves the adapter once, before the call (ADR-009) — same shape as
 * `getDataForSeoAdapter` and `getProfoundAdapter`. A live adapter that fails
 * throws; nothing here ever degrades to the mock.
 */
export async function getSparktoroAdapter(
  organizationId: string,
): Promise<{ adapter: SparktoroAdapter; mode: "live" | "mock" }> {
  const resolved = await resolveIntegration(organizationId, "sparktoro");

  if (resolved.mode === "live") {
    if (resolved.missingFields.length > 0) {
      throw new VendorNotConfiguredError("sparktoro", "getAdapter");
    }
    return {
      adapter: new LiveSparktoroAdapter(resolved.credentials.apiKey!, {
        baseUrl: env.SPARKTORO_BASE_URL,
      }),
      mode: "live",
    };
  }

  return { adapter: new MockSparktoroAdapter(), mode: "mock" };
}
