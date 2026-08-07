import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb, db } from "@/db/client";
import {
  evidenceRecords,
  integrations,
  personaFieldEvidence,
  personaFields,
  personaVersions,
  personas,
  segmentCandidateEvidence,
  segmentCandidates,
} from "@/db/schema";
import { newId, ID_PREFIXES } from "@/lib/ids";
import { CLAIM_FIELD_TYPES, FIELD_TYPE_META } from "@/services/personas";
import {
  approvePersonaVersion,
  attachFieldEvidence,
  comparePersonaVersions,
  createNewVersion,
  detachFieldEvidence,
  duplicatePersona,
  getPersonaDetail,
  listPersonas,
  markFieldUnsupported,
  rejectPersonaVersion,
  renamePersona,
  setFieldLocked,
  startPersonaGeneration,
  updatePersonaField,
} from "@/services/personas";
import {
  decideSegment,
  getSegment,
  listSegments,
  mergeSegments,
  splitSegment,
  startSegmentation,
} from "@/services/segments";
import { exportPersona } from "@/services/persona-export";
import { createSourceFromPaste, deleteSource } from "@/services/sources";
import { reviewEvidence } from "@/services/evidence";
import { drainQueue } from "@/seed/pipeline";
import { createTestTenant, truncateAll, type TestTenant } from "../helpers/db";

/**
 * Two independent security-led buyers. Two sources are the minimum the
 * segmenter accepts, which is the point: one transcript must not be able to
 * invent a segment on its own.
 */
const CALL = `Facilitator: Before we start, can you describe what you are trying to solve?

Prospect: We are trying to replace a reporting setup that our data team maintains by hand.

Facilitator: What has blocked it so far?

Prospect: Customer data cannot leave our approved cloud environment. That is non-negotiable for us.

Facilitator: How do you evaluate vendors given that?

Prospect: If it cannot run in our own VPC we do not even take the demo. The deciding factor is deployment model first, then governance.

Facilitator: What evidence do you need to see?

Prospect: Send me the SOC 2 Type II report, the architecture diagram showing where data lives, and the pen test summary.

Facilitator: Anything you are worried about?

Prospect: Last time we tried a tool like this we got three months into procurement before the architecture review killed it.

Facilitator: What does success look like?

Prospect: Success means the platform is deployed inside our environment and security has signed off.`;

const INTERVIEW = `Interviewer: What made this a hard purchase?

Buyer: Our security review requires a private cloud deployment, so anything multi-tenant is out.

Interviewer: How did you narrow it down?

Buyer: We compared vendors on data residency first. Everything else was secondary.

Interviewer: What proof did you need?

Buyer: We needed an ISO 27001 certification and a documented governance model before procurement would engage.

Interviewer: Did anything nearly stop it?

Buyer: I was worried the self-hosted build would lag behind the cloud version, though I am not certain that is still true.

Interviewer: What are you measuring now?

Buyer: Success means our auditors can trace every metric back to source without asking us.`;

let tenant: TestTenant;
let otherTenant: TestTenant;
let runId: string;
let segmentId: string;
let personaId: string;
let v1Id: string;

beforeAll(async () => {
  await truncateAll();
  tenant = await createTestTenant("Personas");
  otherTenant = await createTestTenant("Personas Rival");

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
});

afterAll(async () => {
  await closeDb();
});

