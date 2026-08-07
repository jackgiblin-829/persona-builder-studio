import { expect } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { evidenceRecords, integrations, prompts } from "@/db/schema";
import { mockPromptId, seedMockProfoundUpload } from "@/adapters/profound";
import { newId, ID_PREFIXES } from "@/lib/ids";
import { promptHash } from "@/lib/prompt-dedupe";
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
import { startResultRetrieval } from "@/services/profound-results";
import { drainQueue } from "@/seed/pipeline";
import { createTestTenant, type TestTenant } from "./db";

/**
 * A fixture builder for milestone 7's content-workflow tests, structurally
 * the same as `tests/integration/profound-results.test.ts`'s
 * `buildDeployedFixture` — content-gap analysis, briefs and page audits all
 * need an approved persona version, an approved prompt-set version deployed
 * to Profound, and at least one retrieved result window before there is
 * anything real to analyze.
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

export const CONTENT_FIXTURE_CATEGORY_ID = "pfc_product_analytics";
export const CONTENT_FIXTURE_START_DATE = "2026-01-01";
export const CONTENT_FIXTURE_END_DATE = "2026-01-05";

export type ContentFixture = {
  tenant: TestTenant;
  personaId: string;
  personaVersionId: string;
  promptSetId: string;
  promptSetVersionId: string;
};

/**
 * Builds a tenant with an approved persona version, an approved prompt-set
 * version exported and reconciled against a simulated Profound upload, and
 * one retrieved result window — everything content-gap analysis, brief
 * generation and page audits need as their starting state.
 */
export async function buildContentFixture(label: string): Promise<ContentFixture> {
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
    {
      id: newId(ID_PREFIXES.integration),
      organizationId: tenant.organizationId,
      vendor: "dataforseo",
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
  await setCategoryMapping(tenant.brandCtx, { profoundCategoryId: CONTENT_FIXTURE_CATEGORY_ID });

  // No automated push exists anymore — model the manual "export, then paste
  // into Profound" flow by seeding the mock account with exactly what this
  // prompt-set version would export, then reconciling against it, the same
  // two steps a real user takes.
  const approvedPrompts = await db
    .select({ promptText: prompts.promptText })
    .from(prompts)
    .where(
      and(
        eq(prompts.promptSetVersionId, set.currentVersionId),
        eq(prompts.reviewStatus, "approved"),
      ),
    );

  seedMockProfoundUpload(
    CONTENT_FIXTURE_CATEGORY_ID,
    approvedPrompts.map((prompt) => {
      const normalizedHash = promptHash(prompt.promptText);
      return {
        id: mockPromptId(CONTENT_FIXTURE_CATEGORY_ID, normalizedHash),
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

  await reconcilePromptSetVersion(tenant.brandCtx, set.currentVersionId);

  await startResultRetrieval(tenant.brandCtx, {
    startDate: CONTENT_FIXTURE_START_DATE,
    endDate: CONTENT_FIXTURE_END_DATE,
  });
  expect((await drainQueue({ workerId: "test" })).failed).toBe(0);

  return {
    tenant,
    personaId: persona.id,
    personaVersionId: persona.currentVersionId,
    promptSetId: set.id,
    promptSetVersionId: set.currentVersionId,
  };
}

/** Inserted directly, bypassing generation — a persona-type prompt with no evidence citation. */
export async function insertUncitedPersonaPrompt(fixture: ContentFixture): Promise<string> {
  const id = newId(ID_PREFIXES.prompt);
  const text = "Uncited prompt inserted directly for a fixture edge case.";
  await db.insert(prompts).values({
    id,
    organizationId: fixture.tenant.organizationId,
    brandId: fixture.tenant.brandId,
    promptSetVersionId: fixture.promptSetVersionId,
    personaId: fixture.personaId,
    personaVersionId: fixture.personaVersionId,
    promptType: "persona",
    topic: "Uncited fixture prompt",
    promptText: text,
    normalizedHash: promptHash(text),
    informationNeed: "Whether this prompt is ever analyzed for content gaps.",
    intent: "evaluation",
    journeyStage: "evaluation",
    inclusionRationale: "Inserted directly for a fixture edge case.",
    reviewStatus: "approved",
    dataOrigin: "local",
  });
  return id;
}
