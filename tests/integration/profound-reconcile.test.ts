import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db/client";
import { evidenceRecords, integrations, profoundPromptLinks, prompts } from "@/db/schema";
import { newId, ID_PREFIXES } from "@/lib/ids";
import { promptHash } from "@/lib/prompt-dedupe";
import { NotFoundError } from "@/lib/errors";
import { mockPromptId, resetMockProfoundState, seedMockProfoundUpload } from "@/adapters/profound";
import { approvePersonaVersion, listPersonas, startPersonaGeneration } from "@/services/personas";
import { decideSegment, listSegments, startSegmentation } from "@/services/segments";
import {
  approvePromptSetVersion,
  getPromptSetDetail,
  listPromptSets,
  reviewPrompts,
  startPromptGeneration,
} from "@/services/prompt-sets";
import { createSourceFromPaste } from "@/services/sources";
import { reviewEvidence } from "@/services/evidence";
import { refreshProfoundConfiguration, testProfoundConnection } from "@/services/profound-config";
import { setCategoryMapping } from "@/services/profound-mapping";
import {
  getReconciliationStatus,
  linkPromptManually,
  reconcilePromptSetVersion,
} from "@/services/profound-reconcile";
import { drainQueue } from "@/seed/pipeline";
import { createTestTenant, truncateAll, type TestTenant } from "../helpers/db";

/**
 * Reconciliation replaces the old deploy pipeline (§ export-only): the app
 * never pushes to Profound anymore, so a prompt only ends up linked because
 * it is either already in the account (the mock fixture's prompt history) or
 * was simulated as manually uploaded via `seedMockProfoundUpload` — modelling
 * a human pasting an export into Profound's own UI — and then reconciled by
 * matching normalized text.
 */

const CALL = `Facilitator: Before we start, can you describe what you are trying to solve?

Prospect: The goal is to get analytics into production without the security review stopping it every time.

Facilitator: What has blocked it so far?

Prospect: Customer data cannot leave our approved cloud environment. That is non-negotiable for us.

Facilitator: How do you evaluate vendors given that?

Prospect: If it cannot run in our own VPC we do not even take the demo. The deciding factor is deployment model first, then governance.

Facilitator: What evidence do you need to see?

Prospect: Send me the SOC 2 Type II report, the architecture diagram showing where data lives, and the pen test summary.

Facilitator: Anything you are worried about?

Prospect: My concern is that self-hosted versions are always a second-class product.

Facilitator: What does success look like?

Prospect: Success means the platform is deployed inside our environment and security has signed off.`;

const INTERVIEW = `Interviewer: What made this a hard purchase?

Buyer: Our security review requires a private cloud deployment, so anything multi-tenant is out.

Interviewer: How did you narrow it down?

Buyer: We compared vendors on data residency first. Everything else was secondary.

Interviewer: What proof did you need?

Buyer: We needed an ISO 27001 certification and a documented governance model before procurement would engage.

Interviewer: What about pricing?

Buyer: Procurement runs the vendor assessment and the pricing model has to survive it.

Interviewer: What are you measuring now?

Buyer: Success means our auditors can trace every metric back to source without asking us.`;

/** The category that carries a prompt history in the mock account (see fixtures/profound/account.ts). */
const CATEGORY_ID = "pfc_product_analytics";

type ApprovedFixture = {
  tenant: TestTenant;
  personaId: string;
  personaVersionId: string;
  promptSetId: string;
  promptSetVersionId: string;
};