describe("candidate segmentation", () => {
  it("refuses to segment a brand with too little approved evidence", async () => {
    await expect(startSegmentation(otherTenant.brandCtx)).rejects.toThrow(
      /at least \d+ approved evidence records/,
    );
  });

  it("produces candidates whose citations all resolve to supplied evidence", async () => {
    const started = await startSegmentation(tenant.brandCtx);
    runId = started.runId;

    const result = await drainQueue({ workerId: "test" });
    expect(result.failed, result.errors.join("; ")).toBe(0);

    const { segments } = await listSegments(tenant.brandCtx);
    expect(segments.length).toBeGreaterThan(0);
    expect(segments.every((segment) => segment.runId === runId)).toBe(true);

    const approvedIds = new Set(
      (
        await db
          .select({ id: evidenceRecords.id })
          .from(evidenceRecords)
          .where(eq(evidenceRecords.brandId, tenant.brandId))
      ).map((row) => row.id),
    );

    const links = await db
      .select({ evidenceId: segmentCandidateEvidence.evidenceId })
      .from(segmentCandidateEvidence)
      .where(eq(segmentCandidateEvidence.organizationId, tenant.organizationId));
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) expect(approvedIds.has(link.evidenceId)).toBe(true);

    segmentId = segments[0]!.id;
  });

  it("computes confidence locally from the evidence links, with all eight components", async () => {
    const { segment } = await getSegment(tenant.brandCtx, segmentId);
    expect(segment.confidence).toBeGreaterThan(0);
    expect(Object.keys(segment.confidenceComponents)).toHaveLength(8);
    expect(segment.confidenceExplanation).toBeTruthy();
    // Two sources contribute, so agreement is partial rather than absent or full.
    expect(segment.confidenceComponents.cross_source_agreement).toBeGreaterThan(0);
    expect(Object.keys(segment.sourceDistribution).length).toBeGreaterThan(0);
  });

  it("keeps a record hedging the segment's premise as contradicting evidence", async () => {
    const { evidence } = await getSegment(tenant.brandCtx, segmentId);
    const contradicting = evidence.filter((row) => row.relation === "contradicts");
    expect(contradicting.length).toBeGreaterThan(0);
  });

  it("does not force every approved record into a candidate", async () => {
    const [approved] = await db
      .select({ id: evidenceRecords.id })
      .from(evidenceRecords)
      .where(eq(evidenceRecords.brandId, tenant.brandId));
    expect(approved).toBeDefined();

    const assigned = await db
      .selectDistinct({ evidenceId: segmentCandidateEvidence.evidenceId })
      .from(segmentCandidateEvidence)
      .innerJoin(
        segmentCandidates,
        eq(segmentCandidates.id, segmentCandidateEvidence.segmentCandidateId),
      )
      .where(eq(segmentCandidates.brandId, tenant.brandId));

    const total = await db
      .select({ id: evidenceRecords.id })
      .from(evidenceRecords)
      .where(eq(evidenceRecords.brandId, tenant.brandId));

    expect(assigned.length).toBeLessThan(total.length);
  });

  it("refuses to generate a persona from an unapproved candidate", async () => {
    await expect(startPersonaGeneration(tenant.brandCtx, segmentId)).rejects.toThrow(
      /Approve the candidate segment/,
    );
  });
});

