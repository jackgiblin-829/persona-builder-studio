# Progress ledger

The persistent record of what has actually been built, tested and verified. One section per milestone.

---

## Milestone 0 — Orientation (complete)

**Scope.** Read the specification and research report in full, inspect the environment, resolve conflicts, produce project documentation and a milestone checklist.

**Completed.**
- Read `1. Product purpose.md` (1453 lines) and `deep-research-report.md` (2066 lines) in full.
- Inspected the environment: no existing repository (greenfield), Node 18 default with Node 20.20.1 available via nvm, PostgreSQL 16.14 running via Homebrew, **no Docker**, **no Redis**, pgvector not installed.
- Compiled pgvector 0.8.0 from source against `postgresql@16` (the Homebrew bottle only ships for pg17/pg18) and verified `CREATE EXTENSION vector` succeeds.
- Created `persona_evidence_studio` and `persona_evidence_studio_test` databases.
- Wrote `docs/product-understanding.md`, `architecture.md`, `data-model.md`, `integrations.md`, `security.md`, `milestones.md`, `decisions.md` (ADR-001…011) and this ledger.

**Specification ↔ environment conflicts and resolutions.**

| Conflict | Resolution | ADR |
| --- | --- | --- |
| Spec recommends Docker Compose for local Postgres/Redis/object storage; Docker is not installed | Ship `docker-compose.yml` as the parity path; default local development targets host PostgreSQL | ADR-002 |
| Spec recommends Redis + BullMQ; Redis is not installed | PostgreSQL-backed durable queue behind a `JobQueue` interface (spec explicitly permits "an equivalent durable queue") | ADR-004 |
| Spec recommends pgvector; not available for pg16 via Homebrew | Compiled from source; verified working | ADR-005 |
| Spec recommends Auth.js; the demo must run with no OAuth provider or mail service | Own organization-aware credentials auth (spec permits "an equivalent organization-aware authentication layer") | ADR-003 |
| Instructions require verifying current official vendor API docs before live integrations; no network access to vendor documentation in this environment | Live adapters written from recorded assumptions and marked `@unverified`; limitation stated in `docs/integrations.md` and the README; mock mode is the default | ADR-011 |
| Research report describes DataForSEO LLM Responses/Mentions; build spec forbids them for the MVP | Not implemented — Profound is the sole AI-search execution and visibility layer | ADR-010 |

**Assumptions recorded (not blocking).**
- Local app port 3100 (5000/5055/5500/8500 are used by other projects in this workspace).
- Embedding dimensionality fixed at 1536 (`text-embedding-3-small`); the mock embedder produces the same shape.
- Seed brand is a fictional B2B analytics company; all seeded people, quotes and companies are invented and contain no real personal data.

**Commands run.**
```
brew install pgvector                        # bottle: pg17/pg18 only
make && make install PG_CONFIG=…postgresql@16/bin/pg_config   # built 0.8.0 for pg16
psql -d postgres -c 'CREATE EXTENSION vector'  # → pgvector 0.8.0
createdb persona_evidence_studio persona_evidence_studio_test
npm install                                   # 561 packages
```

**Unresolved issues.** None.

**Known limitations.** No live vendor call has been executed or verified (ADR-011).

**Next steps.** Milestone 1 — schema, migrations, auth, orgs, brands, storage, queue, seed.

---

## Milestone 1 — Foundation (complete)

**Scope.** Repository scaffold, documentation, local infrastructure, authentication, organizations, brands, database, storage, queue, seed data.

**Completed.**
- Next.js 15 App Router + TypeScript strict (`noUncheckedIndexedAccess`, `noImplicitOverride`, `noFallthroughCasesInSwitch`), Tailwind 3.4, ESLint flat config, Prettier, Vitest, Playwright, drizzle-kit.
- `README.md` (what a persona is/is not, evidence precedence, confidence methodology, retention, deletion, adding a connector/workflow/eval suite), `.env.example`, `docker-compose.yml` (Postgres+pgvector, Redis, MinIO parity stack).
- `src/db/schema.ts`: **50 tables**, 24 Postgres enums, foreign keys, composite tenant indexes, a GIN full-text index on evidence, GIN indexes on entity/segment arrays, and HNSW cosine indexes on both vector columns. Migration `drizzle/0000_init.sql` generated and applied to the dev and test databases.
- `src/lib/env.ts` — Zod-validated environment with mock-mode defaults; refuses to boot in production without `APP_ENCRYPTION_KEY` and `SESSION_SECRET`, falls back to a clearly-labelled development key otherwise.
- Crypto: AES-256-GCM credential encryption with key versioning, scrypt password hashing, stable object hashing for request hashes, timing-safe comparison.
- Auth: opaque session tokens stored as SHA-256, httpOnly/SameSite cookies, CSRF double-submit minted in middleware, per-IP+email sign-in rate limiting, sign-in/sign-out with audit logging.
- RBAC: four roles, 22 capabilities, `requireCapability` enforced in the service layer. Profound deployment requires admin; a dry run only requires editor.
- Brands: full spec field set (products, competitors, markets, languages, regions, conversion actions, crawl allowlist, strategic questions, regulated flag, retention), create/edit/delete with unique slugs and audit entries.
- `ObjectStorage` interface with local-filesystem and S3-compatible drivers, path-traversal guarding on every key.
- `JobQueue` interface + `PostgresJobQueue` (`FOR UPDATE SKIP LOCKED`, exponential backoff with jitter, idempotency keys, `partially_succeeded` state, stale-job reclamation) and a worker loop with graceful shutdown.
- Screens: sign in, organization switcher, brand list, brand setup, brand overview with an 11-stage workflow tracker, mock-mode banner and regulated-domain warning. Loading, empty, success and error states throughout.
- Seed: organization, three users across three roles, the fictional Northwind Analytics brand with products and competitors, all four vendors in mock mode, three model-tier configurations.

**Tests added (42 passing).**
- `tests/unit/crypto.test.ts` (15) — encryption round-trip, IV uniqueness, tampered-ciphertext and tampered-auth-tag rejection, masking, scrypt verify/reject/salt/unicode/malformed-hash, stable hashing key-order independence, timing-safe comparison.
- `tests/unit/permissions.test.ts` (15) — full capability matrix, monotonicity across roles, Profound deploy/dry-run split, org scoping from a session, `ForbiddenError` messages.
- `tests/integration/queue.test.ts` (12) — claim exclusivity, type filtering, future scheduling, idempotency-key no-op, retry-with-backoff then give-up, non-retryable failures, completion vs partial success, cancel semantics, stale-job reclamation, run-after ordering, backoff bounds.

