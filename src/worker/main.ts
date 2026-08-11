import "@/jobs";
import { hostname } from "node:os";
import { getQueue, reclaimStaleJobs } from "@/adapters/queue";
import { getJobHandler, registeredJobTypes } from "@/jobs/registry";
import { closeDb } from "@/db/client";
import { env } from "@/lib/env";
import { isRetryable } from "@/lib/errors";
import { logger, logJob } from "@/lib/logger";
import { newId, ID_PREFIXES } from "@/lib/ids";

const workerId = `${hostname()}-${process.pid}-${newId(ID_PREFIXES.job).slice(-6)}`;
let running = true;
let inFlight = 0;

async function runOne(): Promise<boolean> {
  const queue = getQueue();
  const job = await queue.claim(registeredJobTypes(), workerId);
  if (!job) return false;

  const handler = getJobHandler(job.type);
  const started = Date.now();
  logJob({
    jobId: job.id,
    jobType: job.type,
    organizationId: job.organizationId ?? undefined,
    projectId: job.projectId ?? undefined,
    attempt: job.attempts,
    outcome: "started",
  });

  if (!handler) {
    await queue.fail(job.id, `No handler registered for job type "${job.type}"`, false);
    return true;
  }

  try {
    const outcome = await handler({ job, workerId });
    if (outcome.status === "partially_succeeded") {
      await queue.partiallySucceed(job.id, outcome.result ?? {});
    } else {
      await queue.complete(job.id, outcome.result);
    }
    logJob({
      jobId: job.id,
      jobType: job.type,
      organizationId: job.organizationId ?? undefined,
      projectId: job.projectId ?? undefined,
      attempt: job.attempts,
      durationMs: Date.now() - started,
      outcome: outcome.status,
    });
  } catch (error) {
    const retryable = isRetryable(error);
    const message = error instanceof Error ? error.message : String(error);
    await queue.fail(job.id, message, retryable);
    logJob({
      jobId: job.id,
      jobType: job.type,
      organizationId: job.organizationId ?? undefined,
      projectId: job.projectId ?? undefined,
      attempt: job.attempts,
      durationMs: Date.now() - started,
      outcome: retryable && job.attempts < job.maxAttempts ? "retrying" : "failed",
      errorCode: error instanceof Error ? error.name : "unknown",
    });
  }
  return true;
}

async function loop(): Promise<void> {
  while (running) {
    if (inFlight >= env.QUEUE_CONCURRENCY) {
      await sleep(50);
      continue;
    }
    inFlight++;
    let didWork = false;
    try {
      didWork = await runOne();
    } catch (error) {
      logger.error({ err: error }, "worker loop error");
    } finally {
      inFlight--;
    }
    if (!didWork) await sleep(env.QUEUE_POLL_INTERVAL_MS);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main(): Promise<void> {
  logger.info(
    { workerId, types: registeredJobTypes(), concurrency: env.QUEUE_CONCURRENCY },
    "worker starting",
  );

  const reclaimed = await reclaimStaleJobs();
  if (reclaimed > 0) logger.warn({ reclaimed }, "reclaimed stale jobs from a previous run");

  const reclaimTimer = setInterval(() => {
    reclaimStaleJobs().catch((error) => logger.error({ err: error }, "reclaim failed"));
  }, 60_000);

  const shutdown = (signal: string) => {
    logger.info({ signal }, "worker shutting down");
    running = false;
    clearInterval(reclaimTimer);
    setTimeout(() => {
      void closeDb().finally(() => process.exit(0));
    }, 1500);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  const workers = Array.from({ length: env.QUEUE_CONCURRENCY }, () => loop());
  await Promise.all(workers);
}

main().catch((error) => {
  logger.fatal({ err: error }, "worker failed to start");
  process.exit(1);
});
