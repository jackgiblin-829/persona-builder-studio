import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, db } from "@/db/client";
import {
  dataSources,
  evidenceEmbeddings,
  evidenceRecords,
  ingestionJobs,
  integrations,
  sourceDocuments,
} from "@/db/schema";
import { newId, ID_PREFIXES } from "@/lib/ids";
import { createSourceFromPaste, deleteSource, listSources } from "@/services/sources";
import { getEvidenceCounts, listEvidence, reviewEvidence } from "@/services/evidence";
import { drainQueue } from "@/seed/pipeline";
import { createTestTenant, truncateAll, type TestTenant } from "../helpers/db";

const TRANSCRIPT = `Facilitator: What is blocking the project?

Prospect: Customer data cannot leave our approved cloud environment. That is non-negotiable for us because we are a healthcare payer.

Facilitator: How do you evaluate vendors?

Prospect: The deciding factor is deployment model first, then governance. I need column-level data lineage for auditors.

Facilitator: What evidence do you need?

Prospect: Send me the SOC 2 Type II report and the architecture diagram. Reach me at buyer.contact@payer-example.example if that is easier.

Facilitator: What does success look like?

Prospect: Success means adoption above 60 percent of the product organisation within twelve months.

Facilitator: Anything else?

Prospect: Can you explain how the Slack integration works?`;

let tenant: TestTenant;

beforeAll(async () => {
  await truncateAll();
  tenant = await createTestTenant("Ingestion");
  // Mock mode explicitly, so the test never depends on ambient credentials.
  await db.insert(integrations).values({
    id: newId(ID_PREFIXES.integration),
    organizationId: tenant.organizationId,
    vendor: "openai",
    mode: "mock",
  });
});

afterAll(async () => {
  await closeDb();
});