**Commands run.**
```
npx drizzle-kit generate --name init      # 50 tables
npm run db:migrate && npm run db:migrate -- --test
npm run db:seed
npx tsc --noEmit                          # clean
npx eslint src scripts tests              # clean
npx prettier --check …                    # clean
npx vitest run                            # 42 passed
```

**Manual verification.** Signed in through the browser as `admin@example.com`, confirmed redirect to the brand list, opened the seeded brand and confirmed the overview renders the workflow tracker, mock-mode banner, regulated-domain warning and brand profile.

**Issues found and fixed during the milestone.**
- A client component imported `ActionState` from the server-only action runner, which pulled the database and session modules toward the browser bundle and produced a 500. Split into `src/app/actions/state.ts` (client-safe) and `types.ts` (server runner). This is the exact leak the `server-only` guard exists to catch.
- Server Components cannot set cookies during render, so the CSRF token is now minted in `src/middleware.ts` and only read by pages.
- The initial `no-restricted-imports` rule fired on legitimate server modules; scoped it to `src/components/**`, where the boundary actually matters.
- `server-only` throws under plain Node, so `tsx` scripts run with `--conditions=react-server` and Vitest aliases the package to an empty stub.

**Known limitations.** Rate limiting is in-process (incorrect behind multiple app instances). No MFA. No malware scanner (hook point only).

**Next steps.** Milestone 2 — ingestion, parsing, redaction, evidence extraction, embeddings, evidence explorer.

---

## Milestone 2 — Evidence (complete)

**Scope.** File upload, paste, parsing, redaction, chunking, evidence extraction, embeddings, evidence explorer, source deletion cascade.

**Completed.**
- **Parsers** (`src/lib/parsers/`) for CSV, JSON, TXT, Markdown, DOCX (via mammoth), pasted text, speaker-labelled transcripts and Search Console exports. Each emits `ParsedDocument[]` with a human-meaningful `location` ("row 14", `section "Governance"`, "Prospect at 00:12:30") so evidence can always be traced to a specific place in a specific source. Column detection is heuristic with a longest-text-column fallback.
- **Safe file handling**: extension + MIME detection, magic-byte verification (rejects a PDF/PNG/ELF/Mach-O renamed to `.txt`, and a `.docx` that is not a ZIP), null-byte binary detection, 25 MB cap, per-brand checksum de-duplication.
- **PII redaction** (`src/lib/redaction.ts`): email, phone (E.164 + national), IPv4/IPv6, Luhn-validated card numbers, US SSN, street addresses and URL-embedded credentials. Repeated values share a placeholder so transcripts stay readable. `pii_status` is `none` | `redacted` | `suspected`, with `suspected` flagging identity-shaped text the patterns cannot catch.
- **Chunking** (`src/lib/chunking.ts`): paragraph-first, sentence fallback, hard-split only as a last resort, with overlap so a claim straddling a boundary survives. Transcripts chunk by speaker turn. Offsets always resolve back into the source document.
- **SSRF guard** (`src/lib/url-guard.ts`): scheme allowlist, per-brand domain allowlist with subdomain matching, DNS resolution with rejection of loopback/private/link-local/CGNAT/multicast ranges (including `169.254.169.254` and IPv4-mapped IPv6), rejection when *any* resolved address is private, credential-in-URL rejection, canonicalisation, and a robots.txt evaluator with longest-match Allow/Disallow precedence.
- **OpenAI adapter**: interface + live implementation (Responses API with strict structured outputs, bounded schema-failure retries that feed the validation error back, backoff on 429/5xx, typed timeout/rate-limit errors, cost estimation, `@unverified` annotation) + deterministic mock.
- **Deterministic mock extractor** (`src/adapters/openai/mock/evidence.ts`): a genuine rule-based extractor, not a fixture lookup — it reads the passage, splits it into atomic claims, classifies across all 15 categories by weighted rules, assigns provenance from source type, detects hedging and contradiction qualifiers, preserves customer vocabulary, and returns real character offsets. This is what makes seeded traceability real rather than decorative.
- **Deterministic mock embedder**: hashed unigram+bigram projection into 1536 dims, L2-normalised, so semantic search and near-duplicate detection work offline. Vectors are keyed by `model_id` so mock and live embeddings are never compared.
- **Versioned prompt registry** (`src/prompts/registry.ts`) with all seven templates, and Zod + strict-JSON-Schema output contracts (`src/prompts/schemas.ts`, `json-schema.ts`).
- **Pipeline jobs**: `ingest_source` (parse → redact → persist, honours `exclude_from_model_calls`), `extract_evidence` (per-chunk, one failed chunk never discards the rest, replaces rather than duplicates on re-run), `embed_evidence` (batched, resumable, skips already-embedded records).
- **Evidence explorer**: full-text search (`websearch_to_tsquery` over a GIN index) and semantic search (pgvector HNSW cosine), plus all eleven specified filters, faceted counts, and pagination — all URL-driven so a filtered view is shareable.
- **Evidence detail**: original source context with the extracted span highlighted, editable claim/category/provenance/stage/sentiment, approve/reject, notes, candidate segment labels, full provenance panel (model, template version, schema version, confidence, quality), and a **dependants** panel answering "which personas and prompts cite this record".
- **Source deletion cascade**: deletes the stored object and all embeddings, marks evidence `source_deleted`, marks persona/prompt evidence links unavailable, moves affected approved persona versions to `needs_review` — and never deletes an approved version. Impact is previewed before the user confirms and recorded in the audit log.
- **Vendor usage service**: every adapter call writes a `vendor_usage` row and emits the §38 structured log line.
- **Seed corpus** (`fixtures/seed/sources.ts`): six fictional sources — a security-led discovery call, Q2 support tickets, verified reviews, a Search Console export, a small-team buyer interview, and brand homepage copy — deliberately written to contain three genuinely distinct buyers plus contradictions. All fictional, `.example` domains only, with two synthetic PII values so redaction is exercised by the seed itself.

