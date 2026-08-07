ALTER TYPE "public"."source_system" ADD VALUE 'uploaded_pdf' BEFORE 'pasted_text';--> statement-breakpoint
ALTER TYPE "public"."source_system" ADD VALUE 'sparktoro_report';--> statement-breakpoint
ALTER TYPE "public"."source_system" ADD VALUE 'profound_report';--> statement-breakpoint
ALTER TYPE "public"."source_system" ADD VALUE 'openai_web_search';--> statement-breakpoint
ALTER TYPE "public"."source_type" ADD VALUE 'sparktoro' BEFORE 'other';--> statement-breakpoint
ALTER TYPE "public"."source_type" ADD VALUE 'profound' BEFORE 'other';--> statement-breakpoint
ALTER TYPE "public"."source_type" ADD VALUE 'web_research' BEFORE 'other';