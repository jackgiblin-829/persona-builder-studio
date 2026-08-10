import { beforeEach, describe, expect, it } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db/client";
import {
  evidenceRecords,
  integrations,
  profoundPromptLinks,
  profoundResultBuckets,
  promptPairs,
  prompts,
} from "@/db/schema";
import { newId, ID_PREFIXES } from "@/lib/ids";
import { promptHash } from "@/lib/prompt-dedupe";
import {
  aggregateMetrics,
  compareControl,
  mergeVisibilityCitations,
  type AggregatedMetrics,
} from "@/lib/profound-results";
import {
  getProfoundAdapter,
  mockPromptId,
  resetMockProfoundState,
  seedMockProfoundUpload,
} from "@/adapters/profound";
import type { ProfoundResultQuery } from "@/adapters/profound/types";
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
import { reconcilePromptSetVersion } from "@/services/profound-reconcile";
import {
  getControlComparison,
  getPerformancePanel,
  startResultRetrieval,
} from "@/services/profound-results";
import { drainQueue } from "@/seed/pipeline";
import { createTestTenant, truncateAll, type TestTenant } from "../helpers/db";

/**
 * Result retrieval end to end (§25, redesigned 2026-08-10 around the real
 * bucket-shaped v2 reporting API): a real deployment through the mock
 * adapter, then retrieval, scoping, idempotency, and cross-checks of the
 * performance panel and control comparison against the same raw adapter
 * calls computed independently — not against hand-picked magic numbers, since
 * the mock's per-bucket values are themselves derived from a hash the test
 * has no reason to reverse-engineer.
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

const CATEGORY_ID = "pfc_product_analytics";
const START_DATE = "2026-01-01";
const END_DATE = "2026-01-03";

type ApprovedFixture = {
  tenant: TestTenant;
  personaId: string;
  personaVersionId: string;
  promptSetId: string;
  promptSetVersionId: string;
};

/** Retrieval cannot be exercised without prompts reconciled against a simulated Profound upload first. */
async function buildDeployedFixture(label: string): Promise<ApprovedFixture> {
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

  const fixture: ApprovedFixture = {
    tenant,
    personaId: persona.id,
    personaVersionId: persona.currentVersionId,
    promptSetId: set.id,
    promptSetVersionId: set.currentVersionId,
  };

  // No automated push exists anymore — model the manual "export, then paste
  // into Profound" flow by seeding the mock account with what this
  // prompt-set version would export, then reconciling against it.
  const approvedPrompts = await db
    .select({ promptText: prompts.promptText })
    .from(prompts)
    .where(
      and(
        eq(prompts.promptSetVersionId, fixture.promptSetVersionId),
        eq(prompts.reviewStatus, "approved"),
      ),
    );

  seedMockProfoundUpload(
    CATEGORY_ID,
    approvedPrompts.map((prompt) => {
      const normalizedHash = promptHash(prompt.promptText);
      return {
        id: mockPromptId(CATEGORY_ID, normalizedHash),
        text: prompt.promptText,
        topic: null,
        tags: [],
        personaId: null,
        regions: ["us"],
        platforms: ["chatgpt", "perplexity"],
        status: "active",
      };
    }),
  );

  await reconcilePromptSetVersion(fixture.tenant.brandCtx, fixture.promptSetVersionId);

  return fixture;
}

/** Inserted directly, bypassing generation — an approved prompt that is never deployed. */
async function insertUndeployedPrompt(fixture: ApprovedFixture): Promise<string> {
  const id = newId(ID_PREFIXES.prompt);
  const text = "Never deployed to Profound — a control for retrieval scoping.";
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
    informationNeed: "Whether this prompt is ever queried for results.",
    intent: "evaluation",
    journeyStage: "evaluation",
    inclusionRationale: "Inserted directly to assert retrieval never touches an undeployed prompt.",
    reviewStatus: "approved",
    dataOrigin: "local",
  });
  return id;
}

/**
 * Floating-point fields are compared with tolerance rather than `toEqual`:
 * the two sides sum/average the same values in whatever order their query
 * returned them in, and IEEE-754 addition is not strictly associative, so a
 * bit-for-bit match is not guaranteed even when the underlying data is
 * identical. Integer counts are summed from whole numbers and compared
 * exactly.
 */
function expectMetricsClose(actual: AggregatedMetrics, expected: AggregatedMetrics) {
  for (const key of [
    "visibilityScore",
    "shareOfVoice",
    "citationShare",
    "averagePosition",
  ] as const) {
    if (expected[key] == null) {
      expect(actual[key]).toBeNull();
    } else {
      expect(actual[key]).not.toBeNull();
      expect(actual[key] as number).toBeCloseTo(expected[key] as number, 9);
    }
  }
  expect(actual.citationCount).toBe(expected.citationCount);
  expect(actual.bucketCount).toBe(expected.bucketCount);
}

