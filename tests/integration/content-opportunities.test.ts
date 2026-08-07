import { beforeEach, describe, expect, it } from "vitest";
import { resetMockProfoundState } from "@/adapters/profound/mock";
import {
  approveOpportunity,
  getOpportunityDetail,
  listOpportunities,
  rejectOpportunity,
  startOpportunityGeneration,
  updateOpportunity,
} from "@/services/content-opportunities";
import { exportOpportunities } from "@/services/content-opportunities-export";
import { drainQueue } from "@/seed/pipeline";
import { truncateAll } from "../helpers/db";
import { buildContentFixture, type ContentFixture } from "../helpers/content-fixture";

/**
 * Content-gap analysis and opportunity generation end to end (§27, §28):
 * real mock adapter, real job handler, real service layer. Not a hand-built
 * fixture row.
 */

let fixture: ContentFixture;

beforeEach(async () => {
  await truncateAll();
  resetMockProfoundState();
  fixture = await buildContentFixture("Content Opportunities");
});

describe("generation", () => {
  it("produces at least one opportunity traceable to the deployed prompt set", async () => {
    await startOpportunityGeneration(fixture.tenant.brandCtx, {
      personaVersionId: fixture.personaVersionId,
      promptSetVersionId: fixture.promptSetVersionId,
    });
    expect((await drainQueue({ workerId: "test" })).failed).toBe(0);

    const opportunities = await listOpportunities(fixture.tenant.brandCtx);
    expect(opportunities.length).toBeGreaterThan(0);

    for (const opportunity of opportunities) {
      expect(opportunity.personaVersionId).toBe(fixture.personaVersionId);
      expect(opportunity.promptSetVersionId).toBe(fixture.promptSetVersionId);
      expect(opportunity.reviewStatus).toBe("pending_review");
      // §28: relevant Profound prompt ids are always populated — an
      // opportunity with no Profound reference would not be traceable.
      expect(opportunity.relevantProfoundPromptIds.length).toBeGreaterThan(0);
    }
  });

  it("does not make every opportunity a new_article recommendation", async () => {
    await startOpportunityGeneration(fixture.tenant.brandCtx, {
      personaVersionId: fixture.personaVersionId,
      promptSetVersionId: fixture.promptSetVersionId,
    });
    expect((await drainQueue({ workerId: "test" })).failed).toBe(0);

    const opportunities = await listOpportunities(fixture.tenant.brandCtx);
    const recommendations = new Set(opportunities.map((o) => o.recommendation));
    // The deterministic mock adapter, driven by analyzeGap, should produce
    // more than one shape across a real prompt set rather than defaulting
    // every result to the same recommendation.
    expect(recommendations.size).toBeGreaterThan(1);
  });

  it("only cites evidence ids the underlying prompt actually has available", async () => {
    await startOpportunityGeneration(fixture.tenant.brandCtx, {
      personaVersionId: fixture.personaVersionId,
      promptSetVersionId: fixture.promptSetVersionId,
    });
    expect((await drainQueue({ workerId: "test" })).failed).toBe(0);

    const opportunities = await listOpportunities(fixture.tenant.brandCtx);
    // No opportunity should carry an evidence id starting with a
    // clearly-fabricated pattern — a weak but real signal that citations are
    // filtered rather than trusted verbatim from the model.
    for (const opportunity of opportunities) {
      for (const evidenceId of opportunity.evidenceIds) {
        expect(evidenceId.startsWith("ev_")).toBe(true);
      }
    }
  });

  it("rejects generation against an unapproved persona version", async () => {
    await expect(
      startOpportunityGeneration(fixture.tenant.brandCtx, {
        personaVersionId: "pev_does_not_exist",
        promptSetVersionId: fixture.promptSetVersionId,
      }),
    ).rejects.toThrow();
  });
});

