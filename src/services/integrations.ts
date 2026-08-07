import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { integrations, vendorCredentials } from "@/db/schema";
import { requireCapability, type ScopeContext } from "@/lib/auth/context";
import { decryptSecret, encryptSecret, maskSecret } from "@/lib/crypto";
import { env } from "@/lib/env";
import { newId, ID_PREFIXES } from "@/lib/ids";
import { ValidationError } from "@/lib/errors";
import { recordAudit } from "./audit";

export type Vendor = "openai" | "profound" | "sparktoro" | "dataforseo" | "storage";
export type VendorMode = "mock" | "live";

/** Which credential fields each vendor needs before `live` mode is possible. */
export const VENDOR_CREDENTIAL_FIELDS: Record<Vendor, string[]> = {
  openai: ["apiKey"],
  profound: ["apiKey"],
  sparktoro: ["apiKey"],
  dataforseo: ["login", "password"],
  storage: [],
};

export const VENDOR_LABELS: Record<Vendor, string> = {
  openai: "OpenAI",
  profound: "Profound",
  sparktoro: "SparkToro",
  dataforseo: "DataForSEO",
  storage: "Object storage",
};

export const VENDOR_ROLES: Record<Vendor, string> = {
  openai: "Evidence extraction, segmentation, persona synthesis, prompt generation, briefs, audits",
  profound: "System of record for prompt execution and AI visibility",
  sparktoro: "Aggregated external audience evidence",
  dataforseo: "Traditional search demand, SERP and intent data",
  storage: "Raw uploaded source files",
};

const ENV_MODE: Record<Vendor, VendorMode> = {
  openai: env.OPENAI_MODE,
  profound: env.PROFOUND_MODE,
  sparktoro: env.SPARKTORO_MODE,
  dataforseo: env.DATAFORSEO_MODE,
  storage: "live",
};

/** Environment-provided credentials, used when nothing is stored in the database. */
function envCredentials(vendor: Vendor): Record<string, string> {
  switch (vendor) {
    case "openai":
      return env.OPENAI_API_KEY ? { apiKey: env.OPENAI_API_KEY } : {};
    case "profound":
      return env.PROFOUND_API_KEY ? { apiKey: env.PROFOUND_API_KEY } : {};
    case "sparktoro":
      return env.SPARKTORO_API_KEY ? { apiKey: env.SPARKTORO_API_KEY } : {};
    case "dataforseo":
      return env.DATAFORSEO_LOGIN && env.DATAFORSEO_PASSWORD
        ? { login: env.DATAFORSEO_LOGIN, password: env.DATAFORSEO_PASSWORD }
        : {};
    default:
      return {};
  }
}

export type ResolvedIntegration = {
  vendor: Vendor;
  mode: VendorMode;
  enabled: boolean;
  credentials: Record<string, string>;
  missingFields: string[];
  config: Record<string, unknown>;
  integrationId: string | null;
};

/**
 * Resolves the effective vendor configuration for an organization. This is the
 * single place mode is decided — see ADR-009. It is deliberately synchronous
 * with respect to the call that follows: mode never changes because a request
 * failed.
 */
export async function resolveIntegration(
  organizationId: string,
  vendor: Vendor,
): Promise<ResolvedIntegration> {
  const [row] = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.organizationId, organizationId), eq(integrations.vendor, vendor)))
    .limit(1);

  const stored: Record<string, string> = {};
  if (row) {
    const creds = await db
      .select()
      .from(vendorCredentials)
      .where(eq(vendorCredentials.integrationId, row.id));
    for (const cred of creds) {
      stored[cred.fieldName] = decryptSecret({
        ciphertext: cred.ciphertext,
        iv: cred.iv,
        authTag: cred.authTag,
        keyVersion: cred.keyVersion,
      });
    }
  }

  const credentials = Object.keys(stored).length > 0 ? stored : envCredentials(vendor);
  const required = VENDOR_CREDENTIAL_FIELDS[vendor];
  const missingFields = required.filter((field) => !credentials[field]);
  const mode: VendorMode = row ? row.mode : ENV_MODE[vendor];

  return {
    vendor,
    mode,
    enabled: row?.enabled ?? true,
    credentials,
    missingFields,
    config: row?.config ?? {},
    integrationId: row?.id ?? null,
  };
}

export type IntegrationView = {
  vendor: Vendor;
  label: string;
  role: string;
  mode: VendorMode;
  enabled: boolean;
  configured: boolean;
  missingFields: string[];
  maskedHints: Record<string, string>;
  lastTestedAt: Date | null;
  lastTestOutcome: string | null;
  lastTestMessage: string | null;
};