/** Merges the same visibility/citations calls the service reads back, without touching a database. */
async function groundTruthMetricsFor(
  organizationId: string,
  profoundPromptId: string,
  modelIds: string[],
): Promise<ReturnType<typeof aggregateMetrics>> {
  const { adapter } = await getProfoundAdapter(organizationId);
  const query: ProfoundResultQuery = {
    categoryId: CATEGORY_ID,
    profoundPromptIds: [profoundPromptId],
    modelIds,
    startDate: START_DATE,
    endDate: END_DATE,
  };
  const [visibility, citations] = await Promise.all([
    adapter.queryVisibility(query),
    adapter.queryCitations(query),
  ]);
  return aggregateMetrics(
    mergeVisibilityCitations(visibility, citations).map((row) => ({
      visibilityScore: row.visibilityScore,
      shareOfVoice: row.shareOfVoice,
      citationCount: row.citationCount,
      citationShare: row.citationShare,
      averagePosition: row.averagePosition,
    })),
  );
}

let fixture: ApprovedFixture;

beforeEach(async () => {
  await truncateAll();
  resetMockProfoundState();
  fixture = await buildDeployedFixture("Profound Results");
});

describe("retrieval scoping", () => {
  it("only creates buckets for prompts actually linked in Profound", async () => {
    const undeployedPromptId = await insertUndeployedPrompt(fixture);

    await startResultRetrieval(fixture.tenant.brandCtx, {
      startDate: START_DATE,
      endDate: END_DATE,
    });
    expect((await drainQueue({ workerId: "test" })).failed).toBe(0);

    const links = await db
      .select({ promptId: profoundPromptLinks.promptId })
      .from(profoundPromptLinks)
      .where(eq(profoundPromptLinks.brandId, fixture.tenant.brandId));
    const linkedPromptIds = new Set(links.map((row) => row.promptId));
    expect(linkedPromptIds.size).toBeGreaterThan(0);

    const buckets = await db
      .select({ promptId: profoundResultBuckets.promptId })
      .from(profoundResultBuckets)
      .where(eq(profoundResultBuckets.brandId, fixture.tenant.brandId));
    expect(buckets.length).toBeGreaterThan(0);

    for (const bucket of buckets) {
      expect(bucket.promptId).not.toBe(undeployedPromptId);
      expect(linkedPromptIds.has(bucket.promptId ?? "")).toBe(true);
    }
  });
});

describe("bucket idempotency", () => {
  it("does not duplicate rows when retrieval is re-run over an overlapping range", async () => {
    await startResultRetrieval(fixture.tenant.brandCtx, {
      startDate: START_DATE,
      endDate: END_DATE,
    });
    expect((await drainQueue({ workerId: "test" })).failed).toBe(0);

    const countAfterFirst = (
      await db
        .select({ promptId: profoundResultBuckets.promptId })
        .from(profoundResultBuckets)
        .where(eq(profoundResultBuckets.brandId, fixture.tenant.brandId))
    ).length;
    expect(countAfterFirst).toBeGreaterThan(0);

    await startResultRetrieval(fixture.tenant.brandCtx, {
      startDate: START_DATE,
      endDate: END_DATE,
    });
    expect((await drainQueue({ workerId: "test" })).failed).toBe(0);

    const countAfterSecond = (
      await db
        .select({ promptId: profoundResultBuckets.promptId })
        .from(profoundResultBuckets)
        .where(eq(profoundResultBuckets.brandId, fixture.tenant.brandId))
    ).length;

    expect(countAfterSecond).toBe(countAfterFirst);
  });

  it("still inserts new rows for a range that extends beyond what was already stored", async () => {
    await startResultRetrieval(fixture.tenant.brandCtx, {
      startDate: START_DATE,
      endDate: START_DATE,
    });
    expect((await drainQueue({ workerId: "test" })).failed).toBe(0);
    const countAfterOneDay = (
      await db
        .select({ id: profoundResultBuckets.id })
        .from(profoundResultBuckets)
        .where(eq(profoundResultBuckets.brandId, fixture.tenant.brandId))
    ).length;

    await startResultRetrieval(fixture.tenant.brandCtx, {
      startDate: START_DATE,
      endDate: END_DATE,
    });
    expect((await drainQueue({ workerId: "test" })).failed).toBe(0);
    const countAfterThreeDays = (
      await db
        .select({ id: profoundResultBuckets.id })
        .from(profoundResultBuckets)
        .where(eq(profoundResultBuckets.brandId, fixture.tenant.brandId))
    ).length;

    expect(countAfterThreeDays).toBeGreaterThan(countAfterOneDay);
  });
});