async function buildApprovedPromptSet(label: string): Promise<ApprovedFixture> {
  const tenant = await createTestTenant(label);

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

  for (const [srcLabel, content, sourceType] of [
    ["Discovery call", CALL, "sales_transcript"],
    ["Buyer interview", INTERVIEW, "interview"],
  ] as const) {
    await createSourceFromPaste(tenant.brandCtx, {
      label: srcLabel,
      sourceType,
      observedAt: new Date("2026-06-01T00:00:00Z"),
      excludeFromModelCalls: false,
      content,
      isTranscript: true,
    });
  }
  expect((await drainQueue({ workerId: "test" })).failed).toBe(0);

  const evidenceRows = await db
    .select({ id: evidenceRecords.id })
    .from(evidenceRecords)
    .where(eq(evidenceRecords.brandId, tenant.brandId));
  await reviewEvidence(
    tenant.brandCtx,
    evidenceRows.map((row) => row.id),
    "approved",
  );

  await startSegmentation(tenant.brandCtx);
  expect((await drainQueue({ workerId: "test" })).failed).toBe(0);

  const { segments } = await listSegments(tenant.brandCtx);
  const best = [...segments].sort((a, b) => b.supportingCount - a.supportingCount)[0];
  if (!best) throw new Error("Segmentation produced no candidates for the fixture");
  await decideSegment(tenant.brandCtx, best.id, "approved");

  await startPersonaGeneration(tenant.brandCtx, best.id);
  expect((await drainQueue({ workerId: "test" })).failed).toBe(0);

  const [persona] = await listPersonas(tenant.brandCtx);
  if (!persona?.currentVersionId) throw new Error("Persona synthesis produced no version");

  const { blockers: personaBlockers } = await approvePersonaVersion(
    tenant.brandCtx,
    persona.currentVersionId,
  );
  expect(personaBlockers, personaBlockers.join(" ")).toEqual([]);

  await startPromptGeneration(tenant.brandCtx, persona.id);
  expect((await drainQueue({ workerId: "test" })).failed).toBe(0);

  const [set] = await listPromptSets(tenant.brandCtx);
  if (!set?.currentVersionId) throw new Error("Prompt generation produced no set");

  const detail = await getPromptSetDetail(tenant.brandCtx, set.id);
  const allIds = [...detail.personaPrompts, ...detail.controls].map((prompt) => prompt.id);
  await reviewPrompts(tenant.brandCtx, allIds, "approved");

  const { blockers: setBlockers } = await approvePromptSetVersion(
    tenant.brandCtx,
    set.currentVersionId,
  );
  expect(setBlockers, setBlockers.join(" ")).toEqual([]);

  await testProfoundConnection(tenant.ctx);
  await refreshProfoundConfiguration(tenant.ctx);
  await setCategoryMapping(tenant.brandCtx, { profoundCategoryId: CATEGORY_ID });

  return {
    tenant,
    personaId: persona.id,
    personaVersionId: persona.currentVersionId,
    promptSetId: set.id,
    promptSetVersionId: set.currentVersionId,
  };
}

/** Inserts an approved prompt row directly, bypassing generation and review. */
async function insertApprovedPrompt(fixture: ApprovedFixture, text: string): Promise<string> {
  const id = newId(ID_PREFIXES.prompt);
  await db.insert(prompts).values({
    id,
    organizationId: fixture.tenant.organizationId,
    brandId: fixture.tenant.brandId,
    promptSetVersionId: fixture.promptSetVersionId,
    personaId: fixture.personaId,
    personaVersionId: fixture.personaVersionId,
    promptType: "generic_control",
    topic: "Evaluation and procurement",
    promptText: text,
    normalizedHash: promptHash(text),
    informationNeed: "Whether AI answers name this brand among the available options.",
    intent: "evaluation",
    journeyStage: "evaluation",
    inclusionRationale: "Inserted directly by the test fixture to exercise a specific hash.",
    reviewStatus: "approved",
    dataOrigin: "local",
  });
  return id;
}

let fixture: ApprovedFixture;

beforeEach(async () => {
  await truncateAll();
  resetMockProfoundState();
  fixture = await buildApprovedPromptSet("Profound Reconcile");
});

describe("(a) hash match against the account's existing prompt history", () => {
  it("links a prompt whose normalized text already exists in the account", async () => {
    const duplicateText = "What are the best product-analytics platforms?";
    const promptId = await insertApprovedPrompt(fixture, duplicateText);

    const summary = await reconcilePromptSetVersion(
      fixture.tenant.brandCtx,
      fixture.promptSetVersionId,
    );

    const row = summary.rows.find((r) => r.promptId === promptId);
    expect(row?.status).toBe("matched");
    expect(row?.matchKind).toBe("hash");
    expect(row?.profoundPromptId).toBe("pfp_existing_best_platforms");
  });
});

