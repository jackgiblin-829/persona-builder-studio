import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { dataSources, evidenceRecords, integrations, sourceDocuments } from "@/db/schema";
import { newId, ID_PREFIXES } from "@/lib/ids";
import { refreshProfoundConfiguration, testProfoundConnection } from "@/services/profound-config";
import { setCategoryMapping } from "@/services/profound-mapping";
import { requestProfoundEvidencePull } from "@/services/profound-evidence";
import { ValidationError } from "@/lib/errors";
import { drainQueue } from "@/seed/pipeline";
import { createTestTenant, truncateAll, type TestTenant } from "../helpers/db";

const CATEGORY_ID = "pfc_product_analytics";

let tenant: TestTenant;

beforeEach(async () => {
  await truncateAll();
  tenant = await createTestTenant("Profound Evidence");
  await db.insert(integrations).values([
    {
      id: newId(ID_PREFIXES.integration),
      organizationId: tenant.organizationId,
      vendor: "openai",
      mode: "mock",
    },
    {
      id: newId(ID_PREFIXES.integration),
      organizationId: tenant.organizationId,
      vendor: "profound",
      mode: "mock",
    },
  ]);
});

describe("Profound account-evidence pull", () => {
  it("refuses to run before a category is mapped", async () => {
    await testProfoundConnection(tenant.ctx);
    await refreshProfoundConfiguration(tenant.ctx);

    await expect(
      requestProfoundEvidencePull(tenant.brandCtx, {
        startDate: "2026-01-01",
        endDate: "2026-01-03",
      }),
    ).rejects.toThrow(ValidationError);
  });

  it("turns the brand's account-level Profound data into evidence", async () => {
    await testProfoundConnection(tenant.ctx);
    await refreshProfoundConfiguration(tenant.ctx);
    await setCategoryMapping(tenant.brandCtx, { profoundCategoryId: CATEGORY_ID });

    await requestProfoundEvidencePull(tenant.brandCtx, {
      startDate: "2026-01-01",
      endDate: "2026-01-05",
    });
    expect((await drainQueue({ workerId: "test" })).failed).toBe(0);

    const [source] = await db
      .select()
      .from(dataSources)
      .where(eq(dataSources.brandId, tenant.brandId));
    expect(source).toBeDefined();
    expect(source?.sourceType).toBe("profound");
    expect(source?.sourceSystem).toBe("profound_report");
    expect(source?.documentCount).toBeGreaterThan(0);

    const documents = await db
      .select()
      .from(sourceDocuments)
      .where(eq(sourceDocuments.dataSourceId, source!.id));
    expect(documents.length).toBe(source?.documentCount);
    for (const document of documents) {
      expect(document.location.startsWith("Profound topic:")).toBe(true);
    }

    const evidence = await db
      .select()
      .from(evidenceRecords)
      .where(eq(evidenceRecords.dataSourceId, source!.id));
    expect(evidence.length).toBeGreaterThan(0);
    for (const record of evidence) {
      expect(record.sourceType).toBe("profound");
    }
  });
});
