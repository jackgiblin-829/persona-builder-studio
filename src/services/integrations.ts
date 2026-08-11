import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import { integrations, vendorCredentials } from "@/db/schema";
import { requireCapability, type ScopeContext } from "@/lib/auth/context";
import { decryptSecret, encryptSecret, maskSecret } from "@/lib/crypto";
import { env } from "@/lib/env";
import { ValidationError } from "@/lib/errors";
import { ID_PREFIXES, newId } from "@/lib/ids";
import { recordAudit } from "./audit";

export type Vendor = "openai" | "sparktoro" | "storage";
export type VendorMode = "mock" | "live";

export const VENDOR_CREDENTIAL_FIELDS: Record<Vendor, string[]> = {
  openai: ["apiKey"],
  sparktoro: ["apiKey"],
  storage: [],
};
export const VENDOR_LABELS: Record<Vendor, string> = {
  openai: "OpenAI",
  sparktoro: "SparkToro",
  storage: "Object storage",
};
export const VENDOR_ROLES: Record<Vendor, string> = {
  openai: "Research-signal extraction, persona synthesis and Query Funnel generation",
  sparktoro: "Aggregated demographics, firmographics, channels, keywords and AI topics",
  storage: "Uploaded source files",
};

function environmentMode(vendor: Vendor): VendorMode {
  if (vendor === "openai") return env.OPENAI_MODE;
  if (vendor === "sparktoro") return env.SPARKTORO_MODE;
  return "live";
}

function environmentCredentials(vendor: Vendor): Record<string, string> {
  if (vendor === "openai" && env.OPENAI_API_KEY) return { apiKey: env.OPENAI_API_KEY };
  if (vendor === "sparktoro" && env.SPARKTORO_API_KEY) return { apiKey: env.SPARKTORO_API_KEY };
  return {};
}

export async function resolveIntegration(organizationId: string, vendor: Vendor) {
  const [row] = await db
    .select()
    .from(integrations)
    .where(and(eq(integrations.organizationId, organizationId), eq(integrations.vendor, vendor)))
    .limit(1);
  const stored: Record<string, string> = {};
  if (row) {
    const rows = await db
      .select()
      .from(vendorCredentials)
      .where(eq(vendorCredentials.integrationId, row.id));
    for (const credential of rows) {
      stored[credential.fieldName] = decryptSecret({
        ciphertext: credential.ciphertext,
        iv: credential.iv,
        authTag: credential.authTag,
        keyVersion: credential.keyVersion,
      });
    }
  }
  const credentials = Object.keys(stored).length ? stored : environmentCredentials(vendor);
  const missingFields = VENDOR_CREDENTIAL_FIELDS[vendor].filter((field) => !credentials[field]);
  return {
    vendor,
    mode: row?.mode ?? environmentMode(vendor),
    enabled: row?.enabled ?? true,
    credentials,
    missingFields,
    config: row?.config ?? {},
    integrationId: row?.id ?? null,
  };
}

export async function listIntegrations(ctx: ScopeContext) {
  const rows = await db
    .select()
    .from(integrations)
    .where(eq(integrations.organizationId, ctx.organizationId))
    .orderBy(asc(integrations.vendor));
  const credentials = await db
    .select()
    .from(vendorCredentials)
    .where(eq(vendorCredentials.organizationId, ctx.organizationId));

  return (["openai", "sparktoro"] as const).map((vendor) => {
    const row = rows.find((item) => item.vendor === vendor);
    const maskedHints: Record<string, string> = {};
    for (const credential of credentials.filter((item) => item.integrationId === row?.id)) {
      maskedHints[credential.fieldName] = credential.maskedHint;
    }
    for (const [field, value] of Object.entries(environmentCredentials(vendor))) {
      maskedHints[field] ??= `${maskSecret(value)} (from environment)`;
    }
    const missingFields = VENDOR_CREDENTIAL_FIELDS[vendor].filter((field) => !maskedHints[field]);
    return {
      vendor,
      label: VENDOR_LABELS[vendor],
      role: VENDOR_ROLES[vendor],
      mode: row?.mode ?? environmentMode(vendor),
      enabled: row?.enabled ?? true,
      configured: missingFields.length === 0,
      missingFields,
      maskedHints,
      lastTestedAt: row?.lastTestedAt ?? null,
      lastTestOutcome: row?.lastTestOutcome ?? null,
      lastTestMessage: row?.lastTestMessage ?? null,
    };
  });
}

export const integrationUpdateSchema = z.object({
  vendor: z.enum(["openai", "sparktoro"]),
  mode: z.enum(["mock", "live"]),
  apiKey: z.string().optional(),
});

export async function updateIntegration(
  ctx: ScopeContext,
  input: z.infer<typeof integrationUpdateSchema>,
) {
  requireCapability(ctx, "integration:manage");
  const [integration] = await db
    .insert(integrations)
    .values({
      id: newId(ID_PREFIXES.integration),
      organizationId: ctx.organizationId,
      vendor: input.vendor,
      mode: input.mode,
    })
    .onConflictDoUpdate({
      target: [integrations.organizationId, integrations.vendor],
      set: { mode: input.mode, updatedAt: new Date() },
    })
    .returning();
  if (!integration) throw new ValidationError("Could not update the integration.");

  if (input.apiKey?.trim()) {
    const encrypted = encryptSecret(input.apiKey.trim());
    await db
      .insert(vendorCredentials)
      .values({
        id: newId(ID_PREFIXES.credential),
        organizationId: ctx.organizationId,
        integrationId: integration.id,
        fieldName: "apiKey",
        ...encrypted,
        maskedHint: maskSecret(input.apiKey.trim()),
      })
      .onConflictDoUpdate({
        target: [vendorCredentials.integrationId, vendorCredentials.fieldName],
        set: { ...encrypted, maskedHint: maskSecret(input.apiKey.trim()), updatedAt: new Date() },
      });
  }
  const resolved = await resolveIntegration(ctx.organizationId, input.vendor);
  if (input.mode === "live" && resolved.missingFields.length) {
    throw new ValidationError(
      `${VENDOR_LABELS[input.vendor]} needs an API key before live mode can be enabled.`,
    );
  }
  await recordAudit({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "integration.update",
    entityType: "integration",
    entityId: integration.id,
    metadata: {
      vendor: input.vendor,
      mode: input.mode,
      credentialUpdated: Boolean(input.apiKey?.trim()),
    },
  });
}