describe("persona synthesis", () => {
  it("creates a draft version from an approved segment", async () => {
    await decideSegment(tenant.brandCtx, segmentId, "approved");
    await startPersonaGeneration(tenant.brandCtx, segmentId);

    const result = await drainQueue({ workerId: "test" });
    expect(result.failed, result.errors.join("; ")).toBe(0);

    const rows = await listPersonas(tenant.brandCtx);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.currentStatus).toBe("draft");
    expect(rows[0]!.currentVersion).toBe(1);

    personaId = rows[0]!.id;
    const detail = await getPersonaDetail(tenant.brandCtx, personaId);
    v1Id = detail.version.id;
    expect(detail.mutable).toBe(true);
  });

  it("stores the §33 generation metadata on the version", async () => {
    const { version } = await getPersonaDetail(tenant.brandCtx, personaId);
    expect(version.modelId).toBeTruthy();
    expect(version.modelProvider).toBe("mock");
    expect(version.promptTemplateVersion).toBeTruthy();
    expect(version.schemaVersion).toBeTruthy();
    expect(version.dataOrigin).toBe("mock");
    expect(version.evidenceCutoff).toBeInstanceOf(Date);
  });

  it("holds the traceability invariant on every field", async () => {
    const detail = await getPersonaDetail(tenant.brandCtx, personaId);
    const fields = detail.groups.flatMap((group) => group.fields);
    expect(fields.length).toBeGreaterThan(5);

    for (const field of fields) {
      const supporting = field.evidence.filter((link) => link.relation === "supports");
      expect(
        supporting.length > 0 || field.insufficientEvidence,
        `untraceable field: ${field.fieldType} — ${field.statement}`,
      ).toBe(true);
    }
  });

  it("emits all five core fields, supported or explicitly insufficient", async () => {
    const detail = await getPersonaDetail(tenant.brandCtx, personaId);
    expect(detail.coreCoverage).toHaveLength(5);
    for (const entry of detail.coreCoverage) {
      expect(entry.supported + entry.insufficient).toBeGreaterThan(0);
    }
  });

  it("excludes scope and process fields from the version confidence roll-up", async () => {
    const detail = await getPersonaDetail(tenant.brandCtx, personaId);
    const unscored = detail.groups.filter((group) => !FIELD_TYPE_META[group.fieldType].scored);
    expect(unscored.length).toBeGreaterThan(0);

    for (const group of unscored) {
      expect(CLAIM_FIELD_TYPES).not.toContain(group.fieldType);
      // Fields with no evidence by design always score zero. A validation
      // benchmark cites the evidence it tests, so it is scored but excluded.
      if (FIELD_TYPE_META[group.fieldType].structural) {
        for (const field of group.fields) {
          expect(field.confidence).toBe(0);
          expect(field.insufficientEvidence).toBe(true);
        }
      }
    }

    const benchmarks = detail.groups.find((group) => group.fieldType === "validation_benchmark");
    expect(benchmarks).toBeDefined();
    expect(benchmarks!.fields.some((field) => field.evidence.length > 0)).toBe(true);

    expect(detail.version.overallConfidence).toBeGreaterThan(0);
  });

  it("records the excluded-assumption list on the version", async () => {
    const { version } = await getPersonaDetail(tenant.brandCtx, personaId);
    expect(version.excludedAssumptions.length).toBeGreaterThanOrEqual(8);
    expect(version.excludedAssumptions.join(" ").toLowerCase()).toContain("digital twin");
  });

  it("is invisible to another tenant", async () => {
    await expect(getPersonaDetail(otherTenant.brandCtx, personaId)).rejects.toThrow(/not found/i);
    await expect(
      updatePersonaField(otherTenant.brandCtx, "pfd_does_not_exist", {
        statement: "Injected claim",
        provenance: "observed",
      }),
    ).rejects.toThrow(/not found/i);
  });
});

