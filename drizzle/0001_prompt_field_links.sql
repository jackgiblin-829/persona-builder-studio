ALTER TABLE "prompt_set_versions" ADD COLUMN "rejected_reason" text;--> statement-breakpoint
ALTER TABLE "prompts" ADD COLUMN "persona_field_ids" jsonb DEFAULT '[]'::jsonb NOT NULL;