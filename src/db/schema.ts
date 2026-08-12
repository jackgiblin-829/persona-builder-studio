/**
 * Persona Builder Studio — clean project-first schema.
 *
 * A Project is the isolation boundary for uploaded research, SparkToro data,
 * personas and prompts. Generated artifacts are immutable versions and their
 * stable parent rows only point at the last fully completed version.
 */
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
} from "drizzle-orm/pg-core";
import type { MarketResearchBriefContent } from "@/contracts/market-research";
import type {
  PromptGenerationMetrics,
  PromptQualityIssue,
  PromptQualityScores,
} from "@/contracts/prompt-generation";
import {
  EMPTY_PROMPT_STRATEGY,
  type PromptStrategy,
  type QuestionArchetype,
} from "@/contracts/prompt-strategy";
import type { PersonaProfile } from "@/contracts/studio";
export { GEO_CATEGORIES } from "@/contracts/studio";
export type {
  AudienceDistribution,
  GeoCategory,
  PersonaInsight,
  PersonaProfile,
} from "@/contracts/studio";

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const roleEnum = pgEnum("role", ["owner", "admin", "editor", "viewer"]);
export const vendorEnum = pgEnum("vendor", ["openai", "sparktoro", "storage"]);
export const vendorModeEnum = pgEnum("vendor_mode", ["mock", "live"]);
export const dataOriginEnum = pgEnum("data_origin", ["mock", "live", "local"]);
export const projectMarketEnum = pgEnum("project_market", ["US", "CA", "UK"]);
export const sourceKindEnum = pgEnum("source_kind", ["first_party", "sparktoro"]);
export const sourceStatusEnum = pgEnum("source_status", [
  "queued",
  "processing",
  "completed",
  "completed_with_warnings",
  "failed",
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
export const workflowTypeEnum = pgEnum("workflow_type", [
  "market_research",
  "persona_generation",
  "prompt_generation",
]);
export const workflowStatusEnum = pgEnum("workflow_status", [
  "queued",
  "running",
  "completed",
  "completed_with_warnings",
  "failed",
]);
export const workflowStageEnum = pgEnum("workflow_stage", [
  "researching_market",
  "processing_sources",
  "researching_audience",
  "identifying_segments",
  "creating_personas",
  "creating_clusters",
  "creating_prompts",
  "validating",
  "ready",
]);
export const promptVersionLifecycleEnum = pgEnum("prompt_version_lifecycle", [
  "draft",
  "current",
  "superseded",
]);

export type PromptRubricScores = PromptQualityScores;
export const geoCategoryEnum = pgEnum("geo_category", [
  "problem_discovery",
  "foundational_education",
  "solution_recommendations",
  "comparisons_and_alternatives",
  "evaluation_trust_and_proof",
  "objections_and_risk",
  "purchase_and_selection",
  "implementation_and_optimization",
]);

// Identity and tenancy
export const organizations = pgTable("organizations", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
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
  (table) => [
    uniqueIndex("memberships_org_user_uq").on(table.organizationId, table.userId),
    index("memberships_user_idx").on(table.userId),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
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
  (table) => [
    index("sessions_user_idx").on(table.userId),
    index("sessions_expiry_idx").on(table.expiresAt),
  ],
);

// Organization-level vendor configuration
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
  (table) => [uniqueIndex("integrations_org_vendor_uq").on(table.organizationId, table.vendor)],
);

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
  (table) => [
    uniqueIndex("vendor_credentials_integration_field_uq").on(table.integrationId, table.fieldName),
  ],
);

// Project and uploaded research
export const projects = pgTable(
  "projects",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    canonicalDomain: text("canonical_domain").notNull(),
    description: text("description").notNull(),
    primaryMarket: projectMarketEnum("primary_market").notNull(),
    languageLocale: text("language_locale").notNull(),
    sparktoroAudienceDescription: text("sparktoro_audience_description").notNull(),
    promptStrategy: jsonb("prompt_strategy")
      .$type<PromptStrategy>()
      .notNull()
      .default(EMPTY_PROMPT_STRATEGY),
    promptStrategyEdited: boolean("prompt_strategy_edited").notNull().default(false),
    audienceDescriptionEdited: boolean("audience_description_edited").notNull().default(false),
    sourceRevision: integer("source_revision").notNull().default(0),
    activePersonaRevision: integer("active_persona_revision").notNull().default(0),
    createdByUserId: text("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("projects_org_slug_uq").on(table.organizationId, table.slug),
    index("projects_org_idx").on(table.organizationId, table.createdAt),
  ],
);

export const dataSources = pgTable(
  "data_sources",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    sourceType: text("source_type").notNull(),
    sourceSystem: text("source_system").notNull(),
    originalFilename: text("original_filename"),
    storageKey: text("storage_key"),
    byteSize: integer("byte_size"),
    contentType: text("content_type"),
    checksum: text("checksum"),
    observedAt: timestamp("observed_at", { withTimezone: true }),
    status: sourceStatusEnum("status").notNull().default("queued"),
    stage: text("stage").notNull().default("queued"),
    progress: integer("progress").notNull().default(0),
    documentCount: integer("document_count").notNull().default(0),
    signalCount: integer("signal_count").notNull().default(0),
    piiRedactionCount: integer("pii_redaction_count").notNull().default(0),
    piiStatus: text("pii_status").notNull().default("none"),
    warningMessage: text("warning_message"),
    errorMessage: text("error_message"),
    uploadedByUserId: text("uploaded_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("data_sources_project_idx").on(table.organizationId, table.projectId, table.createdAt),
    uniqueIndex("data_sources_checksum_uq").on(table.projectId, table.checksum),
  ],
);

export const marketResearchBriefs = pgTable(
  "market_research_briefs",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    generationRunId: text("generation_run_id"),
    version: integer("version").notNull(),
    status: text("status").notNull().default("draft"),
    content: jsonb("content").$type<MarketResearchBriefContent>().notNull(),
    sourceRevision: integer("source_revision").notNull(),
    modelProvider: text("model_provider"),
    modelId: text("model_id"),
    dataOrigin: dataOriginEnum("data_origin").notNull(),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull(),
    staleAt: timestamp("stale_at", { withTimezone: true }).notNull(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    approvedByUserId: text("approved_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("market_research_briefs_version_uq").on(table.projectId, table.version),
    index("market_research_briefs_project_idx").on(table.organizationId, table.projectId),
  ],
);

export const sourceDocuments = pgTable(
  "source_documents",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    dataSourceId: text("data_source_id")
      .notNull()
      .references(() => dataSources.id, { onDelete: "cascade" }),
    title: text("title"),
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
  (table) => [
    index("source_documents_source_idx").on(table.dataSourceId, table.sequence),
    uniqueIndex("source_documents_hash_uq").on(table.dataSourceId, table.contentHash),
  ],
);

export const sparkReports = pgTable(
  "sparktoro_reports",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    inputHash: text("input_hash").notNull(),
    audienceDescription: text("audience_description").notNull(),
    market: projectMarketEnum("market").notNull(),
    locale: text("locale").notNull(),
    vendorReportId: text("vendor_report_id"),
    status: sourceStatusEnum("status").notNull().default("queued"),
    creditsEstimated: doublePrecision("credits_estimated").notNull().default(41),
    creditsUsed: doublePrecision("credits_used").notNull().default(0),
    creditsRemainingAtStart: doublePrecision("credits_remaining_at_start"),
    errorMessage: text("error_message"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("sparktoro_reports_cache_uq").on(table.organizationId, table.inputHash),
    index("sparktoro_reports_project_idx").on(table.projectId, table.createdAt),
  ],
);

export const sparkReportSections = pgTable(
  "sparktoro_report_sections",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    reportId: text("report_id")
      .notNull()
      .references(() => sparkReports.id, { onDelete: "cascade" }),
    section: text("section").notNull(),
    status: sourceStatusEnum("status").notNull().default("queued"),
    normalized: jsonb("normalized").$type<Record<string, unknown>>().notNull().default({}),
    rawResponse: jsonb("raw_response").$type<Record<string, unknown>>(),
    creditsUsed: doublePrecision("credits_used").notNull().default(0),
    retryCount: integer("retry_count").notNull().default(0),
    errorMessage: text("error_message"),
    fetchedAt: timestamp("fetched_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex("sparktoro_report_sections_uq").on(table.reportId, table.section)],
);

export const researchSignals = pgTable(
  "research_signals",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    sourceKind: sourceKindEnum("source_kind").notNull(),
    dataSourceId: text("data_source_id").references(() => dataSources.id, { onDelete: "cascade" }),
    sparkReportSectionId: text("sparktoro_report_section_id").references(
      () => sparkReportSections.id,
      { onDelete: "cascade" },
    ),
    category: text("category").notNull(),
    displayText: text("display_text").notNull(),
    structuredValue: jsonb("structured_value")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    provenance: text("provenance").notNull(),
    sourceLocation: text("source_location"),
    confidence: doublePrecision("confidence").notNull(),
    dataOrigin: dataOriginEnum("data_origin").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    index("research_signals_project_idx").on(
      table.organizationId,
      table.projectId,
      table.sourceKind,
    ),
    index("research_signals_source_idx").on(table.dataSourceId),
  ],
);

export const generationRuns = pgTable(
  "generation_runs",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    workflowType: workflowTypeEnum("workflow_type").notNull(),
    status: workflowStatusEnum("status").notNull().default("queued"),
    stage: workflowStageEnum("stage").notNull(),
    progress: integer("progress").notNull().default(0),
    warnings: jsonb("warnings").$type<string[]>().notNull().default([]),
    retryState: jsonb("retry_state").$type<Record<string, unknown>>().notNull().default({}),
    inputSnapshot: jsonb("input_snapshot").$type<Record<string, unknown>>().notNull().default({}),
    resultingVersionIds: jsonb("resulting_version_ids").$type<string[]>().notNull().default([]),
    errorMessage: text("error_message"),
    initiatedByUserId: text("initiated_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    index("generation_runs_project_idx").on(table.projectId, table.workflowType, table.createdAt),
  ],
);

// Immutable persona versions
export const personas = pgTable(
  "personas",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    currentVersionId: text("current_version_id"),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("personas_project_slug_uq").on(table.projectId, table.slug),
    index("personas_project_idx").on(table.organizationId, table.projectId, table.createdAt),
  ],
);

export const personaVersions = pgTable(
  "persona_versions",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    personaId: text("persona_id")
      .notNull()
      .references(() => personas.id, { onDelete: "cascade" }),
    generationRunId: text("generation_run_id").references(() => generationRuns.id, {
      onDelete: "set null",
    }),
    version: integer("version").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    profile: jsonb("profile").$type<PersonaProfile>().notNull(),
    sourceRevision: integer("source_revision").notNull(),
    overallConfidence: doublePrecision("overall_confidence").notNull(),
    modelProvider: text("model_provider"),
    modelId: text("model_id"),
    promptTemplateVersion: text("prompt_template_version"),
    schemaVersion: text("schema_version"),
    dataOrigin: dataOriginEnum("data_origin").notNull(),
    parentVersionId: text("parent_version_id"),
    changeSummary: text("change_summary"),
    createdByUserId: text("created_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("persona_versions_uq").on(table.personaId, table.version),
    index("persona_versions_project_idx").on(table.projectId, table.createdAt),
  ],
);

export const personaVersionSignals = pgTable(
  "persona_version_signals",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    personaVersionId: text("persona_version_id")
      .notNull()
      .references(() => personaVersions.id, { onDelete: "cascade" }),
    signalId: text("signal_id")
      .notNull()
      .references(() => researchSignals.id, { onDelete: "restrict" }),
    section: text("section").notNull(),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("persona_version_signals_uq").on(
      table.personaVersionId,
      table.signalId,
      table.section,
    ),
  ],
);

