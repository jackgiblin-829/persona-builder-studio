import "server-only";

/**
 * Shared transport-retry math for vendor adapters. Every adapter still decides
 * which methods/statuses are
 * eligible to retry, but the delay computation is one implementation.
 */

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 429/5xx are the only transport-level statuses worth retrying at all. */
export function isTransportRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/** Honors a numeric `retry-after` header; otherwise capped exponential backoff. */
export function transportRetryDelayMs(response: Response, attempt: number): number {
  const retryAfter = Number(response.headers.get("retry-after"));
  return Number.isFinite(retryAfter) && retryAfter > 0
    ? retryAfter * 1000
    : Math.min(2 ** attempt * 1000, 20_000);
}
