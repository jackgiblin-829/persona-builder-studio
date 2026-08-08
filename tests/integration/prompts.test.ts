import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, db } from "@/db/client";
import {
  evidenceRecords,
  integrations,
  promptEmbeddings,
  promptEvidence,
  promptPairs,
  promptSetVersions,
  promptSets,
  prompts,
} from "@/db/schema";
import { newId, ID_PREFIXES } from "@/lib/ids";
import { promptHash } from "@/lib/prompt-dedupe";
import { approvePersonaVersion, listPersonas, startPersonaGeneration } from "@/services/personas";
import { decideSegment, listSegments, startSegmentation } from "@/services/segments";
import {
  approvePromptSetVersion,
  createNewPromptSetVersion,
  getPromptSetDetail,
  listPromptSets,
  rejectPromptSetVersion,
  removeGenericControl,
  reviewPrompts,
  setGenericControl,
  setTrackingPriority,
  startPromptGeneration,
  updatePrompt,
} from "@/services/prompt-sets";
import { exportPromptSet } from "@/services/prompt-export";
import { createSourceFromPaste, deleteSource } from "@/services/sources";
import { reviewEvidence } from "@/services/evidence";
import { drainQueue } from "@/seed/pipeline";
import { createTestTenant, truncateAll, type TestTenant } from "../helpers/db";

