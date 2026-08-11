# Architecture

Persona Builder Studio has two runtime processes and one database:

```text
Next.js App Router
  Server Components → tenant-scoped services → PostgreSQL
  Server Actions    → tenant-scoped services → adapters / job queue

PostgreSQL-backed worker
  ingest_source → extract_signals
  generate_personas → SparkToro + OpenAI
  research_market   → uploaded evidence + OpenAI web search → cited draft brief
  generate_prompts  → frozen brief + 50-cell blueprint per persona
                    → 5 BOFU anchors → 15 MOFU branches → 30 TOFU branches
                    → 2 candidates/cell → rubric + embeddings → up to 2 repairs → human review
```

## Boundaries

- Pages render data and forms. Reusable components do not access the database or vendors.
- Server actions validate CSRF, authenticate the session, resolve project membership, and call services.
- Services enforce capabilities and organization/project scope before reads or writes.
- Adapters isolate storage, queue, OpenAI, and SparkToro behavior. Mock and live modes have the same contract.
- Jobs are durable PostgreSQL rows with attempts, retry timing, status, payload, and error state.

## Atomic publication

Persona and prompt generation first build and validate a complete replacement. A transaction then inserts immutable versions and switches stable parent pointers. Existing completed versions remain readable while a new run is queued or running, and remain current if it fails.

Persona edits create a child version with an optimistic version check. If a Query Funnel baseline exists, the edit queues a project-wide replacement so cross-persona coverage and duplicate checks remain valid.

Prompt generation is project-wide even though completed rows retain persona ownership for review and export. Research approval freezes a versioned market brief and its cited facts; editing the strategy invalidates approval until a new brief is approved. Briefs show a warning after 30 days but refresh only through an explicit user action.

The generator starts at the conversion moment and projects upward. Every decision anchor owns MOFU evaluation branches, and every MOFU question owns TOFU awareness branches. It creates two candidates for every cell, measures semantic similarity with embeddings, and scores the stronger candidate against a 100-point rubric. Deterministic checks reject unsupported entities, wrong competitors, brand leakage, missing comparisons, boilerplate, and incomplete coverage. Failed cells receive up to two repair attempts; remaining failures are published as `needs_revision` and cannot be approved. Editing a prompt invalidates its score, while single-row regeneration preserves its pathway and parent relationship.

A production export is allowed only when every active persona has its complete configured baseline, every cell scores at least 80, and every prompt is individually approved. The export includes immutable baseline and prompt IDs, parent IDs, persona, pathway, funnel stage, evidence references, research snapshot, and generation date. Mock baselines remain available only through visibly labeled demo exports.

## Routes

- `/projects`
- `/projects/new`
- `/projects/[projectId]/data`
- `/projects/[projectId]/personas`
- `/projects/[projectId]/prompts`
- `/projects/[projectId]/prompts/export.csv`
- `/orgs/[orgId]/settings/integrations`

Legacy brand, evidence-review, content, operations, audit-deck, and deployment routes do not exist and return 404.
