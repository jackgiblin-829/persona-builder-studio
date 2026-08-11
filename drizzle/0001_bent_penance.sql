ALTER TABLE "generated_prompts" ADD COLUMN "topic_class" text DEFAULT 'unbranded_category_discovery' NOT NULL;--> statement-breakpoint
ALTER TABLE "generated_prompts" ADD COLUMN "prompt_type" text DEFAULT 'unbranded' NOT NULL;--> statement-breakpoint
ALTER TABLE "generated_prompts" ADD COLUMN "business_line" text DEFAULT 'general' NOT NULL;--> statement-breakpoint
ALTER TABLE "generated_prompts" ADD COLUMN "signal_tracked" text DEFAULT 'category recommendation' NOT NULL;--> statement-breakpoint
ALTER TABLE "generated_prompts" ADD COLUMN "buyer_qualifier" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "generated_prompts" ADD COLUMN "named_entities" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "generated_prompts" ADD COLUMN "quality_score" double precision DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "generated_prompts" ADD COLUMN "review_status" text DEFAULT 'ready' NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "prompt_strategy" jsonb DEFAULT '{"canonicalBrand":"","parentCompany":"","aliases":[],"entityCollisions":[],"categoryTerms":[],"businessLines":[],"competitors":[],"buyerQualifiers":[],"freshnessFacts":[],"targetPromptCount":50,"topicTargets":{"brand_entity_authority":6,"unbranded_category_discovery":10,"competitive_comparison":9,"buyer_education":10,"reputation_risk":7,"product_line_use_cases":8},"personaPromptTargets":{}}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "projects" ADD COLUMN "prompt_strategy_edited" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "prompt_set_versions" ADD COLUMN "strategy_snapshot" jsonb DEFAULT '{"canonicalBrand":"","parentCompany":"","aliases":[],"entityCollisions":[],"categoryTerms":[],"businessLines":[],"competitors":[],"buyerQualifiers":[],"freshnessFacts":[],"targetPromptCount":50,"topicTargets":{"brand_entity_authority":6,"unbranded_category_discovery":10,"competitive_comparison":9,"buyer_education":10,"reputation_risk":7,"product_line_use_cases":8},"personaPromptTargets":{}}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "prompt_set_versions" ADD COLUMN "quality_summary" jsonb DEFAULT '{}'::jsonb NOT NULL;