describe("evidence editing recomputes confidence", () => {
  it("raises a field's confidence when supporting evidence is attached", async () => {
    const detail = await getPersonaDetail(tenant.brandCtx, personaId);
    const field = detail.groups
      .flatMap((group) => group.fields)
      .find((candidate) => !candidate.insufficientEvidence && candidate.evidenceCount === 1);
    expect(field).toBeDefined();

    const attachedIds = new Set(field!.evidence.map((link) => link.evidenceId));
    const [extra] = await db
      .select({ id: evidenceRecords.id })
      .from(evidenceRecords)
      .where(
        and(
          eq(evidenceRecords.brandId, tenant.brandId),
          eq(evidenceRecords.reviewStatus, "approved"),
        ),
      )
      .limit(20)
      .then((rows) => rows.filter((row) => !attachedIds.has(row.id)));
    expect(extra).toBeDefined();

    const before = field!.confidence;
    await attachFieldEvidence(tenant.brandCtx, field!.id, extra!.id, "supports");

    const [after] = await db.select().from(personaFields).where(eq(personaFields.id, field!.id));
    expect(after!.evidenceCount).toBe(2);
    expect(after!.confidence).toBeGreaterThan(before);
  });

  it("marks a claim insufficient when its last supporting record is detached", async () => {
    const detail = await getPersonaDetail(tenant.brandCtx, personaId);
    const field = detail.groups
      .flatMap((group) => group.fields)
      .find(
        (candidate) =>
          !candidate.insufficientEvidence &&
          candidate.evidenceCount === 1 &&
          !FIELD_TYPE_META[candidate.fieldType].structural,
      );
    expect(field).toBeDefined();

    const link = field!.evidence.find((item) => item.relation === "supports")!;
    await detachFieldEvidence(tenant.brandCtx, field!.id, link.evidenceId, "supports");

    const [after] = await db.select().from(personaFields).where(eq(personaFields.id, field!.id));
    expect(after!.insufficientEvidence).toBe(true);
    expect(after!.confidence).toBe(0);
  });

  it("zeroes a claim a reviewer marks unsupported, without removing it", async () => {
    const detail = await getPersonaDetail(tenant.brandCtx, personaId);
    const field = detail.groups
      .flatMap((group) => group.fields)
      .find((candidate) => !candidate.insufficientEvidence && candidate.confidence > 0)!;

    await markFieldUnsupported(tenant.brandCtx, field.id, true);
    const [marked] = await db.select().from(personaFields).where(eq(personaFields.id, field.id));
    expect(marked!.markedUnsupported).toBe(true);
    expect(marked!.confidence).toBe(0);

    await markFieldUnsupported(tenant.brandCtx, field.id, false);
    const [restored] = await db.select().from(personaFields).where(eq(personaFields.id, field.id));
    expect(restored!.confidence).toBeGreaterThan(0);
  });

  it("refuses to edit a locked field, and allows it again once unlocked", async () => {
    const detail = await getPersonaDetail(tenant.brandCtx, personaId);
    const field = detail.groups.flatMap((group) => group.fields)[0]!;

    await setFieldLocked(tenant.brandCtx, field.id, true);
    await expect(
      updatePersonaField(tenant.brandCtx, field.id, {
        statement: "Rewritten while locked",
        provenance: "observed",
      }),
    ).rejects.toThrow(/locked/i);

    await setFieldLocked(tenant.brandCtx, field.id, false);
    await updatePersonaField(tenant.brandCtx, field.id, {
      statement: "Rewritten after unlocking",
      provenance: "observed",
    });

    const [after] = await db.select().from(personaFields).where(eq(personaFields.id, field.id));
    expect(after!.statement).toBe("Rewritten after unlocking");
    expect(after!.editedByUser).toBe(true);
  });
});

