ALTER TYPE "workflow_type" ADD VALUE IF NOT EXISTS 'market_research';
--> statement-breakpoint
ALTER TYPE "workflow_stage" ADD VALUE IF NOT EXISTS 'researching_market';
--> statement-breakpoint
CREATE TABLE "market_research_briefs" (
  "id" text PRIMARY KEY NOT NULL,
  "organization_id" text NOT NULL,
  "project_id" text NOT NULL,
  "generation_run_id" text,
  "version" integer NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "content" jsonb NOT NULL,
  "source_revision" integer NOT NULL,
  "model_provider" text,
  "model_id" text,
  "data_origin" "data_origin" NOT NULL,
  "captured_at" timestamp with time zone NOT NULL,
  "stale_at" timestamp with time zone NOT NULL,
  "approved_at" timestamp with time zone,
  "approved_by_user_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "market_research_briefs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade,
  CONSTRAINT "market_research_briefs_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade,
  CONSTRAINT "market_research_briefs_approved_by_user_id_users_id_fk" FOREIGN KEY ("approved_by_user_id") REFERENCES "public"."users"("id") ON DELETE set null
);
--> statement-breakpoint
CREATE UNIQUE INDEX "market_research_briefs_version_uq" ON "market_research_briefs" USING btree ("project_id", "version");
--> statement-breakpoint
CREATE INDEX "market_research_briefs_project_idx" ON "market_research_briefs" USING btree ("organization_id", "project_id");
--> statement-breakpoint
ALTER TABLE "generated_prompts" ADD COLUMN "coverage_key" text DEFAULT 'legacy' NOT NULL;
--> statement-breakpoint
ALTER TABLE "generated_prompts" ADD COLUMN "question_archetype" text DEFAULT 'recommendation' NOT NULL;
--> statement-breakpoint
ALTER TABLE "generated_prompts" ADD COLUMN "rubric_scores" jsonb DEFAULT '{"categorySpecificity":0,"personaQualifierFit":0,"naturalBuyerLanguage":0,"measurementValue":0,"researchSupport":0,"distinctiveness":0,"metadataCompleteness":0,"total":0}'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "generated_prompts" ADD COLUMN "evaluator_explanation" text DEFAULT '' NOT NULL;
--> statement-breakpoint
ALTER TABLE "generated_prompts" ADD COLUMN "research_fact_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "generated_prompts" ADD COLUMN "maximum_similarity" double precision DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "generated_prompts" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
--> statement-breakpoint
ALTER TABLE "prompt_set_versions" ADD COLUMN "research_brief_id" text;