/**
 * The full prompt path against the real handlers and services: generate →
 * review → edit → pair → approve → version → export.
 *
 * Two sources, because the segmenter refuses to build a segment from one voice.
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

let tenant: TestTenant;
let otherTenant: TestTenant;
let personaId: string;
let personaVersionId: string;
let promptSetId: string;
let v1Id: string;

beforeAll(async () => {
  await truncateAll();
  tenant = await createTestTenant("Prompts");
  otherTenant = await createTestTenant("Prompts Rival");

  for (const scope of [tenant, otherTenant]) {
    await db.insert(integrations).values({
      id: newId(ID_PREFIXES.integration),
      organizationId: scope.organizationId,
      vendor: "openai",
      mode: "mock",
    });
  }

  for (const [label, content, sourceType] of [
    ["Discovery call", CALL, "sales_transcript"],
    ["Buyer interview", INTERVIEW, "interview"],
  ] as const) {
    await createSourceFromPaste(tenant.brandCtx, {
      label,
      sourceType,
      observedAt: new Date("2026-06-01T00:00:00Z"),
      excludeFromModelCalls: false,
      content,
      isTranscript: true,
    });
  }

  const ingestion = await drainQueue({ workerId: "test" });
  expect(ingestion.failed, ingestion.errors.join("; ")).toBe(0);

  const all = await db
    .select({ id: evidenceRecords.id })
    .from(evidenceRecords)
    .where(eq(evidenceRecords.brandId, tenant.brandId));
  await reviewEvidence(
    tenant.brandCtx,
    all.map((row) => row.id),
    "approved",
  );

  await startSegmentation(tenant.brandCtx);
  expect((await drainQueue({ workerId: "test" })).failed).toBe(0);

  const { segments } = await listSegments(tenant.brandCtx);
  const best = [...segments].sort((a, b) => b.supportingCount - a.supportingCount)[0];
  if (!best) throw new Error("Segmentation produced no candidates for the prompt fixture");
  await decideSegment(tenant.brandCtx, best.id, "approved");

  await startPersonaGeneration(tenant.brandCtx, best.id);
  expect((await drainQueue({ workerId: "test" })).failed).toBe(0);

  const [persona] = await listPersonas(tenant.brandCtx);
  if (!persona?.currentVersionId) throw new Error("Persona synthesis produced no version");
  personaId = persona.id;
  personaVersionId = persona.currentVersionId;
});

afterAll(async () => {
  await closeDb();
});

describe("generation guards", () => {
  it("refuses to generate from a persona with no approved version", async () => {
    await expect(startPromptGeneration(tenant.brandCtx, personaId)).rejects.toThrow(
      /Approve a persona version/,
    );
  });

  it("refuses a persona that belongs to another tenant", async () => {
    await expect(startPromptGeneration(otherTenant.brandCtx, personaId)).rejects.toThrow();
  });
});

describe("prompt generation", () => {
  beforeAll(async () => {
    const { blockers } = await approvePersonaVersion(tenant.brandCtx, personaVersionId);
    expect(blockers, `persona could not be approved: ${blockers.join(" ")}`).toEqual([]);

    await startPromptGeneration(tenant.brandCtx, personaId);
    const result = await drainQueue({ workerId: "test" });
    expect(result.failed, result.errors.join("; ")).toBe(0);

    const [set] = await listPromptSets(tenant.brandCtx);
    if (!set?.currentVersionId) throw new Error("Prompt generation produced no set");
    promptSetId = set.id;
    v1Id = set.currentVersionId;
  });

  it("creates a draft version linked to the approved persona version", async () => {
    const detail = await getPromptSetDetail(tenant.brandCtx, promptSetId);
    expect(detail.version.status).toBe("draft");
    expect(detail.version.personaVersionId).toBe(personaVersionId);
    expect(detail.personaVersion.status).toBe("approved");
    expect(detail.counts.persona).toBeGreaterThan(0);
  });

  it("records the §33 generation metadata on the version", async () => {
    const detail = await getPromptSetDetail(tenant.brandCtx, promptSetId);
    expect(detail.version.modelProvider).toBe("mock");
    expect(detail.version.modelId).toMatch(/^mock:/);
    expect(detail.version.promptTemplateVersion).toBeTruthy();
    expect(detail.version.schemaVersion).toBeTruthy();
    expect(detail.version.dataOrigin).toBe("mock");
    expect(detail.version.evidenceCutoff).toBeInstanceOf(Date);
    expect(detail.version.generatedByUserId).toBe(tenant.userId);
  });

  /** The traceability invariant: no prompt without evidence. */
  it("gives every persona prompt at least one citation resolving to this brand's evidence", async () => {
    const detail = await getPromptSetDetail(tenant.brandCtx, promptSetId);
    const brandEvidence = new Set(
      (
        await db
          .select({ id: evidenceRecords.id })
          .from(evidenceRecords)
          .where(eq(evidenceRecords.brandId, tenant.brandId))
      ).map((row) => row.id),
    );

    for (const prompt of detail.personaPrompts) {
      expect(prompt.evidence.length).toBeGreaterThan(0);
      for (const link of prompt.evidence) expect(brandEvidence.has(link.evidenceId)).toBe(true);
    }
  });

  it("never names the target brand in a prompt", async () => {
    const detail = await getPromptSetDetail(tenant.brandCtx, promptSetId);
    for (const prompt of [...detail.personaPrompts, ...detail.controls]) {
      expect(prompt.promptText.toLowerCase()).not.toContain(
        tenant.brandCtx.brandName.toLowerCase(),
      );
    }
  });

  it("stores a unique normalized hash per prompt within the version", async () => {
    const rows = await db
      .select({ hash: prompts.normalizedHash, text: prompts.promptText })
      .from(prompts)
      .where(eq(prompts.promptSetVersionId, v1Id));

    expect(new Set(rows.map((row) => row.hash)).size).toBe(rows.length);
    for (const row of rows) expect(row.hash).toBe(promptHash(row.text));
  });

  it("pairs controls, and shares one control row between prompts that reduce to it", async () => {
    const detail = await getPromptSetDetail(tenant.brandCtx, promptSetId);
    expect(detail.counts.paired).toBeGreaterThan(0);
    // Fewer control rows than pairs is the shared-control case; never more.
    expect(detail.counts.controls).toBeLessThanOrEqual(detail.counts.paired);

    for (const prompt of detail.personaPrompts) {
      if (!prompt.control) continue;
      expect(prompt.control.promptText).not.toBe(prompt.promptText);
    }
  });

  it("builds the §21 Profound tag set on every prompt", async () => {
    const detail = await getPromptSetDetail(tenant.brandCtx, promptSetId);
    const prompt = detail.personaPrompts[0]!;
    const tags = (prompt.profoundMetadata as { tags: string[] }).tags;

    expect(tags).toContain(`persona:${detail.persona.slug}`);
    expect(tags).toContain(`prompt-set:${detail.set.slug}`);
    expect(tags).toContain("prompt-type:persona");
    expect(tags).toContain("source:persona-builder-studio");

    const control = detail.controls[0];
    if (control) {
      const controlTags = (control.profoundMetadata as { tags: string[] }).tags;
      expect(controlTags).toContain("prompt-type:generic-control");
      expect(controlTags.some((tag) => tag.startsWith("persona:"))).toBe(false);
    }
  });

  it("embeds every prompt so semantic duplicate detection can run", async () => {
    const promptRows = await db
      .select({ id: prompts.id })
      .from(prompts)
      .where(eq(prompts.promptSetVersionId, v1Id));

    const embeddings = await db
      .select({ promptId: promptEmbeddings.promptId })
      .from(promptEmbeddings)
      .innerJoin(prompts, eq(prompts.id, promptEmbeddings.promptId))
      .where(eq(prompts.promptSetVersionId, v1Id));

    expect(promptRows.length).toBeGreaterThan(0);
    expect(embeddings.length).toBe(promptRows.length);
  });

  it("groups prompts by intent and by journey stage", async () => {
    const detail = await getPromptSetDetail(tenant.brandCtx, promptSetId);
    expect(detail.byIntent.length).toBeGreaterThan(1);
    expect(detail.byStage.length).toBeGreaterThan(1);
    expect(detail.byIntent.reduce((sum, group) => sum + group.prompts.length, 0)).toBe(
      detail.counts.persona,
    );
  });
});

