import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { profoundConnections } from "@/db/schema";
import { getProfoundAdapter } from "@/adapters/profound";
import type { ProfoundConfiguration } from "@/adapters/profound/types";
import { requireCapability, type ScopeContext } from "@/lib/auth/context";
import { AppError, NotFoundError, ValidationError } from "@/lib/errors";
import { newId, ID_PREFIXES } from "@/lib/ids";
import { ensureIntegration, recordConnectionTest } from "./integrations";
import { recordAudit } from "./audit";
import { withVendorUsage } from "./usage";

/**
 * Profound connection and configuration retrieval (§19).
 *
 * Everything a deployment needs to name — the category, the region, the
 * platforms, the persona — belongs to the customer's Profound account, not to
 * this product. So it is **read back and cached**, never typed in. A free-text
 * category field would let a user deploy twenty prompts into a category that
 * does not exist and only discover it when the results never arrive.
 *
 * The cache exists because the mapping and deployment screens each need the
 * full configuration and neither should cost four vendor round-trips to render.
 * It is explicitly stamped with the time it was taken and rendered with that
 * time, so a stale cache looks stale instead of looking current.
 */

export type ConnectionView = {
  id: string;
  label: string;
  mode: "mock" | "live";
  profoundOrganizationId: string | null;
  profoundOrganizationName: string | null;
  lastSyncedConfigAt: Date | null;
  dataOrigin: string;
  configuration: ProfoundConfiguration | null;
};

export async function getProfoundConnection(ctx: ScopeContext): Promise<ConnectionView | null> {
  const integration = await ensureIntegration(ctx.organizationId, "profound");

  const [row] = await db
    .select()
    .from(profoundConnections)
    .where(
      and(
        eq(profoundConnections.organizationId, ctx.organizationId),
        eq(profoundConnections.integrationId, integration.id),
      ),
    )
    .limit(1);

  if (!row) return null;

  return {
    id: row.id,
    label: row.label,
    mode: integration.mode,
    profoundOrganizationId: row.profoundOrganizationId,
    profoundOrganizationName: row.profoundOrganizationName,
    lastSyncedConfigAt: row.lastSyncedConfigAt,
    dataOrigin: row.dataOrigin,
    configuration: parseCachedConfiguration(row.cachedConfig),
  };
}

/** The connection the deployment path needs, or a message saying what is missing. */
export async function requireProfoundConnection(ctx: ScopeContext): Promise<
  ConnectionView & {
    configuration: ProfoundConfiguration;
  }
> {
  const connection = await getProfoundConnection(ctx);
  if (!connection) {
    throw new ValidationError(
      "Profound is not connected yet. Test the connection on the Profound mapping screen first.",
    );
  }
  if (!connection.configuration) {
    throw new ValidationError(
      "Profound's configuration has not been retrieved yet. Refresh it on the Profound mapping screen — categories, regions and personas are read from the account, never typed in.",
    );
  }
  return { ...connection, configuration: connection.configuration };
}

/**
 * Verifies the credentials with the cheapest authenticated read available, and
 * records the outcome on the integration.
 *
 * A failure is recorded and re-surfaced, never swallowed: an integration that
 * reports "connected" while its key is wrong is worse than one that reports
 * nothing.
 */
export async function testProfoundConnection(
  ctx: ScopeContext,
): Promise<{ ok: true; organizationName: string; mode: "mock" | "live" }> {
  requireCapability(ctx, "profound:configure");

  const integration = await ensureIntegration(ctx.organizationId, "profound");
  const { adapter, mode } = await getProfoundAdapter(ctx.organizationId);

  let organizations;
  try {
    organizations = await withVendorUsage(
      {
        organizationId: ctx.organizationId,
        vendor: "profound",
        operation: "getOrganizations",
        mode,
      },
      () => adapter.getOrganizations(),
    );
  } catch (error) {
    const message = error instanceof AppError ? error.message : "The connection test failed.";
    await recordConnectionTest(ctx.organizationId, "profound", "failure", message);
    throw error;
  }

  const organization = organizations[0];
  if (!organization) {
    const message = "The credentials are valid but the account has no organization.";
    await recordConnectionTest(ctx.organizationId, "profound", "failure", message);
    throw new ValidationError(message);
  }

  await db
    .insert(profoundConnections)
    .values({
      id: newId(ID_PREFIXES.profoundConnection),
      organizationId: ctx.organizationId,
      integrationId: integration.id,
      label: organization.name,
      profoundOrganizationId: organization.id,
      profoundOrganizationName: organization.name,
      dataOrigin: mode,
    })
    .onConflictDoUpdate({
      target: [profoundConnections.organizationId, profoundConnections.integrationId],
      set: {
        label: organization.name,
        profoundOrganizationId: organization.id,
        profoundOrganizationName: organization.name,
        dataOrigin: mode,
        updatedAt: new Date(),
      },
    });

  await recordConnectionTest(
    ctx.organizationId,
    "profound",
    "success",
    `Connected to ${organization.name} in ${mode} mode.`,
  );

  await recordAudit({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "profound.connection_test",
    entityType: "integration",
    entityId: integration.id,
    metadata: { mode, profoundOrganizationId: organization.id },
  });

  return { ok: true, organizationName: organization.name, mode };
}