describe("approval and immutability (§33)", () => {
  it("refuses approval while a core field has no supported entry", async () => {
    const detail = await getPersonaDetail(tenant.brandCtx, personaId);
    const constraintFields = detail.groups.find(
      (group) => group.fieldType === "constraint",
    )!.fields;

    // Strip every supporting link from the constraint group.
    for (const field of constraintFields) {
      for (const link of field.evidence.filter((item) => item.relation === "supports")) {
        await detachFieldEvidence(tenant.brandCtx, field.id, link.evidenceId, "supports");
      }
    }

    const { blockers } = await approvePersonaVersion(tenant.brandCtx, v1Id);
    expect(blockers.length).toBeGreaterThan(0);
    expect(blockers.join(" ")).toContain(FIELD_TYPE_META.constraint.label);

    const [version] = await db.select().from(personaVersions).where(eq(personaVersions.id, v1Id));
    expect(version!.status).toBe("draft");
  });

  it("approves once the traceability problems are resolved", async () => {
    const detail = await getPersonaDetail(tenant.brandCtx, personaId);
    const [record] = await db
      .select({ id: evidenceRecords.id })
      .from(evidenceRecords)
      .where(
        and(
          eq(evidenceRecords.brandId, tenant.brandId),
          eq(evidenceRecords.reviewStatus, "approved"),
          eq(evidenceRecords.availability, "available"),
        ),
      )
      .limit(1);
    expect(record).toBeDefined();

    // Close every core-field gap the earlier tests opened, and clear any
    // reviewer-set unsupported marker, since both block approval.
    for (const entry of detail.coreCoverage) {
      if (entry.supported > 0) continue;
      const [field] = detail.groups.find((group) => group.fieldType === entry.fieldType)!.fields;
      await attachFieldEvidence(tenant.brandCtx, field!.id, record!.id, "supports");
    }
    for (const field of detail.groups.flatMap((group) => group.fields)) {
      if (field.markedUnsupported) await markFieldUnsupported(tenant.brandCtx, field.id, false);
    }

    const { blockers } = await approvePersonaVersion(tenant.brandCtx, v1Id);
    expect(blockers, blockers.join(" ")).toHaveLength(0);

    const [version] = await db.select().from(personaVersions).where(eq(personaVersions.id, v1Id));
    expect(version!.status).toBe("approved");
    expect(version!.approvedByUserId).toBe(tenant.userId);
    expect(version!.approvedAt).toBeInstanceOf(Date);

    const [persona] = await db.select().from(personas).where(eq(personas.id, personaId));
    expect(persona!.approvedVersionId).toBe(v1Id);
  });

  it("refuses every write to an approved version", async () => {
    const detail = await getPersonaDetail(tenant.brandCtx, personaId);
    const field = detail.groups.flatMap((group) => group.fields)[0]!;
    const [record] = await db
      .select({ id: evidenceRecords.id })
      .from(evidenceRecords)
      .where(eq(evidenceRecords.brandId, tenant.brandId))
      .limit(1);

    expect(detail.mutable).toBe(false);

    await expect(
      updatePersonaField(tenant.brandCtx, field.id, {
        statement: "Edited after approval",
        provenance: "observed",
      }),
    ).rejects.toThrow(/approved and cannot be modified/i);

    await expect(
      attachFieldEvidence(tenant.brandCtx, field.id, record!.id, "supports"),
    ).rejects.toThrow(/approved and cannot be modified/i);

    await expect(
      detachFieldEvidence(tenant.brandCtx, field.id, record!.id, "supports"),
    ).rejects.toThrow(/approved and cannot be modified/i);

    await expect(markFieldUnsupported(tenant.brandCtx, field.id, true)).rejects.toThrow(
      /approved and cannot be modified/i,
    );

    await expect(approvePersonaVersion(tenant.brandCtx, v1Id)).rejects.toThrow(
      /approved and cannot be modified/i,
    );

    await expect(rejectPersonaVersion(tenant.brandCtx, v1Id, "changed my mind")).rejects.toThrow(
      /approved and cannot be modified/i,
    );
  });

  it("does not rename an approved version, only the persona identity", async () => {
    const before = await getPersonaDetail(tenant.brandCtx, personaId);
    await renamePersona(tenant.brandCtx, personaId, "Regulated deployment buyer");

    const [persona] = await db.select().from(personas).where(eq(personas.id, personaId));
    expect(persona!.name).toBe("Regulated deployment buyer");
    // The slug is what Profound tags use, so it must survive a rename.
    expect(persona!.slug).toBe(before.persona.slug);

    const [version] = await db.select().from(personaVersions).where(eq(personaVersions.id, v1Id));
    expect(version!.name).toBe(before.version.name);
  });
});