describe("review and editing", () => {
  it("rejects a prompt and cascades to a control that served only it", async () => {
    const detail = await getPromptSetDetail(tenant.brandCtx, promptSetId);
    const target = detail.personaPrompts.find(
      (prompt) =>
        prompt.control !== null &&
        detail.personaPrompts.filter((other) => other.control?.id === prompt.control?.id).length ===
          1,
    );
    if (!target?.control) throw new Error("Fixture has no exclusively-paired control");

    const { cascadedControls } = await reviewPrompts(tenant.brandCtx, [target.id], "rejected");
    expect(cascadedControls).toBe(1);

    const [control] = await db
      .select({ status: prompts.reviewStatus })
      .from(prompts)
      .where(eq(prompts.id, target.control.id));
    expect(control?.status).toBe("rejected");

    await reviewPrompts(tenant.brandCtx, [target.id, target.control.id], "pending_review");
  });

  it("sets tracking priority in bulk", async () => {
    const detail = await getPromptSetDetail(tenant.brandCtx, promptSetId);
    const ids = detail.personaPrompts.slice(0, 2).map((prompt) => prompt.id);
    expect(await setTrackingPriority(tenant.brandCtx, ids, "low")).toBe(2);

    const after = await getPromptSetDetail(tenant.brandCtx, promptSetId);
    for (const id of ids) {
      expect(after.personaPrompts.find((prompt) => prompt.id === id)?.trackingPriority).toBe("low");
    }
  });

  it("recomputes hash, tags and the edited flag when a prompt is rewritten", async () => {
    const detail = await getPromptSetDetail(tenant.brandCtx, promptSetId);
    const target = detail.personaPrompts[0]!;

    await updatePrompt(tenant.brandCtx, target.id, {
      promptText: "Which platforms keep customer data inside a customer-controlled VPC?",
      topic: "Data residency",
      intent: "comparison",
      journeyStage: "consideration",
      trackingPriority: "high",
      executionMode: "both",
      informationNeed: "Whether AI answers name options that satisfy the residency requirement.",
      expectedAnswerElements: "Names options\nStates the deployment model",
    });

    const after = await getPromptSetDetail(tenant.brandCtx, promptSetId);
    const updated = after.personaPrompts.find((prompt) => prompt.id === target.id)!;

    expect(updated.promptText).toMatch(/customer-controlled VPC/);
    expect(updated.normalizedHash).toBe(promptHash(updated.promptText));
    expect(updated.editedByUser).toBe(true);
    expect(updated.dataOrigin).toBe("local");
    expect(updated.expectedAnswerElements).toEqual([
      "Names options",
      "States the deployment model",
    ]);
    expect((updated.profoundMetadata as { tags: string[] }).tags).toContain("intent:comparison");
  });

  it("refuses an edit that would exactly duplicate another prompt in the set", async () => {
    const detail = await getPromptSetDetail(tenant.brandCtx, promptSetId);
    const [first, second] = detail.personaPrompts;
    if (!first || !second) throw new Error("Fixture needs two prompts");

    await expect(
      updatePrompt(tenant.brandCtx, second.id, {
        promptText: first.promptText,
        topic: second.topic,
        intent: second.intent,
        journeyStage: second.journeyStage,
        trackingPriority: second.trackingPriority,
        executionMode: second.executionMode,
        informationNeed: second.informationNeed,
      }),
    ).rejects.toThrow(/already asks exactly this question/);
  });

  it("pairs and unpairs a reviewer-authored control", async () => {
    const detail = await getPromptSetDetail(tenant.brandCtx, promptSetId);
    const target = detail.personaPrompts.find((prompt) => prompt.control === null);
    if (!target) throw new Error("Fixture has no unpaired prompt");

    const { controlId } = await setGenericControl(
      tenant.brandCtx,
      target.id,
      "What are the best options in this category?",
    );

    const paired = await getPromptSetDetail(tenant.brandCtx, promptSetId);
    expect(paired.personaPrompts.find((prompt) => prompt.id === target.id)?.control?.id).toBe(
      controlId,
    );

    await removeGenericControl(tenant.brandCtx, target.id);

    const unpaired = await getPromptSetDetail(tenant.brandCtx, promptSetId);
    expect(unpaired.personaPrompts.find((prompt) => prompt.id === target.id)?.control).toBeNull();
    // The control row went with it, rather than lingering as something that
    // would still be deployed.
    const [orphan] = await db.select().from(prompts).where(eq(prompts.id, controlId));
    expect(orphan).toBeUndefined();
  });

  it("refuses a control identical to its persona prompt", async () => {
    const detail = await getPromptSetDetail(tenant.brandCtx, promptSetId);
    const target = detail.personaPrompts[0]!;
    await expect(setGenericControl(tenant.brandCtx, target.id, target.promptText)).rejects.toThrow(
      /identical to the persona prompt/,
    );
  });
});