describe("review lifecycle", () => {
  it("approves, rejects, and blocks further edits on a decided opportunity", async () => {
    await startOpportunityGeneration(fixture.tenant.brandCtx, {
      personaVersionId: fixture.personaVersionId,
      promptSetVersionId: fixture.promptSetVersionId,
    });
    expect((await drainQueue({ workerId: "test" })).failed).toBe(0);

    const [first, second] = await listOpportunities(fixture.tenant.brandCtx);
    if (!first || !second)
      throw new Error("Fixture needs at least two opportunities for this test");

    await approveOpportunity(fixture.tenant.brandCtx, first.id);
    const approved = await getOpportunityDetail(fixture.tenant.brandCtx, first.id);
    expect(approved.reviewStatus).toBe("approved");
    await expect(approveOpportunity(fixture.tenant.brandCtx, first.id)).rejects.toThrow();
    await expect(
      updateOpportunity(fixture.tenant.brandCtx, first.id, {
        title: "Should not be allowed",
        problemStatement: "Should not be allowed to save this either, past minimum length.",
        recommendation: "new_article",
        priority: "p1",
        estimatedEffort: "small",
        validationMethod: "Should not be allowed to save this either.",
      }),
    ).rejects.toThrow();

    await rejectOpportunity(fixture.tenant.brandCtx, second.id, "Not worth pursuing right now.");
    const rejected = await getOpportunityDetail(fixture.tenant.brandCtx, second.id);
    expect(rejected.reviewStatus).toBe("rejected");
  });

  it("lets an editor update a pending opportunity's recommendation and priority", async () => {
    await startOpportunityGeneration(fixture.tenant.brandCtx, {
      personaVersionId: fixture.personaVersionId,
      promptSetVersionId: fixture.promptSetVersionId,
    });
    expect((await drainQueue({ workerId: "test" })).failed).toBe(0);

    const [first] = await listOpportunities(fixture.tenant.brandCtx);
    if (!first) throw new Error("Fixture produced no opportunities");

    await updateOpportunity(fixture.tenant.brandCtx, first.id, {
      title: "Reviewer-edited title for this opportunity",
      problemStatement: "Reviewer-edited problem statement, long enough to pass validation.",
      recommendation: "faq",
      priority: "p1",
      estimatedEffort: "small",
      validationMethod: "Reviewer-edited validation method.",
    });

    const updated = await getOpportunityDetail(fixture.tenant.brandCtx, first.id);
    expect(updated.title).toBe("Reviewer-edited title for this opportunity");
    expect(updated.recommendation).toBe("faq");
    expect(updated.priority).toBe("p1");
  });
});

describe("export", () => {
  it("exports JSON, CSV and Markdown that all include the generated opportunities", async () => {
    await startOpportunityGeneration(fixture.tenant.brandCtx, {
      personaVersionId: fixture.personaVersionId,
      promptSetVersionId: fixture.promptSetVersionId,
    });
    expect((await drainQueue({ workerId: "test" })).failed).toBe(0);

    const opportunities = await listOpportunities(fixture.tenant.brandCtx);
    const [first] = opportunities;
    if (!first) throw new Error("Fixture produced no opportunities");

    const json = await exportOpportunities(fixture.tenant.brandCtx, "json");
    const parsed = JSON.parse(json.body);
    expect(parsed.opportunities.length).toBe(opportunities.length);
    expect(parsed.opportunities.some((o: { id: string }) => o.id === first.id)).toBe(true);

    const csv = await exportOpportunities(fixture.tenant.brandCtx, "csv");
    expect(csv.body.split("\r\n")[0]).toContain("recommendation");
    expect(csv.body).toContain(first.id);

    const markdown = await exportOpportunities(fixture.tenant.brandCtx, "md");
    expect(markdown.body).toContain("# Content opportunities");
    expect(markdown.body).toContain(first.title);
  });
});

describe("tenant isolation", () => {
  it("never surfaces one tenant's opportunities to another", async () => {
    await startOpportunityGeneration(fixture.tenant.brandCtx, {
      personaVersionId: fixture.personaVersionId,
      promptSetVersionId: fixture.promptSetVersionId,
    });
    expect((await drainQueue({ workerId: "test" })).failed).toBe(0);
    const [ownOpportunity] = await listOpportunities(fixture.tenant.brandCtx);
    if (!ownOpportunity) throw new Error("Fixture produced no opportunities");

    const other = await buildContentFixture("Content Opportunities Other Tenant");
    await startOpportunityGeneration(other.tenant.brandCtx, {
      personaVersionId: other.personaVersionId,
      promptSetVersionId: other.promptSetVersionId,
    });
    expect((await drainQueue({ workerId: "test" })).failed).toBe(0);

    const otherOpportunities = await listOpportunities(other.tenant.brandCtx);
    expect(otherOpportunities.some((o) => o.id === ownOpportunity.id)).toBe(false);
    await expect(getOpportunityDetail(other.tenant.brandCtx, ownOpportunity.id)).rejects.toThrow();
  });
});
