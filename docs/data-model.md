# Data model

The clean initial migration contains only the project workflow.

## Identity and scope

`users`, `organizations`, `memberships`, `sessions`, `integrations`, and `projects` provide authentication, tenancy, roles, vendor configuration, and the single project market/locale.

Every project-owned table carries both `organization_id` and `project_id` where useful for explicit tenant filtering and indexes.

## Research

- `data_sources` tracks uploaded files and pasted transcripts, including per-source stage and progress.
- `source_documents` stores parsed/redacted text and storage references.
- `research_signals` unifies first-party evidence and normalized SparkToro results with category, display text, structured value, provenance, location, confidence, and origin.
- `sparktoro_reports` and `sparktoro_report_sections` retain cached full reports, credit usage, normalized sections, warnings, and retry state.
- `market_research_briefs` stores immutable versioned research snapshots, cited facts and URLs, capture/stale dates, and draft/approved/superseded state.

## Generation

- `generation_runs` records workflow type, stage, progress, warnings, retry state, input snapshot, result IDs, and terminal error.
- `personas` is the stable identity; `persona_versions` stores immutable traditional profiles; `persona_version_signals` links evidence.
- `projects.prompt_strategy` stores the editable brand, category, business-line, competitor, qualifier, and coverage brief.
- `prompt_sets` remains the stable per-persona publication pointer, while generation creates a project-wide, globally deduplicated Query Funnel blueprint with a complete baseline for each persona. `prompt_set_versions` is immutable and records `draft`, `current`, or `superseded` lifecycle state, its frozen research brief, planner/writer/evaluator/repair versions, schema version, actual model IDs, and generation metrics. `prompt_clusters` represent decision pathways. `generated_prompts` retain the funnel stage, stable coverage key, parent coverage key, taxonomy, rubric scores, evaluator explanation, typed quality issues, evidence graph, semantic-similarity result, archetype, and research-fact references. Editorial review status is mutable, audited workflow metadata rather than generated prompt content.

Stable rows point to the latest fully passing version only. Failed generations and edits remain drafts; complete project-wide versions are published transactionally.

## Operations

`jobs`, `usage_logs`, and `audit_logs` provide the durable queue, vendor/model accounting, and security-sensitive activity history.
