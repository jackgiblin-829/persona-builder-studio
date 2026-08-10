/**
 * Persona Builder Studio — database schema.
 *
 * Single source of truth for the data model. See docs/data-model.md.
 *
 * Conventions:
 *  - Every tenant table carries `organizationId` directly so isolation is one
 *    predicate away, even when the row is reachable transitively.
 *  - Every generated artefact carries provenance: dataOrigin, model, template
 *    version, schema version, initiating user, evidence cutoff, review status.
 *  - Approved artefacts are immutable; revisions create new version rows.
 */
import { relations, sql } from "drizzle-orm";
import {
  boolean,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  vector,
} from "drizzle-orm/pg-core";

// ────────────────────────────────────────────────────────────────────────────
// Enums
// ────────────────────────────────────────────────────────────────────────────

export const roleEnum = pgEnum("role", ["owner", "admin", "editor", "viewer"]);

export const vendorEnum = pgEnum("vendor", [
  "openai",
  "profound",
  "sparktoro",
  "dataforseo",
  "storage",
]);

export const vendorModeEnum = pgEnum("vendor_mode", ["mock", "live"]);

/** Where a stored value came from. Rendered as a badge everywhere. */
export const dataOriginEnum = pgEnum("data_origin", ["mock", "live", "local"]);

export const reviewStatusEnum = pgEnum("review_status", [
  "draft",
  "pending_review",
  "approved",
  "rejected",
  "needs_review",
  "superseded",
]);

export const evidenceCategoryEnum = pgEnum("evidence_category", [
  "job_to_be_done",
  "constraint",
  "success_metric",
  "decision_criterion",
  "vocabulary",
  "question",
  "objection",
  "pain_point",
  "desired_outcome",
  "behavior",
  "comparison",
  "implementation_requirement",
  "proof_requirement",
  "brand_claim",
  "other",
]);

/** The provenance ladder. Never blur these — see docs/product-understanding.md §4. */
export const provenanceEnum = pgEnum("provenance", [
  "observed",
  "externally_supported",
  "brand_assertion",
  "inferred",
]);

export const journeyStageEnum = pgEnum("journey_stage", [
  "unaware",
  "problem_discovery",
  "education",
  "solution_exploration",
  "consideration",
  "evaluation",
  "purchase",
  "implementation",
  "optimization",
  "troubleshooting",
  "retention",
  "unknown",
]);

export const sentimentEnum = pgEnum("sentiment", [
  "positive",
  "neutral",
  "negative",
  "concern",
  "mixed",
  "unknown",
]);

export const piiStatusEnum = pgEnum("pii_status", ["none", "redacted", "suspected"]);

export const availabilityEnum = pgEnum("availability", ["available", "source_deleted"]);

export const sourceTypeEnum = pgEnum("source_type", [
  "interview",
  "sales_transcript",
  "support_ticket",
  "survey",
  "review",
  "community",
  "search_console",
  "onsite_search",
  "crm_note",
  "brand_page",
  "documentation",
  "sparktoro",
  "profound",
  "web_research",
  "other",
]);

export const sourceSystemEnum = pgEnum("source_system", [
  "uploaded_csv",
  "uploaded_json",
  "uploaded_txt",
  "uploaded_markdown",
  "uploaded_docx",
  "uploaded_pdf",
  "pasted_text",
  "transcript_text",
  "search_console_export",
  "url_crawl",
  "sparktoro_report",
  "profound_report",
  "openai_web_search",
]);

export const jobStatusEnum = pgEnum("job_status", [
  "queued",
  "running",
  "retrying",
  "succeeded",
  "failed",
  "partially_succeeded",
  "cancelled",
]);

export const personaFieldTypeEnum = pgEnum("persona_field_type", [
  "job_to_be_done",
  "constraint",
  "success_metric",
  "decision_criterion",
  "vocabulary",
  "recurring_question",
  "objection",
  "proof_preference",
  "distinguishing_topic",
  "coverage_gap",
  "excluded_assumption",
  "validation_benchmark",
  "regeneration_trigger",
  "information_depth",
]);

export const evidenceRelationEnum = pgEnum("evidence_relation", ["supports", "contradicts"]);

export const segmentStatusEnum = pgEnum("segment_status", [
  "candidate",
  "approved",
  "rejected",
  "merged",
  "split",
]);

export const promptIntentEnum = pgEnum("prompt_intent", [
  "problem_discovery",
  "education",
  "solution_exploration",
  "comparison",
  "evaluation",
  "risk_reduction",
  "purchase",
  "implementation",
  "optimization",
  "troubleshooting",
]);

export const promptTypeEnum = pgEnum("prompt_type", ["persona", "generic_control"]);

export const executionModeEnum = pgEnum("execution_mode", ["standalone", "conversational", "both"]);

export const trackingPriorityEnum = pgEnum("tracking_priority", ["low", "medium", "high"]);

/** §23 — the full sync state machine. */
export const syncStateEnum = pgEnum("sync_state", [
  "draft",
  "ready",
  "dry_run_passed",
  "approved",
  "syncing",
  "synced",
  "partially_synced",
  "failed",
  "archived",
]);

/** §20 — mapping states. `tag_fallback` is the documented no-persona path. */
export const mappingStatusEnum = pgEnum("mapping_status", [
  "unmapped",
  "mapped",
  "tag_fallback",
  "invalid",
  "needs_review",
]);

export const syncItemOutcomeEnum = pgEnum("sync_item_outcome", [
  "pending",
  "created",
  "duplicate",
  "near_duplicate_skipped",
  "failed",
  "skipped",
]);

/** §27 — every allowed recommendation. "New article" is one of thirteen. */
export const recommendationTypeEnum = pgEnum("recommendation_type", [
  "new_article",
  "existing_article_update",
  "faq",
  "comparison_page",
  "landing_page",
  "product_page",
  "documentation",
  "case_study",
  "homepage_update",
  "structured_information_improvement",
  "third_party_authority_or_pr",
  "no_content_action",
  "product_or_positioning_review",
]);

export const gapTypeEnum = pgEnum("gap_type", [
  "content",
  "evidence",
  "authority",
  "messaging",
  "product_fit",
]);

export const priorityEnum = pgEnum("priority", ["p1", "p2", "p3"]);

export const effortEnum = pgEnum("effort", ["small", "medium", "large"]);

export const severityEnum = pgEnum("severity", ["critical", "high", "medium", "low", "info"]);

export const auditScopeEnum = pgEnum("audit_scope", ["homepage", "landing_page", "product_page"]);

// ────────────────────────────────────────────────────────────────────────────
// Shared column helpers
// ────────────────────────────────────────────────────────────────────────────

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

// ────────────────────────────────────────────────────────────────────────────
// Identity and tenancy
// ────────────────────────────────────────────────────────────────────────────

export const organizations = pgTable("organizations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  retentionDays: integer("retention_days"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const users = pgTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  passwordHash: text("password_hash").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const memberships = pgTable(
  "memberships",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: roleEnum("role").notNull().default("viewer"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("memberships_org_user_uq").on(t.organizationId, t.userId),
    index("memberships_user_idx").on(t.userId),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    /** SHA-256 of the cookie value. The raw token is never stored. */
    tokenHash: text("token_hash").notNull().unique(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId), index("sessions_expiry_idx").on(t.expiresAt)],
);

// ────────────────────────────────────────────────────────────────────────────
// Brands
// ────────────────────────────────────────────────────────────────────────────

