# Decisions (ADRs)

Format: context → decision → consequences. Newest last.

---

## ADR-001 — Next.js App Router monolith with a separate worker
**Context.** The spec asks for a TypeScript-first stack, a real database, background jobs and no unnecessary microservices or second language.
**Decision.** One Next.js 15 App Router application (Server Components for reads, Server Actions for writes) plus one worker process from the same codebase and image.
**Consequences.** Secrets stay server-side structurally — a `"use client"` module cannot import an adapter. No API contract to keep in sync. The trade-off is that the worker and web scale together in development; in production they are separate containers.

## ADR-002 — Local development runs against host PostgreSQL, not Docker
**Context.** Docker is not installed in the target environment. PostgreSQL 16 is running locally via Homebrew.
**Decision.** Ship `docker-compose.yml` (Postgres+pgvector, Redis, MinIO) as the documented parity path, but make the default local path point at a host PostgreSQL. pgvector 0.8.0 was compiled from source against `postgresql@16` because the Homebrew bottle only targets pg17/pg18 — the README documents both routes.
**Consequences.** `npm run db:setup` works with no container runtime. Developers with Docker can use compose instead by changing `DATABASE_URL`.

## ADR-003 — Own session authentication instead of Auth.js
**Context.** The spec allows "Auth.js **or an equivalent organization-aware authentication layer**". The product needs organizations, memberships and four roles; the seeded demo must work with no OAuth provider and no email service.
**Decision.** Implement credentials auth directly: scrypt password hashing, opaque session ids stored hashed in a `sessions` table, httpOnly/SameSite cookies, double-submit CSRF, and a real `memberships` table driving RBAC.
**Consequences.** ~250 reviewable lines, no adapter impedance mismatch, and the permission model is testable in isolation. Cost: no OAuth/SSO out of the box. Adding an Auth.js provider later means swapping session creation only — `requireSession()` is the single seam.

## ADR-004 — PostgreSQL-backed durable queue instead of Redis/BullMQ
**Context.** Redis is not available in the target environment. The spec asks for "Redis and BullMQ, **or an equivalent durable queue**".
**Decision.** A `jobs` table claimed with `SELECT … FOR UPDATE SKIP LOCKED`, behind a `JobQueue` interface. Exponential backoff with jitter, `max_attempts`, unique `idempotency_key`, terminal states including `partially_succeeded`.
**Consequences.** Zero extra infrastructure; jobs are inspectable with SQL and enqueued in the same transaction as the state change that caused them, so a job can never reference a rolled-back row. Throughput is bounded by database polling — adequate for this workload (tens of jobs per brand per day) and replaceable behind the interface if that changes.

## ADR-005 — Embeddings in pgvector with a deterministic mock embedder
**Context.** Semantic search, evidence retrieval and prompt near-duplicate detection all need embeddings, but the seeded demo must run with no OpenAI key.
**Decision.** `evidence_embeddings` / `prompt_embeddings` use `vector(1536)` with an HNSW cosine index. The mock embedder is a deterministic hashed-token projection into the same 1536 dimensions, L2-normalised.
**Consequences.** Semantic search and duplicate detection are exercisable and testable offline, and the storage path is identical for mock and live. Mock embeddings capture lexical overlap only, not true semantics — near-duplicate thresholds tuned against mock data should be re-tuned when a real embedding model is enabled. Both are recorded with `model_id` so mixed-model comparisons can be detected and rejected.

## ADR-006 — Persona fields are rows, not JSON blobs
**Context.** "Every persona claim must store supporting/contradicting evidence IDs, counts, source mix, confidence and provenance." A persona has many constraints, many decision criteria, many vocabulary terms.
**Decision.** `persona_fields` is one row per claim with a `field_type` discriminator, and `persona_field_evidence` is an explicit join carrying `relation` = `supports` | `contradicts`.
**Consequences.** "Which personas depend on this evidence record?" is a single indexed query, which the evidence explorer requires. Field-level locking, per-field confidence and version diffing all fall out naturally. Cost: assembling a persona for display is a join rather than a single row read — acceptable at this scale, and it is what makes traceability real rather than decorative.

