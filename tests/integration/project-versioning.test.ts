import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import { closeDb, db } from "@/db/client";
import {
  generationRuns,
  jobs,
  organizations,
  personas,
  personaVersionSignals,
  projects,
  promptSets,
  researchSignals,
  sparkReports,
  sparkReportSections,
} from "@/db/schema";
import { materializeSparkSignals } from "@/jobs/handlers/generate-personas";
import type { ProjectContext } from "@/lib/auth/context";
import { runSeed } from "@/seed/run";
import { getProject, listProjectsForSession } from "@/services/projects";
import { buildProfoundCsv } from "@/services/prompts";
import { createSourceFromTranscript } from "@/services/sources";
import { savePersonaVersion, startPersonaGeneration } from "@/services/studio";

const editor: ProjectContext = {
  userId: "usr_analyst",
  userName: "Demo Strategist",
  userEmail: "analyst@example.com",
  organizationId: "org_demo829",
  role: "editor",
  projectId: "prj_northwind",
  projectName: "Northwind Enterprise Platform",
  projectSlug: "northwind-enterprise-platform",
};

const viewer: ProjectContext = { ...editor, userId: "usr_viewer", role: "viewer" };

beforeAll(async () => {
  await runSeed();
});

afterAll(async () => {
  await closeDb();
});

