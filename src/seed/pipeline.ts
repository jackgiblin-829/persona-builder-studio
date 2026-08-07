import "server-only";
import "@/jobs";
import { getQueue } from "@/adapters/queue";
import { getJobHandler, registeredJobTypes } from "@/jobs/registry";
import { isRetryable } from "@/lib/errors";

/**
 * Drains the job queue in-process.
 *
 * The seed and the integration tests use this instead of a running worker, so
 * the demo dataset is produced by the same handlers the application uses in
 * production. A handler that breaks fails the seed loudly rather than leaving
 * a plausible-looking but fabricated database behind.
 */
export async function drainQueue(
  options: { maxJobs?: number; workerId?: string } = {},
): Promise<{ processed: number; failed: number; errors: string[] }> {
  const queue = getQueue();
  const workerId = options.workerId ?? "seed-drain";
  const maxJobs = options.maxJobs ?? 500;

  let processed = 0;
  let failed = 0;
  const errors: string[] = [];

  for (let i = 0; i < maxJobs; i++) {
    const job = await queue.claim(registeredJobTypes(), workerId);
    if (!job) break;

    const handler = getJobHandler(job.type);
    if (!handler) {
      await queue.fail(job.id, `No handler for ${job.type}`, false);
      failed++;
      errors.push(`no handler for ${job.type}`);
      continue;
    }

    try {
      const outcome = await handler({ job, workerId });
      if (outcome.status === "partially_succeeded") {
        await queue.partiallySucceed(job.id, outcome.result ?? {});
      } else {
        await queue.complete(job.id, outcome.result);
      }
      processed++;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await queue.fail(job.id, message, isRetryable(error));
      failed++;
      errors.push(`${job.type}: ${message}`);
    }
  }

  return { processed, failed, errors };
}