## ADR-007 — Idempotency is enforced by a unique index, not by application logic
**Context.** "Re-running the same approved deployment must not duplicate the 20 successful prompts."
**Decision.** `profound_prompt_links` has a unique index on `(organization_id, profound_category_id, normalized_hash)`. Creation inserts the link inside the same transaction as recording the sync item, using `ON CONFLICT DO NOTHING`; a conflict is reported as outcome `duplicate`.
**Consequences.** Idempotency survives concurrent syncs, crashed workers and re-clicked buttons, because the guarantee lives in the database rather than in a code path that can be bypassed. The normalization function (`src/lib/prompt-hash.ts`) becomes safety-critical and is unit-tested directly.

## ADR-008 — `dry_run` is a hard gate, not a recommendation
**Context.** §22.10 and "Do not skip the dry run."
**Decision.** `profound_sync_jobs` cannot transition to `approved` without a stored dry-run response, and the creation service refuses to run unless the job is in `approved` with `dry_run_response IS NOT NULL` and a `dry_run_request_hash` matching the payload about to be sent. If the payload changed after the dry run, the approval is invalidated.
**Consequences.** Editing prompts after approving a deployment forces a fresh dry run instead of silently deploying something the user never previewed.

## ADR-009 — Mock mode is explicit state, never a fallback
**Context.** "Never silently fall back from a failed live request to mock data."
**Decision.** The adapter factory resolves `live` or `mock` once, from configuration, before the call. A live adapter that fails throws a typed `VendorError`. `data_origin` is written on every artefact and rendered as a badge.
**Consequences.** A user can always tell what they are looking at, and a broken integration looks broken instead of looking like plausible data.

## ADR-010 — DataForSEO LLM products are deliberately not implemented
**Context.** DataForSEO offers LLM Responses / LLM Mentions endpoints, and the research report describes them. The build spec forbids them for the MVP.
**Decision.** The DataForSEO adapter covers traditional search intelligence only. AI-search execution and visibility are Profound's, exclusively.
**Consequences.** No second, competing visibility dataset to reconcile, and no ambiguity about which system is the record for AI answers. If cross-model measurement is wanted later it is a new adapter and a new explicit product decision, not a quiet addition.

## ADR-011 — Live vendor adapters are written from documented assumptions and marked unverified
**Context.** The instructions require verifying current official API documentation before implementing a live integration. This build had no network access to vendor documentation.
**Decision.** Implement each live adapter from the endpoint assumptions recorded in `docs/integrations.md`, annotate every one `@unverified` in source, and state the limitation plainly in the docs and README rather than implying the integrations were verified. Mock mode is the default and is what the demo and tests exercise.
**Consequences.** The seeded workflow is fully functional offline, and nobody is misled into believing a live path has been validated. The verification step is recorded as required work before any vendor is enabled in production.

## ADR-012 — The DataForSEO adapter returns usage metadata; it never writes `vendor_usage` or `search_datasets` itself
**Context.** DataForSEO's per-task cost must be recorded in `vendor_usage` and its normalized output must land in `search_datasets`, but neither `LiveOpenAIAdapter` nor `LiveProfoundAdapter` calls `recordVendorUsage` or touches the database — every existing call site (`src/jobs/handlers/extract-evidence.ts`, `profound-dry-run.ts`, `profound-results.ts`) records usage itself, using `organizationId`/`brandId`/`job.id` the adapter is never given. `DataForSeoAdapter` methods follow the same shape: every method returns `DataForSeoResult<T>`, where `itemCount` and `costCents` are already computed and `data` is exactly the object `search_datasets.normalized` will store, so the milestone-7 job handler that calls this adapter can call `recordVendorUsage` and insert the `search_datasets` row the same way `extract-evidence.ts` does with `StructuredResult.costCents` — no second mapping step, no adapter-side DB access.
**Decision.** Cost, for both the immediate "live" endpoints and the task-post/task-get ones, is computed as `dollarsToCents` applied to each individual vendor response's `cost` field and *summed* across polls/batches — not summed in dollars and converted once — so a caller reading `result.costCents` gets the same figure `vendor_usage.cost_cents` will end up storing. Task-post/task-get polling treats DataForSEO's status-code space as two bands: `20000`–`20099` is success, `20100`–`20199` is "still queued/processing" and is only accepted while polling (`assertTaskQueuedOrSucceeded`); anything else is a genuine failure (`assertTaskSucceeded`/`assertTaskQueuedOrSucceeded` both throw). A task that stays in the pending band past `MAX_POLL_ATTEMPTS` throws a retryable `vendor_timeout`, kept distinct in code and in tests from a `vendor_rate_limited` HTTP 429 — the two are different failure modes (the vendor is busy vs. the task is legitimately still running) even though both are retryable.
**Consequences.** The adapter interface has no organization, brand or job parameter anywhere, which keeps it identical in shape to `ProfoundAdapter` and `OpenAIAdapter` and means the milestone-7 workflow gets vendor-usage accounting "for free" from a pattern it already has to implement for OpenAI calls — but it also means `DataForSeoAdapter` on its own guarantees nothing about `vendor_usage` or `search_datasets` ever being written; that guarantee lives entirely in the job handler that calls it, and must be verified there, not here.

