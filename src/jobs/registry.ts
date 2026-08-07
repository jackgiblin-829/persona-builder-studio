import "server-only";
import type { JobRow } from "@/adapters/queue";

export type JobContext = {
  job: JobRow;
  workerId: string;
};

export type JobResult = {
  status: "succeeded" | "partially_succeeded";
  result?: Record<string, unknown>;
};

export type JobHandler = (ctx: JobContext) => Promise<JobResult>;

const handlers = new Map<string, JobHandler>();

export function registerJob(type: string, handler: JobHandler): void {
  if (handlers.has(type)) throw new Error(`Job handler already registered: ${type}`);
  handlers.set(type, handler);
}

export function getJobHandler(type: string): JobHandler | undefined {
  return handlers.get(type);
}

export function registeredJobTypes(): string[] {
  return [...handlers.keys()];
}

/** Job type constants — the single list of what the worker can run. */
export const JOB_TYPES = {
  ingestSource: "ingest_source",
  crawlUrl: "crawl_url",
  extractEvidence: "extract_evidence",
  embedEvidence: "embed_evidence",
  generateSegments: "generate_segments",
  generatePersona: "generate_persona",
  generatePrompts: "generate_prompts",
  embedPrompts: "embed_prompts",
  sparktoroSection: "sparktoro_section",
  dataforseoQuery: "dataforseo_query",
  profoundResults: "profound_results",
  profoundEvidence: "profound_evidence",
  webResearch: "web_research",
  generateOpportunities: "generate_opportunities",
  generateBrief: "generate_brief",
  generatePageAudit: "generate_page_audit",
  runEvaluation: "run_evaluation",
  retention: "retention_sweep",
} as const;

export type JobType = (typeof JOB_TYPES)[keyof typeof JOB_TYPES];
