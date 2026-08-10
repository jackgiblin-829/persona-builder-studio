import { describe, expect, it } from "vitest";
import { MockSparktoroAdapter } from "@/adapters/sparktoro/mock";
import { SPARKTORO_SECTIONS } from "@/adapters/sparktoro/types";

/**
 * The mock SparkToro adapter (ADR-009: mock is explicit, deterministic
 * state). `createAudienceReport` derives the report id from the description
 * hash, so `getSection` must recover consistent rows from that id alone,
 * without ever seeing the description again — the same contract the live
 * adapter has with the vendor's own persisted report.
 */

const DESCRIPTION = "product managers at B2B SaaS companies";

describe("MockSparktoroAdapter determinism", () => {
  it("derives the same report id for the same description", async () => {
    const a = await new MockSparktoroAdapter().createAudienceReport({ description: DESCRIPTION });
    const b = await new MockSparktoroAdapter().createAudienceReport({ description: DESCRIPTION });
    expect(a.data.reportId).toBe(b.data.reportId);
    expect(a.data.status).toBe("ready");
  });

  it("derives a different report id for a different description", async () => {
    const a = await new MockSparktoroAdapter().createAudienceReport({ description: DESCRIPTION });
    const b = await new MockSparktoroAdapter().createAudienceReport({
      description: "enterprise IT buyers",
    });
    expect(a.data.reportId).not.toBe(b.data.reportId);
  });

  it("returns identical section rows across separate instances for the same reportId", async () => {
    const { data: report } = await new MockSparktoroAdapter().createAudienceReport({
      description: DESCRIPTION,
    });
    const a = await new MockSparktoroAdapter().getSection({
      reportId: report.reportId,
      section: "podcasts",
    });
    const b = await new MockSparktoroAdapter().getSection({
      reportId: report.reportId,
      section: "podcasts",
    });
    expect(a.data).toEqual(b.data);
    expect(a.data.status).toBe("ready");
    expect(a.data.rows.length).toBeGreaterThan(0);
  });

  it("returns audience_size as a single estimate, not affinity rows", async () => {
    const { data: report } = await new MockSparktoroAdapter().createAudienceReport({
      description: DESCRIPTION,
    });
    const result = await new MockSparktoroAdapter().getSection({
      reportId: report.reportId,
      section: "audience_size",
    });
    expect(result.data.rows).toEqual([]);
    expect(result.data.audienceSize?.estimatedSize).toBeGreaterThan(0);
    expect(["low", "medium", "high"]).toContain(result.data.audienceSize?.confidence);
  });

  it("returns plausible rows for every section", async () => {
    const { data: report } = await new MockSparktoroAdapter().createAudienceReport({
      description: DESCRIPTION,
    });
    const adapter = new MockSparktoroAdapter();
    for (const section of SPARKTORO_SECTIONS) {
      const result = await adapter.getSection({ reportId: report.reportId, section });
      expect(result.data.status).toBe("ready");
      if (section === "audience_size") {
        expect(result.data.audienceSize).not.toBeNull();
      } else {
        expect(result.data.rows.length).toBeGreaterThan(0);
        for (const row of result.data.rows) {
          if (section === "demographics") {
            expect((row as { value: number }).value).toBeGreaterThan(0);
          } else if (section === "websites") {
            expect((row as { affinity: number }).affinity).toBeGreaterThanOrEqual(1);
          } else {
            expect((row as { affinityScore: number }).affinityScore).toBeGreaterThanOrEqual(1);
          }
        }
      }
    }
  });
});