describe("approval", () => {
  it("blocks approval while prompts are unreviewed", async () => {
    const { blockers } = await approvePromptSetVersion(tenant.brandCtx, v1Id);
    expect(blockers.some((blocker) => /awaiting review/.test(blocker))).toBe(true);
  });

  it("blocks approval when an approved prompt cites no available evidence", async () => {
    const detail = await getPromptSetDetail(tenant.brandCtx, promptSetId);
    const target = detail.personaPrompts[0]!;

    // Simulate the source-deletion outcome without deleting the source: the
    // link survives for auditability but no longer counts.
    await db
      .update(promptEvidence)
      .set({ unavailable: true })
      .where(eq(promptEvidence.promptId, target.id));

    await reviewPrompts(
      tenant.brandCtx,
      detail.personaPrompts.concat(detail.controls).map((prompt) => prompt.id),
      "approved",
    );

    const { blockers } = await approvePromptSetVersion(tenant.brandCtx, v1Id);
    expect(blockers.some((blocker) => /cites no available evidence/.test(blocker))).toBe(true);

    await db
      .update(promptEvidence)
      .set({ unavailable: false })
      .where(eq(promptEvidence.promptId, target.id));
  });

  it("approves once every prompt is reviewed and traceable, and freezes the version", async () => {
    const { blockers } = await approvePromptSetVersion(tenant.brandCtx, v1Id);
    expect(blockers, blockers.join(" ")).toEqual([]);

    const detail = await getPromptSetDetail(tenant.brandCtx, promptSetId);
    expect(detail.version.status).toBe("approved");
    expect(detail.version.approvedByUserId).toBe(tenant.userId);
    expect(detail.editable).toBe(false);
    expect(detail.set.approvedVersionId).toBe(v1Id);
  });

  it("marks approved prompts ready for the Profound deployment path", async () => {
    const rows = await db
      .select({ state: prompts.profoundSyncState, review: prompts.reviewStatus })
      .from(prompts)
      .where(eq(prompts.promptSetVersionId, v1Id));

    for (const row of rows) {
      expect(row.state).toBe(row.review === "approved" ? "ready" : "draft");
    }
  });

  it("refuses every write to an approved version", async () => {
    const detail = await getPromptSetDetail(tenant.brandCtx, promptSetId);
    const target = detail.personaPrompts[0]!;

    await expect(reviewPrompts(tenant.brandCtx, [target.id], "rejected")).rejects.toThrow();
    await expect(setTrackingPriority(tenant.brandCtx, [target.id], "low")).rejects.toThrow();
    await expect(
      setGenericControl(tenant.brandCtx, target.id, "Anything at all?"),
    ).rejects.toThrow();
    await expect(approvePromptSetVersion(tenant.brandCtx, v1Id)).rejects.toThrow();
    await expect(rejectPromptSetVersion(tenant.brandCtx, v1Id, "too late")).rejects.toThrow();
    await expect(
      updatePrompt(tenant.brandCtx, target.id, {
        promptText: "Some other question entirely about deployment?",
        topic: target.topic,
        intent: target.intent,
        journeyStage: target.journeyStage,
        trackingPriority: target.trackingPriority,
        executionMode: target.executionMode,
        informationNeed: target.informationNeed,
      }),
    ).rejects.toThrow();
  });
});

