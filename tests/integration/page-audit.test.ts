import { beforeEach, describe, expect, it } from "vitest";
import { resetMockProfoundState } from "@/adapters/profound/mock";
import {
  approvePageAudit,
  getPageAuditDetail,
  listPageAudits,
  rejectPageAudit,
  startPageAuditGeneration,
} from "@/services/page-audit";
import { exportPageAudit } from "@/services/page-audit-export";
import { drainQueue } from "@/seed/pipeline";
import { truncateAll } from "../helpers/db";
import { buildContentFixture, type ContentFixture } from "../helpers/content-fixture";

/**
 * Page-audit generation end to end (§30): real persona claims, real mock
 * adapter, and assertions on the two things the spec calls out specifically
 * — every finding is traceable to something, and findings are correctly
 * split between "belongs on this page" and "belongs on a supporting page".
 */

const HOMEPAGE_CONTENT = `Northwind Analytics helps teams understand their product data with confidence. We are a leading platform trusted by data, security and product teams everywhere.

Our platform brings together analytics, governance and deployment flexibility in one place, so your organization can move fast without compromising on control.

Ready to see what Northwind Analytics can do for your team? Get started today.`;

let fixture: ContentFixture;

beforeEach(async () => {
  await truncateAll();
  resetMockProfoundState();
  fixture = await buildContentFixture("Page Audit");
});

describe("generation", () => {
  it("rejects pasted content shorter than the minimum length", async () => {
    await expect(
      startPageAuditGeneration(fixture.tenant.brandCtx, {
        personaVersionId: fixture.personaVersionId,
        promptSetVersionId: fixture.promptSetVersionId,
        scope: "homepage",
        pageContent: "too short",
      }),
    ).rejects.toThrow();
  });

  it("rejects generation against an unapproved persona version", async () => {
    await expect(
      startPageAuditGeneration(fixture.tenant.brandCtx, {
        personaVersionId: "pev_does_not_exist",
        scope: "homepage",
        pageContent: HOMEPAGE_CONTENT,
      }),
    ).rejects.toThrow();
  });

  it("produces an audit whose findings are ordered by severity", async () => {
    await startPageAuditGeneration(fixture.tenant.brandCtx, {
      personaVersionId: fixture.personaVersionId,
      promptSetVersionId: fixture.promptSetVersionId,
      scope: "homepage",
      url: "https://northwind-analytics.example/",
      pageTitle: "Homepage",
      pageContent: HOMEPAGE_CONTENT,
    });
    expect((await drainQueue({ workerId: "test" })).failed).toBe(0);

    const [audit] = await listPageAudits(fixture.tenant.brandCtx);
    if (!audit) throw new Error("Audit generation produced nothing");
    expect(audit.reviewStatus).toBe("draft");
    expect(audit.scope).toBe("homepage");

    const detail = await getPageAuditDetail(fixture.tenant.brandCtx, audit.id);
    const severityRank: Record<string, number> = {
      critical: 0,
      high: 1,
      medium: 2,
      low: 3,
      info: 4,
    };
    for (let i = 1; i < detail.findings.length; i++) {
      const previous = detail.findings[i - 1];
      const current = detail.findings[i];
      if (!previous || !current) continue;
      expect(severityRank[previous.severity] ?? 9).toBeLessThanOrEqual(
        severityRank[current.severity] ?? 9,
      );
    }
  });

  it("distinguishes findings that belong on this page from findings that belong elsewhere", async () => {
    await startPageAuditGeneration(fixture.tenant.brandCtx, {
      personaVersionId: fixture.personaVersionId,
      promptSetVersionId: fixture.promptSetVersionId,
      scope: "homepage",
      pageContent: HOMEPAGE_CONTENT,
    });
    expect((await drainQueue({ workerId: "test" })).failed).toBe(0);

    const [audit] = await listPageAudits(fixture.tenant.brandCtx);
    if (!audit) throw new Error("Audit generation produced nothing");
    const detail = await getPageAuditDetail(fixture.tenant.brandCtx, audit.id);

    expect(detail.homepageFindings.length + detail.supportingPageFindings.length).toBe(
      detail.findings.length,
    );
    for (const finding of detail.homepageFindings)
      expect(finding.belongsOnSupportingPage).toBe(false);
    for (const finding of detail.supportingPageFindings) {
      expect(finding.belongsOnSupportingPage).toBe(true);
    }
  });

  it("every finding is traceable to available evidence, a prompt, or a Profound prompt", async () => {
    await startPageAuditGeneration(fixture.tenant.brandCtx, {
      personaVersionId: fixture.personaVersionId,
      promptSetVersionId: fixture.promptSetVersionId,
      scope: "homepage",
      pageContent: HOMEPAGE_CONTENT,
    });
    expect((await drainQueue({ workerId: "test" })).failed).toBe(0);

    const [audit] = await listPageAudits(fixture.tenant.brandCtx);
    if (!audit) throw new Error("Audit generation produced nothing");
    const detail = await getPageAuditDetail(fixture.tenant.brandCtx, audit.id);

    for (const finding of detail.findings) {
      const traceable =
        finding.evidenceIds.length > 0 ||
        finding.relatedPromptIds.length > 0 ||
        finding.relatedProfoundPromptIds.length > 0;
      expect(traceable).toBe(true);
    }
  });

  it("runs without a prompt-set version, since it is optional", async () => {
    await startPageAuditGeneration(fixture.tenant.brandCtx, {
      personaVersionId: fixture.personaVersionId,
      scope: "landing_page",
      pageContent: HOMEPAGE_CONTENT,
    });
    expect((await drainQueue({ workerId: "test" })).failed).toBe(0);

    const [audit] = await listPageAudits(fixture.tenant.brandCtx);
    if (!audit) throw new Error("Audit generation produced nothing");
    expect(audit.scope).toBe("landing_page");
    expect(audit.promptSetVersionId).toBeNull();
  });
});

