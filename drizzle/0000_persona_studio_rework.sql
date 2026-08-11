CREATE TYPE "public"."data_origin" AS ENUM('mock', 'live', 'local');--> statement-breakpoint
CREATE TYPE "public"."geo_category" AS ENUM('problem_discovery', 'foundational_education', 'solution_recommendations', 'comparisons_and_alternatives', 'evaluation_trust_and_proof', 'objections_and_risk', 'purchase_and_selection', 'implementation_and_optimization');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'retrying', 'succeeded', 'failed', 'partially_succeeded', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."project_market" AS ENUM('US', 'CA', 'UK');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('owner', 'admin', 'editor', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."source_kind" AS ENUM('first_party', 'sparktoro');--> statement-breakpoint
CREATE TYPE "public"."source_status" AS ENUM('queued', 'processing', 'completed', 'completed_with_warnings', 'failed');--> statement-breakpoint
CREATE TYPE "public"."vendor" AS ENUM('openai', 'sparktoro', 'storage');--> statement-breakpoint
CREATE TYPE "public"."vendor_mode" AS ENUM('mock', 'live');--> statement-breakpoint
CREATE TYPE "public"."workflow_stage" AS ENUM('processing_sources', 'researching_audience', 'identifying_segments', 'creating_personas', 'creating_clusters', 'creating_prompts', 'validating', 'ready');--> statement-breakpoint
CREATE TYPE "public"."workflow_status" AS ENUM('queued', 'running', 'completed', 'completed_with_warnings', 'failed');--> statement-breakpoint
CREATE TYPE "public"."workflow_type" AS ENUM('persona_generation', 'prompt_generation');--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text,
	"project_id" text,
	"actor_user_id" text,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"label" text NOT NULL,
	"source_type" text NOT NULL,
	"source_system" text NOT NULL,
	"original_filename" text,
	"storage_key" text,
	"byte_size" integer,
	"content_type" text,
	"checksum" text,
	"observed_at" timestamp with time zone,
	"status" "source_status" DEFAULT 'queued' NOT NULL,
	"stage" text DEFAULT 'queued' NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"document_count" integer DEFAULT 0 NOT NULL,
	"signal_count" integer DEFAULT 0 NOT NULL,
	"pii_redaction_count" integer DEFAULT 0 NOT NULL,
	"pii_status" text DEFAULT 'none' NOT NULL,
	"warning_message" text,
	"error_message" text,
	"uploaded_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generated_prompts" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"prompt_set_version_id" text NOT NULL,
	"cluster_id" text NOT NULL,
	"persona_version_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"prompt_text" text NOT NULL,
	"normalized_hash" text NOT NULL,
	"geo_category" "geo_category" NOT NULL,
	"intent" text NOT NULL,
	"journey_stage" text NOT NULL,
	"expected_answer_elements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"signal_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "generation_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"workflow_type" "workflow_type" NOT NULL,
	"status" "workflow_status" DEFAULT 'queued' NOT NULL,
	"stage" "workflow_stage" NOT NULL,
	"progress" integer DEFAULT 0 NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"retry_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"input_snapshot" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"resulting_version_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"error_message" text,
	"initiated_by_user_id" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "integrations" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"vendor" "vendor" NOT NULL,
	"mode" "vendor_mode" DEFAULT 'mock' NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_tested_at" timestamp with time zone,
	"last_test_outcome" text,
	"last_test_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"organization_id" text,
	"project_id" text,
	"payload" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"run_after" timestamp with time zone DEFAULT now() NOT NULL,
	"locked_at" timestamp with time zone,
	"locked_by" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"last_error" text,
	"result" jsonb,
	"idempotency_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" "role" DEFAULT 'viewer' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "persona_version_signals" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"persona_version_id" text NOT NULL,
	"signal_id" text NOT NULL,
	"section" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "persona_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"persona_id" text NOT NULL,
	"generation_run_id" text,
	"version" integer NOT NULL,
	"name" text NOT NULL,
	"description" text NOT NULL,
	"profile" jsonb NOT NULL,
	"source_revision" integer NOT NULL,
	"overall_confidence" double precision NOT NULL,
	"model_provider" text,
	"model_id" text,
	"prompt_template_version" text,
	"schema_version" text,
	"data_origin" "data_origin" NOT NULL,
	"parent_version_id" text,
	"change_summary" text,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "personas" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"current_version_id" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"canonical_domain" text NOT NULL,
	"description" text NOT NULL,
	"primary_market" "project_market" NOT NULL,
	"language_locale" text NOT NULL,
	"sparktoro_audience_description" text NOT NULL,
	"audience_description_edited" boolean DEFAULT false NOT NULL,
	"source_revision" integer DEFAULT 0 NOT NULL,
	"active_persona_revision" integer DEFAULT 0 NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prompt_clusters" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"prompt_set_version_id" text NOT NULL,
	"persona_version_id" text NOT NULL,
	"sequence" integer NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"seed_topic" text NOT NULL,
	"information_need" text NOT NULL,
	"rationale" text NOT NULL,
	"signal_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prompt_set_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"prompt_set_id" text NOT NULL,
	"persona_version_id" text NOT NULL,
	"generation_run_id" text,
	"version" integer NOT NULL,
	"cluster_count" integer NOT NULL,
	"prompt_count" integer NOT NULL,
	"model_provider" text,
	"model_id" text,
	"data_origin" "data_origin" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prompt_sets" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"persona_id" text NOT NULL,
	"current_version_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prompt_signal_links" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"prompt_id" text NOT NULL,
	"signal_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "research_signals" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"source_kind" "source_kind" NOT NULL,
	"data_source_id" text,
	"sparktoro_report_section_id" text,
	"category" text NOT NULL,
	"display_text" text NOT NULL,
	"structured_value" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"provenance" text NOT NULL,
	"source_location" text,
	"confidence" double precision NOT NULL,
	"data_origin" "data_origin" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"token_hash" text NOT NULL,
	"user_id" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ip" text,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sessions_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "source_documents" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"data_source_id" text NOT NULL,
	"title" text,
	"location" text NOT NULL,
	"sequence" integer DEFAULT 0 NOT NULL,
	"raw_text" text NOT NULL,
	"redacted_text" text NOT NULL,
	"pii_findings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"speaker" text,
	"observed_at" timestamp with time zone,
	"content_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sparktoro_report_sections" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"report_id" text NOT NULL,
	"section" text NOT NULL,
	"status" "source_status" DEFAULT 'queued' NOT NULL,
	"normalized" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"raw_response" jsonb,
	"credits_used" double precision DEFAULT 0 NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"error_message" text,
	"fetched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sparktoro_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text NOT NULL,
	"input_hash" text NOT NULL,
	"audience_description" text NOT NULL,
	"market" "project_market" NOT NULL,
	"locale" text NOT NULL,
	"vendor_report_id" text,
	"status" "source_status" DEFAULT 'queued' NOT NULL,
	"credits_estimated" double precision DEFAULT 41 NOT NULL,
	"credits_used" double precision DEFAULT 0 NOT NULL,
	"credits_remaining_at_start" double precision,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" text PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "vendor_credentials" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"integration_id" text NOT NULL,
	"field_name" text NOT NULL,
	"ciphertext" text NOT NULL,
	"iv" text NOT NULL,
	"auth_tag" text NOT NULL,
	"key_version" integer DEFAULT 1 NOT NULL,
	"masked_hint" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vendor_usage" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"project_id" text,
	"vendor" "vendor" NOT NULL,
	"operation" text NOT NULL,
	"mode" "vendor_mode" NOT NULL,
	"job_id" text,
	"duration_ms" integer DEFAULT 0 NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"outcome" text NOT NULL,
	"error_code" text,
	"tokens_in" integer,
	"tokens_out" integer,
	"credits" double precision,
	"cost_cents" double precision,
	"request_hash" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_sources" ADD CONSTRAINT "data_sources_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_sources" ADD CONSTRAINT "data_sources_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_sources" ADD CONSTRAINT "data_sources_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_prompts" ADD CONSTRAINT "generated_prompts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_prompts" ADD CONSTRAINT "generated_prompts_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_prompts" ADD CONSTRAINT "generated_prompts_prompt_set_version_id_prompt_set_versions_id_fk" FOREIGN KEY ("prompt_set_version_id") REFERENCES "public"."prompt_set_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_prompts" ADD CONSTRAINT "generated_prompts_cluster_id_prompt_clusters_id_fk" FOREIGN KEY ("cluster_id") REFERENCES "public"."prompt_clusters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_prompts" ADD CONSTRAINT "generated_prompts_persona_version_id_persona_versions_id_fk" FOREIGN KEY ("persona_version_id") REFERENCES "public"."persona_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_runs" ADD CONSTRAINT "generation_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_runs" ADD CONSTRAINT "generation_runs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generation_runs" ADD CONSTRAINT "generation_runs_initiated_by_user_id_users_id_fk" FOREIGN KEY ("initiated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_version_signals" ADD CONSTRAINT "persona_version_signals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_version_signals" ADD CONSTRAINT "persona_version_signals_persona_version_id_persona_versions_id_fk" FOREIGN KEY ("persona_version_id") REFERENCES "public"."persona_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_version_signals" ADD CONSTRAINT "persona_version_signals_signal_id_research_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."research_signals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_versions" ADD CONSTRAINT "persona_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_versions" ADD CONSTRAINT "persona_versions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_versions" ADD CONSTRAINT "persona_versions_persona_id_personas_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."personas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_versions" ADD CONSTRAINT "persona_versions_generation_run_id_generation_runs_id_fk" FOREIGN KEY ("generation_run_id") REFERENCES "public"."generation_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_versions" ADD CONSTRAINT "persona_versions_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personas" ADD CONSTRAINT "personas_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personas" ADD CONSTRAINT "personas_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "projects" ADD CONSTRAINT "projects_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_clusters" ADD CONSTRAINT "prompt_clusters_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_clusters" ADD CONSTRAINT "prompt_clusters_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_clusters" ADD CONSTRAINT "prompt_clusters_prompt_set_version_id_prompt_set_versions_id_fk" FOREIGN KEY ("prompt_set_version_id") REFERENCES "public"."prompt_set_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_clusters" ADD CONSTRAINT "prompt_clusters_persona_version_id_persona_versions_id_fk" FOREIGN KEY ("persona_version_id") REFERENCES "public"."persona_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_set_versions" ADD CONSTRAINT "prompt_set_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_set_versions" ADD CONSTRAINT "prompt_set_versions_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_set_versions" ADD CONSTRAINT "prompt_set_versions_prompt_set_id_prompt_sets_id_fk" FOREIGN KEY ("prompt_set_id") REFERENCES "public"."prompt_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_set_versions" ADD CONSTRAINT "prompt_set_versions_persona_version_id_persona_versions_id_fk" FOREIGN KEY ("persona_version_id") REFERENCES "public"."persona_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_set_versions" ADD CONSTRAINT "prompt_set_versions_generation_run_id_generation_runs_id_fk" FOREIGN KEY ("generation_run_id") REFERENCES "public"."generation_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_sets" ADD CONSTRAINT "prompt_sets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_sets" ADD CONSTRAINT "prompt_sets_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_sets" ADD CONSTRAINT "prompt_sets_persona_id_personas_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."personas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_signal_links" ADD CONSTRAINT "prompt_signal_links_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_signal_links" ADD CONSTRAINT "prompt_signal_links_prompt_id_generated_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."generated_prompts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_signal_links" ADD CONSTRAINT "prompt_signal_links_signal_id_research_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."research_signals"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_signals" ADD CONSTRAINT "research_signals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_signals" ADD CONSTRAINT "research_signals_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_signals" ADD CONSTRAINT "research_signals_data_source_id_data_sources_id_fk" FOREIGN KEY ("data_source_id") REFERENCES "public"."data_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "research_signals" ADD CONSTRAINT "research_signals_sparktoro_report_section_id_sparktoro_report_sections_id_fk" FOREIGN KEY ("sparktoro_report_section_id") REFERENCES "public"."sparktoro_report_sections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_documents" ADD CONSTRAINT "source_documents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_documents" ADD CONSTRAINT "source_documents_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_documents" ADD CONSTRAINT "source_documents_data_source_id_data_sources_id_fk" FOREIGN KEY ("data_source_id") REFERENCES "public"."data_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sparktoro_report_sections" ADD CONSTRAINT "sparktoro_report_sections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sparktoro_report_sections" ADD CONSTRAINT "sparktoro_report_sections_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sparktoro_report_sections" ADD CONSTRAINT "sparktoro_report_sections_report_id_sparktoro_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "public"."sparktoro_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sparktoro_reports" ADD CONSTRAINT "sparktoro_reports_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sparktoro_reports" ADD CONSTRAINT "sparktoro_reports_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_credentials" ADD CONSTRAINT "vendor_credentials_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_credentials" ADD CONSTRAINT "vendor_credentials_integration_id_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_usage" ADD CONSTRAINT "vendor_usage_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_usage" ADD CONSTRAINT "vendor_usage_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_org_idx" ON "audit_logs" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "data_sources_project_idx" ON "data_sources" USING btree ("organization_id","project_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "data_sources_checksum_uq" ON "data_sources" USING btree ("project_id","checksum");--> statement-breakpoint
CREATE UNIQUE INDEX "generated_prompts_hash_uq" ON "generated_prompts" USING btree ("prompt_set_version_id","normalized_hash");--> statement-breakpoint
CREATE INDEX "generated_prompts_cluster_idx" ON "generated_prompts" USING btree ("cluster_id","sequence");--> statement-breakpoint
CREATE INDEX "generation_runs_project_idx" ON "generation_runs" USING btree ("project_id","workflow_type","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_org_vendor_uq" ON "integrations" USING btree ("organization_id","vendor");--> statement-breakpoint
CREATE INDEX "jobs_claim_idx" ON "jobs" USING btree ("status","run_after");--> statement-breakpoint
CREATE INDEX "jobs_scope_idx" ON "jobs" USING btree ("organization_id","project_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_idempotency_uq" ON "jobs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_org_user_uq" ON "memberships" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "persona_version_signals_uq" ON "persona_version_signals" USING btree ("persona_version_id","signal_id","section");--> statement-breakpoint
CREATE UNIQUE INDEX "persona_versions_uq" ON "persona_versions" USING btree ("persona_id","version");--> statement-breakpoint
CREATE INDEX "persona_versions_project_idx" ON "persona_versions" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "personas_project_slug_uq" ON "personas" USING btree ("project_id","slug");--> statement-breakpoint
CREATE INDEX "personas_project_idx" ON "personas" USING btree ("organization_id","project_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "projects_org_slug_uq" ON "projects" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE INDEX "projects_org_idx" ON "projects" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "prompt_clusters_sequence_uq" ON "prompt_clusters" USING btree ("prompt_set_version_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "prompt_clusters_slug_uq" ON "prompt_clusters" USING btree ("prompt_set_version_id","slug");--> statement-breakpoint
CREATE UNIQUE INDEX "prompt_set_versions_uq" ON "prompt_set_versions" USING btree ("prompt_set_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "prompt_sets_persona_uq" ON "prompt_sets" USING btree ("persona_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prompt_signal_links_uq" ON "prompt_signal_links" USING btree ("prompt_id","signal_id");--> statement-breakpoint
CREATE INDEX "research_signals_project_idx" ON "research_signals" USING btree ("organization_id","project_id","source_kind");--> statement-breakpoint
CREATE INDEX "research_signals_source_idx" ON "research_signals" USING btree ("data_source_id");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expiry_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "source_documents_source_idx" ON "source_documents" USING btree ("data_source_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "source_documents_hash_uq" ON "source_documents" USING btree ("data_source_id","content_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "sparktoro_report_sections_uq" ON "sparktoro_report_sections" USING btree ("report_id","section");--> statement-breakpoint
CREATE UNIQUE INDEX "sparktoro_reports_cache_uq" ON "sparktoro_reports" USING btree ("organization_id","input_hash");--> statement-breakpoint
CREATE INDEX "sparktoro_reports_project_idx" ON "sparktoro_reports" USING btree ("project_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "vendor_credentials_integration_field_uq" ON "vendor_credentials" USING btree ("integration_id","field_name");--> statement-breakpoint
CREATE INDEX "vendor_usage_org_idx" ON "vendor_usage" USING btree ("organization_id","created_at");