export const brands = pgTable(
  "brands",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    canonicalDomain: text("canonical_domain").notNull(),
    description: text("description").notNull(),
    conversionActions: jsonb("conversion_actions").$type<string[]>().notNull().default([]),
    markets: jsonb("markets").$type<string[]>().notNull().default([]),
    languages: jsonb("languages").$type<string[]>().notNull().default([]),
    regions: jsonb("regions").$type<string[]>().notNull().default([]),
    approvedCrawlDomains: jsonb("approved_crawl_domains").$type<string[]>().notNull().default([]),
    strategicQuestions: jsonb("strategic_questions").$type<string[]>().notNull().default([]),
    /** §6 — governance flag; drives extra review warnings across the product. */
    regulatedDomain: boolean("regulated_domain").notNull().default(false),
    profoundCategoryId: text("profound_category_id"),
    profoundCategoryName: text("profound_category_name"),
    retentionDays: integer("retention_days"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("brands_org_slug_uq").on(t.organizationId, t.slug),
    index("brands_org_idx").on(t.organizationId, t.createdAt),
  ],
);

export const brandProducts = pgTable(
  "brand_products",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    description: text("description"),
    priority: integer("priority").notNull().default(0),
    url: text("url"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("brand_products_brand_idx").on(t.organizationId, t.brandId)],
);

export const competitors = pgTable(
  "competitors",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    domain: text("domain"),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("competitors_brand_idx").on(t.organizationId, t.brandId)],
);

// ────────────────────────────────────────────────────────────────────────────
// Integrations and credentials
// ────────────────────────────────────────────────────────────────────────────

export const integrations = pgTable(
  "integrations",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    vendor: vendorEnum("vendor").notNull(),
    mode: vendorModeEnum("mode").notNull().default("mock"),
    enabled: boolean("enabled").notNull().default(true),
    config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
    lastTestedAt: timestamp("last_tested_at", { withTimezone: true }),
    lastTestOutcome: text("last_test_outcome"),
    lastTestMessage: text("last_test_message"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("integrations_org_vendor_uq").on(t.organizationId, t.vendor)],
);

/** Ciphertext only. Decrypted exclusively inside adapter construction. */
export const vendorCredentials = pgTable(
  "vendor_credentials",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    integrationId: text("integration_id")
      .notNull()
      .references(() => integrations.id, { onDelete: "cascade" }),
    fieldName: text("field_name").notNull(),
    ciphertext: text("ciphertext").notNull(),
    iv: text("iv").notNull(),
    authTag: text("auth_tag").notNull(),
    keyVersion: integer("key_version").notNull().default(1),
    maskedHint: text("masked_hint").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("vendor_credentials_integration_field_uq").on(t.integrationId, t.fieldName)],
);

// ────────────────────────────────────────────────────────────────────────────
// Sources and ingestion
// ────────────────────────────────────────────────────────────────────────────

export const dataSources = pgTable(
  "data_sources",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    sourceType: sourceTypeEnum("source_type").notNull(),
    sourceSystem: sourceSystemEnum("source_system").notNull(),
    originalFilename: text("original_filename"),
    storageKey: text("storage_key"),
    byteSize: integer("byte_size"),
    contentType: text("content_type"),
    checksum: text("checksum"),
    sourceUrl: text("source_url"),
    observedAt: timestamp("observed_at", { withTimezone: true }),
    /** Sensitive sources can be kept out of every model call. */
    excludeFromModelCalls: boolean("exclude_from_model_calls").notNull().default(false),
    status: jobStatusEnum("status").notNull().default("queued"),
    documentCount: integer("document_count").notNull().default(0),
    evidenceCount: integer("evidence_count").notNull().default(0),
    piiRedactionCount: integer("pii_redaction_count").notNull().default(0),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    uploadedByUserId: text("uploaded_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("data_sources_brand_idx").on(t.organizationId, t.brandId, t.createdAt),
    index("data_sources_status_idx").on(t.status),
    uniqueIndex("data_sources_checksum_uq").on(t.brandId, t.checksum),
  ],
);

export const ingestionJobs = pgTable(
  "ingestion_jobs",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    dataSourceId: text("data_source_id")
      .notNull()
      .references(() => dataSources.id, { onDelete: "cascade" }),
    jobId: text("job_id"),
    stage: text("stage").notNull(),
    status: jobStatusEnum("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    message: text("message"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("ingestion_jobs_source_idx").on(t.dataSourceId, t.createdAt)],
);

export const sourceDocuments = pgTable(
  "source_documents",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    dataSourceId: text("data_source_id")
      .notNull()
      .references(() => dataSources.id, { onDelete: "cascade" }),
    title: text("title"),
    /** Location within the source: row number, page URL, timestamp range. */
    location: text("location").notNull(),
    sequence: integer("sequence").notNull().default(0),
    rawText: text("raw_text").notNull(),
    redactedText: text("redacted_text").notNull(),
    piiFindings: jsonb("pii_findings").$type<Record<string, number>>().notNull().default({}),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    speaker: text("speaker"),
    observedAt: timestamp("observed_at", { withTimezone: true }),
    contentHash: text("content_hash").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    index("source_documents_source_idx").on(t.dataSourceId, t.sequence),
    index("source_documents_brand_idx").on(t.organizationId, t.brandId),
    uniqueIndex("source_documents_hash_uq").on(t.dataSourceId, t.contentHash),
  ],
);

// ────────────────────────────────────────────────────────────────────────────
// Evidence
// ────────────────────────────────────────────────────────────────────────────

export const evidenceRecords = pgTable(
  "evidence_records",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    dataSourceId: text("data_source_id")
      .notNull()
      .references(() => dataSources.id, { onDelete: "cascade" }),
    sourceDocumentId: text("source_document_id")
      .notNull()
      .references(() => sourceDocuments.id, { onDelete: "cascade" }),
    sourceType: sourceTypeEnum("source_type").notNull(),
    sourceSystem: sourceSystemEnum("source_system").notNull(),
    sourceLocation: text("source_location").notNull(),
    charStart: integer("char_start"),
    charEnd: integer("char_end"),
    timestampLabel: text("timestamp_label"),
    observedAt: timestamp("observed_at", { withTimezone: true }),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull().defaultNow(),
    speaker: text("speaker"),
    rawText: text("raw_text").notNull(),
    redactedText: text("redacted_text").notNull(),
    normalizedClaim: text("normalized_claim").notNull(),
    category: evidenceCategoryEnum("category").notNull(),
    provenance: provenanceEnum("provenance").notNull(),
    journeyStage: journeyStageEnum("journey_stage").notNull().default("unknown"),
    sentiment: sentimentEnum("sentiment").notNull().default("unknown"),
    entities: jsonb("entities").$type<string[]>().notNull().default([]),
    vocabulary: jsonb("vocabulary").$type<string[]>().notNull().default([]),
    candidateSegmentLabels: jsonb("candidate_segment_labels")
      .$type<string[]>()
      .notNull()
      .default([]),
    piiStatus: piiStatusEnum("pii_status").notNull().default("none"),
    extractionConfidence: doublePrecision("extraction_confidence").notNull().default(0),
    qualityScore: doublePrecision("quality_score").notNull().default(0),
    uncertaintyNote: text("uncertainty_note"),
    createdByModel: text("created_by_model"),
    modelProvider: text("model_provider"),
    promptTemplateVersion: text("prompt_template_version"),
    schemaVersion: text("schema_version"),
    dataOrigin: dataOriginEnum("data_origin").notNull().default("mock"),
    reviewStatus: reviewStatusEnum("review_status").notNull().default("pending_review"),
    reviewedByUserId: text("reviewed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    availability: availabilityEnum("availability").notNull().default("available"),
    editedByUser: boolean("edited_by_user").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("evidence_brand_idx").on(t.organizationId, t.brandId, t.createdAt),
    index("evidence_category_idx").on(t.brandId, t.category),
    index("evidence_stage_idx").on(t.brandId, t.journeyStage),
    index("evidence_provenance_idx").on(t.brandId, t.provenance),
    index("evidence_review_idx").on(t.brandId, t.reviewStatus),
    index("evidence_observed_idx").on(t.brandId, t.observedAt),
    index("evidence_source_idx").on(t.dataSourceId),
    index("evidence_fts_idx").using(
      "gin",
      sql`to_tsvector('english', coalesce(${t.normalizedClaim}, '') || ' ' || coalesce(${t.redactedText}, ''))`,
    ),
    index("evidence_entities_idx").using("gin", t.entities),
    index("evidence_segments_idx").using("gin", t.candidateSegmentLabels),
  ],
);

