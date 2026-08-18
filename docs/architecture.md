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
  generate_prompts  → persona evidence packet + validated search-intent plan
                    → discovery + evaluation + selection questions
                    → 2 candidates/cell → typed checks + rubric + embeddings
                    → up to 2 targeted repairs → draft or atomic promotion
```

## Boundaries

- Pages render data and forms. Reusable components do not access the database or vendors.
- Server actions validate CSRF, authenticate the session, resolve project membership, and call services.
- Services enforce capabilities and organization/project scope before reads or writes.
- Adapters isolate storage, queue, OpenAI, and SparkToro behavior. Mock and live modes have the same contract.
- Jobs are durable PostgreSQL rows with attempts, retry timing, status, payload, and error state.

## Atomic publication

Persona and prompt generation first build and validate a complete replacement. Prompt runs are always persisted as immutable versions. A fully passing project-wide run switches all stable prompt-set pointers in one transaction; a failed run remains a reviewable draft and leaves the current baseline untouched.

Persona edits create a child version with an optimistic version check. If a prompt taxonomy exists, the edit queues a project-wide replacement so cross-persona coverage and duplicate checks remain valid.

Prompt generation is project-wide even though completed rows retain persona ownership for review and export. Research approval freezes a versioned market brief and its cited facts; editing the strategy invalidates approval until a new brief is approved. Briefs show a warning after 30 days but refresh only through an explicit user action.

The generator starts by planning realistic search intents for every persona against a compact, persona-specific evidence packet. The plan validates counts, evidence references, business-line coverage, and distinct search needs before writing begins; unsupported cells are marked `insufficient_evidence`. It balances discovery, evaluation, selection, brand, competitor, cost, and risk searches without exposing a funnel-building workflow to the user.

Each search intent receives two candidates. Deterministic invariants and a semantic evaluator share typed issue codes but remain separate: exact checks cover structure, citations, brands, competitors, unsupported entities, and duplicates, while the evaluator judges business-line meaning, buyer fit, natural search language, intent realism, evidence support, answer value, and distinctiveness. Passing requires at least 80/100, at least 16/20 for intent coherence, at least 8/10 for evidence support, and no blocking issue. Embedding similarity is a warning from 0.86 through 0.92 and blocks only above 0.92 for related prompts with overlapping intent.

Failed cells receive up to two targeted repair attempts with their plan, prior candidates, typed failures, evaluator critique, and nearest duplicate. Unresolved rows remain `needs_revision`; passing rows are approved automatically. A refresh creates a new draft and promotes the complete run atomically only after every question passes.

A production export is allowed only when every active persona has its complete configured library, every question scores at least 80, and all rows pass the search-realism checks. The workbook includes immutable prompt IDs, related prompt IDs, persona, search theme, search intent, evidence references, research snapshot, and generation date. Mock libraries remain available only through visibly labeled demo exports.

## Routes

- `/projects`
- `/projects/new`
- `/projects/[projectId]/data`
- `/projects/[projectId]/personas`
- `/projects/[projectId]/prompts`
- `/projects/[projectId]/prompts/export.csv`
- `/orgs/[orgId]/settings/integrations`

Legacy brand, evidence-review, content, operations, audit-deck, and deployment routes do not exist and return 404.