describe("upload → parse → redact → extract → embed", () => {
  let sourceId: string;

  it("accepts a pasted transcript and queues ingestion", async () => {
    const source = await createSourceFromPaste(tenant.brandCtx, {
      label: "Discovery call",
      sourceType: "sales_transcript",
      observedAt: new Date("2026-06-14T15:00:00Z"),
      excludeFromModelCalls: false,
      content: TRANSCRIPT,
      isTranscript: true,
    });
    expect(source?.status).toBe("queued");
    sourceId = source!.id;

    const sources = await listSources(tenant.brandCtx);
    expect(sources).toHaveLength(1);
  });

  it("refuses a byte-identical duplicate", async () => {
    await expect(
      createSourceFromPaste(tenant.brandCtx, {
        label: "Same call again",
        sourceType: "sales_transcript",
        observedAt: null,
        excludeFromModelCalls: false,
        content: TRANSCRIPT,
        isTranscript: true,
      }),
    ).rejects.toThrow(/already been added/);
  });

  it("runs the whole pipeline to completion", async () => {
    const result = await drainQueue({ workerId: "test" });
    expect(result.failed, result.errors.join("; ")).toBe(0);
    expect(result.processed).toBeGreaterThanOrEqual(3); // ingest, extract, embed

    const [source] = await db.select().from(dataSources).where(eq(dataSources.id, sourceId));
    expect(source?.status).toBe("succeeded");
  });

  it("splits the transcript into per-speaker documents", async () => {
    const documents = await db
      .select()
      .from(sourceDocuments)
      .where(eq(sourceDocuments.dataSourceId, sourceId));
    expect(documents.length).toBeGreaterThan(3);
    expect(documents.some((d) => d.speaker === "Prospect")).toBe(true);
  });

  it("redacts PII before storage and records the finding", async () => {
    const documents = await db
      .select()
      .from(sourceDocuments)
      .where(eq(sourceDocuments.dataSourceId, sourceId));

    const withEmail = documents.find((d) => d.rawText.includes("buyer.contact@"));
    expect(withEmail, "the document containing an email should exist").toBeDefined();
    expect(withEmail!.redactedText).not.toContain("buyer.contact@");
    expect(withEmail!.redactedText).toContain("[EMAIL_1]");
    expect(withEmail!.piiFindings.email).toBe(1);

    const [source] = await db.select().from(dataSources).where(eq(dataSources.id, sourceId));
    expect(source!.piiRedactionCount).toBeGreaterThan(0);

    // No evidence record may carry the unredacted address.
    const evidence = await db
      .select()
      .from(evidenceRecords)
      .where(eq(evidenceRecords.dataSourceId, sourceId));
    expect(evidence.every((row) => !row.rawText.includes("buyer.contact@"))).toBe(true);
    expect(evidence.every((row) => !row.normalizedClaim.includes("buyer.contact@"))).toBe(true);
  });

  it("extracts atomic evidence with provenance, offsets and model metadata", async () => {
    const evidence = await db
      .select()
      .from(evidenceRecords)
      .where(eq(evidenceRecords.dataSourceId, sourceId));

    expect(evidence.length).toBeGreaterThanOrEqual(4);

    const categories = new Set(evidence.map((row) => row.category));
    expect(categories.has("constraint")).toBe(true);
    expect(categories.has("proof_requirement")).toBe(true);

    for (const row of evidence) {
      expect(row.provenance).toBe("observed");
      expect(row.dataOrigin).toBe("mock");
      expect(row.promptTemplateVersion).toBeTruthy();
      expect(row.schemaVersion).toBeTruthy();
      expect(row.createdByModel).toBeTruthy();
      expect(row.sourceDocumentId).toBeTruthy();
      expect(row.reviewStatus).toBe("pending_review");
    }
  });

  it("records each ingestion stage separately", async () => {
    const stages = await db
      .select()
      .from(ingestionJobs)
      .where(eq(ingestionJobs.dataSourceId, sourceId));
    const byStage = Object.fromEntries(stages.map((s) => [s.stage, s.status]));
    expect(byStage.parse).toBe("succeeded");
    expect(byStage.extract).toBe("succeeded");
    expect(byStage.embed).toBe("succeeded");
  });

  it("embeds every extracted record exactly once", async () => {
    const [evidence, embeddings] = await Promise.all([
      db.select().from(evidenceRecords).where(eq(evidenceRecords.dataSourceId, sourceId)),
      db.select().from(evidenceEmbeddings).where(eq(evidenceEmbeddings.brandId, tenant.brandId)),
    ]);
    expect(embeddings.length).toBe(evidence.length);
    expect(embeddings.every((row) => row.dimensions === 1536)).toBe(true);
  });

  it("finds the constraint by full-text search", async () => {
    const result = await listEvidence(tenant.brandCtx, {
      q: "cloud environment",
      searchMode: "text",
      page: 1,
      pageSize: 50,
    });
    expect(result.total).toBeGreaterThan(0);
    expect(result.rows.some((row) => row.normalizedClaim.toLowerCase().includes("cloud"))).toBe(
      true,
    );
  });

  it("ranks the constraint first in semantic search", async () => {
    const result = await listEvidence(tenant.brandCtx, {
      q: "our data must stay inside our own cloud account",
      searchMode: "semantic",
      page: 1,
      pageSize: 10,
    });
    expect(result.rows.length).toBeGreaterThan(0);
    expect(result.rows[0]?.normalizedClaim.toLowerCase()).toContain("cloud");
    expect(result.notice).toMatch(/mock embeddings/);
  });

  it("filters by category and provenance", async () => {
    const constraints = await listEvidence(tenant.brandCtx, {
      searchMode: "text",
      category: "constraint",
      page: 1,
      pageSize: 50,
    });
    expect(constraints.total).toBeGreaterThan(0);
    expect(constraints.rows.every((row) => row.category === "constraint")).toBe(true);

    const inferred = await listEvidence(tenant.brandCtx, {
      searchMode: "text",
      provenance: "inferred",
      page: 1,
      pageSize: 50,
    });
    expect(inferred.total).toBe(0);
  });

  it("records review decisions", async () => {
    const all = await db
      .select({ id: evidenceRecords.id })
      .from(evidenceRecords)
      .where(eq(evidenceRecords.dataSourceId, sourceId));
    const approved = await reviewEvidence(
      tenant.brandCtx,
      all.map((r) => r.id),
      "approved",
    );
    expect(approved).toBe(all.length);

    const counts = await getEvidenceCounts(tenant.brandCtx);
    expect(counts.approved).toBe(all.length);
  });

  it("re-running extraction replaces rather than duplicating records", async () => {
    const before = await db
      .select()
      .from(evidenceRecords)
      .where(eq(evidenceRecords.dataSourceId, sourceId));

    const { getQueue } = await import("@/adapters/queue");
    const { JOB_TYPES } = await import("@/jobs/registry");
    await getQueue().enqueue(
      JOB_TYPES.extractEvidence,
      { dataSourceId: sourceId },
      { organizationId: tenant.organizationId, brandId: tenant.brandId },
    );
    const drained = await drainQueue({ workerId: "test" });
    expect(drained.failed, drained.errors.join("; ")).toBe(0);

    const after = await db
      .select()
      .from(evidenceRecords)
      .where(eq(evidenceRecords.dataSourceId, sourceId));
    expect(after.length).toBe(before.length);
  });
});

