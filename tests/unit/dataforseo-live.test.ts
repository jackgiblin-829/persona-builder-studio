import { afterEach, describe, expect, it, vi } from "vitest";
import { LiveDataForSeoAdapter } from "@/adapters/dataforseo/live";
import { VendorError, VendorNotConfiguredError } from "@/lib/errors";

/**
 * Live DataForSEO adapter, exercised with a mocked `fetch` (same approach the
 * project uses nowhere else yet, since Profound and OpenAI's live adapters
 * have no dedicated HTTP-mock test — this fills that gap for a `@unverified`
 * adapter where the failure paths matter at least as much as the happy one).
 *
 * Covers: never-falls-back-to-mock-on-failure (ADR-009) via typed
 * `VendorError`s, transport-level retry/backoff on 429/5xx, the
 * task-post/task-get poll loop (including the retryable `vendor_timeout` a
 * task that never becomes ready produces), and the keyword-batch concurrency
 * limit.
 */

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), { status, headers });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("LiveDataForSeoAdapter construction", () => {
  it("throws VendorNotConfiguredError when login is missing", () => {
    expect(() => new LiveDataForSeoAdapter("", "password")).toThrow(VendorNotConfiguredError);
  });

  it("throws VendorNotConfiguredError when password is missing", () => {
    expect(() => new LiveDataForSeoAdapter("login", "")).toThrow(VendorNotConfiguredError);
  });

  it("sends HTTP Basic auth built from login and password", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        status_code: 20000,
        tasks: [{ id: "t1", status_code: 20000, cost: 0, result: [{ items: [] }] }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new LiveDataForSeoAdapter("my-login", "my-password");
    await adapter.getDomainCompetitors({ target: "northwind-analytics.example" });

    const [, init] = fetchMock.mock.calls[0] as [
      string,
      RequestInit & { headers: Record<string, string> },
    ];
    expect(init.headers.Authorization).toBe(
      `Basic ${Buffer.from("my-login:my-password", "utf8").toString("base64")}`,
    );
  });
});

describe("LiveDataForSeoAdapter — live (immediate) endpoints", () => {
  it("parses a successful response, unwraps items, and converts cost to cents", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        status_code: 20000,
        cost: 0.15,
        tasks: [
          {
            id: "t1",
            status_code: 20000,
            cost: 0.15,
            result: [{ items: [{ domain: "rivergate-metrics.example", intersections: 12 }] }],
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new LiveDataForSeoAdapter("login", "password");
    const result = await adapter.getDomainCompetitors({ target: "northwind-analytics.example" });

    expect(result.dataOrigin).toBe("live");
    expect(result.vendorTaskId).toBeNull();
    expect(result.costCents).toBe(15);
    expect(result.itemCount).toBe(1);
    expect(result.data.competitors).toEqual([
      {
        domain: "rivergate-metrics.example",
        commonKeywords: 12,
        competitorRelevance: null,
        avgPosition: null,
        estimatedTraffic: null,
      },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0] as [string];
    expect(url).toContain("/v3/dataforseo_labs/google/competitors_domain/live");
  });

  it("throws a non-retryable VendorError when the response fails schema validation", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(200, { unexpected: "shape" })));
    const adapter = new LiveDataForSeoAdapter("login", "password");

    await expect(adapter.getDomainCompetitors({ target: "x.example" })).rejects.toMatchObject({
      retryable: false,
    });
  });

  it("throws a non-retryable VendorError on a 4xx response, with no retry", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(400, { status_message: "Invalid target." }));
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new LiveDataForSeoAdapter("login", "password");

    await expect(adapter.getDomainCompetitors({ target: "x.example" })).rejects.toMatchObject({
      httpStatus: 400,
      retryable: false,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("throws a VendorError when the vendor reports a genuine task failure status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          status_code: 20000,
          tasks: [{ id: "t1", status_code: 40400, status_message: "Not Found.", result: null }],
        }),
      ),
    );
    const adapter = new LiveDataForSeoAdapter("login", "password");

    await expect(adapter.getDomainCompetitors({ target: "x.example" })).rejects.toBeInstanceOf(
      VendorError,
    );
  });

  it("retries a 429 with backoff and succeeds once the vendor recovers", async () => {
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(429, {}))
      .mockResolvedValueOnce(jsonResponse(429, {}))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          status_code: 20000,
          tasks: [{ id: "t1", status_code: 20000, cost: 0, result: [{ items: [] }] }],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new LiveDataForSeoAdapter("login", "password");

    const promise = adapter.getDomainCompetitors({ target: "x.example" });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.data.competitors).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("gives up after exhausting retries on a persistent 429 and throws vendor_rate_limited", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(429, {}));
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new LiveDataForSeoAdapter("login", "password");

    const settled = adapter.getDomainCompetitors({ target: "x.example" }).catch((error) => error);
    await vi.runAllTimersAsync();
    const error = await settled;

    expect(error).toBeInstanceOf(VendorError);
    expect((error as VendorError).code).toBe("vendor_rate_limited");
    expect((error as VendorError).retryable).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("splits a large keyword list into concurrency-limited batches", async () => {
    const keywords = Array.from({ length: 250 }, (_, i) => `keyword ${i}`);
    const fetchMock = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      const payload = JSON.parse(init.body as string) as [{ keywords: string[] }];
      const batchKeywords = payload[0].keywords;
      return jsonResponse(200, {
        status_code: 20000,
        tasks: [
          {
            id: "t",
            status_code: 20000,
            cost: 0.01,
            result: batchKeywords.map((keyword) => ({ keyword })),
          },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new LiveDataForSeoAdapter("login", "password");

    const result = await adapter.getKeywordMetrics({ keywords });

    // 250 keywords at a 200-per-batch cap is exactly two requests.
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.data.metrics).toHaveLength(250);
    expect(result.costCents).toBe(2);
  });
});

