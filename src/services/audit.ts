import "server-only";
import { db, type Executor } from "@/db/client";
import { auditLogs } from "@/db/schema";
import { ID_PREFIXES, newId } from "@/lib/ids";

export type AuditEntry = {
  organizationId?: string | null;
  projectId?: string | null;
  actorUserId?: string | null;
  action: string;
  entityType?: string;
  entityId?: string;
  metadata?: Record<string, unknown>;
  ip?: string | null;
};

export async function recordAudit(entry: AuditEntry, tx?: Executor): Promise<void> {
  await (tx ?? db).insert(auditLogs).values({
    id: newId(ID_PREFIXES.auditLog),
    organizationId: entry.organizationId ?? null,
    projectId: entry.projectId ?? null,
    actorUserId: entry.actorUserId ?? null,
    action: entry.action,
    entityType: entry.entityType ?? null,
    entityId: entry.entityId ?? null,
    metadata: entry.metadata ?? {},
    ip: entry.ip ?? null,
  });
}