describe("versioning", () => {
  let v2Id: string;

  it("copies an approved version into a new editable draft without touching it", async () => {
    const before = await getPromptSetDetail(tenant.brandCtx, promptSetId);

    const { versionId, version } = await createNewPromptSetVersion(tenant.brandCtx, promptSetId, {
      changeSummary: "Rework the residency prompts after the second discovery call.",
    });
    v2Id = versionId;
    expect(version).toBe(2);
    expect((await drainQueue({ workerId: "test" })).failed).toBe(0);

    const after = await getPromptSetDetail(tenant.brandCtx, promptSetId);
    expect(after.version.id).toBe(v2Id);
    expect(after.version.status).toBe("draft");
    expect(after.version.parentVersionId).toBe(v1Id);
    expect(after.counts.total).toBe(before.counts.total);

    const original = await getPromptSetDetail(tenant.brandCtx, promptSetId, 1);
    expect(original.version.status).toBe("approved");
    expect(original.counts.total).toBe(before.counts.total);
  });

  it("copies evidence links and pairs, and resets sync state on the copy", async () => {
    const v1 = await getPromptSetDetail(tenant.brandCtx, promptSetId, 1);
    const v2 = await getPromptSetDetail(tenant.brandCtx, promptSetId, 2);

    expect(v2.counts.paired).toBe(v1.counts.paired);

    const v1Evidence = v1.personaPrompts.flatMap((prompt) =>
      prompt.evidence.map((link) => link.evidenceId),
    );
    const v2Evidence = v2.personaPrompts.flatMap((prompt) =>
      prompt.evidence.map((link) => link.evidenceId),
    );
    expect(new Set(v2Evidence)).toEqual(new Set(v1Evidence));

    for (const prompt of [...v2.personaPrompts, ...v2.controls]) {
      expect(prompt.profoundSyncState).toBe("draft");
    }

    // The copies are new rows, so no prompt id is shared between versions.
    const v1Ids = new Set(v1.personaPrompts.map((prompt) => prompt.id));
    for (const prompt of v2.personaPrompts) expect(v1Ids.has(prompt.id)).toBe(false);
  });

  it("allows only one draft at a time", async () => {
    await expect(
      createNewPromptSetVersion(tenant.brandCtx, promptSetId, { changeSummary: "another" }),
    ).rejects.toThrow(/already a draft/);
  });

  it("records a rejection reason without destroying the version", async () => {
    await rejectPromptSetVersion(tenant.brandCtx, v2Id, "Superseded by new evidence.");
    const detail = await getPromptSetDetail(tenant.brandCtx, promptSetId, 2);
    expect(detail.version.status).toBe("rejected");
    expect(detail.version.rejectedReason).toBe("Superseded by new evidence.");
    expect(detail.counts.total).toBeGreaterThan(0);
  });
});