export const evidenceEmbeddings = pgTable(
  "evidence_embeddings",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    evidenceId: text("evidence_id")
      .notNull()
      .references(() => evidenceRecords.id, { onDelete: "cascade" }),
    modelId: text("model_id").notNull(),
    dimensions: integer("dimensions").notNull(),
    dataOrigin: dataOriginEnum("data_origin").notNull().default("mock"),
    embedding: vector("embedding", { dimensions: 1536 }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("evidence_embeddings_uq").on(t.evidenceId, t.modelId),
    index("evidence_embeddings_brand_idx").on(t.brandId),
    index("evidence_embeddings_hnsw").using("hnsw", t.embedding.op("vector_cosine_ops")),
  ],
);

export const evidenceNotes = pgTable(
  "evidence_notes",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    evidenceId: text("evidence_id")
      .notNull()
      .references(() => evidenceRecords.id, { onDelete: "cascade" }),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    body: text("body").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("evidence_notes_evidence_idx").on(t.evidenceId, t.createdAt)],
);

// ────────────────────────────────────────────────────────────────────────────
// External research
// ────────────────────────────────────────────────────────────────────────────

export const audienceReports = pgTable(
  "audience_reports",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    vendor: vendorEnum("vendor").notNull().default("sparktoro"),
    description: text("description").notNull(),
    location: text("location"),
    vendorReportId: text("vendor_report_id"),
    requestedSections: jsonb("requested_sections").$type<string[]>().notNull().default([]),
    status: jobStatusEnum("status").notNull().default("queued"),
    creditsUsed: doublePrecision("credits_used").notNull().default(0),
    dataOrigin: dataOriginEnum("data_origin").notNull().default("mock"),
    createdByUserId: text("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("audience_reports_brand_idx").on(t.organizationId, t.brandId, t.createdAt)],
);

export const audienceSignals = pgTable(
  "audience_signals",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    audienceReportId: text("audience_report_id")
      .notNull()
      .references(() => audienceReports.id, { onDelete: "cascade" }),
    section: text("section").notNull(),
    status: jobStatusEnum("status").notNull().default("queued"),
    /** Always `externally_supported` — never converted into individual behaviour. */
    provenance: provenanceEnum("provenance").notNull().default("externally_supported"),
    normalized: jsonb("normalized").$type<Record<string, unknown>>().notNull().default({}),
    rawResponse: jsonb("raw_response").$type<Record<string, unknown>>(),
    dataOrigin: dataOriginEnum("data_origin").notNull().default("mock"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }),
    errorMessage: text("error_message"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("audience_signals_uq").on(t.audienceReportId, t.section)],
);

export const searchDatasets = pgTable(
  "search_datasets",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    vendor: vendorEnum("vendor").notNull().default("dataforseo"),
    operation: text("operation").notNull(),
    requestParams: jsonb("request_params").$type<Record<string, unknown>>().notNull().default({}),
    requestHash: text("request_hash").notNull(),
    status: jobStatusEnum("status").notNull().default("queued"),
    vendorTaskId: text("vendor_task_id"),
    normalized: jsonb("normalized").$type<Record<string, unknown>>().notNull().default({}),
    rawResponse: jsonb("raw_response").$type<Record<string, unknown>>(),
    itemCount: integer("item_count").notNull().default(0),
    costCents: doublePrecision("cost_cents").notNull().default(0),
    dataOrigin: dataOriginEnum("data_origin").notNull().default("mock"),
    errorMessage: text("error_message"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("search_datasets_brand_idx").on(t.organizationId, t.brandId, t.createdAt),
    uniqueIndex("search_datasets_hash_uq").on(t.brandId, t.requestHash),
  ],
);

// ────────────────────────────────────────────────────────────────────────────
// Segments
// ────────────────────────────────────────────────────────────────────────────

export const segmentCandidates = pgTable(
  "segment_candidates",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    runId: text("run_id").notNull(),
    label: text("label").notNull(),
    slug: text("slug").notNull(),
    definition: text("definition").notNull(),
    distinguishingVariables: jsonb("distinguishing_variables")
      .$type<string[]>()
      .notNull()
      .default([]),
    whyItChangesPrompts: text("why_it_changes_prompts").notNull(),
    sourceDistribution: jsonb("source_distribution")
      .$type<Record<string, number>>()
      .notNull()
      .default({}),
    evidenceCoverage: doublePrecision("evidence_coverage").notNull().default(0),
    coverageGaps: jsonb("coverage_gaps").$type<string[]>().notNull().default([]),
    overlaps: jsonb("overlaps")
      .$type<{ segmentSlug: string; degree: number; note: string }[]>()
      .notNull()
      .default([]),
    mergeSplitRecommendation: text("merge_split_recommendation"),
    confidence: doublePrecision("confidence").notNull().default(0),
    confidenceComponents: jsonb("confidence_components")
      .$type<Record<string, number>>()
      .notNull()
      .default({}),
    confidenceExplanation: text("confidence_explanation"),
    status: segmentStatusEnum("status").notNull().default("candidate"),
    mergedIntoId: text("merged_into_id"),
    modelProvider: text("model_provider"),
    modelId: text("model_id"),
    promptTemplateVersion: text("prompt_template_version"),
    schemaVersion: text("schema_version"),
    dataOrigin: dataOriginEnum("data_origin").notNull().default("mock"),
    evidenceCutoff: timestamp("evidence_cutoff", { withTimezone: true }),
    generatedByUserId: text("generated_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("segment_candidates_brand_idx").on(t.organizationId, t.brandId, t.createdAt),
    index("segment_candidates_run_idx").on(t.runId),
    uniqueIndex("segment_candidates_run_slug_uq").on(t.runId, t.slug),
  ],
);

export const segmentCandidateEvidence = pgTable(
  "segment_candidate_evidence",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    segmentCandidateId: text("segment_candidate_id")
      .notNull()
      .references(() => segmentCandidates.id, { onDelete: "cascade" }),
    evidenceId: text("evidence_id")
      .notNull()
      .references(() => evidenceRecords.id, { onDelete: "cascade" }),
    relation: evidenceRelationEnum("relation").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("segment_evidence_uq").on(t.segmentCandidateId, t.evidenceId, t.relation),
    index("segment_evidence_evidence_idx").on(t.evidenceId),
  ],
);

// ────────────────────────────────────────────────────────────────────────────
// Personas
// ────────────────────────────────────────────────────────────────────────────

export const personas = pgTable(
  "personas",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Stable across versions — this is what `persona:<slug>` tags use. */
    slug: text("slug").notNull(),
    segmentCandidateId: text("segment_candidate_id").references(() => segmentCandidates.id, {
      onDelete: "set null",
    }),
    currentVersionId: text("current_version_id"),
    approvedVersionId: text("approved_version_id"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("personas_brand_slug_uq").on(t.brandId, t.slug),
    index("personas_brand_idx").on(t.organizationId, t.brandId, t.createdAt),
  ],
);

