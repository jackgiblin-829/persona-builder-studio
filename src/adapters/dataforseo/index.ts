import "server-only";
import { env } from "@/lib/env";
import { VendorNotConfiguredError } from "@/lib/errors";
import { resolveIntegration } from "@/services/integrations";
import { LiveDataForSeoAdapter } from "./live";
import { MockDataForSeoAdapter } from "./mock";
import type { DataForSeoAdapter } from "./types";

export type * from "./types";

/**
 * Resolves the adapter once, before the call (ADR-009). A live adapter that
 * fails throws; nothing here ever degrades to the mock — same shape as
 * `getProfoundAdapter` and `getOpenAIAdapter`.
 */
export async function getDataForSeoAdapter(
  organizationId: string,
): Promise<{ adapter: DataForSeoAdapter; mode: "live" | "mock" }> {
  const resolved = await resolveIntegration(organizationId, "dataforseo");

  if (resolved.mode === "live") {
    if (resolved.missingFields.length > 0) {
      throw new VendorNotConfiguredError("dataforseo", "getAdapter");
    }
    return {
      adapter: new LiveDataForSeoAdapter(
        resolved.credentials.login!,
        resolved.credentials.password!,
        {
          baseUrl: env.DATAFORSEO_BASE_URL,
        },
      ),
      mode: "live",
    };
  }

  return { adapter: new MockDataForSeoAdapter(), mode: "mock" };
}