## ADR-013 — Profound deployment is export-only; a prompt is linked by reconciliation, not by pushing it

**Context.** Milestone 5's original design pushed prompts into Profound automatically: persona/category mapping, a `dry_run`-gated preview, `createPrompts`, and a failed-only retry (ADR-007, ADR-008). In practice this made the tool the thing deciding what exists in a customer's Profound account, and the mapping step tried to bind this product's persona identity to a matching Profound persona object — something Profound's API is not documented to support creating (§20's tag-fallback existed precisely because that binding usually fails). The product's own identity for a persona is already durable without Profound's help: `src/lib/profound-tags.ts` stamps a deterministic `persona:<slug>` tag onto every prompt at *generation* time, independent of whether or how it is ever deployed.

**Decision.** Deployment is replaced with two separable steps:
1. **Export.** `src/services/prompt-export.ts` (unchanged) produces a JSON/CSV/Markdown file carrying every prompt's Profound tags and metadata. The user uploads this into Profound's own UI by hand — there is no `createPrompts` call anywhere in the app's write path anymore. `getMappingOverview`'s persona-mapping half, `setPersonaMapping`, `resolveDeploymentMapping`, and all of `profound-deploy.ts`'s dry-run/approve/deploy/retry machinery are deleted rather than kept dormant; category mapping (`src/services/profound-mapping.ts`) is the only mapping decision left, because reconciliation still needs to know which Profound category to search.
2. **Reconciliation.** `src/services/profound-reconcile.ts` calls the adapter's still-existing `listPrompts(categoryId)` read and matches each of the product's approved-but-unlinked prompts against the account by normalized-text hash first, then by embedding cosine similarity (reusing `src/lib/prompt-dedupe.ts`'s `findDuplicate`, the exact function the old duplicate-check used) — an exact-hash or high-confidence semantic match links automatically; a weaker lexical-only match is surfaced as ambiguous for a human decision; no match at all is unmatched. A `linkPromptManually` escape hatch handles the case reconciliation cannot resolve on its own. Both write to the same `profound_prompt_links` table and respect the same `(organization_id, profound_category_id, normalized_hash)` unique index ADR-007 introduced, so milestone 6 (results retrieval) and milestone 7 (content opportunities/briefs/audits) needed no changes at all — they only ever depended on that table being populated, never on how.

**Consequences.** The product can no longer accidentally create something in a customer's account, and the previously-required admin-only `profound:deploy` write capability and editor-level `profound:dry_run` capability are gone from the RBAC matrix — `profound:configure` covers category mapping and reconciliation both, since neither writes to the vendor. The trade-off is that reconciliation is best-effort pattern matching rather than a guaranteed link: a prompt whose text was edited by hand during upload, or one Profound's UI reformats unrecognizably, may need a manual link. `profound_sync_jobs`, `profound_sync_items` and `profound_persona_mappings` are left in the schema unused rather than dropped, since they hold whatever deployment history predates this change; a follow-up migration can remove them once nobody needs that history.
