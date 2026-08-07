import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, db } from "@/db/client";
import { jobs } from "@/db/schema";
import { PostgresJobQueue, backoffMs, reclaimStaleJobs } from "@/adapters/queue";
import { truncateAll } from "../helpers/db";

const queue = new PostgresJobQueue();

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await closeDb();
});

describe("PostgresJobQueue", () => {
  it("enqueues and claims a job, incrementing attempts", async () => {
    await queue.enqueue("test_job", { hello: "world" });
    const claimed = await queue.claim(["test_job"], "worker-1");

    expect(claimed).not.toBeNull();
    expect(claimed?.status).toBe("running");
    expect(claimed?.attempts).toBe(1);
    expect(claimed?.lockedBy).toBe("worker-1");
    expect(claimed?.payload).toEqual({ hello: "world" });
  });

  it("never hands the same job to two workers", async () => {
    await queue.enqueue("test_job", {});
    const first = await queue.claim(["test_job"], "worker-1");
    const second = await queue.claim(["test_job"], "worker-2");

    expect(first).not.toBeNull();
    expect(second).toBeNull();
  });

  it("ignores job types the worker did not register", async () => {
    await queue.enqueue("unknown_type", {});
    expect(await queue.claim(["test_job"], "worker-1")).toBeNull();
  });

  it("does not claim a job scheduled for the future", async () => {
    await queue.enqueue("test_job", {}, { runAfter: new Date(Date.now() + 60_000) });
    expect(await queue.claim(["test_job"], "worker-1")).toBeNull();
  });

  it("treats an idempotency key as a no-op on re-enqueue", async () => {
    const first = await queue.enqueue("test_job", { n: 1 }, { idempotencyKey: "same-key" });
    const second = await queue.enqueue("test_job", { n: 2 }, { idempotencyKey: "same-key" });

    expect(second.id).toBe(first.id);
    expect(second.payload).toEqual({ n: 1 });
    const all = await db.select().from(jobs).where(eq(jobs.type, "test_job"));
    expect(all).toHaveLength(1);
  });

  it("retries a retryable failure with backoff, then gives up at max attempts", async () => {
    const job = await queue.enqueue("test_job", {}, { maxAttempts: 2 });

    await queue.claim(["test_job"], "w");
    await queue.fail(job.id, "transient", true);
    let row = await queue.get(job.id);
    expect(row?.status).toBe("retrying");
    expect(row?.runAfter.getTime()).toBeGreaterThan(Date.now());
    expect(row?.lastError).toBe("transient");

    // Make it claimable again, then exhaust the attempt budget.
    await db
      .update(jobs)
      .set({ runAfter: new Date(Date.now() - 1000) })
      .where(eq(jobs.id, job.id));
    await queue.claim(["test_job"], "w");
    await queue.fail(job.id, "transient again", true);
    row = await queue.get(job.id);
    expect(row?.attempts).toBe(2);
    expect(row?.status).toBe("failed");
  });

  it("does not retry a non-retryable failure", async () => {
    const job = await queue.enqueue("test_job", {}, { maxAttempts: 5 });
    await queue.claim(["test_job"], "w");
    await queue.fail(job.id, "bad input", false);

    const row = await queue.get(job.id);
    expect(row?.status).toBe("failed");
    expect(row?.attempts).toBe(1);
  });

  it("records completion and partial success distinctly", async () => {
    const ok = await queue.enqueue("test_job", {});
    await queue.claim(["test_job"], "w");
    await queue.complete(ok.id, { created: 20 });
    expect((await queue.get(ok.id))?.status).toBe("succeeded");
    expect((await queue.get(ok.id))?.result).toEqual({ created: 20 });

    const partial = await queue.enqueue("test_job", {});
    await queue.claim(["test_job"], "w");
    await queue.partiallySucceed(partial.id, { created: 20, failed: 4 });
    const row = await queue.get(partial.id);
    expect(row?.status).toBe("partially_succeeded");
    expect(row?.result).toEqual({ created: 20, failed: 4 });
  });

  it("cancels a queued job but not a running one", async () => {
    const queued = await queue.enqueue("test_job", {});
    await queue.cancel(queued.id);
    expect((await queue.get(queued.id))?.status).toBe("cancelled");

    const running = await queue.enqueue("test_job", {});
    await queue.claim(["test_job"], "w");
    await queue.cancel(running.id);
    expect((await queue.get(running.id))?.status).toBe("running");
  });

  it("reclaims jobs stranded by a dead worker", async () => {
    const job = await queue.enqueue("test_job", {});
    await queue.claim(["test_job"], "dead-worker");
    await db
      .update(jobs)
      .set({ lockedAt: new Date(Date.now() - 60 * 60 * 1000) })
      .where(eq(jobs.id, job.id));

    expect(await reclaimStaleJobs(15 * 60 * 1000)).toBe(1);
    const row = await queue.get(job.id);
    expect(row?.status).toBe("retrying");
    expect(row?.lockedBy).toBeNull();
  });

  it("claims in run-after order", async () => {
    const later = await queue.enqueue(
      "test_job",
      { order: "later" },
      { runAfter: new Date(Date.now() - 1000) },
    );
    const earlier = await queue.enqueue(
      "test_job",
      { order: "earlier" },
      { runAfter: new Date(Date.now() - 5000) },
    );

    const first = await queue.claim(["test_job"], "w");
    expect(first?.id).toBe(earlier.id);
    const second = await queue.claim(["test_job"], "w");
    expect(second?.id).toBe(later.id);
  });
});

describe("backoff", () => {
  it("grows exponentially and is capped at ten minutes", () => {
    expect(backoffMs(0)).toBeLessThanOrEqual(5_000 * 1.25);
    expect(backoffMs(1)).toBeGreaterThan(5_000 * 0.7);
    for (const attempt of [0, 1, 2, 3, 10, 50]) {
      expect(backoffMs(attempt)).toBeLessThanOrEqual(600_000 * 1.25);
      expect(backoffMs(attempt)).toBeGreaterThan(0);
    }
  });
});
