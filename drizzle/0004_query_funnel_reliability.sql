CREATE TYPE "public"."prompt_version_lifecycle" AS ENUM('draft', 'current', 'superseded');
--> statement-breakpoint
ALTER TABLE "prompt_set_versions" ADD COLUMN "lifecycle_status" "prompt_version_lifecycle" DEFAULT 'current' NOT NULL;
--> statement-breakpoint
ALTER TABLE "prompt_set_versions" ADD COLUMN "planner_prompt_version" text;
--> statement-breakpoint
ALTER TABLE "prompt_set_versions" ADD COLUMN "writer_prompt_version" text;
--> statement-breakpoint
ALTER TABLE "prompt_set_versions" ADD COLUMN "evaluator_prompt_version" text;
--> statement-breakpoint
ALTER TABLE "prompt_set_versions" ADD COLUMN "repair_prompt_version" text;
--> statement-breakpoint
ALTER TABLE "prompt_set_versions" ADD COLUMN "schema_version" text;
--> statement-breakpoint
ALTER TABLE "prompt_set_versions" ADD COLUMN "generation_metrics" jsonb DEFAULT '{"plannerCalls":0,"writerCalls":0,"evaluatorCalls":0,"repairCalls":0,"repairRounds":0,"initialCellCount":0,"initialPassCount":0,"finalPassCount":0,"durationMs":0,"tokensIn":0,"tokensOut":0,"costCents":0,"modelIds":[],"byTemplate":{}}'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "generated_prompts" ADD COLUMN "quality_issues" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
UPDATE "prompt_set_versions" AS version
SET "lifecycle_status" = 'superseded'
WHERE NOT EXISTS (
  SELECT 1
  FROM "prompt_sets" AS parent
  WHERE parent."current_version_id" = version."id"
);