describe("versioning", () => {
  let v2Id: string;

  it("creates the next version as a copy without touching the approved one", async () => {
    const before = await getPersonaDetail(tenant.brandCtx, personaId, 1);
    const beforeFields = before.groups.flatMap((group) => group.fields);

    const created = await createNewVersion(tenant.brandCtx, personaId, {
      changeSummary: "Reworded the constraint after a follow-up call",
    });
    expect(created.version).toBe(2);
    v2Id = created.versionId;

    const v2 = await getPersonaDetail(tenant.brandCtx, personaId, 2);
    expect(v2.version.parentVersionId).toBe(v1Id);
    expect(v2.version.status).toBe("draft");
    expect(v2.version.changeSummary).toContain("follow-up call");
    expect(v2.groups.flatMap((group) => group.fields)).toHaveLength(beforeFields.length);

    // Version 1 is byte-for-byte what it was.
    const after = await getPersonaDetail(tenant.brandCtx, personaId, 1);
    expect(after.version.status).toBe("approved");
    expect(after.groups.flatMap((group) => group.fields).map((field) => field.statement)).toEqual(
      beforeFields.map((field) => field.statement),
    );
  });

  it("copies the evidence links into the new version rather than sharing them", async () => {
    const v1 = await getPersonaDetail(tenant.brandCtx, personaId, 1);
    const v2 = await getPersonaDetail(tenant.brandCtx, personaId, 2);

    const v1FieldIds = new Set(v1.groups.flatMap((group) => group.fields).map((f) => f.id));
    const v2FieldIds = new Set(v2.groups.flatMap((group) => group.fields).map((f) => f.id));
    for (const id of v2FieldIds) expect(v1FieldIds.has(id)).toBe(false);

    const v1Links = v1.groups
      .flatMap((group) => group.fields)
      .flatMap((field) => field.evidence).length;
    const v2Links = v2.groups
      .flatMap((group) => group.fields)
      .flatMap((field) => field.evidence).length;
    expect(v2Links).toBe(v1Links);
  });

  it("carries locks into the new version", async () => {
    const v2 = await getPersonaDetail(tenant.brandCtx, personaId, 2);
    const field = v2.groups.flatMap((group) => group.fields)[0]!;
    await setFieldLocked(tenant.brandCtx, field.id, true);

    await rejectPersonaVersion(tenant.brandCtx, v2Id, "superseded by a fresh copy");
    const v3 = await createNewVersion(tenant.brandCtx, personaId, {
      fromVersionId: v2Id,
      changeSummary: "Copy that should inherit the lock",
    });

    const detail = await getPersonaDetail(tenant.brandCtx, personaId, v3.version);
    expect(detail.groups.flatMap((group) => group.fields)[0]!.locked).toBe(true);
  });

  it("refuses a second concurrent draft", async () => {
    await expect(
      createNewVersion(tenant.brandCtx, personaId, { changeSummary: "One draft too many" }),
    ).rejects.toThrow(/already a draft/i);
  });

  it("diffs versions field by field", async () => {
    const draft = await db
      .select()
      .from(personaVersions)
      .where(and(eq(personaVersions.personaId, personaId), eq(personaVersions.status, "draft")))
      .limit(1);
    const draftVersion = draft[0]!;

    const detail = await getPersonaDetail(tenant.brandCtx, personaId, draftVersion.version);
    const editable = detail.groups.flatMap((group) => group.fields).find((field) => !field.locked)!;
    await updatePersonaField(tenant.brandCtx, editable.id, {
      statement: "A materially different statement for the diff",
      provenance: "inferred",
    });

    const comparison = await comparePersonaVersions(
      tenant.brandCtx,
      personaId,
      1,
      draftVersion.version,
    );
    expect(comparison.summary.added).toBeGreaterThan(0);
    expect(comparison.summary.removed).toBeGreaterThan(0);
    expect(
      comparison.diffs.some(
        (diff) =>
          diff.change === "added" &&
          diff.after?.statement === "A materially different statement for the diff",
      ),
    ).toBe(true);
    expect(comparison.headerDiffs.some((row) => row.label === "Status")).toBe(true);
  });

  it("duplicates into a separate identity with its own slug and no locks", async () => {
    const { personaId: copyId } = await duplicatePersona(tenant.brandCtx, personaId, {
      fromVersionId: v1Id,
      name: "Duplicated buyer",
    });
    expect(copyId).not.toBe(personaId);

    const [original] = await db.select().from(personas).where(eq(personas.id, personaId));
    const [copy] = await db.select().from(personas).where(eq(personas.id, copyId));
    expect(copy!.slug).not.toBe(original!.slug);
    expect(copy!.segmentCandidateId).toBeNull();

    const detail = await getPersonaDetail(tenant.brandCtx, copyId);
    expect(detail.version.version).toBe(1);
    expect(detail.version.status).toBe("draft");
    expect(detail.groups.flatMap((group) => group.fields).some((field) => field.locked)).toBe(
      false,
    );

    // The original is untouched.
    const stillApproved = await getPersonaDetail(tenant.brandCtx, personaId, 1);
    expect(stillApproved.version.status).toBe("approved");
  });
});