// Prompt sets switch versions only after a complete valid replacement exists.
export const promptSets = pgTable(
  "prompt_sets",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    personaId: text("persona_id")
      .notNull()
      .references(() => personas.id, { onDelete: "cascade" }),
    currentVersionId: text("current_version_id"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [uniqueIndex("prompt_sets_persona_uq").on(table.personaId)],
);

export const promptSetVersions = pgTable(
  "prompt_set_versions",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    promptSetId: text("prompt_set_id")
      .notNull()
      .references(() => promptSets.id, { onDelete: "cascade" }),
    personaVersionId: text("persona_version_id")
      .notNull()
      .references(() => personaVersions.id, { onDelete: "restrict" }),
    generationRunId: text("generation_run_id").references(() => generationRuns.id, {
      onDelete: "set null",
    }),
    version: integer("version").notNull(),
    clusterCount: integer("cluster_count").notNull(),
    promptCount: integer("prompt_count").notNull(),
    modelProvider: text("model_provider"),
    modelId: text("model_id"),
    dataOrigin: dataOriginEnum("data_origin").notNull(),
    lifecycleStatus: promptVersionLifecycleEnum("lifecycle_status").notNull().default("current"),
    researchBriefId: text("research_brief_id"),
    plannerPromptVersion: text("planner_prompt_version"),
    writerPromptVersion: text("writer_prompt_version"),
    evaluatorPromptVersion: text("evaluator_prompt_version"),
    repairPromptVersion: text("repair_prompt_version"),
    schemaVersion: text("schema_version"),
    generationMetrics: jsonb("generation_metrics")
      .$type<PromptGenerationMetrics>()
      .notNull()
      .default({
        plannerCalls: 0,
        writerCalls: 0,
        evaluatorCalls: 0,
        repairCalls: 0,
        repairRounds: 0,
        initialCellCount: 0,
        initialPassCount: 0,
        finalPassCount: 0,
        durationMs: 0,
        tokensIn: 0,
        tokensOut: 0,
        costCents: 0,
        modelIds: [],
        byTemplate: {},
      }),
    strategySnapshot: jsonb("strategy_snapshot")
      .$type<PromptStrategy>()
      .notNull()
      .default(EMPTY_PROMPT_STRATEGY),
    qualitySummary: jsonb("quality_summary")
      .$type<Record<string, number | string | boolean>>()
      .notNull()
      .default({}),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex("prompt_set_versions_uq").on(table.promptSetId, table.version)],
);

