# Milestones and implementation checklist

Mapped directly to §40 of the build specification. Progress is recorded in `docs/progress.md`.

Every milestone ends with: `npm run format:check && npm run lint && npm run typecheck && npm run test` green, plus the relevant integration/e2e tests, plus a `docs/progress.md` entry.

---

## Milestone 1 — Foundation ✅
Repository, documentation, local infrastructure, auth, organizations, brands, database, storage, queue, seed data.

- [x] Repo scaffold: Next.js 15 + TS strict, Tailwind, ESLint, Prettier, Vitest, Playwright
- [x] `README.md`, `.env.example`, `docker-compose.yml`
- [x] `src/db/schema.ts` — all 40+ tables, enums, indexes
- [x] Migration generation + `npm run db:migrate`
- [x] `src/lib/env.ts` typed env with mock-mode defaults
- [x] Crypto: AES-256-GCM credential encryption, scrypt password hashing
- [x] Sessions, sign-in/sign-out, CSRF, rate limiting
- [x] Org + membership + RBAC (`requireOrgAccess`, `requireBrandAccess`, `requireCapability`)
- [x] Brand CRUD with the full spec field set (products, competitors, markets, allowlist, regulated flag)
- [x] `ObjectStorage` interface + local + S3 drivers
- [x] `JobQueue` interface + Postgres driver + worker loop + job status UI
- [x] Seed: org, 2 users, B2B brand, integrations in mock mode
- [x] Tests: crypto, permissions, queue claim/retry, tenant isolation

## Milestone 2 — Evidence ✅
File upload, URL ingestion, parsing, redaction, evidence extraction, embeddings, evidence explorer.

- [x] Upload (CSV/JSON/TXT/MD/DOCX), paste, transcript, GSC CSV; type + size + magic-byte checks
- [~] URL ingestion: guard, robots, canonicalisation and caps implemented and tested; `crawl_url` job handler not yet wired (no UI control shown)
- [x] Parsers → `source_documents`; chunker; `src/lib/redaction.ts`
- [x] Versioned extraction prompt template + Zod schema + bounded retries
- [x] `extract-evidence` and `embed-evidence` jobs
- [x] Evidence explorer: full-text + semantic search, all 11 filters
- [x] Evidence detail: source context, edit claim, reclassify, approve/reject, notes, segment labels, dependants
- [x] Source deletion cascade rules
- [x] Tests: parsers, redaction, chunking, extraction schema, search, deletion cascade

## Milestone 3 — Segments and personas ✅
Candidate segments, persona generation, evidence drawer, editing, approval, versioning, exports.

- [x] Versioned segmentation workflow (3–7 candidates, supporting + contradicting evidence, overlap, merge/split)
- [x] Segment comparison UI: approve / reject / merge / split / rename / edit / generate persona
- [x] Persona synthesis: 5 core fields + all additional fields, per-claim provenance
- [x] Confidence engine (8 components, configurable weights, full component display)
- [x] Persona detail with evidence drawer on every field
- [x] Edit, attach/detach evidence, mark unsupported, lock fields, approve, reject, duplicate, new version
- [x] Version comparison (field-level diff)
- [x] Export JSON / CSV / Markdown
- [x] Tests: confidence maths, versioning immutability, traceability (no field without evidence or an insufficient marker)

## Milestone 4 — Prompts ✅
Prompt generation, generic controls, prompt editor, deduplication, Profound metadata, exports.
_At the end of this milestone the app must be market-testable without a live Profound integration._

- [x] Generation: 15–30 prompts across 10 intents, from information needs, with inclusion rationale
- [x] Generic control pairing
- [x] Duplicate detection: normalized hash + embedding similarity, with warnings
- [x] Prompt editor: intent/stage grouping, evidence drawer, persona-field drawer, bulk approve/reject, tracking priority
- [x] Profound metadata preview with the recommended tag scheme
- [x] Export CSV / JSON / Markdown
- [x] Prompt-set approval → immutable version
- [x] Tests: hashing, dedupe, tag generation, generation guardrails (no forced brand insertion)

## Milestone 5 — Profound deployment
Connection, configuration retrieval, persona mapping, duplicate checks, dry run, creation, idempotency, receipts, retry.

- [ ] Connection + secure credential storage + connection test
- [ ] Config retrieval: categories, regions, models, topics, tags, assets, personas
- [ ] Category mapping + persona mapping with the 5 mapping states and tag fallback
- [ ] Existing-prompt retrieval; exact + semantic duplicate checks
- [ ] Payload builder + `dry_run: true` + preview + explicit approval gate
- [ ] Idempotent creation, per-item outcomes, Profound prompt id storage
- [ ] Partial-failure handling and failed-only retry
- [ ] Immutable sync receipt + JSON/CSV export
- [ ] Tests: payload mapping, idempotency, partial retry, dry-run-required guard

## Milestone 6 — Results
Result retrieval, visibility summary, citation summary, raw-answer inspection, persona vs control.

- [ ] Retrieval for linked prompts only, user-selected date range, immutable snapshots
- [ ] Persona performance panel with all specified metrics and filters
- [ ] Persona vs generic-control comparison
- [ ] Missing expected answer elements; brand-absent and competitor-dominated prompts
- [ ] Links/identifiers back to Profound prompt records
- [ ] Tests: result normalization, snapshot idempotency, control comparison maths

## Milestone 7 — Content workflows
Content opportunities, SEO brief, page audit, exports.

- [ ] Versioned content-gap workflow with the full input set and the 13 recommendation types
- [ ] Content opportunity records with approve/reject/edit/export
- [ ] SEO brief with all 27 required output sections, evidence + Profound prompt references
- [ ] Homepage / landing-page audit with per-finding severity, excerpt, evidence, recommendation, validation method
- [ ] Exports (JSON / CSV / Markdown)
- [ ] Tests: gap rules, brief traceability, audit traceability

## Milestone 8 — Hardening
Evaluation harness, security hardening, usage reporting, full tests, documentation cleanup.

- [ ] 13 application-owned evaluations with results stored by model / template / schema / persona / prompt-set version
- [ ] Vendor usage and cost view
- [ ] Security review pass against `docs/security.md`
- [ ] Full unit + integration + e2e suite green
- [ ] README and docs final pass
