import "server-only";
import { and, desc, eq, gte, sql as raw } from "drizzle-orm";
import { db } from "@/db/client";
import { vendorUsage } from "@/db/schema";
import { newId, ID_PREFIXES } from "@/lib/ids";
import { logVendorCall } from "@/lib/logger";
import type { ScopeContext } from "@/lib/auth/context";

export type VendorUsageEntry = {
  organizationId: string;
  brandId?: string | null;
  vendor: "openai" | "profound" | "sparktoro" | "dataforseo" | "storage";
  operation: string;
  mode: "live" | "mock";
  jobId?: string | null;
  durationMs: number;
  retryCount: number;
  outcome: "success" | "failure";
  errorCode?: string;
  tokensIn?: number;
  tokensOut?: number;
  credits?: number;
  costCents?: number;
  requestHash?: string;
};

/**
 * Records one vendor call for the usage and cost screen, and emits the
 * structured log line required by §38. Never receives a credential or any
 * source text — identifiers, counts and timings only.
 */
export async function recordVendorUsage(entry: VendorUsageEntry): Promise<void> {
  await db.insert(vendorUsage).values({
    id: newId(ID_PREFIXES.vendorUsage),
    organizationId: entry.organizationId,
    brandId: entry.brandId ?? null,
    vendor: entry.vendor,
    operation: entry.operation,
    mode: entry.mode,
    jobId: entry.jobId ?? null,
    durationMs: Math.round(entry.durationMs),
    retryCount: entry.retryCount,
    outcome: entry.outcome,
    errorCode: entry.errorCode ?? null,
    tokensIn: entry.tokensIn ?? null,
    tokensOut: entry.tokensOut ?? null,
    credits: entry.credits ?? null,
    costCents: entry.costCents ?? null,
    requestHash: entry.requestHash ?? null,
  });

  logVendorCall({
    jobId: entry.jobId ?? undefined,
    organizationId: entry.organizationId,
    brandId: entry.brandId ?? undefined,
    vendor: entry.vendor,
    operation: entry.operation,
    mode: entry.mode,
    durationMs: Math.round(entry.durationMs),
    retryCount: entry.retryCount,
    outcome: entry.outcome,
    tokensIn: entry.tokensIn,
    tokensOut: entry.tokensOut,
    costCents: entry.costCents,
    requestHash: entry.requestHash,
    errorCode: entry.errorCode,
  });
}

export type UsageSummaryRow = {
  vendor: string;
  operation: string;
  mode: string;
  calls: number;
  failures: number;
  tokensIn: number;
  tokensOut: number;
  credits: number;
  costCents: number;
  avgDurationMs: number;
};

export async function getUsageSummary(
  ctx: ScopeContext,
  sinceDays = 30,
): Promise<UsageSummaryRow[]> {
  const since = new Date(Date.now() - sinceDays * 24 * 60 * 60 * 1000);
  const rows = await db
    .select({
      vendor: vendorUsage.vendor,
      operation: vendorUsage.operation,
      mode: vendorUsage.mode,
      calls: raw<number>`count(*)::int`,
      failures: raw<number>`count(*) filter (where ${vendorUsage.outcome} = 'failure')::int`,
      tokensIn: raw<number>`coalesce(sum(${vendorUsage.tokensIn}), 0)::int`,
      tokensOut: raw<number>`coalesce(sum(${vendorUsage.tokensOut}), 0)::int`,
      credits: raw<number>`coalesce(sum(${vendorUsage.credits}), 0)::float8`,
      costCents: raw<number>`coalesce(sum(${vendorUsage.costCents}), 0)::float8`,
      avgDurationMs: raw<number>`coalesce(avg(${vendorUsage.durationMs}), 0)::int`,
    })
    .from(vendorUsage)
    .where(
      and(eq(vendorUsage.organizationId, ctx.organizationId), gte(vendorUsage.createdAt, since)),
    )
    .groupBy(vendorUsage.vendor, vendorUsage.operation, vendorUsage.mode)
    .orderBy(vendorUsage.vendor, vendorUsage.operation);

  return rows;
}

export async function getRecentUsage(ctx: ScopeContext, limit = 50) {
  return db
    .select()
    .from(vendorUsage)
    .where(eq(vendorUsage.organizationId, ctx.organizationId))
    .orderBy(desc(vendorUsage.createdAt))
    .limit(limit);
}