export const promptClusters = pgTable(
  "prompt_clusters",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    promptSetVersionId: text("prompt_set_version_id")
      .notNull()
      .references(() => promptSetVersions.id, { onDelete: "cascade" }),
    personaVersionId: text("persona_version_id")
      .notNull()
      .references(() => personaVersions.id, { onDelete: "restrict" }),
    sequence: integer("sequence").notNull(),
    title: text("title").notNull(),
    slug: text("slug").notNull(),
    seedTopic: text("seed_topic").notNull(),
    informationNeed: text("information_need").notNull(),
    rationale: text("rationale").notNull(),
    signalIds: jsonb("signal_ids").$type<string[]>().notNull().default([]),
    createdAt: createdAt(),
  },
  (table) => [
    uniqueIndex("prompt_clusters_sequence_uq").on(table.promptSetVersionId, table.sequence),
    uniqueIndex("prompt_clusters_slug_uq").on(table.promptSetVersionId, table.slug),
  ],
);

export const generatedPrompts = pgTable(
  "generated_prompts",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    promptSetVersionId: text("prompt_set_version_id")
      .notNull()
      .references(() => promptSetVersions.id, { onDelete: "cascade" }),
    clusterId: text("cluster_id")
      .notNull()
      .references(() => promptClusters.id, { onDelete: "cascade" }),
    personaVersionId: text("persona_version_id")
      .notNull()
      .references(() => personaVersions.id, { onDelete: "restrict" }),
    sequence: integer("sequence").notNull(),
    coverageKey: text("coverage_key").notNull().default("legacy"),
    parentCoverageKey: text("parent_coverage_key"),
    promptText: text("prompt_text").notNull(),
    normalizedHash: text("normalized_hash").notNull(),
    geoCategory: geoCategoryEnum("geo_category").notNull(),
    topicClass: text("topic_class").notNull().default("unbranded_category_discovery"),
    promptType: text("prompt_type").notNull().default("unbranded"),
    questionArchetype: text("question_archetype")
      .$type<QuestionArchetype>()
      .notNull()
      .default("recommendation"),
    intent: text("intent").notNull(),
    journeyStage: text("journey_stage").notNull(),
    businessLine: text("business_line").notNull().default("general"),
    signalTracked: text("signal_tracked").notNull().default("category recommendation"),
    buyerQualifier: text("buyer_qualifier").notNull().default(""),
    namedEntities: jsonb("named_entities").$type<string[]>().notNull().default([]),
    qualityScore: doublePrecision("quality_score").notNull().default(1),
    rubricScores: jsonb("rubric_scores").$type<PromptRubricScores>().notNull().default({
      categorySpecificity: 0,
      personaContextFit: 0,
      naturalBuyerLanguage: 0,
      funnelCoherence: 0,
      answerValue: 0,
      evidenceSupport: 0,
      distinctiveness: 0,
      total: 0,
    }),
    evaluatorExplanation: text("evaluator_explanation").notNull().default(""),
    qualityIssues: jsonb("quality_issues").$type<PromptQualityIssue[]>().notNull().default([]),
    researchFactIds: jsonb("research_fact_ids").$type<string[]>().notNull().default([]),
    maximumSimilarity: doublePrecision("maximum_similarity").notNull().default(0),
    reviewStatus: text("review_status").notNull().default("ready"),
    expectedAnswerElements: jsonb("expected_answer_elements")
      .$type<string[]>()
      .notNull()
      .default([]),
    signalIds: jsonb("signal_ids").$type<string[]>().notNull().default([]),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (table) => [
    uniqueIndex("generated_prompts_hash_uq").on(table.promptSetVersionId, table.normalizedHash),
    index("generated_prompts_cluster_idx").on(table.clusterId, table.sequence),
  ],
);

