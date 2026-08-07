import "server-only";
import { env } from "@/lib/env";
import { VendorNotConfiguredError } from "@/lib/errors";
import { resolveIntegration } from "@/services/integrations";
import { LiveProfoundAdapter } from "./live";
import { MockProfoundAdapter } from "./mock";
import type { ProfoundAdapter } from "./types";

export type * from "./types";
export { mockPromptId, resetMockProfoundState, seedMockProfoundUpload } from "./mock";

/**
 * Resolves the adapter once, before the call (ADR-009). A live adapter that
 * fails throws; nothing here ever degrades to the mock, because a deployment
 * that silently wrote to a fixture instead of the customer's account would be
 * indistinguishable from a successful one.
 */
export async function getProfoundAdapter(
  organizationId: string,
): Promise<{ adapter: ProfoundAdapter; mode: "live" | "mock" }> {
  const resolved = await resolveIntegration(organizationId, "profound");

  if (resolved.mode === "live") {
    if (resolved.missingFields.length > 0) {
      throw new VendorNotConfiguredError("profound", "getAdapter");
    }
    return {
      adapter: new LiveProfoundAdapter(resolved.credentials.apiKey!, {
        baseUrl: env.PROFOUND_BASE_URL,
      }),
      mode: "live",
    };
  }

  return { adapter: new MockProfoundAdapter(), mode: "mock" };
}
