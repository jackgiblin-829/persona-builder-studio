import "server-only";
import pino from "pino";
import { env } from "./env";

/**
 * Structured logging. The redaction list is a hard requirement (§38): API
 * keys, tokens, cookies and passwords must never reach a log sink. Raw source
 * text and unredacted PII are never passed to the logger in the first place —
 * services log identifiers and counts, not content.
 */
export const logger = pino({
  level: env.LOG_LEVEL,
  redact: {
    paths: [
      "apiKey",
      "api_key",
      "password",
      "token",
      "secret",
      "authorization",
      "headers.authorization",
      "headers.cookie",
      "headers['set-cookie']",
      "*.apiKey",
      "*.api_key",
      "*.password",
      "*.token",
      "*.secret",
      "*.authorization",
      "credentials",
      "*.credentials",
      "rawText",
      "raw_text",
    ],
    censor: "[redacted]",
  },
  base: { service: "persona-builder-studio" },
});

/** The fixed field set required by §38. */
export type VendorLogFields = {
  jobId?: string;
  organizationId?: string;
  projectId?: string;
  vendor: string;
  operation: string;
  mode: "live" | "mock";
  durationMs: number;
  retryCount: number;
  outcome: "success" | "failure";
  tokensIn?: number;
  tokensOut?: number;
  costCents?: number;
  requestHash?: string;
  errorCode?: string;
};

export function logVendorCall(fields: VendorLogFields): void {
  const log = fields.outcome === "success" ? logger.info.bind(logger) : logger.error.bind(logger);
  log(fields, `${fields.vendor}.${fields.operation} ${fields.outcome} (${fields.mode})`);
}

export type JobLogFields = {
  jobId: string;
  jobType: string;
  organizationId?: string;
  projectId?: string;
  attempt: number;
  durationMs?: number;
  outcome: "started" | "succeeded" | "failed" | "retrying" | "partially_succeeded";
  errorCode?: string;
};

export function logJob(fields: JobLogFields): void {
  const log = fields.outcome === "failed" ? logger.error.bind(logger) : logger.info.bind(logger);
  log(fields, `job ${fields.jobType} ${fields.outcome}`);
}