describe("exports", () => {
  it("carries evidence ids, rationale and Profound tags in JSON", async () => {
    const { body, filename, contentType } = await exportPromptSet(
      tenant.brandCtx,
      promptSetId,
      "json",
      1,
    );
    expect(filename).toMatch(/\.json$/);
    expect(contentType).toMatch(/application\/json/);

    const parsed = JSON.parse(body) as {
      prompts: {
        evidence: { evidence_id: string }[];
        inclusion_rationale: string;
        profound_metadata: { tags: string[] };
      }[];
      version: { prompt_template_version: string; schema_version: string };
      fields_kept_local_only: string[];
    };

    expect(parsed.prompts.length).toBeGreaterThan(0);
    for (const prompt of parsed.prompts) {
      expect(prompt.evidence.length).toBeGreaterThan(0);
      expect(prompt.inclusion_rationale.length).toBeGreaterThan(0);
      expect(prompt.profound_metadata.tags.length).toBeGreaterThan(0);
    }
    expect(parsed.version.prompt_template_version).toBeTruthy();
    expect(parsed.version.schema_version).toBeTruthy();
    expect(parsed.fields_kept_local_only.length).toBeGreaterThan(0);
  });

  it("quotes every CSV cell and guards formula-leading values", async () => {
    const { body } = await exportPromptSet(tenant.brandCtx, promptSetId, "csv", 1);
    const [header, ...rows] = body.split("\r\n");

    expect(header).toContain('"prompt_text"');
    expect(header).toContain('"evidence_ids"');
    expect(header).toContain('"profound_tags"');
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) expect(row.startsWith('"')).toBe(true);
    // No unguarded cell may begin with a spreadsheet formula character.
    expect(body).not.toMatch(/,"[=+@]/);
  });

  it("renders Markdown grouped by intent with evidence under every prompt", async () => {
    const { body } = await exportPromptSet(tenant.brandCtx, promptSetId, "md", 1);
    expect(body).toMatch(/^# /);
    expect(body).toContain("## Provenance");
    expect(body).toContain("Why it was included:");
    expect(body).toContain("Held locally, not sent to Profound");
    expect(body).toMatch(/Evidence \(\d+\)/);
  });

  it("exports the approved version unchanged after a later version is rejected", async () => {
    const { body } = await exportPromptSet(tenant.brandCtx, promptSetId, "json", 1);
    const parsed = JSON.parse(body) as { version: { status: string; version: number } };
    expect(parsed.version.status).toBe("approved");
    expect(parsed.version.version).toBe(1);
  });
});

describe("tenant isolation", () => {
  it("hides another tenant's prompt sets", async () => {
    expect(await listPromptSets(otherTenant.brandCtx)).toEqual([]);
    await expect(getPromptSetDetail(otherTenant.brandCtx, promptSetId)).rejects.toThrow();
  });

  it("refuses another tenant's export", async () => {
    await expect(exportPromptSet(otherTenant.brandCtx, promptSetId, "json")).rejects.toThrow();
  });
});

describe("source deletion", () => {
  it("marks a prompt's citation unavailable without deleting the approved version", async () => {
    const [source] = await db
      .select({ id: evidenceRecords.dataSourceId })
      .from(evidenceRecords)
      .innerJoin(promptEvidence, eq(promptEvidence.evidenceId, evidenceRecords.id))
      .innerJoin(prompts, eq(prompts.id, promptEvidence.promptId))
      .where(eq(prompts.promptSetVersionId, v1Id))
      .limit(1);
    if (!source) throw new Error("Fixture has no cited source to delete");

    await deleteSource(tenant.brandCtx, source.id);

    const detail = await getPromptSetDetail(tenant.brandCtx, promptSetId, 1);
    expect(detail.version.status).toBe("approved");

    const unavailable = detail.personaPrompts
      .flatMap((prompt) => prompt.evidence)
      .filter((link) => link.unavailable || link.availability !== "available");
    expect(unavailable.length).toBeGreaterThan(0);

    // The approved version still exists, with its prompts and pairs intact.
    const [pairCount] = await db
      .select({ id: promptPairs.id })
      .from(promptPairs)
      .where(eq(promptPairs.promptSetVersionId, v1Id))
      .limit(1);
    expect(pairCount).toBeDefined();

    const [versionRow] = await db
      .select({ status: promptSetVersions.status })
      .from(promptSetVersions)
      .where(eq(promptSetVersions.id, v1Id));
    expect(versionRow?.status).toBe("approved");

    const [setRow] = await db.select().from(promptSets).where(eq(promptSets.id, promptSetId));
    expect(setRow?.approvedVersionId).toBe(v1Id);
  });
});
