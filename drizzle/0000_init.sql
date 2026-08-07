CREATE TYPE "public"."audit_scope" AS ENUM('homepage', 'landing_page', 'product_page');--> statement-breakpoint
CREATE TYPE "public"."availability" AS ENUM('available', 'source_deleted');--> statement-breakpoint
CREATE TYPE "public"."data_origin" AS ENUM('mock', 'live', 'local');--> statement-breakpoint
CREATE TYPE "public"."effort" AS ENUM('small', 'medium', 'large');--> statement-breakpoint
CREATE TYPE "public"."evidence_category" AS ENUM('job_to_be_done', 'constraint', 'success_metric', 'decision_criterion', 'vocabulary', 'question', 'objection', 'pain_point', 'desired_outcome', 'behavior', 'comparison', 'implementation_requirement', 'proof_requirement', 'brand_claim', 'other');--> statement-breakpoint
CREATE TYPE "public"."evidence_relation" AS ENUM('supports', 'contradicts');--> statement-breakpoint
CREATE TYPE "public"."execution_mode" AS ENUM('standalone', 'conversational', 'both');--> statement-breakpoint
CREATE TYPE "public"."gap_type" AS ENUM('content', 'evidence', 'authority', 'messaging', 'product_fit');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'retrying', 'succeeded', 'failed', 'partially_succeeded', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."journey_stage" AS ENUM('unaware', 'problem_discovery', 'education', 'solution_exploration', 'consideration', 'evaluation', 'purchase', 'implementation', 'optimization', 'troubleshooting', 'retention', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."mapping_status" AS ENUM('unmapped', 'mapped', 'tag_fallback', 'invalid', 'needs_review');--> statement-breakpoint
CREATE TYPE "public"."persona_field_type" AS ENUM('job_to_be_done', 'constraint', 'success_metric', 'decision_criterion', 'vocabulary', 'recurring_question', 'objection', 'proof_preference', 'distinguishing_topic', 'coverage_gap', 'excluded_assumption', 'validation_benchmark', 'regeneration_trigger', 'information_depth');--> statement-breakpoint
CREATE TYPE "public"."pii_status" AS ENUM('none', 'redacted', 'suspected');--> statement-breakpoint
CREATE TYPE "public"."priority" AS ENUM('p1', 'p2', 'p3');--> statement-breakpoint
CREATE TYPE "public"."prompt_intent" AS ENUM('problem_discovery', 'education', 'solution_exploration', 'comparison', 'evaluation', 'risk_reduction', 'purchase', 'implementation', 'optimization', 'troubleshooting');--> statement-breakpoint
CREATE TYPE "public"."prompt_type" AS ENUM('persona', 'generic_control');--> statement-breakpoint
CREATE TYPE "public"."provenance" AS ENUM('observed', 'externally_supported', 'brand_assertion', 'inferred');--> statement-breakpoint
CREATE TYPE "public"."recommendation_type" AS ENUM('new_article', 'existing_article_update', 'faq', 'comparison_page', 'landing_page', 'product_page', 'documentation', 'case_study', 'homepage_update', 'structured_information_improvement', 'third_party_authority_or_pr', 'no_content_action', 'product_or_positioning_review');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('draft', 'pending_review', 'approved', 'rejected', 'needs_review', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."role" AS ENUM('owner', 'admin', 'editor', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."segment_status" AS ENUM('candidate', 'approved', 'rejected', 'merged', 'split');--> statement-breakpoint
CREATE TYPE "public"."sentiment" AS ENUM('positive', 'neutral', 'negative', 'concern', 'mixed', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."severity" AS ENUM('critical', 'high', 'medium', 'low', 'info');--> statement-breakpoint
CREATE TYPE "public"."source_system" AS ENUM('uploaded_csv', 'uploaded_json', 'uploaded_txt', 'uploaded_markdown', 'uploaded_docx', 'pasted_text', 'transcript_text', 'search_console_export', 'url_crawl');--> statement-breakpoint
CREATE TYPE "public"."source_type" AS ENUM('interview', 'sales_transcript', 'support_ticket', 'survey', 'review', 'community', 'search_console', 'onsite_search', 'crm_note', 'brand_page', 'documentation', 'other');--> statement-breakpoint
CREATE TYPE "public"."sync_item_outcome" AS ENUM('pending', 'created', 'duplicate', 'near_duplicate_skipped', 'failed', 'skipped');--> statement-breakpoint
CREATE TYPE "public"."sync_state" AS ENUM('draft', 'ready', 'dry_run_passed', 'approved', 'syncing', 'synced', 'partially_synced', 'failed', 'archived');--> statement-breakpoint
CREATE TYPE "public"."tracking_priority" AS ENUM('low', 'medium', 'high');--> statement-breakpoint
CREATE TYPE "public"."vendor" AS ENUM('openai', 'profound', 'sparktoro', 'dataforseo', 'storage');--> statement-breakpoint
CREATE TYPE "public"."vendor_mode" AS ENUM('mock', 'live');--> statement-breakpoint
CREATE TABLE "audience_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"vendor" "vendor" DEFAULT 'sparktoro' NOT NULL,
	"description" text NOT NULL,
	"location" text,
	"vendor_report_id" text,
	"requested_sections" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"credits_used" double precision DEFAULT 0 NOT NULL,
	"data_origin" "data_origin" DEFAULT 'mock' NOT NULL,
	"created_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audience_signals" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"audience_report_id" text NOT NULL,
	"section" text NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"provenance" "provenance" DEFAULT 'externally_supported' NOT NULL,
	"normalized" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"raw_response" jsonb,
	"data_origin" "data_origin" DEFAULT 'mock' NOT NULL,
	"fetched_at" timestamp with time zone,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_findings" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"page_audit_id" text NOT NULL,
	"sequence" integer DEFAULT 0 NOT NULL,
	"severity" "severity" NOT NULL,
	"page_element" text NOT NULL,
	"page_excerpt" text,
	"persona_requirement" text NOT NULL,
	"explanation" text NOT NULL,
	"recommended_change" text NOT NULL,
	"suggested_replacement" text,
	"validation_method" text NOT NULL,
	"evidence_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"related_prompt_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"related_profound_prompt_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"belongs_on_supporting_page" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text,
	"brand_id" text,
	"actor_user_id" text,
	"action" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brand_products" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"priority" integer DEFAULT 0 NOT NULL,
	"url" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brands" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"canonical_domain" text NOT NULL,
	"description" text NOT NULL,
	"conversion_actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"markets" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"languages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"regions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"approved_crawl_domains" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"strategic_questions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"regulated_domain" boolean DEFAULT false NOT NULL,
	"profound_category_id" text,
	"profound_category_name" text,
	"retention_days" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "competitors" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"name" text NOT NULL,
	"domain" text,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_briefs" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"opportunity_id" text,
	"persona_id" text,
	"persona_version_id" text,
	"prompt_set_version_id" text,
	"version" integer DEFAULT 1 NOT NULL,
	"working_title" text NOT NULL,
	"body" jsonb NOT NULL,
	"evidence_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"profound_prompt_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"run_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"model_provider" text,
	"model_id" text,
	"prompt_template_version" text,
	"schema_version" text,
	"data_origin" "data_origin" DEFAULT 'mock' NOT NULL,
	"evidence_cutoff" timestamp with time zone,
	"review_status" "review_status" DEFAULT 'draft' NOT NULL,
	"approved_by_user_id" text,
	"approved_at" timestamp with time zone,
	"generated_by_user_id" text,
	"parent_brief_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "content_opportunities" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"persona_id" text,
	"persona_version_id" text,
	"prompt_set_version_id" text,
	"title" text NOT NULL,
	"problem_statement" text NOT NULL,
	"performance_gap" text NOT NULL,
	"gap_type" "gap_type" NOT NULL,
	"recommendation" "recommendation_type" NOT NULL,
	"recommendation_rationale" text NOT NULL,
	"relevant_profound_prompt_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"relevant_run_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"competitors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"citation_sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"missing_answer_elements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"search_demand" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"existing_page_url" text,
	"priority" "priority" DEFAULT 'p2' NOT NULL,
	"estimated_effort" "effort" DEFAULT 'medium' NOT NULL,
	"evidence_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"validation_method" text NOT NULL,
	"model_provider" text,
	"model_id" text,
	"prompt_template_version" text,
	"schema_version" text,
	"data_origin" "data_origin" DEFAULT 'mock' NOT NULL,
	"evidence_cutoff" timestamp with time zone,
	"review_status" "review_status" DEFAULT 'pending_review' NOT NULL,
	"generated_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "data_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"label" text NOT NULL,
	"source_type" "source_type" NOT NULL,
	"source_system" "source_system" NOT NULL,
	"original_filename" text,
	"storage_key" text,
	"byte_size" integer,
	"content_type" text,
	"checksum" text,
	"source_url" text,
	"observed_at" timestamp with time zone,
	"exclude_from_model_calls" boolean DEFAULT false NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"document_count" integer DEFAULT 0 NOT NULL,
	"evidence_count" integer DEFAULT 0 NOT NULL,
	"pii_redaction_count" integer DEFAULT 0 NOT NULL,
	"deleted_at" timestamp with time zone,
	"uploaded_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence_embeddings" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"evidence_id" text NOT NULL,
	"model_id" text NOT NULL,
	"dimensions" integer NOT NULL,
	"data_origin" "data_origin" DEFAULT 'mock' NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence_notes" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"evidence_id" text NOT NULL,
	"user_id" text,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "evidence_records" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"data_source_id" text NOT NULL,
	"source_document_id" text NOT NULL,
	"source_type" "source_type" NOT NULL,
	"source_system" "source_system" NOT NULL,
	"source_location" text NOT NULL,
	"char_start" integer,
	"char_end" integer,
	"timestamp_label" text,
	"observed_at" timestamp with time zone,
	"ingested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"speaker" text,
	"raw_text" text NOT NULL,
	"redacted_text" text NOT NULL,
	"normalized_claim" text NOT NULL,
	"category" "evidence_category" NOT NULL,
	"provenance" "provenance" NOT NULL,
	"journey_stage" "journey_stage" DEFAULT 'unknown' NOT NULL,
	"sentiment" "sentiment" DEFAULT 'unknown' NOT NULL,
	"entities" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"vocabulary" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"candidate_segment_labels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"pii_status" "pii_status" DEFAULT 'none' NOT NULL,
	"extraction_confidence" double precision DEFAULT 0 NOT NULL,
	"quality_score" double precision DEFAULT 0 NOT NULL,
	"uncertainty_note" text,
	"created_by_model" text,
	"model_provider" text,
	"prompt_template_version" text,
	"schema_version" text,
	"data_origin" "data_origin" DEFAULT 'mock' NOT NULL,
	"review_status" "review_status" DEFAULT 'pending_review' NOT NULL,
	"reviewed_by_user_id" text,
	"reviewed_at" timestamp with time zone,
	"availability" "availability" DEFAULT 'available' NOT NULL,
	"edited_by_user" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ingestion_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"data_source_id" text NOT NULL,
	"job_id" text,
	"stage" text NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"message" text,
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
CREATE TABLE "internal_evaluation_results" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"run_id" text NOT NULL,
	"check_name" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"passed" boolean NOT NULL,
	"score" double precision,
	"detail" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "internal_evaluation_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"brand_id" text,
	"suite" text NOT NULL,
	"model_provider" text,
	"model_id" text,
	"prompt_template_version" text,
	"schema_version" text,
	"persona_version_id" text,
	"prompt_set_version_id" text,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"passed_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"score" double precision,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"triggered_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"organization_id" text,
	"brand_id" text,
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
CREATE TABLE "model_configurations" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"tier" text NOT NULL,
	"provider" text NOT NULL,
	"model_id" text NOT NULL,
	"temperature" double precision,
	"max_output_tokens" integer,
	"notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"retention_days" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "page_audits" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"persona_id" text,
	"persona_version_id" text,
	"prompt_set_version_id" text,
	"scope" "audit_scope" DEFAULT 'homepage' NOT NULL,
	"url" text,
	"page_title" text,
	"page_content" text NOT NULL,
	"version" integer DEFAULT 1 NOT NULL,
	"summary" text NOT NULL,
	"supporting_page_recommendations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"scores" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"model_provider" text,
	"model_id" text,
	"prompt_template_version" text,
	"schema_version" text,
	"data_origin" "data_origin" DEFAULT 'mock' NOT NULL,
	"evidence_cutoff" timestamp with time zone,
	"review_status" "review_status" DEFAULT 'draft' NOT NULL,
	"approved_by_user_id" text,
	"approved_at" timestamp with time zone,
	"generated_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "page_inventory" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"url" text NOT NULL,
	"canonical_url" text NOT NULL,
	"title" text,
	"page_type" text,
	"headings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"summary" text,
	"word_count" integer DEFAULT 0 NOT NULL,
	"internal_links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"structured_data" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"data_source_id" text,
	"last_crawled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "persona_field_evidence" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"persona_field_id" text NOT NULL,
	"evidence_id" text NOT NULL,
	"relation" "evidence_relation" NOT NULL,
	"unavailable" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "persona_fields" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"persona_version_id" text NOT NULL,
	"field_type" "persona_field_type" NOT NULL,
	"sequence" integer DEFAULT 0 NOT NULL,
	"statement" text NOT NULL,
	"provenance" "provenance" DEFAULT 'inferred' NOT NULL,
	"insufficient_evidence" boolean DEFAULT false NOT NULL,
	"evidence_count" integer DEFAULT 0 NOT NULL,
	"contradiction_count" integer DEFAULT 0 NOT NULL,
	"source_mix" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"confidence" double precision DEFAULT 0 NOT NULL,
	"confidence_components" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"confidence_explanation" text,
	"locked" boolean DEFAULT false NOT NULL,
	"marked_unsupported" boolean DEFAULT false NOT NULL,
	"edited_by_user" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "persona_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"persona_id" text NOT NULL,
	"version" integer NOT NULL,
	"name" text NOT NULL,
	"segment_definition" text NOT NULL,
	"journey_stages" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"information_depth" text,
	"summary" text,
	"excluded_assumptions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "review_status" DEFAULT 'draft' NOT NULL,
	"overall_confidence" double precision DEFAULT 0 NOT NULL,
	"evidence_cutoff" timestamp with time zone,
	"source_mix" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"model_provider" text,
	"model_id" text,
	"prompt_template_version" text,
	"schema_version" text,
	"data_origin" "data_origin" DEFAULT 'mock' NOT NULL,
	"generated_by_user_id" text,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_by_user_id" text,
	"approved_at" timestamp with time zone,
	"rejected_reason" text,
	"needs_review_reason" text,
	"parent_version_id" text,
	"change_summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "personas" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"segment_candidate_id" text,
	"current_version_id" text,
	"approved_version_id" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profound_category_mappings" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"connection_id" text NOT NULL,
	"profound_category_id" text NOT NULL,
	"profound_category_name" text NOT NULL,
	"status" "mapping_status" DEFAULT 'mapped' NOT NULL,
	"last_validated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profound_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"integration_id" text NOT NULL,
	"label" text NOT NULL,
	"profound_organization_id" text,
	"profound_organization_name" text,
	"last_synced_config_at" timestamp with time zone,
	"cached_config" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"data_origin" "data_origin" DEFAULT 'mock' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profound_persona_mappings" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"persona_id" text NOT NULL,
	"persona_version_id" text NOT NULL,
	"profound_category_id" text NOT NULL,
	"profound_persona_id" text,
	"profound_persona_name" text,
	"fallback_persona_tag" text NOT NULL,
	"status" "mapping_status" DEFAULT 'unmapped' NOT NULL,
	"note" text,
	"last_validated_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profound_prompt_links" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"prompt_id" text NOT NULL,
	"prompt_set_version_id" text NOT NULL,
	"profound_category_id" text NOT NULL,
	"profound_prompt_id" text NOT NULL,
	"normalized_hash" text NOT NULL,
	"request_hash" text NOT NULL,
	"sync_job_id" text,
	"data_origin" "data_origin" DEFAULT 'mock' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profound_result_snapshots" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"prompt_id" text,
	"profound_prompt_id" text NOT NULL,
	"profound_category_id" text NOT NULL,
	"run_id" text NOT NULL,
	"run_date" timestamp with time zone NOT NULL,
	"model" text,
	"model_id" text NOT NULL,
	"region" text,
	"asset" text,
	"topic" text,
	"profound_persona" text,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"visibility_score" double precision,
	"share_of_voice" double precision,
	"mention_count" integer,
	"executions" integer,
	"average_position" double precision,
	"citation_count" integer,
	"citation_share" double precision,
	"brand_mentioned" boolean,
	"raw_answer" text,
	"mentions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"search_queries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"sentiment_themes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"raw_response" jsonb,
	"data_origin" "data_origin" DEFAULT 'mock' NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profound_sync_items" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"sync_job_id" text NOT NULL,
	"prompt_id" text NOT NULL,
	"prompt_type" "prompt_type" NOT NULL,
	"normalized_hash" text NOT NULL,
	"outcome" "sync_item_outcome" DEFAULT 'pending' NOT NULL,
	"profound_prompt_id" text,
	"error_message" text,
	"error_code" text,
	"retryable" boolean DEFAULT false NOT NULL,
	"payload" jsonb,
	"response" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "profound_sync_jobs" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"prompt_set_version_id" text NOT NULL,
	"persona_id" text NOT NULL,
	"persona_version_id" text NOT NULL,
	"persona_mapping_id" text,
	"profound_category_id" text NOT NULL,
	"profound_category_name" text,
	"profound_persona_id" text,
	"fallback_persona_tag" text,
	"region" text,
	"language" text,
	"platforms" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"analysis_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"state" "sync_state" DEFAULT 'draft' NOT NULL,
	"persona_prompt_count" integer DEFAULT 0 NOT NULL,
	"control_prompt_count" integer DEFAULT 0 NOT NULL,
	"duplicate_count" integer DEFAULT 0 NOT NULL,
	"created_count" integer DEFAULT 0 NOT NULL,
	"failed_count" integer DEFAULT 0 NOT NULL,
	"payload" jsonb,
	"dry_run_request_hash" text,
	"dry_run_response" jsonb,
	"dry_run_at" timestamp with time zone,
	"final_response" jsonb,
	"request_hash" text,
	"response_hash" text,
	"errors" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"data_origin" "data_origin" DEFAULT 'mock' NOT NULL,
	"initiated_by_user_id" text,
	"approved_by_user_id" text,
	"approved_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"retry_of_sync_job_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prompt_embeddings" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"prompt_id" text NOT NULL,
	"model_id" text NOT NULL,
	"data_origin" "data_origin" DEFAULT 'mock' NOT NULL,
	"embedding" vector(1536) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prompt_evidence" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"prompt_id" text NOT NULL,
	"evidence_id" text NOT NULL,
	"unavailable" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prompt_pairs" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"prompt_set_version_id" text NOT NULL,
	"persona_prompt_id" text NOT NULL,
	"control_prompt_id" text NOT NULL,
	"rationale" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prompt_set_versions" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"prompt_set_id" text NOT NULL,
	"persona_version_id" text NOT NULL,
	"version" integer NOT NULL,
	"status" "review_status" DEFAULT 'draft' NOT NULL,
	"prompt_count" integer DEFAULT 0 NOT NULL,
	"control_count" integer DEFAULT 0 NOT NULL,
	"model_provider" text,
	"model_id" text,
	"prompt_template_version" text,
	"schema_version" text,
	"data_origin" "data_origin" DEFAULT 'mock' NOT NULL,
	"evidence_cutoff" timestamp with time zone,
	"generated_by_user_id" text,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_by_user_id" text,
	"approved_at" timestamp with time zone,
	"parent_version_id" text,
	"change_summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prompt_sets" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"persona_id" text NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"current_version_id" text,
	"approved_version_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prompt_templates" (
	"id" text PRIMARY KEY NOT NULL,
	"template_id" text NOT NULL,
	"version" text NOT NULL,
	"purpose" text NOT NULL,
	"system_prompt" text NOT NULL,
	"user_template" text NOT NULL,
	"schema_version" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "prompts" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"prompt_set_version_id" text NOT NULL,
	"persona_id" text NOT NULL,
	"persona_version_id" text NOT NULL,
	"prompt_type" "prompt_type" DEFAULT 'persona' NOT NULL,
	"topic" text NOT NULL,
	"prompt_text" text NOT NULL,
	"normalized_hash" text NOT NULL,
	"information_need" text NOT NULL,
	"intent" "prompt_intent" NOT NULL,
	"journey_stage" "journey_stage" DEFAULT 'unknown' NOT NULL,
	"constraints_used" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"decision_criteria_used" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"vocabulary_used" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"expected_answer_elements" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"inclusion_rationale" text NOT NULL,
	"confidence" double precision DEFAULT 0 NOT NULL,
	"tracking_priority" "tracking_priority" DEFAULT 'medium' NOT NULL,
	"execution_mode" "execution_mode" DEFAULT 'standalone' NOT NULL,
	"review_status" "review_status" DEFAULT 'pending_review' NOT NULL,
	"profound_metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"profound_sync_state" "sync_state" DEFAULT 'draft' NOT NULL,
	"duplicate_of_prompt_id" text,
	"similarity_warning" jsonb,
	"edited_by_user" boolean DEFAULT false NOT NULL,
	"data_origin" "data_origin" DEFAULT 'mock' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "search_datasets" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"vendor" "vendor" DEFAULT 'dataforseo' NOT NULL,
	"operation" text NOT NULL,
	"request_params" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"request_hash" text NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"vendor_task_id" text,
	"normalized" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"raw_response" jsonb,
	"item_count" integer DEFAULT 0 NOT NULL,
	"cost_cents" double precision DEFAULT 0 NOT NULL,
	"data_origin" "data_origin" DEFAULT 'mock' NOT NULL,
	"error_message" text,
	"fetched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "segment_candidate_evidence" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"segment_candidate_id" text NOT NULL,
	"evidence_id" text NOT NULL,
	"relation" "evidence_relation" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "segment_candidates" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"run_id" text NOT NULL,
	"label" text NOT NULL,
	"slug" text NOT NULL,
	"definition" text NOT NULL,
	"distinguishing_variables" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"why_it_changes_prompts" text NOT NULL,
	"source_distribution" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"evidence_coverage" double precision DEFAULT 0 NOT NULL,
	"coverage_gaps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"overlaps" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"merge_split_recommendation" text,
	"confidence" double precision DEFAULT 0 NOT NULL,
	"confidence_components" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"confidence_explanation" text,
	"status" "segment_status" DEFAULT 'candidate' NOT NULL,
	"merged_into_id" text,
	"model_provider" text,
	"model_id" text,
	"prompt_template_version" text,
	"schema_version" text,
	"data_origin" "data_origin" DEFAULT 'mock' NOT NULL,
	"evidence_cutoff" timestamp with time zone,
	"generated_by_user_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
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
	"brand_id" text NOT NULL,
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
	"brand_id" text,
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
ALTER TABLE "audience_reports" ADD CONSTRAINT "audience_reports_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audience_reports" ADD CONSTRAINT "audience_reports_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audience_reports" ADD CONSTRAINT "audience_reports_created_by_user_id_users_id_fk" FOREIGN KEY ("created_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audience_signals" ADD CONSTRAINT "audience_signals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audience_signals" ADD CONSTRAINT "audience_signals_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audience_signals" ADD CONSTRAINT "audience_signals_audience_report_id_audience_reports_id_fk" FOREIGN KEY ("audience_report_id") REFERENCES "public"."audience_reports"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_findings" ADD CONSTRAINT "audit_findings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_findings" ADD CONSTRAINT "audit_findings_page_audit_id_page_audits_id_fk" FOREIGN KEY ("page_audit_id") REFERENCES "public"."page_audits"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_products" ADD CONSTRAINT "brand_products_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_products" ADD CONSTRAINT "brand_products_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brands" ADD CONSTRAINT "brands_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitors" ADD CONSTRAINT "competitors_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "competitors" ADD CONSTRAINT "competitors_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_briefs" ADD CONSTRAINT "content_briefs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_briefs" ADD CONSTRAINT "content_briefs_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_briefs" ADD CONSTRAINT "content_briefs_opportunity_id_content_opportunities_id_fk" FOREIGN KEY ("opportunity_id") REFERENCES "public"."content_opportunities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_briefs" ADD CONSTRAINT "content_briefs_persona_id_personas_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."personas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_briefs" ADD CONSTRAINT "content_briefs_persona_version_id_persona_versions_id_fk" FOREIGN KEY ("persona_version_id") REFERENCES "public"."persona_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_briefs" ADD CONSTRAINT "content_briefs_prompt_set_version_id_prompt_set_versions_id_fk" FOREIGN KEY ("prompt_set_version_id") REFERENCES "public"."prompt_set_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_briefs" ADD CONSTRAINT "content_briefs_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_briefs" ADD CONSTRAINT "content_briefs_generated_by_user_id_users_id_fk" FOREIGN KEY ("generated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_opportunities" ADD CONSTRAINT "content_opportunities_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_opportunities" ADD CONSTRAINT "content_opportunities_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_opportunities" ADD CONSTRAINT "content_opportunities_persona_id_personas_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."personas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_opportunities" ADD CONSTRAINT "content_opportunities_persona_version_id_persona_versions_id_fk" FOREIGN KEY ("persona_version_id") REFERENCES "public"."persona_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_opportunities" ADD CONSTRAINT "content_opportunities_prompt_set_version_id_prompt_set_versions_id_fk" FOREIGN KEY ("prompt_set_version_id") REFERENCES "public"."prompt_set_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_opportunities" ADD CONSTRAINT "content_opportunities_generated_by_user_id_users_id_fk" FOREIGN KEY ("generated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_sources" ADD CONSTRAINT "data_sources_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_sources" ADD CONSTRAINT "data_sources_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_sources" ADD CONSTRAINT "data_sources_uploaded_by_user_id_users_id_fk" FOREIGN KEY ("uploaded_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_embeddings" ADD CONSTRAINT "evidence_embeddings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_embeddings" ADD CONSTRAINT "evidence_embeddings_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_embeddings" ADD CONSTRAINT "evidence_embeddings_evidence_id_evidence_records_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_notes" ADD CONSTRAINT "evidence_notes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_notes" ADD CONSTRAINT "evidence_notes_evidence_id_evidence_records_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_notes" ADD CONSTRAINT "evidence_notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_records" ADD CONSTRAINT "evidence_records_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_records" ADD CONSTRAINT "evidence_records_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_records" ADD CONSTRAINT "evidence_records_data_source_id_data_sources_id_fk" FOREIGN KEY ("data_source_id") REFERENCES "public"."data_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_records" ADD CONSTRAINT "evidence_records_source_document_id_source_documents_id_fk" FOREIGN KEY ("source_document_id") REFERENCES "public"."source_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evidence_records" ADD CONSTRAINT "evidence_records_reviewed_by_user_id_users_id_fk" FOREIGN KEY ("reviewed_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_jobs" ADD CONSTRAINT "ingestion_jobs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_jobs" ADD CONSTRAINT "ingestion_jobs_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ingestion_jobs" ADD CONSTRAINT "ingestion_jobs_data_source_id_data_sources_id_fk" FOREIGN KEY ("data_source_id") REFERENCES "public"."data_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "integrations" ADD CONSTRAINT "integrations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_evaluation_results" ADD CONSTRAINT "internal_evaluation_results_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_evaluation_results" ADD CONSTRAINT "internal_evaluation_results_run_id_internal_evaluation_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."internal_evaluation_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_evaluation_runs" ADD CONSTRAINT "internal_evaluation_runs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_evaluation_runs" ADD CONSTRAINT "internal_evaluation_runs_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "internal_evaluation_runs" ADD CONSTRAINT "internal_evaluation_runs_triggered_by_user_id_users_id_fk" FOREIGN KEY ("triggered_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "model_configurations" ADD CONSTRAINT "model_configurations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_audits" ADD CONSTRAINT "page_audits_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_audits" ADD CONSTRAINT "page_audits_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_audits" ADD CONSTRAINT "page_audits_persona_id_personas_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."personas"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_audits" ADD CONSTRAINT "page_audits_persona_version_id_persona_versions_id_fk" FOREIGN KEY ("persona_version_id") REFERENCES "public"."persona_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_audits" ADD CONSTRAINT "page_audits_prompt_set_version_id_prompt_set_versions_id_fk" FOREIGN KEY ("prompt_set_version_id") REFERENCES "public"."prompt_set_versions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_audits" ADD CONSTRAINT "page_audits_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_audits" ADD CONSTRAINT "page_audits_generated_by_user_id_users_id_fk" FOREIGN KEY ("generated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_inventory" ADD CONSTRAINT "page_inventory_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_inventory" ADD CONSTRAINT "page_inventory_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "page_inventory" ADD CONSTRAINT "page_inventory_data_source_id_data_sources_id_fk" FOREIGN KEY ("data_source_id") REFERENCES "public"."data_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_field_evidence" ADD CONSTRAINT "persona_field_evidence_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_field_evidence" ADD CONSTRAINT "persona_field_evidence_persona_field_id_persona_fields_id_fk" FOREIGN KEY ("persona_field_id") REFERENCES "public"."persona_fields"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_field_evidence" ADD CONSTRAINT "persona_field_evidence_evidence_id_evidence_records_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_fields" ADD CONSTRAINT "persona_fields_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_fields" ADD CONSTRAINT "persona_fields_persona_version_id_persona_versions_id_fk" FOREIGN KEY ("persona_version_id") REFERENCES "public"."persona_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_versions" ADD CONSTRAINT "persona_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_versions" ADD CONSTRAINT "persona_versions_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_versions" ADD CONSTRAINT "persona_versions_persona_id_personas_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."personas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_versions" ADD CONSTRAINT "persona_versions_generated_by_user_id_users_id_fk" FOREIGN KEY ("generated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "persona_versions" ADD CONSTRAINT "persona_versions_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personas" ADD CONSTRAINT "personas_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personas" ADD CONSTRAINT "personas_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "personas" ADD CONSTRAINT "personas_segment_candidate_id_segment_candidates_id_fk" FOREIGN KEY ("segment_candidate_id") REFERENCES "public"."segment_candidates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profound_category_mappings" ADD CONSTRAINT "profound_category_mappings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profound_category_mappings" ADD CONSTRAINT "profound_category_mappings_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profound_category_mappings" ADD CONSTRAINT "profound_category_mappings_connection_id_profound_connections_id_fk" FOREIGN KEY ("connection_id") REFERENCES "public"."profound_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profound_connections" ADD CONSTRAINT "profound_connections_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profound_connections" ADD CONSTRAINT "profound_connections_integration_id_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profound_persona_mappings" ADD CONSTRAINT "profound_persona_mappings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profound_persona_mappings" ADD CONSTRAINT "profound_persona_mappings_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profound_persona_mappings" ADD CONSTRAINT "profound_persona_mappings_persona_id_personas_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."personas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profound_persona_mappings" ADD CONSTRAINT "profound_persona_mappings_persona_version_id_persona_versions_id_fk" FOREIGN KEY ("persona_version_id") REFERENCES "public"."persona_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profound_prompt_links" ADD CONSTRAINT "profound_prompt_links_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profound_prompt_links" ADD CONSTRAINT "profound_prompt_links_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profound_prompt_links" ADD CONSTRAINT "profound_prompt_links_prompt_id_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."prompts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profound_prompt_links" ADD CONSTRAINT "profound_prompt_links_prompt_set_version_id_prompt_set_versions_id_fk" FOREIGN KEY ("prompt_set_version_id") REFERENCES "public"."prompt_set_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profound_result_snapshots" ADD CONSTRAINT "profound_result_snapshots_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profound_result_snapshots" ADD CONSTRAINT "profound_result_snapshots_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profound_result_snapshots" ADD CONSTRAINT "profound_result_snapshots_prompt_id_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."prompts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profound_sync_items" ADD CONSTRAINT "profound_sync_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profound_sync_items" ADD CONSTRAINT "profound_sync_items_sync_job_id_profound_sync_jobs_id_fk" FOREIGN KEY ("sync_job_id") REFERENCES "public"."profound_sync_jobs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profound_sync_items" ADD CONSTRAINT "profound_sync_items_prompt_id_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."prompts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profound_sync_jobs" ADD CONSTRAINT "profound_sync_jobs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profound_sync_jobs" ADD CONSTRAINT "profound_sync_jobs_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profound_sync_jobs" ADD CONSTRAINT "profound_sync_jobs_prompt_set_version_id_prompt_set_versions_id_fk" FOREIGN KEY ("prompt_set_version_id") REFERENCES "public"."prompt_set_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profound_sync_jobs" ADD CONSTRAINT "profound_sync_jobs_persona_id_personas_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."personas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profound_sync_jobs" ADD CONSTRAINT "profound_sync_jobs_persona_version_id_persona_versions_id_fk" FOREIGN KEY ("persona_version_id") REFERENCES "public"."persona_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profound_sync_jobs" ADD CONSTRAINT "profound_sync_jobs_persona_mapping_id_profound_persona_mappings_id_fk" FOREIGN KEY ("persona_mapping_id") REFERENCES "public"."profound_persona_mappings"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profound_sync_jobs" ADD CONSTRAINT "profound_sync_jobs_initiated_by_user_id_users_id_fk" FOREIGN KEY ("initiated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profound_sync_jobs" ADD CONSTRAINT "profound_sync_jobs_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_embeddings" ADD CONSTRAINT "prompt_embeddings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_embeddings" ADD CONSTRAINT "prompt_embeddings_prompt_id_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."prompts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_evidence" ADD CONSTRAINT "prompt_evidence_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_evidence" ADD CONSTRAINT "prompt_evidence_prompt_id_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."prompts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_evidence" ADD CONSTRAINT "prompt_evidence_evidence_id_evidence_records_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_pairs" ADD CONSTRAINT "prompt_pairs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_pairs" ADD CONSTRAINT "prompt_pairs_prompt_set_version_id_prompt_set_versions_id_fk" FOREIGN KEY ("prompt_set_version_id") REFERENCES "public"."prompt_set_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_pairs" ADD CONSTRAINT "prompt_pairs_persona_prompt_id_prompts_id_fk" FOREIGN KEY ("persona_prompt_id") REFERENCES "public"."prompts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_pairs" ADD CONSTRAINT "prompt_pairs_control_prompt_id_prompts_id_fk" FOREIGN KEY ("control_prompt_id") REFERENCES "public"."prompts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_set_versions" ADD CONSTRAINT "prompt_set_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_set_versions" ADD CONSTRAINT "prompt_set_versions_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_set_versions" ADD CONSTRAINT "prompt_set_versions_prompt_set_id_prompt_sets_id_fk" FOREIGN KEY ("prompt_set_id") REFERENCES "public"."prompt_sets"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_set_versions" ADD CONSTRAINT "prompt_set_versions_persona_version_id_persona_versions_id_fk" FOREIGN KEY ("persona_version_id") REFERENCES "public"."persona_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_set_versions" ADD CONSTRAINT "prompt_set_versions_generated_by_user_id_users_id_fk" FOREIGN KEY ("generated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_set_versions" ADD CONSTRAINT "prompt_set_versions_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_sets" ADD CONSTRAINT "prompt_sets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_sets" ADD CONSTRAINT "prompt_sets_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_sets" ADD CONSTRAINT "prompt_sets_persona_id_personas_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."personas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompts" ADD CONSTRAINT "prompts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompts" ADD CONSTRAINT "prompts_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompts" ADD CONSTRAINT "prompts_prompt_set_version_id_prompt_set_versions_id_fk" FOREIGN KEY ("prompt_set_version_id") REFERENCES "public"."prompt_set_versions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompts" ADD CONSTRAINT "prompts_persona_id_personas_id_fk" FOREIGN KEY ("persona_id") REFERENCES "public"."personas"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompts" ADD CONSTRAINT "prompts_persona_version_id_persona_versions_id_fk" FOREIGN KEY ("persona_version_id") REFERENCES "public"."persona_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_datasets" ADD CONSTRAINT "search_datasets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "search_datasets" ADD CONSTRAINT "search_datasets_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segment_candidate_evidence" ADD CONSTRAINT "segment_candidate_evidence_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segment_candidate_evidence" ADD CONSTRAINT "segment_candidate_evidence_segment_candidate_id_segment_candidates_id_fk" FOREIGN KEY ("segment_candidate_id") REFERENCES "public"."segment_candidates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segment_candidate_evidence" ADD CONSTRAINT "segment_candidate_evidence_evidence_id_evidence_records_id_fk" FOREIGN KEY ("evidence_id") REFERENCES "public"."evidence_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segment_candidates" ADD CONSTRAINT "segment_candidates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segment_candidates" ADD CONSTRAINT "segment_candidates_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segment_candidates" ADD CONSTRAINT "segment_candidates_generated_by_user_id_users_id_fk" FOREIGN KEY ("generated_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_documents" ADD CONSTRAINT "source_documents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_documents" ADD CONSTRAINT "source_documents_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_documents" ADD CONSTRAINT "source_documents_data_source_id_data_sources_id_fk" FOREIGN KEY ("data_source_id") REFERENCES "public"."data_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_credentials" ADD CONSTRAINT "vendor_credentials_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_credentials" ADD CONSTRAINT "vendor_credentials_integration_id_integrations_id_fk" FOREIGN KEY ("integration_id") REFERENCES "public"."integrations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_usage" ADD CONSTRAINT "vendor_usage_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vendor_usage" ADD CONSTRAINT "vendor_usage_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audience_reports_brand_idx" ON "audience_reports" USING btree ("organization_id","brand_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "audience_signals_uq" ON "audience_signals" USING btree ("audience_report_id","section");--> statement-breakpoint
CREATE INDEX "audit_findings_audit_idx" ON "audit_findings" USING btree ("page_audit_id","sequence");--> statement-breakpoint
CREATE INDEX "audit_logs_org_idx" ON "audit_logs" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "audit_logs" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "brand_products_brand_idx" ON "brand_products" USING btree ("organization_id","brand_id");--> statement-breakpoint
CREATE UNIQUE INDEX "brands_org_slug_uq" ON "brands" USING btree ("organization_id","slug");--> statement-breakpoint
CREATE INDEX "brands_org_idx" ON "brands" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "competitors_brand_idx" ON "competitors" USING btree ("organization_id","brand_id");--> statement-breakpoint
CREATE INDEX "content_briefs_brand_idx" ON "content_briefs" USING btree ("organization_id","brand_id","created_at");--> statement-breakpoint
CREATE INDEX "content_opportunities_brand_idx" ON "content_opportunities" USING btree ("organization_id","brand_id","created_at");--> statement-breakpoint
CREATE INDEX "content_opportunities_persona_idx" ON "content_opportunities" USING btree ("persona_version_id");--> statement-breakpoint
CREATE INDEX "data_sources_brand_idx" ON "data_sources" USING btree ("organization_id","brand_id","created_at");--> statement-breakpoint
CREATE INDEX "data_sources_status_idx" ON "data_sources" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "data_sources_checksum_uq" ON "data_sources" USING btree ("brand_id","checksum");--> statement-breakpoint
CREATE UNIQUE INDEX "evidence_embeddings_uq" ON "evidence_embeddings" USING btree ("evidence_id","model_id");--> statement-breakpoint
CREATE INDEX "evidence_embeddings_brand_idx" ON "evidence_embeddings" USING btree ("brand_id");--> statement-breakpoint
CREATE INDEX "evidence_embeddings_hnsw" ON "evidence_embeddings" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "evidence_notes_evidence_idx" ON "evidence_notes" USING btree ("evidence_id","created_at");--> statement-breakpoint
CREATE INDEX "evidence_brand_idx" ON "evidence_records" USING btree ("organization_id","brand_id","created_at");--> statement-breakpoint
CREATE INDEX "evidence_category_idx" ON "evidence_records" USING btree ("brand_id","category");--> statement-breakpoint
CREATE INDEX "evidence_stage_idx" ON "evidence_records" USING btree ("brand_id","journey_stage");--> statement-breakpoint
CREATE INDEX "evidence_provenance_idx" ON "evidence_records" USING btree ("brand_id","provenance");--> statement-breakpoint
CREATE INDEX "evidence_review_idx" ON "evidence_records" USING btree ("brand_id","review_status");--> statement-breakpoint
CREATE INDEX "evidence_observed_idx" ON "evidence_records" USING btree ("brand_id","observed_at");--> statement-breakpoint
CREATE INDEX "evidence_source_idx" ON "evidence_records" USING btree ("data_source_id");--> statement-breakpoint
CREATE INDEX "evidence_fts_idx" ON "evidence_records" USING gin (to_tsvector('english', coalesce("normalized_claim", '') || ' ' || coalesce("redacted_text", '')));--> statement-breakpoint
CREATE INDEX "evidence_entities_idx" ON "evidence_records" USING gin ("entities");--> statement-breakpoint
CREATE INDEX "evidence_segments_idx" ON "evidence_records" USING gin ("candidate_segment_labels");--> statement-breakpoint
CREATE INDEX "ingestion_jobs_source_idx" ON "ingestion_jobs" USING btree ("data_source_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "integrations_org_vendor_uq" ON "integrations" USING btree ("organization_id","vendor");--> statement-breakpoint
CREATE INDEX "internal_evaluation_results_run_idx" ON "internal_evaluation_results" USING btree ("run_id","passed");--> statement-breakpoint
CREATE INDEX "internal_evaluation_runs_idx" ON "internal_evaluation_runs" USING btree ("organization_id","suite","created_at");--> statement-breakpoint
CREATE INDEX "jobs_claim_idx" ON "jobs" USING btree ("status","run_after");--> statement-breakpoint
CREATE INDEX "jobs_scope_idx" ON "jobs" USING btree ("organization_id","brand_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "jobs_idempotency_uq" ON "jobs" USING btree ("idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_org_user_uq" ON "memberships" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "memberships_user_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "model_configurations_uq" ON "model_configurations" USING btree ("organization_id","tier");--> statement-breakpoint
CREATE INDEX "page_audits_brand_idx" ON "page_audits" USING btree ("organization_id","brand_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "page_inventory_uq" ON "page_inventory" USING btree ("brand_id","canonical_url");--> statement-breakpoint
CREATE UNIQUE INDEX "persona_field_evidence_uq" ON "persona_field_evidence" USING btree ("persona_field_id","evidence_id","relation");--> statement-breakpoint
CREATE INDEX "persona_field_evidence_evidence_idx" ON "persona_field_evidence" USING btree ("evidence_id");--> statement-breakpoint
CREATE INDEX "persona_fields_version_idx" ON "persona_fields" USING btree ("persona_version_id","field_type","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "persona_versions_uq" ON "persona_versions" USING btree ("persona_id","version");--> statement-breakpoint
CREATE INDEX "persona_versions_brand_idx" ON "persona_versions" USING btree ("organization_id","brand_id","created_at");--> statement-breakpoint
CREATE INDEX "persona_versions_status_idx" ON "persona_versions" USING btree ("brand_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "personas_brand_slug_uq" ON "personas" USING btree ("brand_id","slug");--> statement-breakpoint
CREATE INDEX "personas_brand_idx" ON "personas" USING btree ("organization_id","brand_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "profound_category_mappings_uq" ON "profound_category_mappings" USING btree ("brand_id","profound_category_id");--> statement-breakpoint
CREATE UNIQUE INDEX "profound_connections_org_uq" ON "profound_connections" USING btree ("organization_id","integration_id");--> statement-breakpoint
CREATE UNIQUE INDEX "profound_persona_mappings_uq" ON "profound_persona_mappings" USING btree ("persona_version_id","profound_category_id");--> statement-breakpoint
CREATE INDEX "profound_persona_mappings_brand_idx" ON "profound_persona_mappings" USING btree ("organization_id","brand_id");--> statement-breakpoint
CREATE UNIQUE INDEX "profound_prompt_links_idempotency_uq" ON "profound_prompt_links" USING btree ("organization_id","profound_category_id","normalized_hash");--> statement-breakpoint
CREATE INDEX "profound_prompt_links_prompt_idx" ON "profound_prompt_links" USING btree ("prompt_id");--> statement-breakpoint
CREATE INDEX "profound_prompt_links_profound_idx" ON "profound_prompt_links" USING btree ("profound_prompt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "profound_result_snapshots_uq" ON "profound_result_snapshots" USING btree ("organization_id","profound_prompt_id","run_id","model_id");--> statement-breakpoint
CREATE INDEX "profound_result_snapshots_brand_idx" ON "profound_result_snapshots" USING btree ("organization_id","brand_id","run_date");--> statement-breakpoint
CREATE INDEX "profound_result_snapshots_prompt_idx" ON "profound_result_snapshots" USING btree ("prompt_id","run_date");--> statement-breakpoint
CREATE UNIQUE INDEX "profound_sync_items_uq" ON "profound_sync_items" USING btree ("sync_job_id","prompt_id");--> statement-breakpoint
CREATE INDEX "profound_sync_items_outcome_idx" ON "profound_sync_items" USING btree ("sync_job_id","outcome");--> statement-breakpoint
CREATE INDEX "profound_sync_jobs_brand_idx" ON "profound_sync_jobs" USING btree ("organization_id","brand_id","created_at");--> statement-breakpoint
CREATE INDEX "profound_sync_jobs_set_idx" ON "profound_sync_jobs" USING btree ("prompt_set_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prompt_embeddings_uq" ON "prompt_embeddings" USING btree ("prompt_id","model_id");--> statement-breakpoint
CREATE INDEX "prompt_embeddings_hnsw" ON "prompt_embeddings" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "prompt_evidence_uq" ON "prompt_evidence" USING btree ("prompt_id","evidence_id");--> statement-breakpoint
CREATE INDEX "prompt_evidence_evidence_idx" ON "prompt_evidence" USING btree ("evidence_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prompt_pairs_uq" ON "prompt_pairs" USING btree ("persona_prompt_id","control_prompt_id");--> statement-breakpoint
CREATE INDEX "prompt_pairs_set_idx" ON "prompt_pairs" USING btree ("prompt_set_version_id");--> statement-breakpoint
CREATE UNIQUE INDEX "prompt_set_versions_uq" ON "prompt_set_versions" USING btree ("prompt_set_id","version");--> statement-breakpoint
CREATE INDEX "prompt_set_versions_brand_idx" ON "prompt_set_versions" USING btree ("organization_id","brand_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "prompt_sets_brand_slug_uq" ON "prompt_sets" USING btree ("brand_id","slug");--> statement-breakpoint
CREATE INDEX "prompt_sets_brand_idx" ON "prompt_sets" USING btree ("organization_id","brand_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "prompt_templates_uq" ON "prompt_templates" USING btree ("template_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "prompts_set_hash_uq" ON "prompts" USING btree ("prompt_set_version_id","normalized_hash");--> statement-breakpoint
CREATE INDEX "prompts_set_idx" ON "prompts" USING btree ("prompt_set_version_id","intent","journey_stage");--> statement-breakpoint
CREATE INDEX "prompts_brand_idx" ON "prompts" USING btree ("organization_id","brand_id");--> statement-breakpoint
CREATE INDEX "prompts_persona_idx" ON "prompts" USING btree ("persona_version_id");--> statement-breakpoint
CREATE INDEX "search_datasets_brand_idx" ON "search_datasets" USING btree ("organization_id","brand_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "search_datasets_hash_uq" ON "search_datasets" USING btree ("brand_id","request_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "segment_evidence_uq" ON "segment_candidate_evidence" USING btree ("segment_candidate_id","evidence_id","relation");--> statement-breakpoint
CREATE INDEX "segment_evidence_evidence_idx" ON "segment_candidate_evidence" USING btree ("evidence_id");--> statement-breakpoint
CREATE INDEX "segment_candidates_brand_idx" ON "segment_candidates" USING btree ("organization_id","brand_id","created_at");--> statement-breakpoint
CREATE INDEX "segment_candidates_run_idx" ON "segment_candidates" USING btree ("run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "segment_candidates_run_slug_uq" ON "segment_candidates" USING btree ("run_id","slug");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sessions_expiry_idx" ON "sessions" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "source_documents_source_idx" ON "source_documents" USING btree ("data_source_id","sequence");--> statement-breakpoint
CREATE INDEX "source_documents_brand_idx" ON "source_documents" USING btree ("organization_id","brand_id");--> statement-breakpoint
CREATE UNIQUE INDEX "source_documents_hash_uq" ON "source_documents" USING btree ("data_source_id","content_hash");--> statement-breakpoint
CREATE UNIQUE INDEX "vendor_credentials_integration_field_uq" ON "vendor_credentials" USING btree ("integration_id","field_name");--> statement-breakpoint
CREATE INDEX "vendor_usage_org_idx" ON "vendor_usage" USING btree ("organization_id","created_at");--> statement-breakpoint
CREATE INDEX "vendor_usage_vendor_idx" ON "vendor_usage" USING btree ("vendor","created_at");