export const promptSignalLinks = pgTable(
  "prompt_signal_links",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    promptId: text("prompt_id")
      .notNull()
      .references(() => generatedPrompts.id, { onDelete: "cascade" }),
    signalId: text("signal_id")
      .notNull()
      .references(() => researchSignals.id, { onDelete: "restrict" }),
    createdAt: createdAt(),
  },
  (table) => [uniqueIndex("prompt_signal_links_uq").on(table.promptId, table.signalId)],
);

// Durable queue, usage and audit
export const jobs = pgTable(
  "jobs",
  {
    id: text("id").primaryKey(),
    type: text("type").notNull(),
    organizationId: text("organization_id"),
    projectId: text("project_id"),
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
  (table) => [
    index("jobs_claim_idx").on(table.status, table.runAfter),
    index("jobs_scope_idx").on(table.organizationId, table.projectId, table.createdAt),
    uniqueIndex("jobs_idempotency_uq").on(table.idempotencyKey),
  ],
);

export const vendorUsage = pgTable(
  "vendor_usage",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "cascade" }),
    projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
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
  (table) => [index("vendor_usage_org_idx").on(table.organizationId, table.createdAt)],
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: text("id").primaryKey(),
    organizationId: text("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    projectId: text("project_id").references(() => projects.id, { onDelete: "cascade" }),
    actorUserId: text("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    entityType: text("entity_type"),
    entityId: text("entity_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    ip: text("ip"),
    createdAt: createdAt(),
  },
  (table) => [
    index("audit_logs_org_idx").on(table.organizationId, table.createdAt),
    index("audit_logs_entity_idx").on(table.entityType, table.entityId),
  ],
);