**Tests added (85 new; 127 passing overall).**
- `tests/unit/redaction.test.ts` (14) — every PII type, placeholder reuse, Luhn validation (accepts a valid card, leaves an invalid one alone), URL credentials, and the negative cases (ordinary numbers and business text are untouched).
- `tests/unit/ingestion.test.ts` (37) — chunking offsets and size bounds, transcript speaker splitting, magic-byte rejection, every parser, question-query classification, and the mock extractor's determinism, atomicity, category coverage, offset correctness, brand-assertion handling, hedging detection, empty-result case and vocabulary preservation; plus embedding normalisation, determinism and paraphrase ranking.
- `tests/unit/url-guard.test.ts` (22) — private/reserved range coverage including cloud metadata and IPv4-mapped IPv6, suffix-attack allowlist bypass attempts, DNS rebinding, canonicalisation, and robots.txt precedence.
- `tests/integration/ingestion-pipeline.test.ts` (12) — the whole upload → parse → redact → extract → embed path, asserting PII never reaches an evidence record, provenance and model metadata are stored, each stage reports independently, embeddings match record count, text and semantic search both find the seeded constraint, re-extraction replaces rather than duplicates, the deletion cascade behaves as specified, and an excluded source is parsed but never extracted.

**Commands run.**
```
npx tsc --noEmit                # clean
npx eslint src scripts tests    # clean
npx prettier --check …          # clean
npx vitest run                  # 127 passed (7 files)
npm run db:seed                 # 6 sources → 72 documents → 74 evidence → 74 embeddings, 2 redactions
```

**Manual verification.** Signed in, opened the evidence explorer (73 records, 68 approved, faceted filters populated with real counts), and ran a semantic search for "data cannot leave our cloud": the top hit was the customer constraint at 62% similarity, and the brand's own equivalent copy ranked second correctly labelled **brand claim** rather than customer belief. The mock-embedding notice rendered as intended.

**Bugs found and fixed by the tests.**
- `previewSourceDeletion` used a raw `= ANY(${array})`; postgres-js binds a template-literal array as separate positional parameters, so the query failed at runtime. Replaced with Drizzle's `inArray()` join chain. This path had no UI coverage yet, so only the integration test caught it.
- `markStage` fell back to updating the *first* ingestion stage when the named stage had no row, so a source excluded from model calls silently overwrote its `parse` status. Now upserts a row per stage.
- The phone pattern redacted the middle of any long digit run, so a 16-digit order number that failed the Luhn check became `[PHONE_1]`. Added lookarounds requiring non-digit context on both sides.
- The objection rule only recognised "too expensive/slow/complex/risky", missing "too small for us" — a real objection in the seed corpus. Broadened.

**Known limitations.**
- URL ingestion has its guard, canonicalisation and robots evaluation fully implemented and tested, but the `crawl_url` job handler that drives them is not yet wired up — the Data sources screen therefore offers file upload and paste only, with no non-functional crawl control shown.
- Mock embeddings capture lexical rather than semantic similarity (ADR-005); thresholds need re-tuning against a real embedding model.
- DOCX parsing relies on mammoth's raw-text extraction, so tables and complex layouts flatten.

**Next steps.** Milestone 3 — candidate segments, persona synthesis, confidence engine, evidence drawer, editing, approval, versioning, exports.

---

## Milestone 3 — Segments and personas (complete)

**Scope.** Versioned candidate segmentation, persona synthesis, the confidence engine, the evidence drawer, field editing, approval, versioning, version comparison and exports.

**Completed.**
- **Confidence engine** (`src/lib/confidence.ts`): the §15 formula with all eight components, configurable weights, and the specified source weights (first-party 1.00 → brand assertion 0.40). Pure and clock-free — the reference date is always passed in, so the maths is deterministic and unit-testable. Design decisions worth naming: a single source scores **zero** on cross-source agreement (one voice is not agreement); quantity saturates logarithmically so the tenth record adds far less than the second; an unknown observation date scores 0.5 rather than 0, because unknown recency is not the same as stale; and the contradiction penalty is capped at 0.4 so one disagreement cannot zero an otherwise well-evidenced claim. `rollUpConfidence` scales the mean of supported fields by the share of fields that are supported at all, so a persona half-composed of declared gaps cannot look strong.
- **Confidence is computed by the application, never taken from the model.** The generators return components, but `recomputeSegmentConfidence` and `recomputeVersionConfidence` recalculate from the evidence links that actually exist. Attaching, detaching, marking unsupported or deleting a source therefore moves the number immediately and visibly.
- **Deterministic mock segmenter** (`src/adapters/openai/mock/segmentation.ts`): five segmentation dimensions tested against the real evidence text. A dimension becomes a candidate only with ≥3 supporting records from ≥2 distinct sources, so one transcript cannot invent a segment. Overlap is real Jaccard over the cited id sets; merge/split recommendations come from that overlap and from journey-stage spread. Records matching a dimension's scope but hedging or countering its premise are stored as **contradicting**, not discarded. Records matching nothing are reported as unassigned rather than forced into a segment.
- **Deterministic mock persona synthesiser** (`src/adapters/openai/mock/persona.ts`): assembles the five core fields plus questions, objections, proof preferences, vocabulary, distinguishing topics, information depth, validation benchmarks, coverage gaps, excluded assumptions and regeneration triggers. Where no evidence supports a core field it emits the field with `insufficient_evidence: true` and says what is missing.
- **Pipeline jobs**: `generate_segments` and `generate_persona`. Both filter cited evidence ids against the ids actually supplied — a hallucinated citation is dropped and counted in the job result, and a candidate with no verifiable citation is not stored at all. A persona field left with no valid citation is stored with the insufficient marker rather than a confident-looking claim.
- **Segmentation is versioned by run.** Each run writes under its own `run_id`; previous runs and the decisions taken on them are never modified. The run's segment slugs are mirrored onto `evidence_records.candidate_segment_labels`, replacing labels from earlier runs while leaving reviewer-added labels alone, which makes the explorer's segment filter reflect the current run.
- **Segment screens**: comparison view with every specified return value (definition, distinguishing variables, supporting/contradicting counts, source distribution, coverage, coverage gaps, overlap, merge/split recommendation, all eight confidence components), plus approve / reject / undo / edit / merge / split / generate-persona. Merging unions evidence onto the target and marks the sources `merged` with `merged_into_id` set — nothing is deleted. Splitting requires the reviewer to assign the evidence explicitly; the application does not guess a partition, because a wrong guess would silently change what each new segment claims.
- **Persona screens**: list, detail, and field-level version comparison. Every claim renders its provenance badge, all eight confidence components with their weights, its flags (insufficient / marked unsupported / locked / reviewer-edited), and an evidence drawer showing each cited record's claim, exact quote, source, location, speaker, date, id and a link through to the record.
- **Review and versioning**: edit, attach/detach evidence, mark unsupported, lock/unlock, approve, reject, duplicate, new version, compare. Approval is refused while any core field has no supported entry or any claim asserts support while citing no available evidence — the blockers are listed rather than the button silently failing.
- **Exports** (JSON / CSV / Markdown) carry the evidence ids, the confidence components rather than only the score, the insufficient markers and the full §33 generation metadata. CSV quotes every cell per RFC 4180 and prefixes formula-leading values, because evidence quotes are customer text and must never be executed by a spreadsheet. Every export writes an audit entry.
- **Seed** now runs segmentation and persona synthesis through the real handlers: 4 candidates, 2 approved, 2 personas, 64 fields, 59 field-level citations.

