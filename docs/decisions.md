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
