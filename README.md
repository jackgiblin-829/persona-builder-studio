# Persona Evidence Studio

An **evidence-backed persona and prompt strategy layer for [Profound](https://tryprofound.com)**.

It ingests first-party customer evidence, turns it into reviewable persona hypotheses whose every claim links back to a source, generates persona-specific AI-search prompts paired with generic controls, deploys those prompts safely into Profound, and turns Profound's results back into content opportunities, SEO briefs and page audits.

> **Profound is the system of record for prompt execution and AI visibility.** This product does not execute prompts against AI models, and does not reproduce Profound's dashboard. See `docs/product-understanding.md` §3.

---

## What a synthetic persona is — and is not

**Is:** a structured, versioned, evidence-linked hypothesis about a recurring difference in what a group of buyers needs to know. Built from five behavioural fields — job to be done, constraints, success metrics, decision criteria, vocabulary — each carrying its supporting evidence, its contradicting evidence, and a transparent confidence heuristic.

**Is not:** a real person, a digital twin, a predictor of individual behaviour, or a substitute for talking to customers. Personas here are for *exploration and filtering*; finalists get validated against real users.

The product will never invent age, gender, income, hobbies, family status, personality, political beliefs, health status or protected characteristics. If evidence cannot support a field, the field is marked **insufficient evidence** and the gap is shown, not filled.

### Evidence precedence

| Class | Meaning | Default weight |
| --- | --- | --- |
| Direct first-party evidence (interview, call, support, survey, observed behaviour) | Observed | 1.00 |
| Search Console query or on-site search | Observed | 0.90 |
| Verified review or attributed community statement | Observed | 0.80 |
| SparkToro aggregated audience signal | Externally supported | 0.70 |
| DataForSEO search / SERP / intent signal | Externally supported | 0.65 |
| Brand-site assertion | Brand claim | 0.40 |
| Unsupported model inference | Inferred | 0.00 |

An aggregate external signal is never converted into an asserted individual behaviour. A brand's own copy is evidence of positioning, not of customer belief.

### Confidence methodology

Confidence is a **transparent heuristic, not a statistical probability that the persona is correct**:

```
field_confidence =
    0.25 × first_party_strength
  + 0.20 × cross_source_agreement
  + 0.15 × evidence_quantity
  + 0.15 × evidence_specificity
  + 0.10 × recency
  + 0.10 × segment_coverage
  + 0.05 × external_support
  −        contradiction_penalty
```

All eight components are stored per claim and displayed in the UI, so a field with plenty of evidence but poor segment coverage is visibly that.

---

## Running it locally

### Prerequisites

- **Node.js 20.11+** (`nvm use 20`)
- **PostgreSQL 16+ with the `pgvector` extension**

No vendor API credentials are needed. The complete seeded demo runs offline against deterministic mock adapters.

### Option A — host PostgreSQL (no Docker required)

```bash
brew install postgresql@16 && brew services start postgresql@16
```

pgvector's Homebrew bottle only targets pg17/pg18. To build it for pg16:

```bash
git clone --branch v0.8.0 --depth 1 https://github.com/pgvector/pgvector.git /tmp/pgvector && cd /tmp/pgvector && make PG_CONFIG=/opt/homebrew/opt/postgresql@16/bin/pg_config && make install PG_CONFIG=/opt/homebrew/opt/postgresql@16/bin/pg_config
```

Then create the databases:

```bash
createdb persona_evidence_studio && createdb persona_evidence_studio_test
```

### Option B — Docker Compose

```bash
docker compose up -d
```

Then set `DATABASE_URL=postgresql://pes:pes@localhost:5433/persona_evidence_studio` in `.env`.

### Setup

```bash
cp .env.example .env
```

```bash
printf 'APP_ENCRYPTION_KEY=%s\nSESSION_SECRET=%s\n' "$(openssl rand -base64 32)" "$(openssl rand -base64 32)" >> .env
```

```bash
npm install && npm run db:setup
```

```bash
npm run dev
```

Open <http://localhost:3100> and sign in:

| Email | Password | Role |
| --- | --- | --- |
| `admin@example.com` | `demo-password-1` | owner |
| `analyst@example.com` | `demo-password-2` | editor |
| `viewer@example.com` | `demo-password-3` | viewer |

Background jobs run in a separate process:

```bash
npm run worker
```

---

## The seeded demo

`npm run db:seed` builds a fictional B2B analytics brand (**Northwind Analytics**) by running the real pipeline against mock adapters — it does not insert fabricated rows straight into result tables, so a broken pipeline fails the seed rather than producing a plausible-looking database.

Everything seeded is invented. No real person, company, quote or domain appears; all domains use the reserved `.example` TLD.

From the seeded state you can walk the full workflow: open the brand → review sources → inspect extracted evidence → generate candidate segments → approve a persona → generate prompts → pair controls → review Profound metadata → dry run → deploy → sync receipt → results → content opportunity → SEO brief → homepage audit → export.

---

## Mock mode

Every vendor adapter — OpenAI, Profound, SparkToro, DataForSEO, object storage, the queue — sits behind an interface with a deterministic mock implementation.

Two rules the code enforces:

1. **Mock data is always labelled.** Every generated artefact carries `data_origin` (`mock` | `live` | `local`) and the UI renders a badge from it.
2. **A failed live call never falls back to mock.** It raises a typed `VendorError` and the job enters a retry or failed state. Silent substitution is the exact failure this product exists to prevent.

> **Live integrations are unverified.** This build was produced without network access to vendor documentation, so no live endpoint has been checked against current official docs and no live call has been executed. Live adapters are written from the endpoint assumptions recorded in `docs/integrations.md` and marked `@unverified` in source. Verify the vendor's current documentation, correct the assumptions, and record the documentation date before enabling any vendor in production.

---

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | App on :3100 |
| `npm run worker` | Background job worker |
| `npm run db:migrate` | Apply migrations (add `-- --test` for the test database) |
| `npm run db:seed` | Rebuild the demo dataset |
| `npm run db:reset` | Drop and recreate the schema (refuses in production) |
| `npm run db:generate` | Generate a migration from `src/db/schema.ts` |
| `npm test` | Unit + integration tests |
| `npm run test:e2e` | Playwright end-to-end suite |
| `npm run evals` | Internal evaluation harness |
| `npm run verify` | format:check → lint → typecheck → test |

---

## Architecture at a glance

One Next.js 15 App Router application plus one worker process, both against one PostgreSQL database with pgvector. No microservices, no second language.

```
Server Components / Server Actions
        ↓ (never call a vendor directly)
   Services layer (org-scoped, all domain logic)
        ↓                      ↓
   Drizzle / Postgres     Adapters (interface + live + mock)
        ↓
   jobs table  →  Worker  →  job handlers
```

Detail: `docs/architecture.md`. Schema: `docs/data-model.md`. Decisions and trade-offs: `docs/decisions.md`. Security posture and threat model: `docs/security.md`. Build progress and known limitations: `docs/progress.md`.

---

## How things work

### Persona versions and evidence references

Approved artefacts are **never mutated**. Editing an approved persona creates version *n+1*; the prior version keeps its own field rows and evidence links, so a brief generated three months ago still resolves to the exact persona it was written against.

`persona_fields` is one row per claim, and `persona_field_evidence` is an explicit join carrying `relation = supports | contradicts`. That is what makes "which personas depend on this evidence record?" a single indexed query, and what makes traceability real rather than decorative.

### Deleting source data

Deleting a data source removes the stored object, deletes its embeddings, and marks derived evidence `availability = 'source_deleted'`. It **does not** delete approved persona versions that referenced that evidence — those references render as unavailable and the persona is moved to `needs_review`. Every deletion is written to `audit_logs`.

Set `brands.retention_days` to expire sources automatically.

### Adding a connector

1. `src/adapters/<vendor>/types.ts` — the interface plus Zod schemas for normalized responses.
2. `live.ts` — typed HTTP, retries, typed errors, `vendor_usage` recording, raw-response retention.
3. `mock.ts` — pure and fixture-backed; no clock, no randomness.
4. `index.ts` — factory returning `{ adapter, mode }`.
5. Fixtures under `fixtures/<vendor>/`, the vendor added to the `vendor` enum, the integrations screen and `.env.example`.
6. A contract test asserting both implementations satisfy the interface and that the live one throws rather than degrading.

### Adding a content workflow

Add a versioned prompt template under `src/prompts/`, a Zod output schema, a service in `src/services/`, a job handler in `src/jobs/handlers/`, and a screen. Every generated artefact must store organization, brand, evidence ids, evidence cutoff, model, template version, schema version, initiating user and review status.

### Creating an evaluation suite

Add a check to `src/evaluations/`, register it in the suite registry, and run `npm run evals`. Results are stored in `internal_evaluation_runs` / `internal_evaluation_results` keyed by model, template version, schema version, persona version and prompt-set version.

### Model and vendor configuration

Model tiers (`economical`, `reasoning`, `embedding`) are configured per organization in `model_configurations` and defaulted from `.env`. Every generated artefact pins the model id it was produced with.

### Data retention and privacy

Automated PII detection is best-effort pattern matching, surfaced with this warning throughout the product:

> Automated PII detection is not a substitute for legal or compliance review.

Individual sources can be excluded from all model calls (`data_sources.exclude_from_model_calls`). Vendor credentials are AES-256-GCM encrypted at rest and never leave the server.

---

## Scope boundaries

Deliberately **not** built: a native multi-model prompt runner, a replacement for Profound reporting, custom prompt scheduling, autonomous publication, full article generation, native CRM/support connectors, multilingual generation, model fine-tuning, a digital-twin simulator, automatic Profound persona creation through undocumented endpoints, synthetic market-size estimates, or automated decisions without human review.

DataForSEO's LLM Responses / LLM Mentions products are intentionally not implemented — Profound is the sole AI-search execution and visibility layer (ADR-010).