/**
 * Reads the whole configuration back and caches it on the connection.
 *
 * Per-category topics, tags and personas are fetched for every category rather
 * than lazily on selection: the mapping screen has to show which categories
 * *have* a matching persona before the user picks one, and a lazy read would
 * make that comparison impossible.
 */
export async function refreshProfoundConfiguration(ctx: ScopeContext): Promise<{
  configuration: ProfoundConfiguration;
  mode: "mock" | "live";
  categoryCount: number;
  personaCount: number;
}> {
  requireCapability(ctx, "profound:configure");

  const connection = await getProfoundConnection(ctx);
  if (!connection?.profoundOrganizationId) {
    throw new ValidationError(
      "Test the Profound connection before retrieving its configuration — the organization id comes from that call.",
    );
  }

  const { adapter, mode } = await getProfoundAdapter(ctx.organizationId);
  const profoundOrganizationId = connection.profoundOrganizationId;

  const { configuration, categories, organizationPersonas, personasByCategory } =
    await withVendorUsage(
      {
        organizationId: ctx.organizationId,
        vendor: "profound",
        operation: "getConfiguration",
        mode,
      },
      async () => {
        const [categories, regions, models, assets, organizationPersonas] = await Promise.all([
          adapter.getCategories(),
          adapter.getRegions(),
          adapter.getModels(),
          adapter.getAssets(),
          adapter.getOrganizationPersonas(profoundOrganizationId),
        ]);

        const topicsByCategory: ProfoundConfiguration["topicsByCategory"] = {};
        const tagsByCategory: ProfoundConfiguration["tagsByCategory"] = {};
        const personasByCategory: ProfoundConfiguration["personasByCategory"] = {};

        for (const category of categories) {
          const [topics, tags, personas] = await Promise.all([
            adapter.getCategoryTopics(category.id),
            adapter.getCategoryTags(category.id),
            adapter.getCategoryPersonas(category.id),
          ]);
          topicsByCategory[category.id] = topics;
          tagsByCategory[category.id] = tags;
          personasByCategory[category.id] = personas;
        }

        const configuration: ProfoundConfiguration = {
          organizations: [
            {
              id: profoundOrganizationId,
              name: connection.profoundOrganizationName ?? connection.label,
            },
          ],
          categories,
          regions,
          models,
          assets,
          organizationPersonas,
          topicsByCategory,
          tagsByCategory,
          personasByCategory,
        };

        return { configuration, categories, organizationPersonas, personasByCategory };
      },
    );

  await db
    .update(profoundConnections)
    .set({
      cachedConfig: configuration as unknown as Record<string, unknown>,
      lastSyncedConfigAt: new Date(),
      dataOrigin: mode,
      updatedAt: new Date(),
    })
    .where(eq(profoundConnections.id, connection.id));

  await recordAudit({
    organizationId: ctx.organizationId,
    actorUserId: ctx.userId,
    action: "profound.config_refresh",
    entityType: "profound_connection",
    entityId: connection.id,
    metadata: {
      mode,
      categories: categories.length,
      personas: organizationPersonas.length,
    },
  });

  return {
    configuration,
    mode,
    categoryCount: categories.length,
    personaCount:
      organizationPersonas.length +
      Object.values(personasByCategory).reduce((sum, list) => sum + list.length, 0),
  };
}

/** Every persona Profound knows about, organization-level and category-level. */
export function allProfoundPersonas(configuration: ProfoundConfiguration, categoryId?: string) {
  const scoped = categoryId ? (configuration.personasByCategory[categoryId] ?? []) : [];
  const byId = new Map(scoped.map((persona) => [persona.id, persona]));
  for (const persona of configuration.organizationPersonas) {
    // A category-scoped record wins: it carries the category link.
    if (!byId.has(persona.id)) byId.set(persona.id, persona);
  }
  return [...byId.values()];
}

export function findCategory(configuration: ProfoundConfiguration, categoryId: string) {
  const category = configuration.categories.find((row) => row.id === categoryId);
  if (!category) throw new NotFoundError("Profound category");
  return category;
}

/**
 * Cached configuration is validated on read, not trusted.
 *
 * The column is `jsonb` written by a previous release of this code; if its
 * shape has moved on, treating it as absent forces a refresh rather than
 * rendering a half-populated mapping screen.
 */
function parseCachedConfiguration(value: Record<string, unknown>): ProfoundConfiguration | null {
  const candidate = value as Partial<ProfoundConfiguration>;
  if (!Array.isArray(candidate.categories) || !Array.isArray(candidate.regions)) return null;
  return {
    organizations: candidate.organizations ?? [],
    categories: candidate.categories,
    regions: candidate.regions,
    models: candidate.models ?? [],
    assets: candidate.assets ?? [],
    organizationPersonas: candidate.organizationPersonas ?? [],
    topicsByCategory: candidate.topicsByCategory ?? {},
    tagsByCategory: candidate.tagsByCategory ?? {},
    personasByCategory: candidate.personasByCategory ?? {},
  };
}
