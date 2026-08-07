# Architecture

## 1. Shape of the system

A single Next.js application (App Router, TypeScript strict) plus a separate worker process, both talking to one PostgreSQL database. No microservices, no second language.

```
┌──────────────────────────────────────────────────────────────────┐
│  Next.js app (src/app)                                           │
│  ├── Server Components   → read via src/services/*               │
│  ├── Server Actions      → write via src/services/* (+ Zod)      │
│  └── Route handlers      → exports, webhooks, health             │
└───────────────┬──────────────────────────────────────────────────┘
                │  never calls a vendor directly
                ▼
┌──────────────────────────────────────────────────────────────────┐
│  Services layer (src/services)  — all domain logic, org-scoped   │
│  evidence · segments · personas · prompts · profound-sync ·      │
│  opportunities · briefs · audits · usage · evaluations           │
└───────┬─────────────────────────────┬────────────────────────────┘
        │                             │
        ▼                             ▼
┌───────────────────┐        ┌────────────────────────────────────┐
│ Data access       │        │ Adapters (src/adapters)            │
│ Drizzle ORM       │        │ openai · profound · sparktoro ·    │
│ (src/db)          │        │ dataforseo · storage · queue       │
│                   │        │ each: interface + live + mock      │
└─────────┬─────────┘        └──────────────┬─────────────────────┘
          │                                 │
          ▼                                 ▼
┌───────────────────┐        ┌────────────────────────────────────┐
│ PostgreSQL 16     │        │ Vendor APIs (only from server)     │
│ + pgvector        │        └────────────────────────────────────┘
│ + job queue table │
└─────────┬─────────┘
          │ FOR UPDATE SKIP LOCKED
          ▼
┌──────────────────────────────────────────────────────────────────┐
│  Worker (src/worker/main.ts) → job handlers (src/jobs)           │
│  ingest · parse · redact · chunk · extract · embed · segment ·   │
│  persona · prompts · profound-dryrun · profound-sync · results · │
│  opportunity · brief · audit                                     │
└──────────────────────────────────────────────────────────────────┘
```

## 2. Why these choices

| Decision | Rationale |
| --- | --- |
| Next.js App Router + Server Actions | One codebase, no separate API tier to keep in sync. Secrets stay on the server by construction — no vendor client is importable from a `"use client"` module. |
| Drizzle ORM | TypeScript-first, SQL-shaped, first-class migration files we can read and review. Schema is the type source for the whole app. |
| PostgreSQL + pgvector | One store for relational data *and* embeddings. Avoids a second datastore for the MVP. |
| **Postgres-backed queue** (not Redis/BullMQ) | Redis is not available in the target dev environment and the queue interface is what matters. `jobs` table + `FOR UPDATE SKIP LOCKED` gives durability, visibility, retries and backoff with zero extra infrastructure. A BullMQ implementation can be dropped behind the same `JobQueue` interface. See ADR-004. |
| Own session auth, not Auth.js | The spec allows "an equivalent organization-aware authentication layer". Auth.js's adapter model fights an org/membership/role model like ours. We implement scrypt password hashing + httpOnly/SameSite session cookies + CSRF double-submit + a real `memberships` table. ~250 lines, fully testable, no OAuth provider needed for the seeded demo. See ADR-003. |
| Zod at every boundary | Form input, server action input, vendor response, LLM structured output. Nothing untyped crosses a boundary. |

## 3. Directory layout

```
src/
  app/                     Next.js routes
    (auth)/sign-in         unauthenticated
    (app)/                 authenticated shell: org + brand context
      brands/[brandId]/    every brand-scoped screen
    api/                   route handlers (exports, health)
    actions/               server actions, one module per domain
  components/              UI. ui/ = primitives, rest = feature components
  db/
    schema.ts              all tables (single source of truth)
    client.ts              connection + drizzle instance
    types.ts               inferred row types
  services/                domain logic. The only place that writes.
  adapters/
    <vendor>/
      types.ts             the interface + normalized schemas
      live.ts              real implementation
      mock.ts              deterministic fixture implementation
      index.ts             factory: picks live|mock from config, never both
  jobs/                    job handlers, registered by type
  worker/main.ts           polling worker loop
  lib/                     env, crypto, auth, logging, errors, pure helpers
  prompts/                 versioned LLM prompt templates + JSON schemas
fixtures/                  deterministic vendor fixtures + seed corpus
scripts/                   migrate, seed, reset, evals
tests/{unit,integration,e2e}
drizzle/                   generated SQL migrations (checked in)
```

