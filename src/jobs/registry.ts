import "server-only";
import type { JobRow } from "@/adapters/queue";

export type JobContext = { job: JobRow; workerId: string };
export type JobResult = {
  status: "succeeded" | "partially_succeeded";
  result?: Record<string, unknown>;
};
export type JobHandler = (context: JobContext) => Promise<JobResult>;

const handlers = new Map<string, JobHandler>();
export function registerJob(type: string, handler: JobHandler) {
  if (handlers.has(type)) throw new Error(`Job handler already registered: ${type}`);
  handlers.set(type, handler);
}
export function getJobHandler(type: string) {
  return handlers.get(type);
}
export function registeredJobTypes() {
  return [...handlers.keys()];
}

export const JOB_TYPES = {
  researchMarket: "research_market",
  ingestSource: "ingest_source",
  extractSignals: "extract_signals",
  generatePersonas: "generate_personas",
  generatePrompts: "generate_prompts",
} as const;
export type JobType = (typeof JOB_TYPES)[keyof typeof JOB_TYPES];
