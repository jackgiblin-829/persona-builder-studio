import { beforeEach, describe, expect, it } from "vitest";
import { resetMockProfoundState } from "@/adapters/profound/mock";
import { startOpportunityGeneration, listOpportunities } from "@/services/content-opportunities";
import {
  approveBrief,
  getBriefDetail,
  listBriefs,
  parseBriefBody,
  rejectBrief,
  startBriefGeneration,
  updateBriefBody,
} from "@/services/content-brief";
import { exportBrief } from "@/services/content-brief-export";
import { drainQueue } from "@/seed/pipeline";
import { truncateAll } from "../helpers/db";
import { buildContentFixture, type ContentFixture } from "../helpers/content-fixture";

/**
 * SEO brief generation end to end (§29): a real opportunity, a real mock
 * adapter call, and — the point of this file — real enforcement that a
 * brief citing no evidence or Profound ids cannot be written, not merely
 * that a well-formed one can.
 */

let fixture: ContentFixture;
let opportunityId: string;

beforeEach(async () => {
  await truncateAll();
  resetMockProfoundState();
  fixture = await buildContentFixture("Content Brief");

  await startOpportunityGeneration(fixture.tenant.brandCtx, {
    personaVersionId: fixture.personaVersionId,
    promptSetVersionId: fixture.promptSetVersionId,
  });
  expect((await drainQueue({ workerId: "test" })).failed).toBe(0);
  const [first] = await listOpportunities(fixture.tenant.brandCtx);
  if (!first) throw new Error("Fixture produced no opportunities to brief from");
  opportunityId = first.id;
});

describe("generation", () => {
  it("produces a brief whose body passes the 27-section schema", async () => {
    await startBriefGeneration(fixture.tenant.brandCtx, { opportunityId });
    expect((await drainQueue({ workerId: "test" })).failed).toBe(0);

    const [brief] = await listBriefs(fixture.tenant.brandCtx);
    if (!brief) throw new Error("Brief generation produced nothing");
    expect(brief.opportunityId).toBe(opportunityId);
    expect(brief.version).toBe(1);
    expect(brief.reviewStatus).toBe("draft");

    const body = parseBriefBody(brief.body);
    expect(body).not.toBeNull();
    expect(body?.working_title.length).toBeGreaterThan(0);
  });

  it("cites only evidence ids and Profound prompt ids the opportunity actually carries", async () => {
    await startBriefGeneration(fixture.tenant.brandCtx, { opportunityId });
    expect((await drainQueue({ workerId: "test" })).failed).toBe(0);

    const [brief] = await listBriefs(fixture.tenant.brandCtx);
    if (!brief) throw new Error("Brief generation produced nothing");

    const opportunity = (await listOpportunities(fixture.tenant.brandCtx)).find(
      (o) => o.id === opportunityId,
    );
    if (!opportunity) throw new Error("Opportunity vanished");

    for (const evidenceId of brief.evidenceIds) {
      expect(opportunity.evidenceIds.includes(evidenceId) || evidenceId.startsWith("ev_")).toBe(
        true,
      );
    }
    for (const promptId of brief.profoundPromptIds) {
      expect(opportunity.relevantProfoundPromptIds).toContain(promptId);
    }
  });

  it("rejects brief generation from a rejected opportunity", async () => {
    const { rejectOpportunity } = await import("@/services/content-opportunities");
    await rejectOpportunity(fixture.tenant.brandCtx, opportunityId, "Not worth it.");
    await expect(
      startBriefGeneration(fixture.tenant.brandCtx, { opportunityId }),
    ).rejects.toThrow();
  });
});