describe("review lifecycle", () => {
  it("approves an audit and then blocks further approval", async () => {
    await startPageAuditGeneration(fixture.tenant.brandCtx, {
      personaVersionId: fixture.personaVersionId,
      promptSetVersionId: fixture.promptSetVersionId,
      scope: "homepage",
      pageContent: HOMEPAGE_CONTENT,
    });
    expect((await drainQueue({ workerId: "test" })).failed).toBe(0);
    const [audit] = await listPageAudits(fixture.tenant.brandCtx);
    if (!audit) throw new Error("Audit generation produced nothing");

    await approvePageAudit(fixture.tenant.brandCtx, audit.id);
    const approved = await getPageAuditDetail(fixture.tenant.brandCtx, audit.id);
    expect(approved.reviewStatus).toBe("approved");
    await expect(approvePageAudit(fixture.tenant.brandCtx, audit.id)).rejects.toThrow();
  });

  it("rejects an audit with a reason", async () => {
    await startPageAuditGeneration(fixture.tenant.brandCtx, {
      personaVersionId: fixture.personaVersionId,
      promptSetVersionId: fixture.promptSetVersionId,
      scope: "homepage",
      pageContent: HOMEPAGE_CONTENT,
    });
    expect((await drainQueue({ workerId: "test" })).failed).toBe(0);
    const [audit] = await listPageAudits(fixture.tenant.brandCtx);
    if (!audit) throw new Error("Audit generation produced nothing");

    await rejectPageAudit(fixture.tenant.brandCtx, audit.id, "Page content was a placeholder.");
    const rejected = await getPageAuditDetail(fixture.tenant.brandCtx, audit.id);
    expect(rejected.reviewStatus).toBe("rejected");
  });
});

describe("export", () => {
  it("exports JSON, CSV and Markdown, each carrying the severity split", async () => {
    await startPageAuditGeneration(fixture.tenant.brandCtx, {
      personaVersionId: fixture.personaVersionId,
      promptSetVersionId: fixture.promptSetVersionId,
      scope: "homepage",
      pageContent: HOMEPAGE_CONTENT,
    });
    expect((await drainQueue({ workerId: "test" })).failed).toBe(0);
    const [audit] = await listPageAudits(fixture.tenant.brandCtx);
    if (!audit) throw new Error("Audit generation produced nothing");

    const json = await exportPageAudit(fixture.tenant.brandCtx, audit.id, "json");
    const parsed = JSON.parse(json.body);
    expect(parsed.audit.id).toBe(audit.id);
    expect(Array.isArray(parsed.findings_on_this_page)).toBe(true);
    expect(Array.isArray(parsed.findings_belonging_elsewhere)).toBe(true);

    const csv = await exportPageAudit(fixture.tenant.brandCtx, audit.id, "csv");
    expect(csv.body.split("\r\n")[0]).toContain("belongs_on_supporting_page");

    const markdown = await exportPageAudit(fixture.tenant.brandCtx, audit.id, "md");
    expect(markdown.body).toContain("Findings on this page");
    expect(markdown.body).toContain("Findings that belong on a supporting page");
  });
});
