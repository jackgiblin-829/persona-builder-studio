import "server-only";
import { desc, eq } from "drizzle-orm";
import { db, type Executor } from "@/db/client";
import { auditLogs } from "@/db/schema";
import { newId, ID_PREFIXES } from "@/lib/ids";

export type AuditAction =
  | "auth.sign_in"
  | "auth.sign_out"
  | "brand.create"
  | "brand.update"
  | "brand.delete"
  | "source.upload"
  | "source.delete"
  | "source.url_ingest"
  | "evidence.update"
  | "evidence.review"
  | "segment.generate"
  | "segment.decision"
  | "persona.generate"
  | "persona.update"
  | "persona.approve"
  | "persona.reject"
  | "persona.new_version"
  | "prompt_set.generate"
  | "prompt_set.approve"
  | "prompt_set.reject"
  | "prompt_set.new_version"
  | "prompt.update"
  | "prompt.review"
  | "prompt.pair"
  | "integration.update"
  | "credential.update"
  | "profound.connection_test"
  | "profound.config_refresh"
  | "profound.mapping_update"
  | "profound.dry_run"
  | "profound.deploy_approve"
  | "profound.deploy"
  | "profound.retry"
  | "profound.results_retrieve"
  | "opportunity.generate"
  | "opportunity.review"
  | "brief.generate"
  | "brief.approve"
  | "audit.generate"
  | "audit.approve"
  | "export"
  | "evaluation.run"
  | "audience_report.request"
  | "profound.evidence_pull"
  | "web_research.run"
  | "profound.reconcile"
  | "profound.link_manual";

export type AuditEntry = {
  organizationId?: string | null;
  brandId?: string | null;
  actorUserId?: string | null;
  action: AuditAction;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  ip?: string | null;
};

/**
 * Insert-only audit trail. Every approval, export, deletion and Profound write
 * goes through here. Never records source text or secrets — identifiers and
 * counts only.
 */
export async function recordAudit(entry: AuditEntry, tx?: Executor): Promise<void> {
  const executor = tx ?? db;
  await executor.insert(auditLogs).values({
    id: newId(ID_PREFIXES.auditLog),
    organizationId: entry.organizationId ?? null,
    brandId: entry.brandId ?? null,
    actorUserId: entry.actorUserId ?? null,
    action: entry.action,
    entityType: entry.entityType ?? null,
    entityId: entry.entityId ?? null,
    metadata: entry.metadata ?? {},
    ip: entry.ip ?? null,
  });
}

export async function listAuditLogs(organizationId: string, limit = 100) {
  return db
    .select()
    .from(auditLogs)
    .where(eq(auditLogs.organizationId, organizationId))
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);
}