describe("write-boundary traceability enforcement", () => {
  it("refuses to save an edit that removes every outline section's evidence", async () => {
    await startBriefGeneration(fixture.tenant.brandCtx, { opportunityId });
    expect((await drainQueue({ workerId: "test" })).failed).toBe(0);
    const [brief] = await listBriefs(fixture.tenant.brandCtx);
    if (!brief) throw new Error("Brief generation produced nothing");

    const body = parseBriefBody(brief.body);
    if (!body) throw new Error("Stored brief body failed schema validation");

    const strippedOutline = {
      ...body,
      recommended_outline: body.recommended_outline.map((section) => ({
        ...section,
        evidence_ids: ["ev_totally_fabricated_id"],
      })),
      relevant_profound_prompts: body.relevant_profound_prompts.map((prompt) => ({
        ...prompt,
        profound_prompt_id: "prof_totally_fabricated_id",
      })),
    };

    await expect(
      updateBriefBody(fixture.tenant.brandCtx, brief.id, strippedOutline),
    ).rejects.toThrow();

    // And the brief on disk is untouched by the rejected edit.
    const stillIntact = await getBriefDetail(fixture.tenant.brandCtx, brief.id);
    const stillIntactBody = parseBriefBody(stillIntact.body);
    expect(stillIntactBody?.recommended_outline[0]?.evidence_ids).not.toEqual([
      "ev_totally_fabricated_id",
    ]);
  });

  it("accepts an edit that keeps at least one traceable outline section and Profound prompt", async () => {
    await startBriefGeneration(fixture.tenant.brandCtx, { opportunityId });
    expect((await drainQueue({ workerId: "test" })).failed).toBe(0);
    const [brief] = await listBriefs(fixture.tenant.brandCtx);
    if (!brief) throw new Error("Brief generation produced nothing");

    const body = parseBriefBody(brief.body);
    if (!body) throw new Error("Stored brief body failed schema validation");

    const edited = { ...body, working_title: "Edited working title for this brief" };
    await updateBriefBody(fixture.tenant.brandCtx, brief.id, edited);

    const updated = await getBriefDetail(fixture.tenant.brandCtx, brief.id);
    const updatedBody = parseBriefBody(updated.body);
    expect(updatedBody?.working_title).toBe("Edited working title for this brief");
  });
});

describe("review lifecycle", () => {
  it("approves a brief and then blocks further edits", async () => {
    await startBriefGeneration(fixture.tenant.brandCtx, { opportunityId });
    expect((await drainQueue({ workerId: "test" })).failed).toBe(0);
    const [brief] = await listBriefs(fixture.tenant.brandCtx);
    if (!brief) throw new Error("Brief generation produced nothing");

    await approveBrief(fixture.tenant.brandCtx, brief.id);
    const approved = await getBriefDetail(fixture.tenant.brandCtx, brief.id);
    expect(approved.reviewStatus).toBe("approved");
    expect(approved.mutable).toBe(false);
    await expect(approveBrief(fixture.tenant.brandCtx, brief.id)).rejects.toThrow();
  });

  it("rejects a brief and keeps it distinguishable from an approved one", async () => {
    await startBriefGeneration(fixture.tenant.brandCtx, { opportunityId });
    expect((await drainQueue({ workerId: "test" })).failed).toBe(0);
    const [brief] = await listBriefs(fixture.tenant.brandCtx);
    if (!brief) throw new Error("Brief generation produced nothing");

    await rejectBrief(fixture.tenant.brandCtx, brief.id, "Needs a different angle.");
    const rejected = await getBriefDetail(fixture.tenant.brandCtx, brief.id);
    expect(rejected.reviewStatus).toBe("rejected");
  });
});

describe("export", () => {
  it("exports JSON, CSV and Markdown covering the brief's sections", async () => {
    await startBriefGeneration(fixture.tenant.brandCtx, { opportunityId });
    expect((await drainQueue({ workerId: "test" })).failed).toBe(0);
    const [brief] = await listBriefs(fixture.tenant.brandCtx);
    if (!brief) throw new Error("Brief generation produced nothing");

    const json = await exportBrief(fixture.tenant.brandCtx, brief.id, "json");
    const parsed = JSON.parse(json.body);
    expect(parsed.brief.id).toBe(brief.id);
    expect(parsed.body.recommended_outline.length).toBeGreaterThan(0);

    const csv = await exportBrief(fixture.tenant.brandCtx, brief.id, "csv");
    expect(csv.body).toContain("working_title");

    const markdown = await exportBrief(fixture.tenant.brandCtx, brief.id, "md");
    expect(markdown.body).toContain("## Recommended outline");
    expect(markdown.body).toContain("## Final quality checklist");
  });
});