describe("LiveDataForSeoAdapter — task-post/task-get endpoints", () => {
  it("returns immediately when task_post embeds the result inline (no polling)", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse(200, {
        status_code: 20000,
        tasks: [
          {
            id: "serp-task-1",
            status_code: 20000,
            cost: 0.003,
            result: [{ rank_absolute: 1, type: "organic", domain: "rivergate-metrics.example" }],
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new LiveDataForSeoAdapter("login", "password");

    const result = await adapter.getOrganicSerp({ keyword: "product analytics platform" });

    expect(result.vendorTaskId).toBe("serp-task-1");
    expect(result.data.items).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("polls task_get with backoff until the task reports ready", async () => {
    vi.useFakeTimers();
    const taskId = "serp-task-2";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, {
          status_code: 20000,
          tasks: [{ id: taskId, status_code: 20000, cost: 0.02, result: null }],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          status_code: 20000,
          tasks: [{ id: taskId, status_code: 20100, cost: 0, result: null }],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          status_code: 20000,
          tasks: [
            {
              id: taskId,
              status_code: 20000,
              cost: 0.03,
              result: [{ rank_absolute: 1, type: "organic" }],
            },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new LiveDataForSeoAdapter("login", "password");

    const promise = adapter.getOrganicSerp({ keyword: "product analytics platform" });
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result.vendorTaskId).toBe(taskId);
    expect(result.data.items).toHaveLength(1);
    // Cost is converted to cents per response and summed, not summed in
    // dollars and converted once — so this is 2 + 0 + 3, not round(0.05*100).
    expect(result.costCents).toBe(5);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("throws a retryable vendor_timeout when a task never becomes ready", async () => {
    vi.useFakeTimers();
    const taskId = "serp-task-3";
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse(200, {
          status_code: 20000,
          tasks: [{ id: taskId, status_code: 20000, result: null }],
        }),
      )
      .mockImplementation(() =>
        Promise.resolve(
          jsonResponse(200, {
            status_code: 20000,
            tasks: [{ id: taskId, status_code: 20100, result: null }],
          }),
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new LiveDataForSeoAdapter("login", "password");

    const settled = adapter
      .getOrganicSerp({ keyword: "product analytics platform" })
      .catch((error) => error);
    await vi.runAllTimersAsync();
    const error = await settled;

    expect(error).toBeInstanceOf(VendorError);
    expect((error as VendorError).code).toBe("vendor_timeout");
    expect((error as VendorError).retryable).toBe(true);
    // 1 task_post + 10 poll attempts (MAX_POLL_ATTEMPTS).
    expect(fetchMock).toHaveBeenCalledTimes(11);
  });

  it("throws when the vendor rejects the task outright (e.g. an invalid field)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(200, {
          status_code: 20000,
          tasks: [
            {
              id: "t",
              status_code: 40501,
              status_message: "Invalid Field: keyword.",
              result: null,
            },
          ],
        }),
      ),
    );
    const adapter = new LiveDataForSeoAdapter("login", "password");

    await expect(adapter.getReviews({ query: "Northwind Analytics" })).rejects.toBeInstanceOf(
      VendorError,
    );
  });
});
