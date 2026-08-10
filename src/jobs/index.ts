/**
 * Job handler registration. Importing this module registers every handler with
 * the registry; the worker imports it once at startup.
 */
import "./handlers/ingest-source";
import "./handlers/extract-evidence";
import "./handlers/embed-evidence";
import "./handlers/generate-segments";
import "./handlers/generate-persona";
import "./handlers/generate-prompts";
import "./handlers/embed-prompts";
import "./handlers/profound-results";
import "./handlers/profound-evidence";
import "./handlers/web-research";
import "./handlers/dataforseo-query";
import "./handlers/sparktoro-section";
import "./handlers/generate-opportunities";
import "./handlers/generate-brief";
import "./handlers/generate-page-audit";
import "./handlers/estimate-answer-coverage";

export { JOB_TYPES, registeredJobTypes, getJobHandler } from "./registry";
export type { JobHandler, JobContext, JobResult, JobType } from "./registry";