export async function listIntegrations(ctx: ScopeContext): Promise<IntegrationView[]> {
  const rows = await db
    .select()
    .from(integrations)
    .where(eq(integrations.organizationId, ctx.organizationId))
    .orderBy(asc(integrations.vendor));

  const creds = await db
    .select()
    .from(vendorCredentials)
    .where(eq(vendorCredentials.organizationId, ctx.organizationId));

  const vendors: Vendor[] = ["openai", "profound", "sparktoro", "dataforseo"];
  return vendors.map((vendor) => {
    const row = rows.find((r) => r.vendor === vendor);
    const hints: Record<string, string> = {};
    for (const cred of creds.filter((c) => c.integrationId === row?.id)) {
      hints[cred.fieldName] = cred.maskedHint;
    }
    const fromEnv = envCredentials(vendor);
    for (const [field, value] of Object.entries(fromEnv)) {
      hints[field] ??= `${maskSecret(value)} (from environment)`;
    }
    const missingFields = VENDOR_CREDENTIAL_FIELDS[vendor].filter((f) => !hints[f]);
    return {
      vendor,
      label: VENDOR_LABELS[vendor],
      role: VENDOR_ROLES[vendor],
      mode: row?.mode ?? ENV_MODE[vendor],
      enabled: row?.enabled ?? true,
      configured: missingFields.length === 0,
      missingFields,
      maskedHints: hints,
      lastTestedAt: row?.lastTestedAt ?? null,
      lastTestOutcome: row?.lastTestOutcome ?? null,
      lastTestMessage: row?.lastTestMessage ?? null,
    };
  });
}

export const integrationUpdateSchema = z.object({
  vendor: z.enum(["openai", "profound", "sparktoro", "dataforseo"]),
  mode: z.enum(["mock", "live"]),
  credentials: z.record(z.string(), z.string()).default({}),
});

export async function ensureIntegration(organizationId: string, vendor: Vendor) {
  const [existing] = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.organizationId, organizationId), eq(integrations.vendor, vendor)))
    .limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(integrations)
    .values({
      id: newId(ID_PREFIXES.integration),
      organizationId,
      vendor,
      mode: ENV_MODE[vendor],
    })
    .returning();
  if (!created) throw new ValidationError("Could not create the integration record.");
  return created;
}

export async function updateIntegration(
  ctx: ScopeContext,
  input: z.infer<typeof integrationUpdateSchema>,
) {
  requireCapability(ctx, "integration:manage");
  const integration = await ensureIntegration(ctx.organizationId, input.vendor);

  // Store any newly supplied credentials before evaluating whether live is possible.
  for (const [field, value] of Object.entries(input.credentials)) {
    if (!value || value.trim() === "") continue;
    if (!VENDOR_CREDENTIAL_FIELDS[input.vendor].includes(field)) continue;
    const encrypted = encryptSecret(value.trim());
    await db
      .insert(vendorCredentials)
      .values({
        id: newId(ID_PREFIXES.credential),
        organizationId: ctx.organizationId,
        integrationId: integration.id,
        fieldName: field,
        ciphertext: encrypted.ciphertext,
        iv: encrypted.iv,
        authTag: encrypted.authTag,
        keyVersion: encrypted.keyVersion,
        maskedHint: maskSecret(value.trim()),
      })
      .onConflictDoUpdate({
        target: [vendorCredentials.integrationId, vendorCredentials.fieldName],
        set: {
          ciphertext: encrypted.ciphertext,
          iv: encrypted.iv,
          authTag: encrypted.authTag,
          keyVersion: encrypted.keyVersion,
          maskedHint: maskSecret(value.trim()),
          updatedAt: new Date(),
        },
      });
  }

  if (input.mode === "live") {
    const resolved = await resolveIntegration(ctx.organizationId, input.vendor);
    if (resolved.missingFields.length > 0) {
      throw new ValidationError(
        `${VENDOR_LABELS[input.vendor]} cannot be switched to live mode until these are provided: ${resolved.missingFields.join(", ")}.`,
      );
    }
  }

  await db
    .update(integrations)
    .set({ mode: input.mode, updatedAt: new Date() })
    .where(eq(integrations.id, integration.id));

  await recordAudit({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "integration.update",
    entityType: "integration",
    entityId: integration.id,
    // Records that credentials changed, never what they are.
    metadata: {
      vendor: input.vendor,
      mode: input.mode,
      fieldsUpdated: Object.keys(input.credentials).filter((k) => input.credentials[k]),
    },
  });
}

export async function recordConnectionTest(
  organizationId: string,
  vendor: Vendor,
  outcome: "success" | "failure",
  message: string,
) {
  const integration = await ensureIntegration(organizationId, vendor);
  await db
    .update(integrations)
    .set({
      lastTestedAt: new Date(),
      lastTestOutcome: outcome,
      lastTestMessage: message.slice(0, 1000),
      updatedAt: new Date(),
    })
    .where(eq(integrations.id, integration.id));
}