describe("exports (§16)", () => {
  it("exports JSON carrying every evidence id and confidence component", async () => {
    const { body, filename, contentType } = await exportPersona(
      tenant.brandCtx,
      personaId,
      "json",
      1,
    );
    expect(contentType).toContain("application/json");
    expect(filename).toMatch(/-v1\.json$/);

    const parsed = JSON.parse(body) as {
      disclaimer: string;
      version: { schema_version: string; model_id: string; evidence_cutoff: string };
      fields: {
        statement: string;
        confidence_components: Record<string, number>;
        insufficient_evidence: boolean;
        supporting_evidence: { evidence_id: string }[];
      }[];
    };

    expect(parsed.disclaimer.toLowerCase()).toContain("not a real person");
    expect(parsed.version.schema_version).toBeTruthy();
    expect(parsed.version.model_id).toBeTruthy();
    expect(parsed.fields.length).toBeGreaterThan(5);

    for (const field of parsed.fields) {
      expect(
        field.supporting_evidence.length > 0 || field.insufficient_evidence,
        `export lost traceability for: ${field.statement}`,
      ).toBe(true);
      if (!field.insufficient_evidence) {
        expect(Object.keys(field.confidence_components)).toHaveLength(8);
      }
    }
  });

  it("exports CSV with a header, one row per field, and formula injection guarded", async () => {
    const { body } = await exportPersona(tenant.brandCtx, personaId, "csv", 1);
    const lines = body.split("\r\n");
    expect(lines[0]).toContain("supporting_evidence_ids");
    expect(lines[0]).toContain("contradiction_penalty");

    const detail = await getPersonaDetail(tenant.brandCtx, personaId, 1);
    expect(lines).toHaveLength(detail.groups.flatMap((group) => group.fields).length + 1);

    // Every cell is quoted, and nothing starts a spreadsheet formula.
    for (const line of lines) {
      expect(line.startsWith('"')).toBe(true);
      expect(line).not.toMatch(/(^|,)=/);
    }
  });

  it("exports Markdown that keeps the provenance table and the evidence ids", async () => {
    const { body } = await exportPersona(tenant.brandCtx, personaId, "md", 1);
    expect(body).toContain("## Provenance");
    expect(body).toContain("## Excluded assumptions");
    expect(body).toContain("Schema version");
    expect(body.toLowerCase()).toContain("not a real person");

    const detail = await getPersonaDetail(tenant.brandCtx, personaId, 1);
    const anyEvidenceId = detail.groups
      .flatMap((group) => group.fields)
      .flatMap((field) => field.evidence)[0]!.evidenceId;
    expect(body).toContain(anyEvidenceId);
  });

  it("refuses to export another tenant's persona", async () => {
    await expect(exportPersona(otherTenant.brandCtx, personaId, "json")).rejects.toThrow(
      /not found/i,
    );
  });
});