describe("(b) simulated manual upload", () => {
  it("links a prompt that was never in the account until an export was simulated as uploaded", async () => {
    const text = "How does this platform handle SOC 2 compliance for enterprise buyers?";
    const promptId = await insertApprovedPrompt(fixture, text);

    // Nothing to match yet — the mock account has no persona resembling this
    // fixture's buyer and no prompt with this text.
    const before = await reconcilePromptSetVersion(
      fixture.tenant.brandCtx,
      fixture.promptSetVersionId,
    );
    expect(before.rows.find((r) => r.promptId === promptId)?.status).toBe("unmatched");

    seedMockProfoundUpload(CATEGORY_ID, [
      {
        id: mockPromptId(CATEGORY_ID, promptHash(text)),
        text,
        topic: null,
        tags: [],
        personaId: null,
        regions: ["us"],
        platforms: ["chatgpt", "perplexity"],
        status: "active",
      },
    ]);

    const after = await reconcilePromptSetVersion(
      fixture.tenant.brandCtx,
      fixture.promptSetVersionId,
    );
    const row = after.rows.find((r) => r.promptId === promptId);
    expect(row?.status).toBe("matched");
    expect(row?.matchKind).toBe("hash");
  });
});

describe("(c) idempotency", () => {
  it("reports an already-linked prompt as already_linked rather than re-linking it", async () => {
    await insertApprovedPrompt(fixture, "What are the best product-analytics platforms?");

    const first = await reconcilePromptSetVersion(
      fixture.tenant.brandCtx,
      fixture.promptSetVersionId,
    );
    expect(first.matched).toBeGreaterThan(0);

    const linksAfterFirst = await db
      .select()
      .from(profoundPromptLinks)
      .where(eq(profoundPromptLinks.organizationId, fixture.tenant.organizationId));

    const second = await reconcilePromptSetVersion(
      fixture.tenant.brandCtx,
      fixture.promptSetVersionId,
    );
    expect(second.matched).toBe(0);
    expect(second.alreadyLinked).toBeGreaterThan(0);

    const linksAfterSecond = await db
      .select()
      .from(profoundPromptLinks)
      .where(eq(profoundPromptLinks.organizationId, fixture.tenant.organizationId));
    expect(linksAfterSecond.length).toBe(linksAfterFirst.length);
  });
});

describe("(d) unmatched prompts and the manual-link fallback", () => {
  it("leaves a prompt with no match unlinked until a manual link is recorded", async () => {
    const text = "Does this platform support column-level data lineage for regulated industries?";
    const promptId = await insertApprovedPrompt(fixture, text);

    const summary = await reconcilePromptSetVersion(
      fixture.tenant.brandCtx,
      fixture.promptSetVersionId,
    );
    expect(summary.rows.find((r) => r.promptId === promptId)?.status).toBe("unmatched");

    const statusBefore = await getReconciliationStatus(
      fixture.tenant.brandCtx,
      fixture.promptSetVersionId,
    );
    expect(statusBefore.find((r) => r.promptId === promptId)?.linked).toBe(false);

    await linkPromptManually(fixture.tenant.brandCtx, {
      promptId,
      promptSetVersionId: fixture.promptSetVersionId,
      profoundPromptId: "pfp_manually_chosen",
    });

    const statusAfter = await getReconciliationStatus(
      fixture.tenant.brandCtx,
      fixture.promptSetVersionId,
    );
    const row = statusAfter.find((r) => r.promptId === promptId);
    expect(row?.linked).toBe(true);
    expect(row?.profoundPromptId).toBe("pfp_manually_chosen");
  });
});

describe("(e) tenant isolation", () => {
  it("refuses another tenant's prompt-set version", async () => {
    const other = await createTestTenant("Profound Reconcile Rival");

    await expect(
      reconcilePromptSetVersion(other.brandCtx, fixture.promptSetVersionId),
    ).rejects.toThrow(NotFoundError);
  });
});
