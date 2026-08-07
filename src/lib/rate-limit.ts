import "server-only";

/**
 * In-process token bucket.
 *
 * Known limitation (documented in docs/security.md): this is per-process and
 * therefore incorrect behind multiple app instances. A shared store is
 * required before horizontal scaling.
 */

type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
};

export function checkRateLimit(
  key: string,
  opts: { limit: number; windowMs: number },
): RateLimitResult {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
    return { allowed: true, remaining: opts.limit - 1, retryAfterMs: 0 };
  }

  if (existing.count >= opts.limit) {
    return { allowed: false, remaining: 0, retryAfterMs: existing.resetAt - now };
  }

  existing.count += 1;
  return { allowed: true, remaining: opts.limit - existing.count, retryAfterMs: 0 };
}

export function resetRateLimit(key?: string): void {
  if (key) buckets.delete(key);
  else buckets.clear();
}

/** Prevents unbounded growth in a long-running process. */
export function sweepRateLimits(): number {
  const now = Date.now();
  let removed = 0;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) {
      buckets.delete(key);
      removed++;
    }
  }
  return removed;
}