**Design decisions worth recording.**
- `scored` and `structural` are separate flags on a persona field type. Coverage gaps, excluded assumptions and regeneration triggers carry no evidence by design (`structural`), so they render without a drawer and always carry the insufficient marker. Validation benchmarks *do* cite the evidence they propose to test, so they get a drawer — but they are statements about how to test the hypothesis, not claims about the buyer, so they are excluded from the confidence roll-up. Scoring them would let self-referential benchmarks inflate a persona's confidence.
- A persona rename never changes the slug. `persona:<slug>` tags will be deployed to Profound in milestone 5 and must survive a rename.
- Renaming updates the current version's name only when that version is not approved.
- Duplicating a persona drops the segment link and all field locks: a duplicate exists to be changed.
- Only one draft version per persona at a time, so "the draft" is never ambiguous.

**Tests added (80 new; 207 passing overall).**
- `tests/unit/confidence.test.ts` (22) — every source weight including the brand-assertion override, all eight components in isolation, the half-life boundary, unknown-date handling, the exact weighted formula, weight overrides, the 0–1 clamp, the three unsupported-claim paths, and the roll-up's coverage scaling.
- `tests/unit/segmentation-persona-mock.test.ts` (23) — schema conformance for both generators, determinism, the one-source and thin-evidence refusals, citation integrity, unassigned evidence, hedged-as-contradicting, coverage-gap detection, the seven-candidate cap, and for personas: the traceability invariant, the aggregate-demand rule, the excluded-assumption list, absence of demographic claims, verbatim vocabulary, and journey stages derived from evidence.
- `tests/integration/personas.test.ts` (35) — the whole segmentation → approval → synthesis → review → versioning → export path against the real handlers, asserting citation integrity, the traceability invariant, the §33 metadata, confidence recomputation on attach/detach/mark-unsupported, lock enforcement, approval blockers, that every write to an approved version is refused, that a new version copies without touching its parent, lock inheritance, the single-draft rule, the field-level diff, duplication semantics, export traceability and CSV formula guarding, merge and split semantics, tenant isolation, and that deleting a cited source keeps the approved version while marking it `needs_review`.

**Commands run.**
```
npx tsc --noEmit                # clean
npx eslint src scripts tests    # clean
npx prettier --check …          # clean
npx vitest run                  # 207 passed (10 files)
npm run db:seed                 # 4 segments → 2 approved → 2 personas → 64 fields, 59 citations
```

**Manual verification.** Signed in through the browser, opened the candidate-segments screen and confirmed four candidates with all eight confidence components, their weights and the plain-language explanation; confirmed the run reports 27 of 69 approved records assigned and 42 unassigned with the reason stated. Opened a persona and confirmed the disclaimer, the approval blocker for the unsupported core field, the provenance table, and an evidence drawer resolving a claim to its exact quote, source, location, speaker, date and record id. Exercised all three export routes: correct content types, `Content-Disposition` filenames, and a 400 for an unknown format. Approved version 1, created version 2, reworded a constraint and detached a hedged citation, then confirmed the comparison screen reports the reword as a removal plus an addition and the detachment as `changed` in "confidence, evidence count, insufficient marker" — 53% down to 0% and newly marked insufficient — with version 1 still approved and unaltered.

