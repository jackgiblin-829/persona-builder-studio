import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveSparktoroAdapter, normalizeSection } from "@/adapters/sparktoro/live";
import { MockSparktoroAdapter } from "@/adapters/sparktoro/mock";
import { SPARKTORO_MAX_REPORT_COST, SPARKTORO_SECTIONS } from "@/adapters/sparktoro/types";

afterEach(() => vi.unstubAllGlobals());

describe("SparkToro full report contract", () => {
  it("preflights the documented maximum and normalizes all mock sections", async () => {
    expect(SPARKTORO_MAX_REPORT_COST).toBe(41);
    const adapter = new MockSparktoroAdapter();
    expect((await adapter.getCreditBalance()).data.creditsRemaining).toBeGreaterThan(41);
    const report = await adapter.createAudienceReport({
      description: "enterprise evaluators",
      location: "us",
    });
    for (const section of SPARKTORO_SECTIONS) {
      const result = await adapter.getSection({ reportId: report.data.reportId, section });
      expect(result.data.status).toBe("ready");
      expect(Object.keys(result.data.normalized).length).toBeGreaterThan(0);
    }
  });

  it("polls a 202 warm section using Retry-After", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: true, status: 202, message: "preparing" }), {
          status: 202,
          headers: { "Retry-After": "0" },
        }),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            data: [{ name: "r/operations", affinity: 42 }],
            meta: { credits_charged: 2 },
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new LiveSparktoroAdapter("key", { baseUrl: "https://example.test" });
    const result = await adapter.getSection({ reportId: "report", section: "reddit" });
    expect(result.attempts).toBe(2);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries 429 and exposes 402 as non-retryable credit exhaustion", async () => {
    const rateLimited = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 429, headers: { "Retry-After": "0" } }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            credits_remaining: 100,
            credits_expires_at: null,
            is_trial: false,
            low_balance: true,
            rate_limit_per_min: 60,
          }),
          { status: 200 },
        ),
      );
    vi.stubGlobal("fetch", rateLimited);
    const adapter = new LiveSparktoroAdapter("key", { baseUrl: "https://example.test" });
    expect((await adapter.getCreditBalance()).data.creditsRemaining).toBe(100);

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ credits_required: 5, credits_remaining: 0 }), {
          status: 402,
        }),
      ),
    );
    await expect(
      adapter.getSection({ reportId: "report", section: "keywords" }),
    ).rejects.toMatchObject({ code: "vendor_credit_exhausted", retryable: false });
  });

  it("normalizes demographic and generic live response shapes", () => {
    expect(normalizeSection("demographics", { age: [{ name: "35-44", value: 30 }] })).toEqual({
      distributions: { age: [{ name: "35-44", value: 30 }] },
    });
    expect(normalizeSection("websites", [{ domain: "example.com" }])).toEqual({
      items: [{ domain: "example.com" }],
    });
  });
});