describe("clean project schema and tenant boundaries", () => {
  it("installs only the reworked tables and keeps project reads tenant-scoped", async () => {
    const tableRows = await db.execute<{ table_name: string }>(sql`
      select table_name
      from information_schema.tables
      where table_schema = 'public'
    `);
    const tableNames = new Set(tableRows.map((row) => row.table_name));
    expect(tableNames.has("projects")).toBe(true);
    expect(tableNames.has("research_signals")).toBe(true);
    expect(tableNames.has("market_research_briefs")).toBe(true);
    expect(tableNames.has("generated_prompts")).toBe(true);
    expect(
      ["brands", "evidence_records", "content_opportunities", "audit_decks"].some((name) =>
        tableNames.has(name),
      ),
    ).toBe(false);

    await db
      .insert(organizations)
      .values({ id: "org_isolated", name: "Isolated", slug: "isolated" });
    await db.insert(projects).values({
      id: "prj_isolated",
      organizationId: "org_isolated",
      name: "Other tenant",
      slug: "other-tenant",
      canonicalDomain: "other.example",
      description: "A project belonging to another organization.",
      primaryMarket: "CA",
      languageLocale: "en-CA",
      sparktoroAudienceDescription: "Canadian operators evaluating workflow tools",
    });

    const visible = await listProjectsForSession([
      { organizationId: editor.organizationId, organizationName: "829 Demo" },
    ]);
    expect(visible.map((project) => project.id)).toEqual(["prj_northwind"]);
    await expect(getProject({ ...editor, organizationId: "org_isolated" })).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("keeps viewers read-only while allowing a complete CSV export", async () => {
    await expect(
      createSourceFromTranscript(viewer, {
        sourceType: "sales_transcript",
        observedAt: null,
        label: "Viewer attempt",
        content: "A viewer must not be able to create this otherwise valid transcript source.",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });

    await expect(buildProfoundCsv(viewer)).rejects.toThrow(/demo-mode/i);
    const csv = await buildProfoundCsv(viewer, { allowMock: true });
    expect(csv.startsWith('\uFEFF"Topic","Prompt","Tags","Regions","Language"')).toBe(true);
    expect(csv.trim().split("\r\n")).toHaveLength(73);
    expect(csv).toContain('"US","en-US"');
    expect(csv).toContain("generation_mode:mock");
  });
});

describe("persona versioning and prompt refresh", () => {
  it("reuses cached SparkToro signals without breaking immutable source links", async () => {
    const [persona] = await db
      .select()
      .from(personas)
      .where(eq(personas.projectId, editor.projectId))
      .limit(1);
    expect(persona?.currentVersionId).toBeTruthy();
    await db.insert(sparkReports).values({
      id: "spr_report_immutable",
      organizationId: editor.organizationId,
      projectId: editor.projectId,
      inputHash: "integration-immutable-report",
      audienceDescription: "A cached test audience",
      market: "US",
      locale: "en-US",
      status: "completed",
    });
    await db.insert(sparkReportSections).values({
      id: "spr_section_immutable",
      organizationId: editor.organizationId,
      projectId: editor.projectId,
      reportId: "spr_report_immutable",
      section: "keywords",
      status: "completed",
      normalized: { items: [{ name: "governed workflow automation" }] },
    });
    await db.insert(researchSignals).values({
      id: "sig_immutable_spark",
      organizationId: editor.organizationId,
      projectId: editor.projectId,
      sourceKind: "sparktoro",
      sparkReportSectionId: "spr_section_immutable",
      category: "sparktoro:keywords",
      displayText: "governed workflow automation",
      provenance: "externally_supported_aggregate",
      confidence: 0.82,
      dataOrigin: "mock",
    });
    await db.insert(personaVersionSignals).values({
      id: "pvs_immutable_spark",
      organizationId: editor.organizationId,
      personaVersionId: persona!.currentVersionId!,
      signalId: "sig_immutable_spark",
      section: "keywords",
    });

    await materializeSparkSignals(
      editor.projectId,
      editor.organizationId,
      "spr_report_immutable",
      "mock",
    );
    expect(
      await db.select().from(researchSignals).where(eq(researchSignals.id, "sig_immutable_spark")),
    ).toHaveLength(1);
    expect(
      await db
        .select()
        .from(personaVersionSignals)
        .where(eq(personaVersionSignals.id, "pvs_immutable_spark")),
    ).toHaveLength(1);
  });

  it("publishes an immutable edit, rejects a stale edit, and queues prompt replacement", async () => {
    const [before] = await db
      .select()
      .from(personas)
      .where(eq(personas.projectId, editor.projectId))
      .limit(1);
    expect(before?.currentVersionId).toBeTruthy();
    const [current] = await db.query.personaVersions.findMany({
      where: (version, operators) => operators.eq(version.id, before!.currentVersionId!),
      limit: 1,
    });
    expect(current).toBeTruthy();
    const priorPromptPointer = (
      await db
        .select({ value: promptSets.currentVersionId })
        .from(promptSets)
        .where(eq(promptSets.personaId, before!.id))
        .limit(1)
    )[0]?.value;
    expect(priorPromptPointer).toBeTruthy();

    const list = (items: { text: string }[]) => items.map((item) => item.text);
    const profile = current!.profile;
    const input = {
      personaId: before!.id,
      expectedVersion: current!.version,
      name: current!.name,
      description: current!.description,
      summary: `${profile.summary} Edited in the integration test.`,
      roles: list(profile.firmographics.roles),
      seniority: list(profile.firmographics.seniority),
      departments: list(profile.firmographics.departments),
      industries: list(profile.firmographics.industries),
      companySize: list(profile.firmographics.companySize),
      experience: list(profile.firmographics.experience),
      jobsToBeDone: list(profile.jobsToBeDone),
      motivations: list(profile.motivations),
      goals: list(profile.goals),
      painPoints: list(profile.painPoints),
      constraints: list(profile.constraints),
      successMeasures: list(profile.successMeasures),
      decisionCriteria: list(profile.decisionCriteria),
      objections: list(profile.objections),
      commonQuestions: list(profile.commonQuestions),
      proofNeeds: list(profile.proofNeeds),
      vocabulary: list(profile.vocabulary),
      buyingTriggers: list(profile.buyingTriggers),
      channels: list(profile.channels),
      communities: list(profile.communities),
      websites: list(profile.websites),
      contentPreferences: list(profile.contentPreferences),
      keywords: list(profile.keywords),
      aiPromptTopics: list(profile.aiPromptTopics),
    };

    const versionId = await savePersonaVersion(editor, input);
    const [after] = await db.select().from(personas).where(eq(personas.id, before!.id)).limit(1);
    expect(after?.currentVersionId).toBe(versionId);
    expect(after?.currentVersionId).not.toBe(before?.currentVersionId);
    expect(
      (
        await db
          .select({ value: promptSets.currentVersionId })
          .from(promptSets)
          .where(eq(promptSets.personaId, before!.id))
          .limit(1)
      )[0]?.value,
    ).toBe(priorPromptPointer);

    const queuedRuns = await db
      .select()
      .from(generationRuns)
      .where(eq(generationRuns.projectId, editor.projectId));
    expect(queuedRuns.some((run) => run.workflowType === "prompt_generation")).toBe(true);
    const queuedJobs = await db
      .select()
      .from(jobs)
      .where(inArray(jobs.status, ["queued", "retrying"]));
    expect(queuedJobs.some((job) => job.type === "generate_prompts")).toBe(true);

    await expect(savePersonaVersion(editor, input)).rejects.toThrow(/changed after you opened/i);
    const [stillCurrent] = await db
      .select()
      .from(personas)
      .where(eq(personas.id, before!.id))
      .limit(1);
    expect(stillCurrent?.currentVersionId).toBe(versionId);
  });

  it("reuses an identical active persona run and enqueues a fresh intentional rerun", async () => {
    const firstRunId = await startPersonaGeneration(editor);
    const duplicateRunId = await startPersonaGeneration(editor);
    expect(duplicateRunId).toBe(firstRunId);

    await db
      .update(generationRuns)
      .set({ status: "completed", stage: "ready", progress: 100, finishedAt: new Date() })
      .where(eq(generationRuns.id, firstRunId));

    const nextRunId = await startPersonaGeneration(editor);
    expect(nextRunId).not.toBe(firstRunId);
    const personaJobs = await db.select().from(jobs).where(eq(jobs.type, "generate_personas"));
    expect(personaJobs.map((job) => job.payload.runId)).toEqual(
      expect.arrayContaining([firstRunId, nextRunId]),
    );
    expect(personaJobs).toHaveLength(2);
  });
});
