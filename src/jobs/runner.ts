import "server-only";
import "@/jobs";
import { hostname } from "node:os";
import { getQueue } from "@/adapters/queue";
import { isRetryable } from "@/lib/errors";
import { ID_PREFIXES, newId } from "@/lib/ids";
import { logJob } from "@/lib/logger";
import { getJobHandler, registeredJobTypes } from "./registry";

type RunNextOptions = {
  workerId?: string;
  projectId?: string;
  types?: string[];
};

type DrainOptions = {
  projectId: string;
  types?: string[];
  maxJobs?: number;
};

function inlineWorkerId() {
  return `${hostname()}-${process.pid}-inline-${newId(ID_PREFIXES.job).slice(-6)}`;
}

/**
 * Claims and completes one durable job. The standalone worker and synchronous
 * product workflows share this executor so a user action never depends on a
 * second process being started correctly.
 */
export async function runNextQueuedJob(options: RunNextOptions = {}): Promise<boolean> {
  const workerId = options.workerId ?? inlineWorkerId();
  const queue = getQueue();
  const job = await queue.claim(
    options.types?.length ? options.types : registeredJobTypes(),
    workerId,
    options.projectId,
  );
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

/** Process the immediately runnable jobs needed by one product action. */
export async function drainProjectJobs({
  projectId,
  types,
  maxJobs = 250,
}: DrainOptions): Promise<number> {
  const workerId = inlineWorkerId();
  let processed = 0;
  while (processed < maxJobs) {
    const didWork = await runNextQueuedJob({ workerId, projectId, types });
    if (!didWork) break;
    processed++;
  }
  return processed;
}