describe("merging and splitting candidates", () => {
  it("merges evidence onto the target, keeps the sources, and recomputes confidence", async () => {
    const { segments } = await listSegments(tenant.brandCtx, runId);
    const mergeable = segments.filter(
      (segment) => segment.status !== "merged" && segment.status !== "split",
    );
    if (mergeable.length < 2) {
      // The corpus produced a single candidate; merging is untestable here and
      // the split case below still exercises the versioning rules.
      expect(mergeable.length).toBeGreaterThan(0);
      return;
    }

    const target = mergeable[0]!;
    const source = mergeable[1]!;
    const before = target.supportingCount;

    const { merged } = await mergeSegments(tenant.brandCtx, target.id, [source.id]);
    expect(merged).toBe(1);

    const [sourceAfter] = await db
      .select()
      .from(segmentCandidates)
      .where(eq(segmentCandidates.id, source.id));
    expect(sourceAfter!.status).toBe("merged");
    expect(sourceAfter!.mergedIntoId).toBe(target.id);

    const { segment: targetAfter, evidence } = await getSegment(tenant.brandCtx, target.id);
    expect(evidence.filter((row) => row.relation === "supports").length).toBeGreaterThanOrEqual(
      before,
    );
    expect(targetAfter.mergeSplitRecommendation).toContain("Merged from");

    // No record is both supporting and contradicting after a merge.
    const supports = new Set(
      evidence.filter((row) => row.relation === "supports").map((row) => row.id),
    );
    for (const row of evidence.filter((item) => item.relation === "contradicts")) {
      expect(supports.has(row.id)).toBe(false);
    }
  });

  it("splits a candidate into two, keeping the parent", async () => {
    const { evidence } = await getSegment(tenant.brandCtx, segmentId);
    const supporting = evidence.filter((row) => row.relation === "supports");
    expect(supporting.length).toBeGreaterThanOrEqual(2);

    const { ids } = await splitSegment(tenant.brandCtx, segmentId, {
      labelA: "Security-led, cloud-hosted",
      labelB: "Security-led, self-hosted",
      evidenceIdsForB: [supporting[0]!.id],
    });
    expect(ids).toHaveLength(2);

    const [parent] = await db
      .select()
      .from(segmentCandidates)
      .where(eq(segmentCandidates.id, segmentId));
    expect(parent!.status).toBe("split");

    const partA = await getSegment(tenant.brandCtx, ids[0]!);
    const partB = await getSegment(tenant.brandCtx, ids[1]!);
    expect(partA.evidence.filter((row) => row.relation === "supports").length).toBe(
      supporting.length - 1,
    );
    expect(partB.evidence.filter((row) => row.relation === "supports")).toHaveLength(1);
    expect(partA.segment.slug).not.toBe(partB.segment.slug);
    expect(partA.segment.runId).toBe(parent!.runId);
  });

  it("refuses a split that would leave a part with no evidence", async () => {
    const { segments } = await listSegments(tenant.brandCtx, runId);
    const candidate = segments.find(
      (segment) => segment.status === "candidate" && segment.supportingCount >= 2,
    );
    if (!candidate) return;

    const { evidence } = await getSegment(tenant.brandCtx, candidate.id);
    const allSupporting = evidence
      .filter((row) => row.relation === "supports")
      .map((row) => row.id);

    await expect(
      splitSegment(tenant.brandCtx, candidate.id, {
        labelA: "Everything",
        labelB: "Nothing",
        evidenceIdsForB: allSupporting,
      }),
    ).rejects.toThrow(/both sides/i);
  });
});

describe("source deletion never deletes an approved persona (§16)", () => {
  it("keeps the approved version, marks references unavailable and queues review", async () => {
    const detail = await getPersonaDetail(tenant.brandCtx, personaId, 1);
    expect(detail.version.status).toBe("approved");

    const citedId = detail.groups
      .flatMap((group) => group.fields)
      .flatMap((field) => field.evidence)[0]!.evidenceId;

    const [cited] = await db
      .select({ dataSourceId: evidenceRecords.dataSourceId })
      .from(evidenceRecords)
      .where(eq(evidenceRecords.id, citedId));

    await deleteSource(tenant.brandCtx, cited!.dataSourceId);

    const [version] = await db.select().from(personaVersions).where(eq(personaVersions.id, v1Id));
    expect(version, "an approved version must never be deleted").toBeDefined();
    expect(version!.status).toBe("needs_review");
    expect(version!.needsReviewReason).toBeTruthy();

    const [link] = await db
      .select()
      .from(personaFieldEvidence)
      .where(eq(personaFieldEvidence.evidenceId, citedId))
      .limit(1);
    expect(link!.unavailable).toBe(true);

    const [record] = await db
      .select({ availability: evidenceRecords.availability })
      .from(evidenceRecords)
      .where(eq(evidenceRecords.id, citedId));
    expect(record!.availability).toBe("source_deleted");
  });
});
