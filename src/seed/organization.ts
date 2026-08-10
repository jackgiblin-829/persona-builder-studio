import "server-only";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import {
  brandProducts,
  brands,
  competitors,
  integrations,
  memberships,
  modelConfigurations,
  organizations,
  users,
} from "@/db/schema";
import { hashPassword } from "@/lib/crypto";
import { env } from "@/lib/env";
import { newId, ID_PREFIXES } from "@/lib/ids";

/**
 * Seed identities and the demo brand.
 *
 * Everything here is fictional. No real person, company, quote or domain is
 * used — `.example` is a reserved TLD that cannot resolve.
 */

export const SEED_USERS = [
  {
    email: "admin@example.com",
    name: "Dana Okafor",
    password: "demo-password-1",
    role: "owner" as const,
  },
  {
    email: "analyst@example.com",
    name: "Rafi Lindqvist",
    password: "demo-password-2",
    role: "editor" as const,
  },
  {
    email: "viewer@example.com",
    name: "Sam Petrov",
    password: "demo-password-3",
    role: "viewer" as const,
  },
];

export type SeededOrg = {
  organizationId: string;
  brandId: string;
  ownerUserId: string;
  editorUserId: string;
};

export async function seedOrganizationAndBrand(): Promise<SeededOrg> {
  const organizationId = newId(ID_PREFIXES.organization);
  await db.insert(organizations).values({
    id: organizationId,
    name: "829 Studios",
    slug: "829-studios",
    retentionDays: null,
  });

  const userIds: Record<string, string> = {};
  for (const seedUser of SEED_USERS) {
    const [existing] = await db
      .select()
      .from(users)
      .where(eq(users.email, seedUser.email))
      .limit(1);
    const id = existing?.id ?? newId(ID_PREFIXES.user);
    if (!existing) {
      await db.insert(users).values({
        id,
        email: seedUser.email,
        name: seedUser.name,
        passwordHash: hashPassword(seedUser.password),
      });
    }
    userIds[seedUser.email] = id;
    await db.insert(memberships).values({
      id: newId(ID_PREFIXES.membership),
      organizationId,
      userId: id,
      role: seedUser.role,
    });
  }

  const brandId = newId(ID_PREFIXES.brand);
  await db.insert(brands).values({
    id: brandId,
    organizationId,
    name: "Northwind Analytics",
    slug: "northwind-analytics",
    canonicalDomain: "northwind-analytics.example",
    description:
      "Northwind Analytics is a product-analytics platform for regulated and security-sensitive companies. It offers self-hosted and private-cloud deployment, column-level data lineage, and role-based governance controls, and is sold to data, security and product teams in healthcare, financial services and public sector organisations.",
    conversionActions: [
      "Book a technical demo",
      "Start a 14-day private-cloud trial",
      "Request the security package",
    ],
    markets: ["United States", "United Kingdom", "Canada"],
    languages: ["en"],
    regions: ["us", "uk"],
    approvedCrawlDomains: ["northwind-analytics.example", "docs.northwind-analytics.example"],
    strategicQuestions: [
      "Why do security-led evaluations stall between demo and procurement?",
      "Which buyer segments never reach a shortlist in AI answers?",
      "Where do competitors get cited that we do not?",
    ],
    regulatedDomain: true,
    retentionDays: 365,
  });

  await db.insert(brandProducts).values([
    {
      id: newId(ID_PREFIXES.brandProduct),
      organizationId,
      brandId,
      name: "Northwind Private Cloud",
      description: "Single-tenant deployment inside the customer's own cloud account.",
      priority: 1,
      url: "https://northwind-analytics.example/private-cloud",
    },
    {
      id: newId(ID_PREFIXES.brandProduct),
      organizationId,
      brandId,
      name: "Lineage Graph",
      description: "Column-level data lineage across warehouse, transformation and dashboards.",
      priority: 2,
      url: "https://northwind-analytics.example/lineage",
    },
    {
      id: newId(ID_PREFIXES.brandProduct),
      organizationId,
      brandId,
      name: "Governance Console",
      description: "Role-based access, retention policies and audit export.",
      priority: 3,
      url: "https://northwind-analytics.example/governance",
    },
  ]);

  await db.insert(competitors).values([
    {
      id: newId(ID_PREFIXES.competitor),
      organizationId,
      brandId,
      name: "Cobalt Insights",
      domain: "cobalt-insights.example",
      notes: "Cloud-only. Strong self-serve motion, weaker on deployment controls.",
    },
    {
      id: newId(ID_PREFIXES.competitor),
      organizationId,
      brandId,
      name: "Tessellate BI",
      domain: "tessellate-bi.example",
      notes: "Enterprise BI incumbent. Often cited in comparison answers.",
    },
    {
      id: newId(ID_PREFIXES.competitor),
      organizationId,
      brandId,
      name: "Perch Metrics",
      domain: "perch-metrics.example",
      notes: "Small-team focus, aggressive pricing.",
    },
  ]);

  // Every vendor starts in mock mode so the demo runs with no credentials.
  for (const vendor of ["openai", "profound", "sparktoro", "dataforseo"] as const) {
    await db.insert(integrations).values({
      id: newId(ID_PREFIXES.integration),
      organizationId,
      vendor,
      mode: "mock",
      enabled: true,
    });
  }

  await db.insert(modelConfigurations).values([
    {
      id: newId(ID_PREFIXES.modelConfiguration),
      organizationId,
      tier: "economical",
      provider: "openai",
      modelId: env.OPENAI_MODEL_ECONOMICAL,
      notes: "Evidence extraction and classification.",
    },
    {
      id: newId(ID_PREFIXES.modelConfiguration),
      organizationId,
      tier: "reasoning",
      provider: "openai",
      modelId: env.OPENAI_MODEL_REASONING,
      notes: "Segmentation, persona synthesis, prompt generation, briefs, audits.",
    },
    {
      id: newId(ID_PREFIXES.modelConfiguration),
      organizationId,
      tier: "embedding",
      provider: "openai",
      modelId: env.OPENAI_MODEL_EMBEDDING,
      notes: "Semantic evidence search and prompt near-duplicate detection.",
    },
  ]);

  const ownerUserId = userIds["admin@example.com"];
  const editorUserId = userIds["analyst@example.com"];
  if (!ownerUserId || !editorUserId) throw new Error("Seed users were not created");

  return { organizationId, brandId, ownerUserId, editorUserId };
}
