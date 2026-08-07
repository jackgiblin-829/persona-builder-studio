import "server-only";
import { and, eq, inArray, lte, or, sql as raw } from "drizzle-orm";
import { db, type Executor } from "@/db/client";
import { jobs } from "@/db/schema";
import { newId, ID_PREFIXES } from "@/lib/ids";

export type JobRow = typeof jobs.$inferSelect;

export type EnqueueOptions = {
  organizationId?: string;
  brandId?: string;
  runAfter?: Date;
  maxAttempts?: number;
  /** Uniquely indexed. Enqueueing the same key twice is a no-op. */
  idempotencyKey?: string;
  /** Enqueue inside an existing transaction so the job cannot outlive a rollback. */
  tx?: Executor;
};

export interface JobQueue {
  readonly driver: string;
  enqueue(type: string, payload: Record<string, unknown>, opts?: EnqueueOptions): Promise<JobRow>;
  claim(types: string[], workerId: string): Promise<JobRow | null>;
  complete(jobId: string, result?: Record<string, unknown>): Promise<void>;
  fail(jobId: string, error: string, retryable: boolean): Promise<void>;
  partiallySucceed(jobId: string, result: Record<string, unknown>): Promise<void>;
  cancel(jobId: string): Promise<void>;
  get(jobId: string): Promise<JobRow | null>;
}

/** Exponential backoff with jitter, capped at ten minutes. */
export function backoffMs(attempts: number): number {
  const base = Math.min(2 ** attempts * 5_000, 600_000);
  return Math.round(base * (0.75 + Math.random() * 0.5));
}

/**
 * Durable queue in PostgreSQL (ADR-004). Claiming uses
 * `FOR UPDATE SKIP LOCKED`, so multiple workers never take the same job.
 */
export class PostgresJobQueue implements JobQueue {
  readonly driver = "postgres" as const;

  async enqueue(
    type: string,
    payload: Record<string, unknown>,
    opts: EnqueueOptions = {},
  ): Promise<JobRow> {
    const executor = opts.tx ?? db;
    const values = {
      id: newId(ID_PREFIXES.job),
      type,
      payload,
      organizationId: opts.organizationId ?? null,
      brandId: opts.brandId ?? null,
      runAfter: opts.runAfter ?? new Date(),
      maxAttempts: opts.maxAttempts ?? 3,
      idempotencyKey: opts.idempotencyKey ?? null,
    };

    if (opts.idempotencyKey) {
      const inserted = await executor
        .insert(jobs)
        .values(values)
        .onConflictDoNothing({ target: jobs.idempotencyKey })
        .returning();
      if (inserted[0]) return inserted[0];
      const [existing] = await executor
        .select()
        .from(jobs)
        .where(eq(jobs.idempotencyKey, opts.idempotencyKey))
        .limit(1);
      if (!existing) throw new Error("Failed to enqueue or resolve idempotent job");
      return existing;
    }

    const [row] = await executor.insert(jobs).values(values).returning();
    if (!row) throw new Error("Failed to enqueue job");
    return row;
  }

  async claim(types: string[], workerId: string): Promise<JobRow | null> {
    if (types.length === 0) return null;
    return db.transaction(async (tx) => {
      const candidates = await tx
        .select({ id: jobs.id })
        .from(jobs)
        .where(
          and(
            inArray(jobs.type, types),
            or(eq(jobs.status, "queued"), eq(jobs.status, "retrying")),
            lte(jobs.runAfter, new Date()),
          ),
        )
        .orderBy(jobs.runAfter, jobs.createdAt)
        .limit(1)
        .for("update", { skipLocked: true });

      const candidate = candidates[0];
      if (!candidate) return null;

      const [claimed] = await tx
        .update(jobs)
        .set({
          status: "running",
          attempts: raw`${jobs.attempts} + 1`,
          lockedAt: new Date(),
          lockedBy: workerId,
          startedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(jobs.id, candidate.id))
        .returning();

      return claimed ?? null;
    });
  }

  async complete(jobId: string, result?: Record<string, unknown>): Promise<void> {
    await db
      .update(jobs)
      .set({
        status: "succeeded",
        result: result ?? null,
        finishedAt: new Date(),
        lockedAt: null,
        lockedBy: null,
        lastError: null,
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, jobId));
  }

  async partiallySucceed(jobId: string, result: Record<string, unknown>): Promise<void> {
    await db
      .update(jobs)
      .set({
        status: "partially_succeeded",
        result,
        finishedAt: new Date(),
        lockedAt: null,
        lockedBy: null,
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, jobId));
  }

  async fail(jobId: string, error: string, retryable: boolean): Promise<void> {
    const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
    if (!job) return;

    const canRetry = retryable && job.attempts < job.maxAttempts;
    await db
      .update(jobs)
      .set({
        status: canRetry ? "retrying" : "failed",
        lastError: error.slice(0, 4000),
        runAfter: canRetry ? new Date(Date.now() + backoffMs(job.attempts)) : job.runAfter,
        finishedAt: canRetry ? null : new Date(),
        lockedAt: null,
        lockedBy: null,
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, jobId));
  }

  async cancel(jobId: string): Promise<void> {
    await db
      .update(jobs)
      .set({ status: "cancelled", finishedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(jobs.id, jobId), inArray(jobs.status, ["queued", "retrying"])));
  }

  async get(jobId: string): Promise<JobRow | null> {
    const [row] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
    return row ?? null;
  }
}

let cached: JobQueue | undefined;

export function getQueue(): JobQueue {
  cached ??= new PostgresJobQueue();
  return cached;
}

/**
 * Reclaims jobs whose worker died mid-run. Called on worker startup and
 * periodically — without this a crashed worker would strand `running` rows.
 */
export async function reclaimStaleJobs(staleAfterMs = 15 * 60 * 1000): Promise<number> {
  const cutoff = new Date(Date.now() - staleAfterMs);
  const reclaimed = await db
    .update(jobs)
    .set({ status: "retrying", lockedAt: null, lockedBy: null, updatedAt: new Date() })
    .where(and(eq(jobs.status, "running"), lte(jobs.lockedAt, cutoff)))
    .returning({ id: jobs.id });
  return reclaimed.length;
}