describe("performance panel and control comparison", () => {
  it("matches independently computed metrics for the same prompt and window", async () => {
    await startResultRetrieval(fixture.tenant.brandCtx, {
      startDate: START_DATE,
      endDate: END_DATE,
    });
    expect((await drainQueue({ workerId: "test" })).failed).toBe(0);

    const links = await db
      .select()
      .from(profoundPromptLinks)
      .where(eq(profoundPromptLinks.brandId, fixture.tenant.brandId));
    const link = links[0];
    if (!link) throw new Error("Fixture produced no Profound prompt links to inspect");

    const { adapter } = await getProfoundAdapter(fixture.tenant.organizationId);
    const modelIds = (await adapter.getModels()).map((model) => model.id);
    const groundTruth = await groundTruthMetricsFor(
      fixture.tenant.organizationId,
      link.profoundPromptId,
      modelIds,
    );

    const panel = await getPerformancePanel(fixture.tenant.brandCtx, {
      startDate: START_DATE,
      endDate: END_DATE,
    });
    const promptRow = panel.personas
      .flatMap((group) => group.prompts)
      .find((prompt) => prompt.promptId === link.promptId);
    if (!promptRow) throw new Error("Performance panel did not surface the linked prompt");

    expectMetricsClose(promptRow.metrics, groundTruth);
  });

  it("computes control-comparison deltas that match compareControl on the same raw data", async () => {
    await startResultRetrieval(fixture.tenant.brandCtx, {
      startDate: START_DATE,
      endDate: END_DATE,
    });
    expect((await drainQueue({ workerId: "test" })).failed).toBe(0);

    const [pair] = await db
      .select({
        personaPromptId: promptPairs.personaPromptId,
        controlPromptId: promptPairs.controlPromptId,
      })
      .from(promptPairs)
      .where(eq(promptPairs.promptSetVersionId, fixture.promptSetVersionId))
      .limit(1);
    if (!pair) throw new Error("Fixture produced no persona/control prompt pair");

    const links = await db
      .select()
      .from(profoundPromptLinks)
      .where(inArray(profoundPromptLinks.promptId, [pair.personaPromptId, pair.controlPromptId]));
    const linkByPromptId = new Map(links.map((row) => [row.promptId, row]));
    const personaLink = linkByPromptId.get(pair.personaPromptId);
    const controlLink = linkByPromptId.get(pair.controlPromptId);
    if (!personaLink || !controlLink) {
      throw new Error("Fixture's persona/control pair was not both deployed — cannot compare");
    }

    const { adapter } = await getProfoundAdapter(fixture.tenant.organizationId);
    const modelIds = (await adapter.getModels()).map((model) => model.id);

    async function rawMetricsFor(profoundPromptId: string) {
      const query: ProfoundResultQuery = {
        categoryId: CATEGORY_ID,
        profoundPromptIds: [profoundPromptId],
        modelIds,
        startDate: START_DATE,
        endDate: END_DATE,
      };
      const [visibility, citations] = await Promise.all([
        adapter.queryVisibility(query),
        adapter.queryCitations(query),
      ]);
      return mergeVisibilityCitations(visibility, citations).map((row) => ({
        visibilityScore: row.visibilityScore,
        shareOfVoice: row.shareOfVoice,
        citationCount: row.citationCount,
        citationShare: row.citationShare,
        averagePosition: row.averagePosition,
      }));
    }

    const groundTruth = compareControl(
      await rawMetricsFor(personaLink.profoundPromptId),
      await rawMetricsFor(controlLink.profoundPromptId),
    );

    const { pairs } = await getControlComparison(fixture.tenant.brandCtx, {
      promptSetVersionId: fixture.promptSetVersionId,
      startDate: START_DATE,
      endDate: END_DATE,
    });
    const comparisonRow = pairs.find((row) => row.personaPromptId === pair.personaPromptId);
    if (!comparisonRow) throw new Error("Control comparison did not surface the fixture's pair");

    expectMetricsClose(comparisonRow.persona, groundTruth.persona);
    expectMetricsClose(comparisonRow.control, groundTruth.control);

    if (groundTruth.deltas.visibilityScore == null) {
      expect(comparisonRow.deltas.visibilityScore).toBeNull();
    } else {
      expect(comparisonRow.deltas.visibilityScore).toBeCloseTo(
        groundTruth.deltas.visibilityScore,
        9,
      );
    }
    if (groundTruth.deltas.shareOfVoice == null) {
      expect(comparisonRow.deltas.shareOfVoice).toBeNull();
    } else {
      expect(comparisonRow.deltas.shareOfVoice).toBeCloseTo(groundTruth.deltas.shareOfVoice, 9);
    }
    expect(comparisonRow.deltas.citationCount).toBe(groundTruth.deltas.citationCount);

    expect(comparisonRow.personaOutperforms).toBe(groundTruth.personaOutperforms);
    if (groundTruth.liftPercent == null) {
      expect(comparisonRow.liftPercent).toBeNull();
    } else {
      expect(comparisonRow.liftPercent).toBeCloseTo(groundTruth.liftPercent, 6);
    }
  });
});
