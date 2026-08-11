ALTER TABLE "generated_prompts" ADD COLUMN IF NOT EXISTS "parent_coverage_key" text;
--> statement-breakpoint
ALTER TABLE "projects" ALTER COLUMN "prompt_strategy" SET DEFAULT '{"canonicalBrand":"","parentCompany":"","aliases":[],"entityCollisions":[],"categoryTerms":[],"businessLines":[],"competitors":[],"buyerQualifiers":[],"freshnessFacts":[],"pathwaysPerPersona":3,"targetPromptCount":50,"funnelTargets":{"awareness":30,"consideration":15,"decision":5}}'::jsonb;
--> statement-breakpoint
ALTER TABLE "prompt_set_versions" ALTER COLUMN "strategy_snapshot" SET DEFAULT '{"canonicalBrand":"","parentCompany":"","aliases":[],"entityCollisions":[],"categoryTerms":[],"businessLines":[],"competitors":[],"buyerQualifiers":[],"freshnessFacts":[],"pathwaysPerPersona":3,"targetPromptCount":50,"funnelTargets":{"awareness":30,"consideration":15,"decision":5}}'::jsonb;
--> statement-breakpoint
UPDATE "projects"
SET "prompt_strategy" = ("prompt_strategy" - 'topicTargets' - 'personaPromptTargets') || '{"pathwaysPerPersona":3,"targetPromptCount":50,"funnelTargets":{"awareness":30,"consideration":15,"decision":5}}'::jsonb;
--> statement-breakpoint
UPDATE "prompt_set_versions"
SET "strategy_snapshot" = ("strategy_snapshot" - 'topicTargets' - 'personaPromptTargets') || '{"pathwaysPerPersona":3,"targetPromptCount":50,"funnelTargets":{"awareness":30,"consideration":15,"decision":5}}'::jsonb;
--> statement-breakpoint
UPDATE "market_research_briefs"
SET "content" = jsonb_set(
  "content",
  '{strategy}',
  (("content"->'strategy') - 'topicTargets' - 'personaPromptTargets') || '{"pathwaysPerPersona":3,"targetPromptCount":50,"funnelTargets":{"awareness":30,"consideration":15,"decision":5}}'::jsonb
)
WHERE "content" ? 'strategy';
