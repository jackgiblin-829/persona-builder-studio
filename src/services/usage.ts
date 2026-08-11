import "server-only";
import { db } from "@/db/client";
import { vendorUsage } from "@/db/schema";
import { AppError } from "@/lib/errors";
import { ID_PREFIXES, newId } from "@/lib/ids";

export type VendorUsageEntry = {
  organizationId: string;
  projectId?: string | null;
  vendor: "openai" | "sparktoro" | "storage";
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

export async function recordVendorUsage(entry: VendorUsageEntry): Promise<void> {
  await db.insert(vendorUsage).values({
    id: newId(ID_PREFIXES.vendorUsage),
    organizationId: entry.organizationId,
    projectId: entry.projectId ?? null,
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
}

type UsageContext = Omit<
  VendorUsageEntry,
  | "durationMs"
  | "outcome"
  | "errorCode"
  | "retryCount"
  | "tokensIn"
  | "tokensOut"
  | "credits"
  | "costCents"
>;

export async function withVendorUsage<T>(
  context: UsageContext,
  call: () => Promise<T>,
  onSuccess?: (result: T) => Partial<VendorUsageEntry>,
): Promise<T> {
  const started = Date.now();
  try {
    const result = await call();
    await recordVendorUsage({
      ...context,
      durationMs: Date.now() - started,
      retryCount: 0,
      outcome: "success",
      ...(onSuccess?.(result) ?? {}),
    });
    return result;
  } catch (error) {
    await recordVendorUsage({
      ...context,
      durationMs: Date.now() - started,
      retryCount: 0,
      outcome: "failure",
      errorCode:
        error instanceof AppError ? error.code : error instanceof Error ? error.name : "unknown",
    });
    throw error;
  }
}
