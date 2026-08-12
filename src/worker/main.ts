import "@/jobs";
import { hostname } from "node:os";
import { reclaimStaleJobs } from "@/adapters/queue";
import { registeredJobTypes } from "@/jobs/registry";
import { runNextQueuedJob } from "@/jobs/runner";
import { closeDb } from "@/db/client";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { newId, ID_PREFIXES } from "@/lib/ids";

const workerId = `${hostname()}-${process.pid}-${newId(ID_PREFIXES.job).slice(-6)}`;
let running = true;
let inFlight = 0;

async function loop(): Promise<void> {
  while (running) {
    if (inFlight >= env.QUEUE_CONCURRENCY) {
      await sleep(50);
      continue;
    }
    inFlight++;
    let didWork = false;
    try {
      didWork = await runNextQueuedJob({ workerId });
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