Note on the dev preview: these persona pages are dense (roughly 540 KB of markup plus Next.js's unminified dev RSC payload), and the in-app browser pane frequently showed the loading fallback rather than the finished page. The server returned complete, correct HTML every time — verified by fetching the pages and asserting on their content — so this is a preview-harness limitation rather than an application defect. Worth re-checking against a production build in milestone 8.

**Bugs found and fixed during the milestone.**
- `applySegmentLabels` used `= ANY(${array})` and `unnest(${array})` in raw SQL. postgres-js binds a JS array as separate positional parameters, so both failed at runtime — the same trap that bit `previewSourceDeletion` in milestone 2. The set arithmetic now runs in TypeScript. Worth generalising: **never pass a JS array into a raw SQL fragment in this codebase.**
- The warehouse segmentation dimension matched the bare word "integration", which pulled "Can you explain how the Slack integration works?" into a data-engineering segment. Narrowed to concrete data-infrastructure terms.
- Search Console queries were being promoted into first-person persona claims ("Customer data cannot leave…" alongside `Searchers used the query "self-hosted product analytics"` as a *constraint*). This violates §14 — search volume is evidence of aggregate demand, not persona identity. Aggregate-demand sources can now support a claim and contribute vocabulary, but can never be the claim; when records are excluded this way the persona records a coverage-gap note saying so.
- The seed approved the two highest-confidence candidates, which selected narrow segments — a candidate can score well precisely because it has little to contradict. It now ranks by supporting-record count, which is what a reviewer deciding where to invest actually cares about.
- The persona detail page rendered a 200-option evidence `<select>` for every field, producing megabytes of `<option>` markup. Capped at the 25 highest-quality approved records with a pointer to the explorer for anything further down.
- A subject–verb agreement bug in the generated persona summary ("1 core field has no supporting evidence and **are** marked insufficient").
- The persona detail screen offered "Create a new version" while the displayed version was itself an open draft — a control that always failed, since the service allows only one draft at a time. §31 forbids nonfunctional buttons, so the control is now replaced by an explanation and a link to the open draft. Found by clicking it in the browser; no test would have caught it, because the service was behaving correctly.
- "0 supporting record s" on the comparison screen: JSX inserted a space before the pluralising expression.

**Known limitations.**
- The confidence weights are configurable in code (`evaluateConfidence` accepts a `weights` argument) but there is no UI or environment override yet; §15 only requires that the formula be configurable, and per-organization tuning is not an MVP goal.
- Version comparison matches fields by exact statement within a type, so a reworded claim reads as a removal plus an addition. That is the honest reading — the evidence behind the two statements may differ — but it does mean a typo fix looks like a bigger change than it is.
- The evidence drawer is a `<details>` disclosure rather than a modal. It needs no client state and several can be open for comparison, but it does mean every drawer's markup is in the page.
- Mock segmentation dimensions are tuned against the seeded B2B corpus. A different vertical will produce fewer candidates until the dimension set is extended or a live model is configured.

**Next steps.** Milestone 4 — prompt generation, generic controls, duplicate detection, the prompt editor, Profound metadata preview and prompt-set exports. At the end of milestone 4 the app must be market-testable without a live Profound integration.

---

## Milestone 4 — Prompts (complete)

**Scope.** Prompt generation from approved personas, generic control pairing, duplicate detection, the prompt-set editor, Profound metadata preview, exports. At the end of this milestone the application is market-testable without a live Profound integration.

**Completed.**
- **`src/lib/prompt-dedupe.ts`**: `normalizePromptText` (case, punctuation, politeness-wrapper and whitespace normalisation, order-preserving so a reversed comparison is not folded into its mirror), `promptHash` (the exact-duplicate key), `lexicalSimilarity` (Jaccard over content tokens), and `findDuplicate`, which returns the single strongest signal against a candidate pool — exact hash beats semantic embedding beats lexical overlap, in that order of certainty. `dedupeExact` drops only exact repeats from a freshly generated batch; a near-duplicate is kept and flagged, never silently removed, because a persona prompt and its generic control are near-identical by design.
- **`src/lib/profound-tags.ts`**: the §21 recommended tag scheme (`persona:<slug>`, `persona-version:<n>`, `intent:<intent>`, `stage:<stage>`, `prompt-set:<slug>`, `prompt-set-version:<n>`, `prompt-type:*`, `source:persona-evidence-studio`) plus `buildPromptMetadata`, a pure preview of the full Profound payload with brand-level defaults for language/regions/platforms until milestone 5's live configuration read replaces them. `LOCAL_ONLY_FIELDS` names what stays in this database and never travels to the vendor.
- **Deterministic mock prompt generator** (`src/adapters/openai/mock/prompts.ts`): builds 15–30 prompts across the ten specified intents strictly from the persona's evidence-backed fields — a field with no evidence produces no prompt. Two guardrails are structural rather than advisory: the target brand's name is never inserted into a prompt or topic, and a competitor is named only where this segment's own comparison evidence names it. Generic controls are derived by removing the persona's qualifying clause from its own prompt text, not written independently, so a pair is genuinely comparable. Selection when a persona has enough evidence to overflow 30 prompts round-robins across intents rather than sorting globally, so one intent cannot crowd out the rest, and a low-frequency constraint is deliberately protected from being trimmed (§17).
- **`generate_prompts` job** (`src/jobs/handlers/generate-prompts.ts`): generates from one approved persona version only. Citation integrity mirrors persona synthesis — a prompt's cited evidence ids are filtered against what the persona version actually has available, and a prompt left with no valid citation is dropped and counted rather than stored. A prompt whose text or topic names the brand is rejected outright. Prompt-set identity is stable per persona; every run creates a new version. Controls are shared across persona prompts that reduce to the same generic question, so the same control is not measured twice.
- **`embed_prompts` job** (`src/jobs/handlers/embed-prompts.ts`): embeds every prompt in a set version, then calls `recomputeDuplicateWarnings`, which compares each prompt against the whole brand's prompt library (not just its own set) so a persona cannot unknowingly duplicate a prompt another persona already tracks. A prompt's own paired control is excluded from its candidate pool, and controls are only ever compared against other controls. The recompute is exported so the service layer can re-run it after a manual edit.
- **`src/services/prompt-sets.ts`**: generation, listing, the grouped detail view (by intent and by journey stage), editing (which recomputes the hash, Profound metadata and duplicate warnings together, since a rewritten prompt is a different question in the vendor's terms too), bulk approve/reject/priority, control pairing (reusing an existing control row by hash, deleting an orphaned one), approval, rejection, and new-version copying that preserves rejected prompts, evidence links and pairs.
- **Approval blockers** are listed rather than silently refused: any prompt still `pending_review`, an approved persona prompt citing no available evidence, or an approved prompt that is an *exact* duplicate of another approved prompt. A near-duplicate warning never blocks — that judgement belongs to the reviewer with the pair in front of them.
- **Rejecting a persona prompt cascades to its control** only when every persona prompt that control served is also being rejected, so an orphaned control that measures a generic question nobody chose to track is not left deployable.
- **Prompt-set screens**: list (`/prompt-sets`) and editor (`/prompt-sets/[promptSetId]`) with intent and journey-stage grouping, per-prompt evidence drawer, persona-field drawer (§18 — which persona claim a prompt tests, resolved by stored field ids rather than matched back by statement text so a persona rewording never breaks the link), a Profound metadata preview disclosure that also names what stays local, inline editing, control pairing/removal, bulk review and priority forms, and CSV/JSON/Markdown export routes. `src/lib/prompt-display.ts` holds the shared view types and display vocabulary so client components never import `@/services/*`, which the existing lint boundary rule forbids.
- **Exports** (`src/services/prompt-export.ts`) carry the same traceability as the screen: evidence ids and quotes, inclusion rationale, the paired control, Profound tags and metadata, and the §33 generation metadata. CSV applies the same RFC 4180 quoting and formula-guarding used for persona exports.
- **Seed** now runs prompt generation and embedding through the real handlers for the approved persona whose core fields are all supported; the persona blocked from approval by an unsupported decision criterion (a known limitation carried over from milestone 3's seed) correctly has no prompt set.

**Tests added (103 new; 310 passing overall).**
- `tests/unit/prompt-dedupe.test.ts` (24) — normalisation (case, punctuation, politeness wrappers including nested ones, smart quotes, word-order preservation), hashing stability and collision behaviour, lexical similarity boundaries, `findDuplicate`'s precedence rules (exact > semantic > lexical, self-exclusion, threshold overrides), and `dedupeExact`'s exact-only behaviour.
- `tests/unit/profound-tags.test.ts` (15) — the exact §21 tag order and its determinism, slug-safety against unslugified input, the control tag scheme never claiming the persona tag, brand-configuration defaults and fallbacks, the §20 tag-fallback path when no Profound persona is mapped, and that internal-only fields never leak into the built payload.
- `tests/unit/prompt-generation-mock.test.ts` (31) — category-term derivation from a brand description, clause construction from a persona statement, and for the generator itself: the 15–30 count band, that every prompt cites available evidence, that no prompt or topic names the brand, that a competitor only appears when named in comparison evidence, intent coverage under both normal and overflow conditions, and `mentionsBrand`'s word-boundary matching.
- `tests/integration/prompts.test.ts` (33) — the full generation → citation-integrity → brand-guard → hashing → pairing → tagging → embedding → grouping path against the real handlers; bulk review with control cascade; tracking priority; edit-triggered hash/tag/duplicate recomputation; the duplicate-edit refusal; reviewer control pairing and unpairing; every approval blocker; the immutability of an approved version; version copying with evidence, pairs and sync-state reset; the single-draft rule; all three export formats with their traceability; and tenant isolation.

**Commands run.**
```
npx tsc --noEmit                # clean
npx eslint src scripts tests    # clean
npx prettier --check …          # clean
npx vitest run                  # 310 passed (14 files)
npm run db:seed                 # 1 approved persona → 1 prompt set → 15 persona prompts, 8 controls, 9 pairs
```

Node 18 is the shell default in this environment; `vitest` (via Vite) requires Node ≥ 20 and fails with `ERR_REQUIRE_ESM` under Node 18. `nvm use 20` before `npm test`/`npm run db:seed` — consistent with the Node 20 requirement already recorded in milestone 0.

**Manual verification.** Ran the seed, confirmed 15 persona prompts and 8 generic controls were generated for the one persona with fully supported core fields, with 9 control pairs (one control shared between two persona prompts that reduced to the same generic question) and zero duplicate warnings in the seeded set. Typecheck, lint and the full suite are green on Node 20.

**Known limitations.**
- Profound region, platform and analysis-type values in the metadata preview are brand-level defaults, not a live read of Profound's configuration — that read is milestone 5's job, and the preview says so explicitly in the UI and in the export.
- Duplicate-detection thresholds inherit the mock embedder's lexical-rather-than-semantic behaviour (ADR-005) and will need re-tuning once live embeddings are enabled.
- The generic-control derivation is rule-based (remove the persona's qualifying clause) rather than model-authored in mock mode; a live model may propose different, equally valid controls.

**Next steps.** Milestone 5 — Profound connection, live configuration retrieval, persona mapping, duplicate checks against Profound's existing prompts, the dry-run-gated deployment workflow, idempotent creation, sync receipts and partial-failure retry.

---

## Milestone 5 — Profound deployment (complete)

**Scope.** Profound connection and live configuration retrieval, category and persona mapping with the five documented mapping states, exact and semantic duplicate checks against the vendor's existing prompts, the dry-run-gated deployment workflow, idempotent creation, immutable sync receipts, and failed-only retry.

**Completed.**
- **`src/adapters/profound/`** (`types.ts`, `live.ts`, `mock.ts`, `index.ts`): the `ProfoundAdapter` interface and the `getProfoundAdapter(organizationId)` factory that picks mock or live per the integration's mode. `MockProfoundAdapter` (`fixtures/profound/account.ts`) models an account rather than returning canned responses: a prompt id is derived deterministically from `(categoryId, normalized text)` so re-creating the same prompt returns the same id, an already-present normalized prompt comes back `duplicate`, an over-long prompt fails permanently, and roughly one prompt in eight fails *transiently* on its first real write and succeeds on retry — the only way the failed-only retry path can be exercised end to end rather than merely asserted.
- **`src/services/profound-config.ts`**: `testProfoundConnection` (the cheapest authenticated read, recorded on the integration whether it succeeds or fails), `refreshProfoundConfiguration` (reads categories, regions, models, assets, and per-category topics/tags/personas, and caches the whole thing stamped with the time it was taken), and `requireProfoundConnection`/`getProfoundConnection` for the mapping and deployment paths that consume the cache. Nothing about a Profound category, region, platform or persona is ever typed in — it is always read back from the account first.
- **`src/services/profound-mapping.ts`** (§20): category mapping (one brand, one category) and persona mapping with five states — `unmapped`, `mapped`, `tag_fallback`, `invalid` (the mapped Profound persona vanished from the account), and `needs_review` (the persona moved to a new approved version since the mapping was decided). Name-similarity suggestions are deliberately weak token overlap, shown with a score and never auto-applied — the failure mode of a confident wrong match is silent misattribution. When no Profound persona fits, the documented answer is the deterministic `persona:<slug>` tag rather than inventing a persona the API isn't documented to support creating.
- **`src/lib/profound-payload.ts`**: pure payload-building and hashing functions (`buildPromptPayload`, `payloadHash`, `newTopics`), building on milestone 4's `src/lib/profound-tags.ts` tag scheme.
- **`src/services/profound-deploy.ts`** (§22–§24, ADR-007, ADR-008): the deployment core, with five invariants stated as guarantees rather than intentions — nothing is created without a dry run of the same payload (approval stores the hash of what was previewed; creation recomputes it and refuses if it moved), the same prompt cannot be created twice (a unique index on `(organization_id, profound_category_id, normalized_hash)`, not application logic, is what makes a re-run safe), a duplicate is found before the write via both exact-hash and semantic checks against the account's existing prompts, a near-duplicate is a warning the reviewer decides on rather than an automatic exclusion, and partial failure is a first-class outcome recorded exactly as it happened.
- **Job handlers** `src/jobs/handlers/profound-dry-run.ts` and `profound-sync.ts`: the dry run re-validates the exact payload with `dry_run: true` and stores both the response and its hash as the approval gate; the sync handler re-checks that gate at write time (an approval from ten minutes ago is worthless if the payload moved since), inserts the link row with `ON CONFLICT DO NOTHING` so a conflict is recorded as `duplicate` rather than a second creation, and ends in `partially_succeeded` rather than failure when some items fail — the twenty that were created stay created.
- **`src/app/actions/profound.ts`**: server actions for connection test, configuration refresh, category and persona mapping, deployment creation, per-item skip, dry run, approval, deployment, and retry — each a thin `useActionState`-compatible wrapper over the service layer, authorization and validation included.
- **Seed** (`src/seed/run.ts`) now bulk-approves the generated prompts and approves the prompt-set version through the real service (a Profound deployment can only ever target an approved, immutable version), then runs the full Profound path through the real mock adapter for the one persona that made it through approval: connection test, configuration refresh, category mapping, persona mapping (landing on `tag_fallback`, since the mock account has no persona resembling the seeded security-led buyer — see `docs/integrations.md`), deployment creation, dry run, approval, deployment, and — because the mock adapter's deterministic flake reliably catches a few of the ~23 seeded prompts — a failed-only retry of exactly the items that failed. `summarise()` gained columns for the category-mapping status, the persona-mapping status, deployment count, and prompts created/duplicate/failed across `profound_sync_jobs` and `profound_prompt_links`, following the existing raw-SQL aggregation style.

**Design decisions worth recording.**
- The mock adapter's transient-failure ledger (`transientFailuresServed`) is per-process, mutable, module-level state — the one deliberate exception to "adapters are pure" in this codebase, because a flaky vendor cannot be modelled as a pure function and the failed-only retry guarantee needs something real to retry against.
- A dry run never suffers the transient flake: it validates without writing, so a clean dry run is explicitly not a promise that every subsequent create will succeed, and the deployment path has to tolerate partial failure even immediately after a passing preview.
- `retryFailedItems` never re-runs a dry run for the retried subset. It carries the parent's approval forward by verifying the retried payloads hash-identical to what was already previewed and approved, and records that inheritance in the receipt rather than implying a dry run happened that didn't.
- The seed wires an approval step for prompt-set versions that milestone 4's seed never needed (nothing downstream depended on it then). It runs through `reviewPrompts` and `approvePromptSetVersion`, the same real service and blockers a human reviewer would hit, not a status column written in directly.

**Tests added (19 new; 329 passing overall).**
- `tests/unit/profound-payload.test.ts` (13) — `buildPromptPayload`'s `client_reference` wiring, `payloadHash` determinism and order-independence and its sensitivity to a single changed field, and `newTopics`'s case/trim-insensitive filtering, internal deduplication and order preservation.
- `tests/integration/profound-sync.test.ts` (6) — exact-duplicate detection against the mock account's existing prompt; the dry-run gate (`DryRunRequiredError` before a dry run, success after, and re-blocking after `setItemSkipped` invalidates an existing approval); idempotent creation (a second deployment of the same version and category reports the already-linked prompts as duplicates rather than creating them again); partial failure and failed-only retry (a deterministically chosen flaky prompt fails once, the retry job inherits the parent's approval without a fresh dry run, and the retried prompt succeeds and links exactly once); tenant isolation on `getDeploymentDetail`/`loadSyncJob`; and the `tag_fallback` mapping path end to end.

**Commands run.**
```
npx tsc --noEmit                # clean
npx eslint src scripts tests    # clean
npx prettier --check …          # clean
npx vitest run                  # 329 passed (16 files), at the point this entry was written
npm run db:seed                 # 1 approved persona → 1 approved prompt-set version → 1 deployment,
                                 # retried once for its transient failures → 2 deployments,
                                 # 22 prompts created, 1 duplicate, 3 failed-then-retried
```

Node 20 is required for `tsc`/`eslint`/`vitest`/`db:seed` in this environment; the shell default is Node 18 and fails with `ERR_REQUIRE_ESM` under it.

**Manual verification.** Ran the seed fresh twice. Both runs produced identical, deterministic results: the connection test and configuration refresh succeeded against the mock organization, the brand mapped to the "Product analytics" category, the one approved persona's mapping landed on `tag_fallback` exactly as intended, the deployment's dry run passed and was approved with zero blockers, the sync created 22 of 23 deployable prompts (one exact duplicate against the mock account's existing prompt was correctly excluded before the write), left 3 items in the deterministic transient-failure state, and the seed's own retry-if-`partially_synced` step brought all 3 in on the second sync — leaving `profound_sync_jobs` with two rows (the original and its retry) and `profound_prompt_links` with 22 rows for the brand. Typecheck, lint, prettier and the full test suite are green on Node 20.

**Known limitations.**
- The org settings integrations page (`src/app/(app)/orgs/[orgId]/settings/integrations/page.tsx`) now exists, built this milestone — it was a latent gap dating back to milestone 1, when the integration model was first designed but never given a screen.
- Profound persona creation is deliberately absent: the API is not documented to support it, so when no Profound persona matches a seeded persona, attribution falls back to the deterministic `persona:<slug>` tag rather than the product inventing a persona on the vendor's behalf.
- The mock adapter injects a deterministic transient failure on roughly one in eight prompts, keyed by normalized hash, specifically so the retry path is exercisable rather than merely unit-tested — which is why the seed itself demonstrates a retry rather than always completing in one clean sync.
- Live Profound endpoints remain unverified per ADR-011: the live adapter is written from the endpoint assumptions recorded in `docs/integrations.md`, not against a running account, and mock mode remains the default for the demo and the tests.

**Next steps.** Milestone 6 — Profound result retrieval, the persona performance panel, and persona versus generic-control comparison.

## Milestone 6 — Results (complete)

**Scope.** Result retrieval for linked prompts over a user-selected date range, the persona performance panel with filters, persona-vs-generic-control comparison, brand-absent/competitor-dominated/missing-expected-element detection, and links back to Profound prompt identifiers.

**Completed.**
- **`src/adapters/profound/types.ts`**: four reporting operations added to `ProfoundAdapter` — `queryVisibility`, `queryCitations`, `querySentiment`, `getPromptAnswers` — each keyed by `(profoundPromptId, runId, modelId)`, matching the grain of `profound_result_snapshots`'s existing unique index (foundation-milestone schema, unchanged this milestone).
- **`fixtures/profound/results.ts`**: a deterministic per-day generator (`generateRun`), not a fixed fixture file — one synthetic run per UTC day, per prompt, per model, hashed from `(profoundPromptId, modelId, date)`. A prompt's own id (hashed alone) deterministically makes it chronically brand-absent (~1 in 7), competitor-dominated (~1 in 5 of the rest), or normal, so the classification logic downstream has real cases to catch rather than only a unit-tested code path.
- **`src/adapters/profound/mock.ts`** and **`live.ts`**: the four methods implemented for both — mock via the generator above, live against the assumed endpoints already recorded in `docs/integrations.md` (plus a newly-assumed `POST /v1/reports/sentiment`), `@unverified`, throwing typed `VendorError` on failure per ADR-009.
- **`src/lib/profound-results.ts`**: pure, clock-free functions — `mergeResultRows` (the four vendor calls → one row), `classifyResult` (brand-absent wins over competitor-dominated: a brand that never appeared did not lose a competition), `detectMissingElements` (naive normalized substring match against the raw answer), `aggregateMetrics` (means the rate-like fields, sums the counts, never treats a null as zero), and `compareControl` (the persona-vs-control maths, including a lift percentage that is null rather than infinite when the control had no share of voice to lift from).
- **`src/services/profound-results.ts`**: `startResultRetrieval` (capability-gated, reuses milestone 5's `listPromptLinks` so retrieval can never reach for a prompt this product never deployed), `getPerformancePanel` (joins snapshots → prompts → personas, groups by persona, classifies and detects missing elements from each prompt's *most recent* run in range), `getControlComparison` (per `prompt_pairs` row), `getPromptResultDetail` (single-prompt raw-answer inspection, with the linked `profoundPromptId`/`profoundCategoryId` for cross-referencing the vendor account directly).
- **`src/jobs/handlers/profound-results.ts`** (`JOB_TYPES.profoundResults`, itself pre-reserved in the foundation milestone): loads every distinct linked prompt for the brand, reads the account's current models directly from the adapter (never assumes a stale cached list), calls the four reporting operations, merges, and inserts with `.onConflictDoNothing()` — the insert is the idempotency guarantee, the same pattern ADR-007 already established for prompt links.
- **`src/app/actions/profound-results.ts`** and the performance UI at `src/app/(app)/brands/[brandId]/profound/performance/` (route and nav entry were both already reserved by the foundation milestone) — a retrieval trigger, a filterable persona performance panel with brand-absent/competitor-dominated/missing-element counts, a persona-vs-control comparison table, and `.../performance/prompts/[promptId]` for per-run raw-answer inspection (raw answer, citations, mentions, sentiment themes, classification, and the Profound identifiers).
- **Seed** (`src/seed/run.ts`): after the milestone 5 deployment sequence, retrieves results for the 30 days ending on the day the seed runs, then reports snapshot/brand-absent/competitor-dominated counts in `summarise()`'s output alongside the existing Profound counts.

**Design decisions worth recording.**
- Retrieval is scoped to *every currently-linked prompt for the brand*, not to one sync job — a deployment can happen more than once (as milestone 5's own retry demonstrates), and results should cover everything linked regardless of which deployment created the link.
- The four vendor calls are merged app-side around the visibility row as the anchor: a citations, sentiment, or answer row with no matching visibility row for the same key is dropped rather than guessed at, because there is no run to attach it to.
- Classification and missing-element detection are computed from the stored, merged row — never invented by the adapter — continuing the pattern milestone 3 established for confidence scoring: the vendor supplies data, the application supplies judgment.
- The performance panel's per-prompt classification and missing-element badges reflect that prompt's *most recent* run in the selected range, while its numeric metrics are aggregated over the whole range — "how does this look right now" and "how has this performed" are deliberately different questions with different answers.
- The mock's raw-answer text is generic synthetic prose, not text engineered to satisfy any particular prompt's `expected_answer_elements` — so almost every seeded prompt reports elements missing against mock data. That is an honest reflection of not running a second model call to grade the first one's answer, not a bug (see Known limitations).

**Tests added (25 new; 354 passing overall).**
- `tests/unit/profound-results.test.ts` (20) — `mergeResultRows`'s keying and defaults, `classifyResult`'s four branches (including that a null share of voice is treated as unknown, not zero), `detectMissingElements`'s normalization and no-answer/no-elements edge cases, `aggregateMetrics`'s mean-vs-sum behaviour and its null-is-not-zero rule, and `compareControl`'s deltas, outperformance flag, and lift-percent null case.
- `tests/integration/profound-results.test.ts` (5) — end to end through the real mock adapter and job handler: retrieval only ever creates snapshots for prompts actually linked (an inserted-but-undeployed prompt is asserted absent from every snapshot), re-running retrieval over an overlapping window inserts no duplicate rows while a widened window does insert more, and both the performance panel's per-prompt metrics and the control-comparison deltas are cross-checked against the exact same values computed directly from the adapter's own calls for the same prompt and window — not against hardcoded numbers, since the mock's per-run values are themselves hash-derived and not meant to be reverse-engineered by a test.

**Commands run.**
```
source ~/.nvm/nvm.sh && nvm use 20   # v20.20.1
npx tsc --noEmit                      # clean
npx eslint src scripts tests fixtures # clean
npm run format:check                  # clean
npx vitest run                        # 354 passed (18 files)
npm run db:seed                       # 22 linked prompts × 4 models × 30 days = 2,640 snapshots;
                                       # 5 brand-absent prompts, 6 competitor-dominated prompts
```

**Manual verification.** Ran the dev server and signed in as the seeded owner. `/brands/{brandId}/profound/performance` rendered the retrieval trigger, filters, aggregate stats (22 prompts with results, 5 brand-absent, 6 competitor-dominated, 22 with missing elements), the per-persona performance list with per-prompt classification badges and metrics, and the persona-vs-control comparison table with real lift percentages (e.g. one pair at +506%, another correctly showing "does not outperform control"). Clicking "Inspect answers" opened the per-run raw-answer page with the classification, missing-element list, mentions, citations, sentiment themes, mock-origin badge, and the Profound prompt/category identifiers. Clicking "Retrieve" queued a new job and displayed the queued job id, confirming the action layer end to end. No console or server errors.

**Known limitations.**
- The mock's raw-answer text is generic and unrelated to any specific prompt's `expected_answer_elements`, so the missing-elements count against mock data is close to "everything" — an honest byproduct of not running a second model call to grade the first one's answer, not something to tune away.
- `getPromptAnswers` has no per-model filter in the documented endpoint (`GET /v1/prompts/{id}/answers?start_date&end_date`), so the mock and live adapters both return every model's answers for a prompt in one call; this is a vendor-shape assumption, not a product limitation.
- Live Profound reporting endpoints remain unverified per ADR-011, including the newly-assumed sentiment endpoint — mock mode is what the seed and the tests exercise.

**Next steps.** Milestone 7 — content opportunities, SEO briefs, page audits, and exports.
