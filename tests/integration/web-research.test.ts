import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import {
  competitors,
  dataSources,
  evidenceRecords,
  integrations,
  sourceDocuments,
} from "@/db/schema";
import { newId, ID_PREFIXES } from "@/lib/ids";
import { requestWebResearch } from "@/services/web-research";
import { drainQueue } from "@/seed/pipeline";
import { createTestTenant, truncateAll, type TestTenant } from "../helpers/db";

let tenant: TestTenant;

beforeEach(async () => {
  await truncateAll();
  tenant = await createTestTenant("Web Research");
  await db.insert(integrations).values({
    id: newId(ID_PREFIXES.integration),
    organizationId: tenant.organizationId,
    vendor: "openai",
    mode: "mock",
  });
  await db.insert(competitors).values({
    id: newId(ID_PREFIXES.competitor),
    organizationId: tenant.organizationId,
    brandId: tenant.brandId,
    name: "Cobalt Insights",
  });
});

describe("Deep web research", () => {
  it("plans queries from brand context, searches each, and turns findings into evidence", async () => {
    await requestWebResearch(tenant.brandCtx);
    expect((await drainQueue({ workerId: "test" })).failed).toBe(0);

    const [source] = await db
      .select()
      .from(dataSources)
      .where(eq(dataSources.brandId, tenant.brandId));
    expect(source).toBeDefined();
    expect(source?.sourceType).toBe("web_research");
    expect(source?.sourceSystem).toBe("openai_web_search");
    expect(source?.documentCount).toBeGreaterThan(0);

    const documents = await db
      .select()
      .from(sourceDocuments)
      .where(eq(sourceDocuments.dataSourceId, source!.id));
    expect(documents.length).toBe(source?.documentCount);
    for (const document of documents) {
      expect(document.rawText).toContain("mock-source.example");
    }

    const evidence = await db
      .select()
      .from(evidenceRecords)
      .where(eq(evidenceRecords.dataSourceId, source!.id));
    expect(evidence.length).toBeGreaterThan(0);
    for (const record of evidence) {
      expect(record.sourceType).toBe("web_research");
      expect(record.sourceLocation).toContain("mock-source.example");
    }
  });
});
