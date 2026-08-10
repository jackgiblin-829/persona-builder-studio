DROP TABLE "profound_result_snapshots" CASCADE;--> statement-breakpoint
ALTER TABLE "content_opportunities" RENAME COLUMN "relevant_run_ids" TO "relevant_bucket_ids";--> statement-breakpoint
ALTER TABLE "content_briefs" RENAME COLUMN "run_ids" TO "bucket_ids";--> statement-breakpoint
CREATE TABLE "profound_result_buckets" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"prompt_id" text,
	"profound_prompt_id" text NOT NULL,
	"profound_category_id" text NOT NULL,
	"bucket_date" timestamp with time zone NOT NULL,
	"model_id" text NOT NULL,
	"model" text,
	"topic_id" text DEFAULT '' NOT NULL,
	"topic" text,
	"region_id" text DEFAULT '' NOT NULL,
	"region" text,
	"persona_id" text DEFAULT '' NOT NULL,
	"profound_persona" text,
	"asset" text NOT NULL,
	"asset_owned" boolean,
	"rank" integer,
	"tags" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"visibility_score" double precision,
	"share_of_voice" double precision,
	"average_position" double precision,
	"citation_count" integer,
	"citation_share" double precision,
	"citation_domains" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"citations" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"raw_response" jsonb,
	"data_origin" "data_origin" DEFAULT 'mock' NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "profound_sentiment_buckets" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"prompt_id" text,
	"profound_prompt_id" text NOT NULL,
	"profound_category_id" text NOT NULL,
	"asset" text NOT NULL,
	"bucket_date" timestamp with time zone NOT NULL,
	"model_id" text NOT NULL,
	"model" text,
	"topic_id" text DEFAULT '' NOT NULL,
	"topic" text,
	"region_id" text DEFAULT '' NOT NULL,
	"region" text,
	"persona_id" text DEFAULT '' NOT NULL,
	"profound_persona" text,
	"tag" text DEFAULT '' NOT NULL,
	"theme" text DEFAULT '' NOT NULL,
	"claim" text DEFAULT '' NOT NULL,
	"profound_run" text DEFAULT '' NOT NULL,
	"competitor" text DEFAULT '' NOT NULL,
	"positive_sentiment" double precision,
	"negative_sentiment" double precision,
	"occurrence" double precision,
	"cited_websites" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"rank" integer,
	"raw_response" jsonb,
	"data_origin" "data_origin" DEFAULT 'mock' NOT NULL,
	"synced_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
CREATE TABLE "prompt_answer_coverage_estimates" (
	"id" text PRIMARY KEY NOT NULL,
	"organization_id" text NOT NULL,
	"brand_id" text NOT NULL,
	"prompt_id" text NOT NULL,
	"expected_elements_hash" text NOT NULL,
	"covered" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"missing" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confidence" double precision NOT NULL,
	"rationale" text NOT NULL,
	"model_provider" text,
	"model_id" text,
	"prompt_template_version" text,
	"data_origin" "data_origin" DEFAULT 'local' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);--> statement-breakpoint
ALTER TABLE "profound_result_buckets" ADD CONSTRAINT "profound_result_buckets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profound_result_buckets" ADD CONSTRAINT "profound_result_buckets_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profound_result_buckets" ADD CONSTRAINT "profound_result_buckets_prompt_id_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."prompts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profound_sentiment_buckets" ADD CONSTRAINT "profound_sentiment_buckets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profound_sentiment_buckets" ADD CONSTRAINT "profound_sentiment_buckets_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profound_sentiment_buckets" ADD CONSTRAINT "profound_sentiment_buckets_prompt_id_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."prompts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_answer_coverage_estimates" ADD CONSTRAINT "prompt_answer_coverage_estimates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_answer_coverage_estimates" ADD CONSTRAINT "prompt_answer_coverage_estimates_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "prompt_answer_coverage_estimates" ADD CONSTRAINT "prompt_answer_coverage_estimates_prompt_id_prompts_id_fk" FOREIGN KEY ("prompt_id") REFERENCES "public"."prompts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "profound_result_buckets_uq" ON "profound_result_buckets" USING btree ("organization_id","profound_prompt_id","bucket_date","model_id","topic_id","region_id","persona_id","asset");--> statement-breakpoint
CREATE INDEX "profound_result_buckets_brand_idx" ON "profound_result_buckets" USING btree ("organization_id","brand_id","bucket_date");--> statement-breakpoint
CREATE INDEX "profound_result_buckets_prompt_idx" ON "profound_result_buckets" USING btree ("prompt_id","bucket_date");--> statement-breakpoint
CREATE UNIQUE INDEX "profound_sentiment_buckets_uq" ON "profound_sentiment_buckets" USING btree ("organization_id","profound_prompt_id","asset","bucket_date","model_id","topic_id","region_id","persona_id","tag","theme","claim","profound_run","competitor");--> statement-breakpoint
CREATE INDEX "profound_sentiment_buckets_brand_idx" ON "profound_sentiment_buckets" USING btree ("organization_id","brand_id","bucket_date");--> statement-breakpoint
CREATE UNIQUE INDEX "prompt_answer_coverage_estimates_uq" ON "prompt_answer_coverage_estimates" USING btree ("prompt_id","expected_elements_hash");--> statement-breakpoint
CREATE INDEX "prompt_answer_coverage_estimates_brand_idx" ON "prompt_answer_coverage_estimates" USING btree ("organization_id","brand_id");