export const personaVersions = pgTable(
  "persona_versions",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    personaId: text("persona_id")
      .notNull()
      .references(() => personas.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    name: text("name").notNull(),
    segmentDefinition: text("segment_definition").notNull(),
    journeyStages: jsonb("journey_stages").$type<string[]>().notNull().default([]),
    informationDepth: text("information_depth"),
    summary: text("summary"),
    /** Explicitly recorded so reviewers can see what the persona does NOT claim. */
    excludedAssumptions: jsonb("excluded_assumptions").$type<string[]>().notNull().default([]),
    status: reviewStatusEnum("status").notNull().default("draft"),
    overallConfidence: doublePrecision("overall_confidence").notNull().default(0),
    evidenceCutoff: timestamp("evidence_cutoff", { withTimezone: true }),
    sourceMix: jsonb("source_mix").$type<Record<string, number>>().notNull().default({}),
    modelProvider: text("model_provider"),
    modelId: text("model_id"),
    promptTemplateVersion: text("prompt_template_version"),
    schemaVersion: text("schema_version"),
    dataOrigin: dataOriginEnum("data_origin").notNull().default("mock"),
    generatedByUserId: text("generated_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
    approvedByUserId: text("approved_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    rejectedReason: text("rejected_reason"),
    /** Set when supporting evidence is deleted — never deletes the version. */
    needsReviewReason: text("needs_review_reason"),
    parentVersionId: text("parent_version_id"),
    changeSummary: text("change_summary"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("persona_versions_uq").on(t.personaId, t.version),
    index("persona_versions_brand_idx").on(t.organizationId, t.brandId, t.createdAt),
    index("persona_versions_status_idx").on(t.brandId, t.status),
  ],
);

export const personaFields = pgTable(
  "persona_fields",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    personaVersionId: text("persona_version_id")
      .notNull()
      .references(() => personaVersions.id, { onDelete: "cascade" }),
    fieldType: personaFieldTypeEnum("field_type").notNull(),
    sequence: integer("sequence").notNull().default(0),
    statement: text("statement").notNull(),
    provenance: provenanceEnum("provenance").notNull().default("inferred"),
    /** True when the model could not support the claim — a visible gap, not a guess. */
    insufficientEvidence: boolean("insufficient_evidence").notNull().default(false),
    evidenceCount: integer("evidence_count").notNull().default(0),
    contradictionCount: integer("contradiction_count").notNull().default(0),
    sourceMix: jsonb("source_mix").$type<Record<string, number>>().notNull().default({}),
    confidence: doublePrecision("confidence").notNull().default(0),
    confidenceComponents: jsonb("confidence_components")
      .$type<Record<string, number>>()
      .notNull()
      .default({}),
    confidenceExplanation: text("confidence_explanation"),
    locked: boolean("locked").notNull().default(false),
    markedUnsupported: boolean("marked_unsupported").notNull().default(false),
    editedByUser: boolean("edited_by_user").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("persona_fields_version_idx").on(t.personaVersionId, t.fieldType, t.sequence)],
);

export const personaFieldEvidence = pgTable(
  "persona_field_evidence",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    personaFieldId: text("persona_field_id")
      .notNull()
      .references(() => personaFields.id, { onDelete: "cascade" }),
    evidenceId: text("evidence_id")
      .notNull()
      .references(() => evidenceRecords.id, { onDelete: "cascade" }),
    relation: evidenceRelationEnum("relation").notNull(),
    /** Flipped when the source is deleted; the link is kept for auditability. */
    unavailable: boolean("unavailable").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("persona_field_evidence_uq").on(t.personaFieldId, t.evidenceId, t.relation),
    index("persona_field_evidence_evidence_idx").on(t.evidenceId),
  ],
);

// ────────────────────────────────────────────────────────────────────────────
// Prompts
// ────────────────────────────────────────────────────────────────────────────

export const promptSets = pgTable(
  "prompt_sets",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    personaId: text("persona_id")
      .notNull()
      .references(() => personas.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    currentVersionId: text("current_version_id"),
    approvedVersionId: text("approved_version_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("prompt_sets_brand_slug_uq").on(t.brandId, t.slug),
    index("prompt_sets_brand_idx").on(t.organizationId, t.brandId, t.createdAt),
  ],
);

export const promptSetVersions = pgTable(
  "prompt_set_versions",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    promptSetId: text("prompt_set_id")
      .notNull()
      .references(() => promptSets.id, { onDelete: "cascade" }),
    personaVersionId: text("persona_version_id")
      .notNull()
      .references(() => personaVersions.id, { onDelete: "restrict" }),
    version: integer("version").notNull(),
    status: reviewStatusEnum("status").notNull().default("draft"),
    promptCount: integer("prompt_count").notNull().default(0),
    controlCount: integer("control_count").notNull().default(0),
    modelProvider: text("model_provider"),
    modelId: text("model_id"),
    promptTemplateVersion: text("prompt_template_version"),
    schemaVersion: text("schema_version"),
    dataOrigin: dataOriginEnum("data_origin").notNull().default("mock"),
    evidenceCutoff: timestamp("evidence_cutoff", { withTimezone: true }),
    generatedByUserId: text("generated_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
    approvedByUserId: text("approved_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    rejectedReason: text("rejected_reason"),
    parentVersionId: text("parent_version_id"),
    changeSummary: text("change_summary"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("prompt_set_versions_uq").on(t.promptSetId, t.version),
    index("prompt_set_versions_brand_idx").on(t.organizationId, t.brandId, t.createdAt),
  ],
);

export const prompts = pgTable(
  "prompts",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    promptSetVersionId: text("prompt_set_version_id")
      .notNull()
      .references(() => promptSetVersions.id, { onDelete: "cascade" }),
    personaId: text("persona_id")
      .notNull()
      .references(() => personas.id, { onDelete: "cascade" }),
    personaVersionId: text("persona_version_id")
      .notNull()
      .references(() => personaVersions.id, { onDelete: "restrict" }),
    promptType: promptTypeEnum("prompt_type").notNull().default("persona"),
    topic: text("topic").notNull(),
    promptText: text("prompt_text").notNull(),
    normalizedHash: text("normalized_hash").notNull(),
    informationNeed: text("information_need").notNull(),
    intent: promptIntentEnum("intent").notNull(),
    journeyStage: journeyStageEnum("journey_stage").notNull().default("unknown"),
    constraintsUsed: jsonb("constraints_used").$type<string[]>().notNull().default([]),
    decisionCriteriaUsed: jsonb("decision_criteria_used").$type<string[]>().notNull().default([]),
    vocabularyUsed: jsonb("vocabulary_used").$type<string[]>().notNull().default([]),
    /**
     * The persona fields this prompt was derived from (§18 persona-field drawer).
     * Stored as ids rather than matched back by statement text, so a reviewer
     * editing the persona wording never breaks the link.
     */
    personaFieldIds: jsonb("persona_field_ids").$type<string[]>().notNull().default([]),
    expectedAnswerElements: jsonb("expected_answer_elements")
      .$type<string[]>()
      .notNull()
      .default([]),
    /** §17 — "explain why every prompt was included". */
    inclusionRationale: text("inclusion_rationale").notNull(),
    confidence: doublePrecision("confidence").notNull().default(0),
    trackingPriority: trackingPriorityEnum("tracking_priority").notNull().default("medium"),
    executionMode: executionModeEnum("execution_mode").notNull().default("standalone"),
    reviewStatus: reviewStatusEnum("review_status").notNull().default("pending_review"),
    profoundMetadata: jsonb("profound_metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    profoundSyncState: syncStateEnum("profound_sync_state").notNull().default("draft"),
    duplicateOfPromptId: text("duplicate_of_prompt_id"),
    /** §18 duplicate warning — advisory only; the reviewer decides (see prompt-dedupe). */
    similarityWarning: jsonb("similarity_warning").$type<{
      promptId: string;
      score: number;
      text: string;
      kind: "exact" | "lexical" | "semantic";
      promptSetLabel?: string;
    } | null>(),
    editedByUser: boolean("edited_by_user").notNull().default(false),
    dataOrigin: dataOriginEnum("data_origin").notNull().default("mock"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("prompts_set_hash_uq").on(t.promptSetVersionId, t.normalizedHash),
    index("prompts_set_idx").on(t.promptSetVersionId, t.intent, t.journeyStage),
    index("prompts_brand_idx").on(t.organizationId, t.brandId),
    index("prompts_persona_idx").on(t.personaVersionId),
  ],
);

export const promptEmbeddings = pgTable(
  "prompt_embeddings",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    promptId: text("prompt_id")
      .notNull()
      .references(() => prompts.id, { onDelete: "cascade" }),
    modelId: text("model_id").notNull(),
    dataOrigin: dataOriginEnum("data_origin").notNull().default("mock"),
    embedding: vector("embedding", { dimensions: 1536 }).notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("prompt_embeddings_uq").on(t.promptId, t.modelId),
    index("prompt_embeddings_hnsw").using("hnsw", t.embedding.op("vector_cosine_ops")),
  ],
);

export const promptEvidence = pgTable(
  "prompt_evidence",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    promptId: text("prompt_id")
      .notNull()
      .references(() => prompts.id, { onDelete: "cascade" }),
    evidenceId: text("evidence_id")
      .notNull()
      .references(() => evidenceRecords.id, { onDelete: "cascade" }),
    unavailable: boolean("unavailable").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("prompt_evidence_uq").on(t.promptId, t.evidenceId),
    index("prompt_evidence_evidence_idx").on(t.evidenceId),
  ],
);

/** Persona prompt ↔ its generic control. Survives editing either side. */
export const promptPairs = pgTable(
  "prompt_pairs",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    promptSetVersionId: text("prompt_set_version_id")
      .notNull()
      .references(() => promptSetVersions.id, { onDelete: "cascade" }),
    personaPromptId: text("persona_prompt_id")
      .notNull()
      .references(() => prompts.id, { onDelete: "cascade" }),
    controlPromptId: text("control_prompt_id")
      .notNull()
      .references(() => prompts.id, { onDelete: "cascade" }),
    rationale: text("rationale"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("prompt_pairs_uq").on(t.personaPromptId, t.controlPromptId),
    index("prompt_pairs_set_idx").on(t.promptSetVersionId),
  ],
);

// ────────────────────────────────────────────────────────────────────────────
// Profound
// ────────────────────────────────────────────────────────────────────────────

export const profoundConnections = pgTable(
  "profound_connections",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    integrationId: text("integration_id")
      .notNull()
      .references(() => integrations.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    profoundOrganizationId: text("profound_organization_id"),
    profoundOrganizationName: text("profound_organization_name"),
    lastSyncedConfigAt: timestamp("last_synced_config_at", { withTimezone: true }),
    cachedConfig: jsonb("cached_config").$type<Record<string, unknown>>().notNull().default({}),
    dataOrigin: dataOriginEnum("data_origin").notNull().default("mock"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("profound_connections_org_uq").on(t.organizationId, t.integrationId)],
);

export const profoundCategoryMappings = pgTable(
  "profound_category_mappings",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    connectionId: text("connection_id")
      .notNull()
      .references(() => profoundConnections.id, { onDelete: "cascade" }),
    profoundCategoryId: text("profound_category_id").notNull(),
    profoundCategoryName: text("profound_category_name").notNull(),
    status: mappingStatusEnum("status").notNull().default("mapped"),
    lastValidatedAt: timestamp("last_validated_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("profound_category_mappings_uq").on(t.brandId, t.profoundCategoryId)],
);

/** §20 — never silently map to an unrelated persona. */
export const profoundPersonaMappings = pgTable(
  "profound_persona_mappings",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    personaId: text("persona_id")
      .notNull()
      .references(() => personas.id, { onDelete: "cascade" }),
    personaVersionId: text("persona_version_id")
      .notNull()
      .references(() => personaVersions.id, { onDelete: "cascade" }),
    profoundCategoryId: text("profound_category_id").notNull(),
    profoundPersonaId: text("profound_persona_id"),
    profoundPersonaName: text("profound_persona_name"),
    /** Deterministic `persona:<slug>` fallback when no Profound persona exists. */
    fallbackPersonaTag: text("fallback_persona_tag").notNull(),
    status: mappingStatusEnum("status").notNull().default("unmapped"),
    note: text("note"),
    lastValidatedAt: timestamp("last_validated_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("profound_persona_mappings_uq").on(t.personaVersionId, t.profoundCategoryId),
    index("profound_persona_mappings_brand_idx").on(t.organizationId, t.brandId),
  ],
);

/**
 * The idempotency guarantee (ADR-007). The unique index on
 * (organizationId, profoundCategoryId, normalizedHash) means the same
 * normalized prompt cannot be created twice in the same category.
 */
export const profoundPromptLinks = pgTable(
  "profound_prompt_links",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    promptId: text("prompt_id")
      .notNull()
      .references(() => prompts.id, { onDelete: "cascade" }),
    promptSetVersionId: text("prompt_set_version_id")
      .notNull()
      .references(() => promptSetVersions.id, { onDelete: "cascade" }),
    profoundCategoryId: text("profound_category_id").notNull(),
    profoundPromptId: text("profound_prompt_id").notNull(),
    normalizedHash: text("normalized_hash").notNull(),
    requestHash: text("request_hash").notNull(),
    syncJobId: text("sync_job_id"),
    dataOrigin: dataOriginEnum("data_origin").notNull().default("mock"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("profound_prompt_links_idempotency_uq").on(
      t.organizationId,
      t.profoundCategoryId,
      t.normalizedHash,
    ),
    index("profound_prompt_links_prompt_idx").on(t.promptId),
    index("profound_prompt_links_profound_idx").on(t.profoundPromptId),
  ],
);

/** §24 — the sync receipt. Insert-only once terminal. */
export const profoundSyncJobs = pgTable(
  "profound_sync_jobs",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    promptSetVersionId: text("prompt_set_version_id")
      .notNull()
      .references(() => promptSetVersions.id, { onDelete: "cascade" }),
    personaId: text("persona_id")
      .notNull()
      .references(() => personas.id, { onDelete: "cascade" }),
    personaVersionId: text("persona_version_id")
      .notNull()
      .references(() => personaVersions.id, { onDelete: "restrict" }),
    personaMappingId: text("persona_mapping_id").references(() => profoundPersonaMappings.id, {
      onDelete: "set null",
    }),
    profoundCategoryId: text("profound_category_id").notNull(),
    profoundCategoryName: text("profound_category_name"),
    profoundPersonaId: text("profound_persona_id"),
    fallbackPersonaTag: text("fallback_persona_tag"),
    region: text("region"),
    language: text("language"),
    platforms: jsonb("platforms").$type<string[]>().notNull().default([]),
    analysisTypes: jsonb("analysis_types").$type<string[]>().notNull().default([]),
    state: syncStateEnum("state").notNull().default("draft"),
    personaPromptCount: integer("persona_prompt_count").notNull().default(0),
    controlPromptCount: integer("control_prompt_count").notNull().default(0),
    duplicateCount: integer("duplicate_count").notNull().default(0),
    createdCount: integer("created_count").notNull().default(0),
    failedCount: integer("failed_count").notNull().default(0),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    dryRunRequestHash: text("dry_run_request_hash"),
    dryRunResponse: jsonb("dry_run_response").$type<Record<string, unknown>>(),
    dryRunAt: timestamp("dry_run_at", { withTimezone: true }),
    finalResponse: jsonb("final_response").$type<Record<string, unknown>>(),
    requestHash: text("request_hash"),
    responseHash: text("response_hash"),
    errors: jsonb("errors")
      .$type<{ promptId: string; message: string; code?: string }[]>()
      .notNull()
      .default([]),
    dataOrigin: dataOriginEnum("data_origin").notNull().default("mock"),
    initiatedByUserId: text("initiated_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    approvedByUserId: text("approved_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    retryOfSyncJobId: text("retry_of_sync_job_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("profound_sync_jobs_brand_idx").on(t.organizationId, t.brandId, t.createdAt),
    index("profound_sync_jobs_set_idx").on(t.promptSetVersionId),
  ],
);

export const profoundSyncItems = pgTable(
  "profound_sync_items",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    syncJobId: text("sync_job_id")
      .notNull()
      .references(() => profoundSyncJobs.id, { onDelete: "cascade" }),
    promptId: text("prompt_id")
      .notNull()
      .references(() => prompts.id, { onDelete: "cascade" }),
    promptType: promptTypeEnum("prompt_type").notNull(),
    normalizedHash: text("normalized_hash").notNull(),
    outcome: syncItemOutcomeEnum("outcome").notNull().default("pending"),
    profoundPromptId: text("profound_prompt_id"),
    errorMessage: text("error_message"),
    errorCode: text("error_code"),
    retryable: boolean("retryable").notNull().default(false),
    payload: jsonb("payload").$type<Record<string, unknown>>(),
    response: jsonb("response").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("profound_sync_items_uq").on(t.syncJobId, t.promptId),
    index("profound_sync_items_outcome_idx").on(t.syncJobId, t.outcome),
  ],
);

/**
 * §25 — Profound visibility/citations bucket rows.
 *
 * Renamed from `profound_result_snapshots` (2026-08-10): the real Profound v2
 * reporting API returns one row per (asset x requested group_by dimension)
 * bucket — there is no per-execution "run" concept, no mention count, no
 * brand-mentioned flag, no raw answer text. Every column here has a direct
 * real-API source; nothing is fabricated to fill a gap the vendor doesn't
 * cover (see docs/integrations.md's Profound section and ADR-011).
 * Immutable once written. Never recomputed, never relabelled — re-running
 * retrieval for an overlapping window is a no-op for buckets already stored,
 * enforced by the unique index below.
 */
export const profoundResultBuckets = pgTable(
  "profound_result_buckets",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    promptId: text("prompt_id").references(() => prompts.id, { onDelete: "set null" }),
    profoundPromptId: text("profound_prompt_id").notNull(),
    profoundCategoryId: text("profound_category_id").notNull(),
    bucketDate: timestamp("bucket_date", { withTimezone: true }).notNull(),
    modelId: text("model_id").notNull(),
    model: text("model"),
    /** Empty-string sentinel (never null) so the unique index below dedupes correctly — Postgres treats NULL as distinct from NULL. */
    topicId: text("topic_id").notNull().default(""),
    topic: text("topic"),
    regionId: text("region_id").notNull().default(""),
    region: text("region"),
    personaId: text("persona_id").notNull().default(""),
    profoundPersona: text("profound_persona"),
    asset: text("asset").notNull(),
    assetOwned: boolean("asset_owned"),
    rank: integer("rank"),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    visibilityScore: doublePrecision("visibility_score"),
    shareOfVoice: doublePrecision("share_of_voice"),
    averagePosition: doublePrecision("average_position"),
    citationCount: integer("citation_count"),
    citationShare: doublePrecision("citation_share"),
    citationDomains: jsonb("citation_domains").$type<string[]>().notNull().default([]),
    citations: jsonb("citations").$type<Record<string, unknown>[]>().notNull().default([]),
    rawResponse: jsonb("raw_response").$type<Record<string, unknown>>(),
    dataOrigin: dataOriginEnum("data_origin").notNull().default("mock"),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("profound_result_buckets_uq").on(
      t.organizationId,
      t.profoundPromptId,
      t.bucketDate,
      t.modelId,
      t.topicId,
      t.regionId,
      t.personaId,
      t.asset,
    ),
    index("profound_result_buckets_brand_idx").on(t.organizationId, t.brandId, t.bucketDate),
    index("profound_result_buckets_prompt_idx").on(t.promptId, t.bucketDate),
  ],
);

/**
 * §25 — Profound sentiment bucket rows.
 *
 * Kept separate from `profoundResultBuckets`: the real `/v2/reports/sentiment`
 * endpoint requires an `asset` param and allows `group_by` dimensions
 * (`tag`, `theme`, `claim`, `run`, `competitor`) that visibility/citations
 * don't have, so it cannot share a bucket key with them. `profoundRun` here
 * is Profound's own "run" group_by dimension for sentiment specifically —
 * a real vendor concept, unrelated to and never to be confused with the
 * retired per-execution `run_id` this schema used to invent.
 */
export const profoundSentimentBuckets = pgTable(
  "profound_sentiment_buckets",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    promptId: text("prompt_id").references(() => prompts.id, { onDelete: "set null" }),
    profoundPromptId: text("profound_prompt_id").notNull(),
    profoundCategoryId: text("profound_category_id").notNull(),
    asset: text("asset").notNull(),
    bucketDate: timestamp("bucket_date", { withTimezone: true }).notNull(),
    modelId: text("model_id").notNull(),
    model: text("model"),
    /** Empty-string sentinels (never null) so the unique index dedupes correctly regardless of which optional group_by dimensions a given query requested. */
    topicId: text("topic_id").notNull().default(""),
    topic: text("topic"),
    regionId: text("region_id").notNull().default(""),
    region: text("region"),
    personaId: text("persona_id").notNull().default(""),
    profoundPersona: text("profound_persona"),
    tag: text("tag").notNull().default(""),
    theme: text("theme").notNull().default(""),
    claim: text("claim").notNull().default(""),
    profoundRun: text("profound_run").notNull().default(""),
    competitor: text("competitor").notNull().default(""),
    positiveSentiment: doublePrecision("positive_sentiment"),
    negativeSentiment: doublePrecision("negative_sentiment"),
    occurrence: doublePrecision("occurrence"),
    citedWebsites: jsonb("cited_websites").$type<string[]>().notNull().default([]),
    rank: integer("rank"),
    rawResponse: jsonb("raw_response").$type<Record<string, unknown>>(),
    dataOrigin: dataOriginEnum("data_origin").notNull().default("mock"),
    syncedAt: timestamp("synced_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("profound_sentiment_buckets_uq").on(
      t.organizationId,
      t.profoundPromptId,
      t.asset,
      t.bucketDate,
      t.modelId,
      t.topicId,
      t.regionId,
      t.personaId,
      t.tag,
      t.theme,
      t.claim,
      t.profoundRun,
      t.competitor,
    ),
    index("profound_sentiment_buckets_brand_idx").on(t.organizationId, t.brandId, t.bucketDate),
  ],
);

/**
 * Self-computed answer-coverage estimate (replaces Profound-sourced
 * missing-expected-elements detection — the real API exposes no raw answer
 * text at all, so this product estimates coverage itself via its own LLM
 * call). Always `dataOrigin: "local"` — "calculated by this application, not
 * a vendor" (see `OriginBadge`) — never confused with Profound-confirmed data.
 * Keyed by promptId + a content hash of the expected elements so it's
 * cacheable and re-runnable without recomputing on every job.
 */
export const promptAnswerCoverageEstimates = pgTable(
  "prompt_answer_coverage_estimates",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    promptId: text("prompt_id")
      .notNull()
      .references(() => prompts.id, { onDelete: "cascade" }),
    expectedElementsHash: text("expected_elements_hash").notNull(),
    covered: jsonb("covered").$type<string[]>().notNull().default([]),
    missing: jsonb("missing").$type<string[]>().notNull().default([]),
    confidence: doublePrecision("confidence").notNull(),
    rationale: text("rationale").notNull(),
    modelProvider: text("model_provider"),
    modelId: text("model_id"),
    promptTemplateVersion: text("prompt_template_version"),
    dataOrigin: dataOriginEnum("data_origin").notNull().default("local"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("prompt_answer_coverage_estimates_uq").on(t.promptId, t.expectedElementsHash),
    index("prompt_answer_coverage_estimates_brand_idx").on(t.organizationId, t.brandId),
  ],
);

// ────────────────────────────────────────────────────────────────────────────
// Content workflows
// ────────────────────────────────────────────────────────────────────────────

export const pageInventory = pgTable(
  "page_inventory",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    canonicalUrl: text("canonical_url").notNull(),
    title: text("title"),
    pageType: text("page_type"),
    headings: jsonb("headings").$type<string[]>().notNull().default([]),
    summary: text("summary"),
    wordCount: integer("word_count").notNull().default(0),
    internalLinks: jsonb("internal_links").$type<string[]>().notNull().default([]),
    structuredData: jsonb("structured_data")
      .$type<Record<string, unknown>[]>()
      .notNull()
      .default([]),
    dataSourceId: text("data_source_id").references(() => dataSources.id, { onDelete: "set null" }),
    lastCrawledAt: timestamp("last_crawled_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("page_inventory_uq").on(t.brandId, t.canonicalUrl)],
);

export const contentOpportunities = pgTable(
  "content_opportunities",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    personaId: text("persona_id").references(() => personas.id, { onDelete: "set null" }),
    personaVersionId: text("persona_version_id").references(() => personaVersions.id, {
      onDelete: "set null",
    }),
    promptSetVersionId: text("prompt_set_version_id").references(() => promptSetVersions.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    problemStatement: text("problem_statement").notNull(),
    performanceGap: text("performance_gap").notNull(),
    gapType: gapTypeEnum("gap_type").notNull(),
    recommendation: recommendationTypeEnum("recommendation").notNull(),
    recommendationRationale: text("recommendation_rationale").notNull(),
    relevantProfoundPromptIds: jsonb("relevant_profound_prompt_ids")
      .$type<string[]>()
      .notNull()
      .default([]),
    relevantBucketIds: jsonb("relevant_bucket_ids").$type<string[]>().notNull().default([]),
    competitors: jsonb("competitors").$type<string[]>().notNull().default([]),
    citationSources: jsonb("citation_sources").$type<string[]>().notNull().default([]),
    missingAnswerElements: jsonb("missing_answer_elements").$type<string[]>().notNull().default([]),
    searchDemand: jsonb("search_demand").$type<Record<string, unknown>>().notNull().default({}),
    existingPageUrl: text("existing_page_url"),
    priority: priorityEnum("priority").notNull().default("p2"),
    estimatedEffort: effortEnum("estimated_effort").notNull().default("medium"),
    evidenceIds: jsonb("evidence_ids").$type<string[]>().notNull().default([]),
    validationMethod: text("validation_method").notNull(),
    modelProvider: text("model_provider"),
    modelId: text("model_id"),
    promptTemplateVersion: text("prompt_template_version"),
    schemaVersion: text("schema_version"),
    dataOrigin: dataOriginEnum("data_origin").notNull().default("mock"),
    evidenceCutoff: timestamp("evidence_cutoff", { withTimezone: true }),
    reviewStatus: reviewStatusEnum("review_status").notNull().default("pending_review"),
    generatedByUserId: text("generated_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("content_opportunities_brand_idx").on(t.organizationId, t.brandId, t.createdAt),
    index("content_opportunities_persona_idx").on(t.personaVersionId),
  ],
);

export const contentBriefs = pgTable(
  "content_briefs",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    opportunityId: text("opportunity_id").references(() => contentOpportunities.id, {
      onDelete: "set null",
    }),
    personaId: text("persona_id").references(() => personas.id, { onDelete: "set null" }),
    personaVersionId: text("persona_version_id").references(() => personaVersions.id, {
      onDelete: "set null",
    }),
    promptSetVersionId: text("prompt_set_version_id").references(() => promptSetVersions.id, {
      onDelete: "set null",
    }),
    version: integer("version").notNull().default(1),
    workingTitle: text("working_title").notNull(),
    /** All 27 required brief sections, validated by a Zod schema on write. */
    body: jsonb("body").$type<Record<string, unknown>>().notNull(),
    evidenceIds: jsonb("evidence_ids").$type<string[]>().notNull().default([]),
    profoundPromptIds: jsonb("profound_prompt_ids").$type<string[]>().notNull().default([]),
    bucketIds: jsonb("bucket_ids").$type<string[]>().notNull().default([]),
    modelProvider: text("model_provider"),
    modelId: text("model_id"),
    promptTemplateVersion: text("prompt_template_version"),
    schemaVersion: text("schema_version"),
    dataOrigin: dataOriginEnum("data_origin").notNull().default("mock"),
    evidenceCutoff: timestamp("evidence_cutoff", { withTimezone: true }),
    reviewStatus: reviewStatusEnum("review_status").notNull().default("draft"),
    approvedByUserId: text("approved_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    generatedByUserId: text("generated_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    parentBriefId: text("parent_brief_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("content_briefs_brand_idx").on(t.organizationId, t.brandId, t.createdAt)],
);

export const pageAudits = pgTable(
  "page_audits",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    brandId: text("brand_id")
      .notNull()
      .references(() => brands.id, { onDelete: "cascade" }),
    personaId: text("persona_id").references(() => personas.id, { onDelete: "set null" }),
    personaVersionId: text("persona_version_id").references(() => personaVersions.id, {
      onDelete: "set null",
    }),
    promptSetVersionId: text("prompt_set_version_id").references(() => promptSetVersions.id, {
      onDelete: "set null",
    }),
    scope: auditScopeEnum("scope").notNull().default("homepage"),
    url: text("url"),
    pageTitle: text("page_title"),
    pageContent: text("page_content").notNull(),
    version: integer("version").notNull().default(1),
    summary: text("summary").notNull(),
    /** Findings that belong on supporting pages, not the audited page (§30). */
    supportingPageRecommendations: jsonb("supporting_page_recommendations")
      .$type<{ need: string; suggestedPageType: string; rationale: string }[]>()
      .notNull()
      .default([]),
    scores: jsonb("scores").$type<Record<string, number>>().notNull().default({}),
    modelProvider: text("model_provider"),
    modelId: text("model_id"),
    promptTemplateVersion: text("prompt_template_version"),
    schemaVersion: text("schema_version"),
    dataOrigin: dataOriginEnum("data_origin").notNull().default("mock"),
    evidenceCutoff: timestamp("evidence_cutoff", { withTimezone: true }),
    reviewStatus: reviewStatusEnum("review_status").notNull().default("draft"),
    approvedByUserId: text("approved_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    generatedByUserId: text("generated_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("page_audits_brand_idx").on(t.organizationId, t.brandId, t.createdAt)],
);

export const auditFindings = pgTable(
  "audit_findings",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    pageAuditId: text("page_audit_id")
      .notNull()
      .references(() => pageAudits.id, { onDelete: "cascade" }),
    sequence: integer("sequence").notNull().default(0),
    severity: severityEnum("severity").notNull(),
    pageElement: text("page_element").notNull(),
    pageExcerpt: text("page_excerpt"),
    personaRequirement: text("persona_requirement").notNull(),
    explanation: text("explanation").notNull(),
    recommendedChange: text("recommended_change").notNull(),
    suggestedReplacement: text("suggested_replacement"),
    validationMethod: text("validation_method").notNull(),
    evidenceIds: jsonb("evidence_ids").$type<string[]>().notNull().default([]),
    relatedPromptIds: jsonb("related_prompt_ids").$type<string[]>().notNull().default([]),
    relatedProfoundPromptIds: jsonb("related_profound_prompt_ids")
      .$type<string[]>()
      .notNull()
      .default([]),
    belongsOnSupportingPage: boolean("belongs_on_supporting_page").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("audit_findings_audit_idx").on(t.pageAuditId, t.sequence)],
);

// ────────────────────────────────────────────────────────────────────────────
// Configuration, evaluation, usage, audit
// ────────────────────────────────────────────────────────────────────────────

export const modelConfigurations = pgTable(
  "model_configurations",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    tier: text("tier").notNull(),
    provider: text("provider").notNull(),
    modelId: text("model_id").notNull(),
    temperature: doublePrecision("temperature"),
    maxOutputTokens: integer("max_output_tokens"),
    notes: text("notes"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("model_configurations_uq").on(t.organizationId, t.tier)],
);

export const promptTemplates = pgTable(
  "prompt_templates",
  {
    id: text("id").primaryKey(),
    templateId: text("template_id").notNull(),
    version: text("version").notNull(),
    purpose: text("purpose").notNull(),
    systemPrompt: text("system_prompt").notNull(),
    userTemplate: text("user_template").notNull(),
    schemaVersion: text("schema_version").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("prompt_templates_uq").on(t.templateId, t.version)],
);

export const internalEvaluationRuns = pgTable(
  "internal_evaluation_runs",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    brandId: text("brand_id").references(() => brands.id, { onDelete: "cascade" }),
    suite: text("suite").notNull(),
    modelProvider: text("model_provider"),
    modelId: text("model_id"),
    promptTemplateVersion: text("prompt_template_version"),
    schemaVersion: text("schema_version"),
    personaVersionId: text("persona_version_id"),
    promptSetVersionId: text("prompt_set_version_id"),
    status: jobStatusEnum("status").notNull().default("queued"),
    passedCount: integer("passed_count").notNull().default(0),
    failedCount: integer("failed_count").notNull().default(0),
    score: doublePrecision("score"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    triggeredByUserId: text("triggered_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  (t) => [index("internal_evaluation_runs_idx").on(t.organizationId, t.suite, t.createdAt)],
);

export const internalEvaluationResults = pgTable(
  "internal_evaluation_results",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    runId: text("run_id")
      .notNull()
      .references(() => internalEvaluationRuns.id, { onDelete: "cascade" }),
    checkName: text("check_name").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    passed: boolean("passed").notNull(),
    score: doublePrecision("score"),
    detail: text("detail"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("internal_evaluation_results_run_idx").on(t.runId, t.passed)],
);

export const vendorUsage = pgTable(
  "vendor_usage",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    brandId: text("brand_id").references(() => brands.id, { onDelete: "cascade" }),
    vendor: vendorEnum("vendor").notNull(),
    operation: text("operation").notNull(),
    mode: vendorModeEnum("mode").notNull(),
    jobId: text("job_id"),
    durationMs: integer("duration_ms").notNull().default(0),
    retryCount: integer("retry_count").notNull().default(0),
    outcome: text("outcome").notNull(),
    errorCode: text("error_code"),
    tokensIn: integer("tokens_in"),
    tokensOut: integer("tokens_out"),
    credits: doublePrecision("credits"),
    costCents: doublePrecision("cost_cents"),
    requestHash: text("request_hash"),
    createdAt: createdAt(),
  },
  (t) => [
    index("vendor_usage_org_idx").on(t.organizationId, t.createdAt),
    index("vendor_usage_vendor_idx").on(t.vendor, t.createdAt),
  ],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    brandId: text("brand_id").references(() => brands.id, { onDelete: "cascade" }),
    actorUserId: text("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ip: text("ip"),
    createdAt: createdAt(),
  },
  (t) => [
    index("audit_logs_org_idx").on(t.organizationId, t.createdAt),
    index("audit_logs_entity_idx").on(t.entityType, t.entityId),
  ],
);

// ────────────────────────────────────────────────────────────────────────────
// Queue
// ────────────────────────────────────────────────────────────────────────────

export const jobs = pgTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(),
    organizationId: text("organization_id"),
    brandId: text("brand_id"),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    status: jobStatusEnum("status").notNull().default("queued"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(3),
    runAfter: timestamp("run_after", { withTimezone: true }).notNull().defaultNow(),
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    lockedBy: text("locked_by"),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    lastError: text("last_error"),
    result: jsonb("result").$type<Record<string, unknown>>(),
    idempotencyKey: text("idempotency_key"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("jobs_claim_idx").on(t.status, t.runAfter),
    index("jobs_scope_idx").on(t.organizationId, t.brandId, t.createdAt),
    uniqueIndex("jobs_idempotency_uq").on(t.idempotencyKey),
  ],
);

// ────────────────────────────────────────────────────────────────────────────
// Relations (used by drizzle query API where convenient)
// ────────────────────────────────────────────────────────────────────────────

export const organizationsRelations = relations(organizations, ({ many }) => ({
  memberships: many(memberships),
  brands: many(brands),
}));

export const usersRelations = relations(users, ({ many }) => ({
  memberships: many(memberships),
  sessions: many(sessions),
}));

export const membershipsRelations = relations(memberships, ({ one }) => ({
  organization: one(organizations, {
    fields: [memberships.organizationId],
    references: [organizations.id],
  }),
  user: one(users, { fields: [memberships.userId], references: [users.id] }),
}));

export const brandsRelations = relations(brands, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [brands.organizationId],
    references: [organizations.id],
  }),
  products: many(brandProducts),
  competitors: many(competitors),
  dataSources: many(dataSources),
  personas: many(personas),
}));

export const evidenceRecordsRelations = relations(evidenceRecords, ({ one, many }) => ({
  dataSource: one(dataSources, {
    fields: [evidenceRecords.dataSourceId],
    references: [dataSources.id],
  }),
  sourceDocument: one(sourceDocuments, {
    fields: [evidenceRecords.sourceDocumentId],
    references: [sourceDocuments.id],
  }),
  embeddings: many(evidenceEmbeddings),
  notes: many(evidenceNotes),
}));

export const personasRelations = relations(personas, ({ many }) => ({
  versions: many(personaVersions),
  promptSets: many(promptSets),
}));

export const personaVersionsRelations = relations(personaVersions, ({ one, many }) => ({
  persona: one(personas, { fields: [personaVersions.personaId], references: [personas.id] }),
  fields: many(personaFields),
}));

export const personaFieldsRelations = relations(personaFields, ({ one, many }) => ({
  version: one(personaVersions, {
    fields: [personaFields.personaVersionId],
    references: [personaVersions.id],
  }),
  evidenceLinks: many(personaFieldEvidence),
}));

export const promptSetVersionsRelations = relations(promptSetVersions, ({ one, many }) => ({
  promptSet: one(promptSets, {
    fields: [promptSetVersions.promptSetId],
    references: [promptSets.id],
  }),
  prompts: many(prompts),
}));

export const promptsRelations = relations(prompts, ({ one, many }) => ({
  setVersion: one(promptSetVersions, {
    fields: [prompts.promptSetVersionId],
    references: [promptSetVersions.id],
  }),
  evidenceLinks: many(promptEvidence),
  profoundLinks: many(profoundPromptLinks),
}));

export const profoundSyncJobsRelations = relations(profoundSyncJobs, ({ many }) => ({
  items: many(profoundSyncItems),
}));

export const pageAuditsRelations = relations(pageAudits, ({ many }) => ({
  findings: many(auditFindings),
}));