describe("source deletion cascade", () => {
  it("marks evidence unavailable and deletes embeddings without deleting the source row's history", async () => {
    const [source] = await db
      .select()
      .from(dataSources)
      .where(eq(dataSources.brandId, tenant.brandId))
      .limit(1);

    const impact = await deleteSource(tenant.brandCtx, source!.id);
    expect(impact.evidenceCount).toBeGreaterThan(0);
    expect(impact.embeddingCount).toBeGreaterThan(0);

    const embeddings = await db
      .select()
      .from(evidenceEmbeddings)
      .where(eq(evidenceEmbeddings.brandId, tenant.brandId));
    expect(embeddings).toHaveLength(0);

    const evidence = await db
      .select()
      .from(evidenceRecords)
      .where(eq(evidenceRecords.dataSourceId, source!.id));
    expect(evidence.length).toBeGreaterThan(0);
    expect(evidence.every((row) => row.availability === "source_deleted")).toBe(true);

    // The source is soft-deleted, so it disappears from the list but the
    // record of what happened survives for auditing.
    expect(await listSources(tenant.brandCtx)).toHaveLength(0);
    const [deleted] = await db.select().from(dataSources).where(eq(dataSources.id, source!.id));
    expect(deleted?.deletedAt).not.toBeNull();
  });
});

describe("sources excluded from model calls", () => {
  it("parses and stores but never extracts evidence", async () => {
    const source = await createSourceFromPaste(tenant.brandCtx, {
      label: "Sensitive contract notes",
      sourceType: "crm_note",
      observedAt: null,
      excludeFromModelCalls: true,
      content:
        "This customer requires a bespoke data processing agreement. The deciding factor is deployment model. " +
        "We cannot send this text to any model provider under the terms we agreed.",
      isTranscript: false,
    });

    const drained = await drainQueue({ workerId: "test" });
    expect(drained.failed, drained.errors.join("; ")).toBe(0);

    const documents = await db
      .select()
      .from(sourceDocuments)
      .where(eq(sourceDocuments.dataSourceId, source!.id));
    expect(documents.length).toBeGreaterThan(0);

    const evidence = await db
      .select()
      .from(evidenceRecords)
      .where(eq(evidenceRecords.dataSourceId, source!.id));
    expect(evidence).toHaveLength(0);

    const [stage] = await db
      .select()
      .from(ingestionJobs)
      .where(and(eq(ingestionJobs.dataSourceId, source!.id), eq(ingestionJobs.stage, "extract")));
    expect(stage?.status).toBe("cancelled");
    expect(stage?.message).toMatch(/excluded from model calls/);
  });
});