## 4. Request lifecycle

**Read (Server Component)**
`page.tsx` → `requireBrandAccess(brandId)` → `services/*.list()` → Drizzle query already filtered by `organization_id` → render.

**Write (Server Action)**
`"use server"` action → `requireBrandAccess` + role check → Zod parse of the raw `FormData` → `services/*.create()` → transaction → `audit_logs` row → `revalidatePath`.

**Background work**
Service enqueues a job row (same transaction as the state change, so a job can never reference a row that was rolled back) → worker claims it with `FOR UPDATE SKIP LOCKED` → handler runs → job row updated with attempt count, error, timing → domain row updated.

## 5. Tenant isolation

Three layers, deliberately redundant:

1. **Session layer** — `requireOrgAccess` / `requireBrandAccess` resolve the membership row and throw `ForbiddenError` before any query runs.
2. **Query layer** — every service query includes `eq(table.organizationId, ctx.organizationId)`. Brand-scoped tables also filter `brandId`. Helpers in `src/services/scope.ts` make the unscoped variant awkward to write.
3. **Schema layer** — every tenant table carries `organization_id` (not just a transitive FK) and a composite index on `(organization_id, …)`.

Cross-tenant access is covered by `tests/integration/tenant-isolation.test.ts`, which asserts that a member of org A gets `ForbiddenError` on every brand-scoped service entry point for org B.

## 6. Adapter contract

Every adapter exports the same trio:

```ts
export interface ProfoundAdapter { … }               // types.ts
export class LiveProfoundAdapter implements … { … }  // live.ts
export class MockProfoundAdapter implements … { … }  // mock.ts
export function getProfoundAdapter(cfg): {
  adapter: ProfoundAdapter;
  mode: "live" | "mock";
}
```

Rules enforced by review and by `tests/unit/adapter-contract.test.ts`:

- Mock mode is chosen **only** when the vendor is explicitly configured as mock or has no credentials at startup. A live call that fails throws — it never silently degrades to mock.
- Every response is normalized into a Zod-validated internal schema; the raw vendor payload is stored separately (`raw_response`, secrets redacted) for debugging.
- Every call records a `vendor_usage` row: vendor, operation, duration, retries, outcome, tokens/credits/cost, request hash.
- Mock implementations are pure functions of their inputs plus a checked-in fixture — same input, same output, no clock, no randomness.

## 7. Versioning and immutability

Approved artefacts are never mutated. Editing an approved persona creates `persona_versions` row `n+1`; the prior row keeps its own field rows and evidence links. The same applies to prompt-set versions, sync receipts, result snapshots, briefs and audits.

Enforced by:
- `status` + `approved_at` columns checked in services before any update.
- `tests/integration/versioning.test.ts` attempts a mutation of an approved version and expects rejection.

## 8. Failure model

Job states: `queued → running → (retrying)* → succeeded | failed | cancelled`, plus `partially_succeeded` for multi-item jobs such as Profound sync.

- Retries use exponential backoff with jitter, bounded by `max_attempts` per job type.
- A partially-succeeded Profound sync stores per-prompt outcomes so retry targets only the failures.
- Vendor timeouts, rate limits (`429`) and credit exhaustion are distinct typed errors with distinct UI states — a rate limit is retryable, a credit error is not.
- Errors surfaced to the browser are redacted through `toPublicError()`; the detailed error stays in the job row and the structured log.

## 9. Observability

`pino` structured logs with a fixed field set: `jobId, organizationId, brandId, vendor, operation, durationMs, retryCount, outcome, tokens, costCents, requestHash`. A redaction serializer strips `authorization`, `apiKey`, `password`, `token`, `cookie`. Raw source text and unredacted PII are never logged. `vendor_usage` powers the in-app usage/cost screen.

## 10. Deployment

`docker-compose.yml` provides Postgres+pgvector, MinIO and Redis for parity, but local development runs directly against a host Postgres because Docker is not available in the target environment (ADR-002). Production runs two containers from the same image: `next start` and `npm run worker`.
