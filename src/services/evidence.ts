import "server-only";
import { and, asc, count, desc, eq, gte, inArray, lte, sql as raw, type SQL } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db/client";
import {
  dataSources,
  evidenceEmbeddings,
  evidenceNotes,
  evidenceRecords,
  personaFieldEvidence,
  personaFields,
  personaVersions,
  personas,
  promptEvidence,
  prompts,
  sourceDocuments,
  users,
} from "@/db/schema";
import { getOpenAIAdapter } from "@/adapters/openai";
import { requireCapability, type BrandContext } from "@/lib/auth/context";
import { NotFoundError } from "@/lib/errors";
import { newId, ID_PREFIXES } from "@/lib/ids";
import { EVIDENCE_CATEGORIES, JOURNEY_STAGES, PROVENANCE, SENTIMENTS } from "@/prompts/schemas";
import { recordAudit } from "./audit";

export const evidenceFilterSchema = z.object({
  q: z.string().trim().max(300).optional(),
  /** `semantic` uses embeddings; `text` uses the Postgres full-text index. */
  searchMode: z.enum(["text", "semantic"]).default("text"),
  sourceId: z.string().optional(),
  category: z.enum(EVIDENCE_CATEGORIES).optional(),
  provenance: z.enum(PROVENANCE).optional(),
  journeyStage: z.enum(JOURNEY_STAGES).optional(),
  sentiment: z.enum(SENTIMENTS).optional(),
  reviewStatus: z
    .enum(["draft", "pending_review", "approved", "rejected", "needs_review"])
    .optional(),
  entity: z.string().trim().max(120).optional(),
  segmentLabel: z.string().trim().max(120).optional(),
  observedFrom: z.string().optional(),
  observedTo: z.string().optional(),
  availability: z.enum(["available", "source_deleted"]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(10).max(200).default(50),
});

export type EvidenceFilter = z.infer<typeof evidenceFilterSchema>;

export type EvidenceRow = typeof evidenceRecords.$inferSelect & {
  sourceLabel: string;
  /** Only present for semantic search. */
  similarity?: number;
};

export type EvidenceListResult = {
  rows: EvidenceRow[];
  total: number;
  page: number;
  pageSize: number;
  /** Set when a semantic search could not run, so the UI can say why. */
  notice?: string;
};

function baseConditions(ctx: BrandContext, filter: EvidenceFilter): SQL[] {
  const conditions: SQL[] = [
    eq(evidenceRecords.organizationId, ctx.organizationId),
    eq(evidenceRecords.brandId, ctx.brandId),
  ];

  if (filter.sourceId) conditions.push(eq(evidenceRecords.dataSourceId, filter.sourceId));
  if (filter.category) conditions.push(eq(evidenceRecords.category, filter.category));
  if (filter.provenance) conditions.push(eq(evidenceRecords.provenance, filter.provenance));
  if (filter.journeyStage) conditions.push(eq(evidenceRecords.journeyStage, filter.journeyStage));
  if (filter.sentiment) conditions.push(eq(evidenceRecords.sentiment, filter.sentiment));
  if (filter.reviewStatus) conditions.push(eq(evidenceRecords.reviewStatus, filter.reviewStatus));
  if (filter.availability) conditions.push(eq(evidenceRecords.availability, filter.availability));

  if (filter.entity) {
    conditions.push(raw`${evidenceRecords.entities} @> ${JSON.stringify([filter.entity])}::jsonb`);
  }
  if (filter.segmentLabel) {
    conditions.push(
      raw`${evidenceRecords.candidateSegmentLabels} @> ${JSON.stringify([filter.segmentLabel])}::jsonb`,
    );
  }

  const from = filter.observedFrom ? new Date(filter.observedFrom) : null;
  const to = filter.observedTo ? new Date(filter.observedTo) : null;
  if (from && !Number.isNaN(from.getTime())) conditions.push(gte(evidenceRecords.observedAt, from));
  if (to && !Number.isNaN(to.getTime())) conditions.push(lte(evidenceRecords.observedAt, to));

  return conditions;
}

export async function listEvidence(
  ctx: BrandContext,
  filter: EvidenceFilter,
): Promise<EvidenceListResult> {
  const conditions = baseConditions(ctx, filter);
  const offset = (filter.page - 1) * filter.pageSize;

  if (filter.q && filter.searchMode === "semantic") {
    return semanticSearch(ctx, filter, conditions);
  }

  if (filter.q) {
    // websearch_to_tsquery tolerates the punctuation users actually type.
    conditions.push(
      raw`to_tsvector('english', coalesce(${evidenceRecords.normalizedClaim}, '') || ' ' || coalesce(${evidenceRecords.redactedText}, '')) @@ websearch_to_tsquery('english', ${filter.q})`,
    );
  }

  const where = and(...conditions);
  const [rows, totals] = await Promise.all([
    db
      .select({ evidence: evidenceRecords, sourceLabel: dataSources.label })
      .from(evidenceRecords)
      .innerJoin(dataSources, eq(dataSources.id, evidenceRecords.dataSourceId))
      .where(where)
      .orderBy(desc(evidenceRecords.observedAt), desc(evidenceRecords.createdAt))
      .limit(filter.pageSize)
      .offset(offset),
    db.select({ n: count() }).from(evidenceRecords).where(where),
  ]);

  return {
    rows: rows.map((row) => ({ ...row.evidence, sourceLabel: row.sourceLabel })),
    total: totals[0]?.n ?? 0,
    page: filter.page,
    pageSize: filter.pageSize,
  };
}

/**
 * Semantic search over evidence embeddings.
 *
 * Restricted to the embedding model currently in use, because mock and live
 * vectors are not comparable (ADR-005). If the query cannot be embedded, the
 * caller is told rather than silently getting text-search results.
 */
async function semanticSearch(
  ctx: BrandContext,
  filter: EvidenceFilter,
  conditions: SQL[],
): Promise<EvidenceListResult> {
  const { adapter } = await getOpenAIAdapter(ctx.organizationId);
  const embedded = await adapter.embed({ texts: [filter.q ?? ""] });
  const vector = embedded.embeddings[0];
  if (!vector) {
    return {
      rows: [],
      total: 0,
      page: filter.page,
      pageSize: filter.pageSize,
      notice: "The search query could not be embedded, so semantic search is unavailable.",
    };
  }

  const literal = `[${vector.join(",")}]`;
  const where = and(
    ...conditions,
    eq(evidenceEmbeddings.modelId, embedded.modelId),
    eq(evidenceRecords.availability, "available"),
  );

  const rows = await db
    .select({
      evidence: evidenceRecords,
      sourceLabel: dataSources.label,
      similarity: raw<number>`1 - (${evidenceEmbeddings.embedding} <=> ${literal}::vector)`,
    })
    .from(evidenceRecords)
    .innerJoin(evidenceEmbeddings, eq(evidenceEmbeddings.evidenceId, evidenceRecords.id))
    .innerJoin(dataSources, eq(dataSources.id, evidenceRecords.dataSourceId))
    .where(where)
    .orderBy(raw`${evidenceEmbeddings.embedding} <=> ${literal}::vector`)
    .limit(filter.pageSize);

  if (rows.length === 0) {
    const [any] = await db
      .select({ n: count() })
      .from(evidenceEmbeddings)
      .where(eq(evidenceEmbeddings.brandId, ctx.brandId));
    if ((any?.n ?? 0) === 0) {
      return {
        rows: [],
        total: 0,
        page: filter.page,
        pageSize: filter.pageSize,
        notice:
          "No embeddings exist for this brand yet. Semantic search becomes available once the embedding job has run.",
      };
    }
  }

  return {
    rows: rows.map((row) => ({
      ...row.evidence,
      sourceLabel: row.sourceLabel,
      similarity: row.similarity,
    })),
    total: rows.length,
    page: 1,
    pageSize: filter.pageSize,
    notice:
      embedded.dataOrigin === "mock"
        ? "Semantic search is using deterministic mock embeddings, which capture lexical rather than true semantic similarity."
        : undefined,
  };
}

/** Distinct values for the explorer's filter dropdowns. */
export async function getEvidenceFacets(ctx: BrandContext) {
  const where = and(
    eq(evidenceRecords.organizationId, ctx.organizationId),
    eq(evidenceRecords.brandId, ctx.brandId),
  );

  const [categories, stages, sourcesList, entities, segments] = await Promise.all([
    db
      .select({ value: evidenceRecords.category, n: count() })
      .from(evidenceRecords)
      .where(where)
      .groupBy(evidenceRecords.category)
      .orderBy(desc(count())),
    db
      .select({ value: evidenceRecords.journeyStage, n: count() })
      .from(evidenceRecords)
      .where(where)
      .groupBy(evidenceRecords.journeyStage)
      .orderBy(desc(count())),
    db
      .select({ id: dataSources.id, label: dataSources.label, sourceType: dataSources.sourceType })
      .from(dataSources)
      .where(and(eq(dataSources.brandId, ctx.brandId)))
      .orderBy(asc(dataSources.label)),
    db.execute<{ value: string; n: number }>(raw`
      SELECT value, COUNT(*)::int AS n
      FROM evidence_records, jsonb_array_elements_text(entities) AS value
      WHERE brand_id = ${ctx.brandId}
      GROUP BY value
      ORDER BY n DESC
      LIMIT 40
    `),
    db.execute<{ value: string; n: number }>(raw`
      SELECT value, COUNT(*)::int AS n
      FROM evidence_records, jsonb_array_elements_text(candidate_segment_labels) AS value
      WHERE brand_id = ${ctx.brandId}
      GROUP BY value
      ORDER BY n DESC
      LIMIT 40
    `),
  ]);

  return {
    categories,
    stages,
    sources: sourcesList,
    entities: [...entities],
    segments: [...segments],
  };
}

export type EvidenceDependants = {
  personas: {
    personaId: string;
    personaName: string;
    version: number;
    status: string;
    fieldStatement: string;
    relation: string;
  }[];
  prompts: { promptId: string; promptText: string; intent: string; setVersionId: string }[];
};

/**
 * "Which personas and prompts depend on this evidence record?" (§10).
 * A single indexed lookup, which is why persona fields are rows rather than a
 * JSON blob (ADR-006).
 */
export async function getEvidenceDependants(
  ctx: BrandContext,
  evidenceId: string,
): Promise<EvidenceDependants> {
  const [personaRows, promptRows] = await Promise.all([
    db
      .select({
        personaId: personas.id,
        personaName: personas.name,
        version: personaVersions.version,
        status: personaVersions.status,
        fieldStatement: personaFields.statement,
        relation: personaFieldEvidence.relation,
      })
      .from(personaFieldEvidence)
      .innerJoin(personaFields, eq(personaFields.id, personaFieldEvidence.personaFieldId))
      .innerJoin(personaVersions, eq(personaVersions.id, personaFields.personaVersionId))
      .innerJoin(personas, eq(personas.id, personaVersions.personaId))
      .where(
        and(
          eq(personaFieldEvidence.organizationId, ctx.organizationId),
          eq(personaFieldEvidence.evidenceId, evidenceId),
        ),
      )
      .orderBy(desc(personaVersions.version)),
    db
      .select({
        promptId: prompts.id,
        promptText: prompts.promptText,
        intent: prompts.intent,
        setVersionId: prompts.promptSetVersionId,
      })
      .from(promptEvidence)
      .innerJoin(prompts, eq(prompts.id, promptEvidence.promptId))
      .where(
        and(
          eq(promptEvidence.organizationId, ctx.organizationId),
          eq(promptEvidence.evidenceId, evidenceId),
        ),
      ),
  ]);

  return { personas: personaRows, prompts: promptRows };
}

export async function getEvidenceDetail(ctx: BrandContext, evidenceId: string) {
  const [row] = await db
    .select({
      evidence: evidenceRecords,
      sourceLabel: dataSources.label,
      sourceType: dataSources.sourceType,
      documentTitle: sourceDocuments.title,
      documentLocation: sourceDocuments.location,
      documentText: sourceDocuments.redactedText,
    })
    .from(evidenceRecords)
    .innerJoin(dataSources, eq(dataSources.id, evidenceRecords.dataSourceId))
    .innerJoin(sourceDocuments, eq(sourceDocuments.id, evidenceRecords.sourceDocumentId))
    .where(
      and(
        eq(evidenceRecords.id, evidenceId),
        eq(evidenceRecords.organizationId, ctx.organizationId),
        eq(evidenceRecords.brandId, ctx.brandId),
      ),
    )
    .limit(1);

  if (!row) throw new NotFoundError("Evidence record");

  const [notes, dependants] = await Promise.all([
    db
      .select({
        id: evidenceNotes.id,
        body: evidenceNotes.body,
        createdAt: evidenceNotes.createdAt,
        authorName: users.name,
      })
      .from(evidenceNotes)
      .leftJoin(users, eq(users.id, evidenceNotes.userId))
      .where(eq(evidenceNotes.evidenceId, evidenceId))
      .orderBy(desc(evidenceNotes.createdAt)),
    getEvidenceDependants(ctx, evidenceId),
  ]);

  return { ...row, notes, dependants };
}

// ── Mutations ───────────────────────────────────────────────────────────────

export const evidenceUpdateSchema = z.object({
  normalizedClaim: z.string().trim().min(3).max(600),
  category: z.enum(EVIDENCE_CATEGORIES),
  provenance: z.enum(PROVENANCE),
  journeyStage: z.enum(JOURNEY_STAGES),
  sentiment: z.enum(SENTIMENTS),
});

export async function updateEvidence(
  ctx: BrandContext,
  evidenceId: string,
  input: z.infer<typeof evidenceUpdateSchema>,
) {
  requireCapability(ctx, "evidence:edit");
  const [updated] = await db
    .update(evidenceRecords)
    .set({
      normalizedClaim: input.normalizedClaim,
      category: input.category,
      provenance: input.provenance,
      journeyStage: input.journeyStage,
      sentiment: input.sentiment,
      editedByUser: true,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(evidenceRecords.id, evidenceId),
        eq(evidenceRecords.organizationId, ctx.organizationId),
        eq(evidenceRecords.brandId, ctx.brandId),
      ),
    )
    .returning();

  if (!updated) throw new NotFoundError("Evidence record");

  await recordAudit({
    organizationId: ctx.organizationId,
    brandId: ctx.brandId,
    actorUserId: ctx.userId,
    action: "evidence.update",
    entityType: "evidence_record",
    entityId: evidenceId,
    metadata: { category: input.category, provenance: input.provenance },
  });

  return updated;
}

export async function reviewEvidence(
  ctx: BrandContext,
  evidenceIds: string[],
  decision: "approved" | "rejected" | "pending_review",
) {
  requireCapability(ctx, "evidence:review");
  if (evidenceIds.length === 0) return 0;

  const updated = await db
    .update(evidenceRecords)
    .set({
      reviewStatus: decision,
      reviewedByUserId: ctx.userId,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(evidenceRecords.organizationId, ctx.organizationId),
        eq(evidenceRecords.brandId, ctx.brandId),
        inArray(evidenceRecords.id, evidenceIds),
      ),
    )
    .returning({ id: evidenceRecords.id });

  await recordAudit({
    organizationId: ctx.organizationId,
    brandId: ctx.brandId,
    actorUserId: ctx.userId,
    action: "evidence.review",
    entityType: "evidence_record",
    entityId: evidenceIds[0],
    metadata: { decision, count: updated.length },
  });

  return updated.length;
}

export async function addEvidenceNote(ctx: BrandContext, evidenceId: string, body: string) {
  requireCapability(ctx, "evidence:edit");
  const [note] = await db
    .insert(evidenceNotes)
    .values({
      id: newId(ID_PREFIXES.evidenceNote),
      organizationId: ctx.organizationId,
      evidenceId,
      userId: ctx.userId,
      body: body.trim().slice(0, 4000),
    })
    .returning();
  return note;
}

export async function setSegmentLabels(ctx: BrandContext, evidenceId: string, labels: string[]) {
  requireCapability(ctx, "evidence:edit");
  const clean = Array.from(new Set(labels.map((l) => l.trim()).filter(Boolean))).slice(0, 20);
  const [updated] = await db
    .update(evidenceRecords)
    .set({ candidateSegmentLabels: clean, editedByUser: true, updatedAt: new Date() })
    .where(
      and(
        eq(evidenceRecords.id, evidenceId),
        eq(evidenceRecords.organizationId, ctx.organizationId),
        eq(evidenceRecords.brandId, ctx.brandId),
      ),
    )
    .returning();
  if (!updated) throw new NotFoundError("Evidence record");
  return updated;
}

/** Approved, available evidence — the only input downstream generation uses. */
export async function getApprovedEvidence(ctx: BrandContext, limit = 400) {
  return db
    .select({ evidence: evidenceRecords, sourceLabel: dataSources.label })
    .from(evidenceRecords)
    .innerJoin(dataSources, eq(dataSources.id, evidenceRecords.dataSourceId))
    .where(
      and(
        eq(evidenceRecords.organizationId, ctx.organizationId),
        eq(evidenceRecords.brandId, ctx.brandId),
        eq(evidenceRecords.reviewStatus, "approved"),
        eq(evidenceRecords.availability, "available"),
      ),
    )
    .orderBy(desc(evidenceRecords.qualityScore))
    .limit(limit);
}

export async function getEvidenceCounts(ctx: BrandContext) {
  const rows = await db
    .select({ status: evidenceRecords.reviewStatus, n: count() })
    .from(evidenceRecords)
    .where(
      and(
        eq(evidenceRecords.organizationId, ctx.organizationId),
        eq(evidenceRecords.brandId, ctx.brandId),
      ),
    )
    .groupBy(evidenceRecords.reviewStatus);

  const counts: Record<string, number> = { total: 0 };
  for (const row of rows) {
    counts[row.status] = row.n;
    counts.total = (counts.total ?? 0) + row.n;
  }
  return counts;
}
