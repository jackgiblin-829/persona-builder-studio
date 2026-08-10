# Integrations

Every vendor sits behind an interface in `src/adapters/<vendor>/types.ts` with a live and a deterministic mock implementation. `src/adapters/<vendor>/index.ts` resolves which one to use at call time from `integrations` + `vendor_credentials`, and returns the mode alongside the adapter so the UI can label the result.

## Non-negotiable rules

1. **A failed live call never falls back to mock.** It throws a typed `VendorError` and the job enters `retrying` or `failed`. Silent substitution would make mock data indistinguishable from real data, which is the failure mode this product exists to prevent.
2. **Mode is stored, not inferred.** Every generated artefact and every vendor-sourced row carries `data_origin` = `mock` | `live` | `local`. The UI renders a badge from that column.
3. **Credentials never reach the client.** They are read server-side only, decrypted from `vendor_credentials` with AES-256-GCM, and never logged, never returned from a server action, never embedded in a payload sent to the browser.
4. **Raw responses are stored** (secrets redacted) alongside the normalized form, so a normalization bug is debuggable after the fact.
5. **No undocumented endpoints.** Where an operation is not documented as available, the adapter exposes it as unavailable and the product uses the specified fallback.

## Documentation verification status

| Vendor | Live implementation status | Docs verified | Notes |
| --- | --- | --- | --- |
| OpenAI | Implemented against the embeddings API | Verified 2026-08-10 (live call executed) | `embed()` confirmed working live against a real key. `generateStructured`/`webSearch` still unverified. |
| Profound | Typed REST wrapper behind `ProfoundAdapter` | Verified 2026-08-10 against docs.tryprofound.com | Auth header and the `/v1/org/*` taxonomy endpoints (models, categories, regions, domains, topics, tags) fixed and confirmed working live. `createPrompts`, the visibility/citations/sentiment reports, personas, `getOrganizations`, and `getPromptAnswers` are known to be a data-model mismatch, not a path bug — see below. |
| SparkToro | Report-create + section-fetch with polling | Verified 2026-08-10 against sparktoro.com/api/docs | `createAudienceReport` fixed and confirmed working live. `getSection`'s per-row mapping is a known data-model mismatch — see below. |
| DataForSEO | Live + task-based patterns, Basic auth | Verified 2026-08-10 against docs.dataforseo.com | Base URL, endpoint path, and Basic-auth scheme all confirmed correct as written. A live 401 was traced to a credentials/account issue (wrong login/password pair, per DataForSEO's own error code `40100`), not a code bug — see below. |
| Object storage | S3-compatible via `@aws-sdk/client-s3`; local filesystem driver for dev | n/a | |
| Queue | Postgres `jobs` table; BullMQ driver slot reserved | n/a | See ADR-004 |

> **Update, 2026-08-10.** A live smoke test (real API keys, one call per vendor) found every adapter's endpoint assumptions were wrong in at least one way — see the per-vendor sections below for exactly what was fixed and confirmed working versus what is still broken. The bigger finding: for Profound's reporting endpoints and SparkToro's section endpoint, the real vendor APIs return a **structurally different response shape** than what this product's normalized types and DB schema (`profound_result_snapshots`, `SparktoroAffinityRow`) were built around — invented per-execution/per-affinity-row detail (`run_id`, `mention_count`, `executions`, `brand_mentioned`, raw answer text, a uniform affinity row) that the real APIs simply do not expose. Those call sites now throw a clear `VendorError` naming the mismatch rather than guess a lossy mapping. Reconciling this is a schema/pipeline redesign decision, not a quick patch — see the `createPrompts`/reporting/persona notes in the Profound section and the `getSection` note in the SparkToro section for what a redesign would need to account for. The mock adapters are unaffected and remain the only path exercised by the seeded demo and the automated tests.

## OpenAI

Interface (`src/adapters/openai/types.ts`):

```ts
generateStructured<T>(req: {
  templateId: string; templateVersion: string;
  system: string; user: string;
  schema: { name: string; schema: JSONSchema; strict: true };
  modelTier: "economical" | "reasoning";
  maxRetries?: number;
}): Promise<StructuredResult<T>>

embed(req: { texts: string[]; model?: string }): Promise<EmbeddingResult>
```

Assumptions: `POST /v1/responses` with `text.format = { type: "json_schema", … , strict: true }`; `POST /v1/embeddings` with `text-embedding-3-small` (1536 dims). Model ids are configurable per environment via `model_configurations` and pinned per artefact.

Behaviour: schema validation with Zod after the call; bounded retries (default 2) on schema failure with the validation error fed back into the retry; token usage and estimated cost written to `vendor_usage`.

Mock: deterministic generation keyed by a hash of `(templateId, templateVersion, input)` reading from `fixtures/openai/*.json`; embeddings are a deterministic hashed bag-of-words projection into 1536 dims, so semantic-similarity behaviour is stable and testable without a key.

### Deep web research (`webSearch`)

A separate adapter method, not schema-based like `generateStructured` — the output is free-text findings plus a citation list, not a structured record:

```ts
webSearch(req: { query: string; brandContext: string }): Promise<{
  findings: string;
  citations: { url: string; title: string | null }[];
  modelProvider: string; modelId: string; dataOrigin: "mock" | "live";
  tokensIn: number; tokensOut: number; costCents: number; raw?: Record<string, unknown>;
}>
```

**@unverified.** Assumed to be `POST /v1/responses` with `tools: [{ type: "web_search" }]`, reading citations back from `url_citation` annotations on the output text (`src/adapters/openai/live.ts`). Powers `src/jobs/handlers/web-research.ts` (§ deep research): a planning call (`WEB_RESEARCH_PLANNING` template, `src/prompts/registry.ts`) turns the brand's own context — name, description, competitors — into 3-6 externally-answerable research questions, one `webSearch` call runs per question, and the findings become `dataSources` rows (`source_type = 'web_research'`) that flow through the ordinary evidence pipeline like any upload.

Mock: `fixtures/openai/web-research.ts` returns one of a fixed pool of plausible findings paragraphs, keyed deterministically by the query text, with citation URLs on `mock-source.example` — deliberately never a real-looking domain, so a mock finding is never mistaken for a genuine citation.

## Profound

Interface (`src/adapters/profound/types.ts`) — read, write and reporting operations exactly as specified:

```
getOrganizations / getCategories / getRegions / getModels /
getCategoryTopics / getCategoryTags / getAssets /
getOrganizationPersonas / getCategoryPersonas / listPrompts
createPrompts (supports dryRun) / updatePrompt / updatePromptStatus
queryVisibility / queryCitations / querySentiment
queryAccountVisibility / queryAccountCitations / queryAccountSentiment
```

`getPromptAnswers` was **removed from the interface entirely** (2026-08-10) — there is no live raw-answer endpoint to call, and keeping a permanently-throwing stub method around was worse than not having it. See "Reporting redesign" below for what replaced the capability it fed.

**`createPrompts` is no longer called by the app** (ADR-013 — deployment is export-only now; the user uploads an export into Profound's own UI by hand). It stays on the adapter and in both `live.ts`/`mock.ts` because it is still a real Profound operation and removing it would be removing correct code for no reason, but nothing in `src/` calls it. `listPrompts` is the one still-used read: `src/services/profound-reconcile.ts` calls it to find the account's prompts and link them back to this product's own prompt rows by normalized-text match.

**`queryAccountVisibility` / `queryAccountCitations` / `queryAccountSentiment`** are scoped to a whole *category*, not to a list of prompts this product deployed — the brand's existing AI-visibility data across everything Profound already tracks, grouped by topic, used as an evidence source for persona building via `src/jobs/handlers/profound-evidence.ts`. These share the same real `/v2/reports/*` endpoints as the prompt-scoped versions below.

Endpoints, base `https://api.tryprofound.com` — **verified 2026-08-10** against https://docs.tryprofound.com unless marked otherwise:

| Operation | Request | Status |
| --- | --- | --- |
| Auth | `X-API-Key: <api key>`, server-side only | Fixed (was `Authorization: Bearer`) and confirmed live |
| Categories | `GET /v1/org/categories` | Fixed (was `/v1/categories`) and confirmed live |
| Regions / models | `GET /v1/org/regions`, `GET /v1/org/models` | Fixed (was `/v1/regions`, `/v1/models`) and confirmed live |
| Topics / tags / domains | `GET /v1/org/categories/{id}/topics`, `/tags`, `GET /v1/org/domains` | Fixed (was `/v1/categories/{id}/...`, `/v1/assets`) and confirmed live for domains; topics/tags use the same fix pattern, not separately smoke-tested |
| List prompts | `GET /v1/org/categories/{id}/prompts?limit&cursor` | Fixed path; also fixed response parsing — real shape is `{info:{next_cursor,...}, data:[{prompt, topic:{id,name}, tags:[{id,name}], regions:[{id,name}], platforms:[{id,name}], personas:[{id,name}], status}]}`, not the flat string fields previously assumed. Not live-tested (no prompts exist yet in the test category). |
| Organizations | **No documented endpoint.** The org is implicit in the API key; it only appears nested as `{id, name}` on category/domain/persona rows. `getOrganizations` throws rather than call a made-up path. |
| Personas | `GET /v1/org/personas` (org-scoped only, no category filter) | **Not fixed** — real response is a rich `PersonaProfile` (behavior/employment/demographics), not this product's flat `{id, name, description, categoryId}`. Needs a type redesign before going live; `getOrganizationPersonas`/`getCategoryPersonas` throw a clear error rather than guess a mapping. Still an open, known gap as of this pass — out of scope for the reporting redesign. |
| Create prompts | `POST /v1/org/categories/{id}/prompts` with `{ prompts: [...], dry_run: boolean }` | Path fixed, **but not usable live**: the real response has no per-item status or `client_reference` echo — it's aggregate counts (`created`, `topics_created`, `tags_created`) plus a flat list of created prompt objects. This product's idempotency/outcome-tracking model (`normalizeOutcome`, per-item correlation) has no data to work from. Moot in practice per ADR-013 (deployment is export-only; nothing in `src/` calls this), but the code still can't go live as written. Still an open, known gap. |
| Visibility / citations / sentiment | `POST /v2/reports/{visibility,citations,sentiment}` | **Fully redesigned and confirmed working live** — see "Reporting redesign" below. |

**Persona creation is deliberately absent.** The spec forbids assuming it exists. When no Profound persona matches, the mapping falls back to the deterministic tag `persona:<internal-slug>` with mapping status `tag_fallback` and a visible warning in the deployment preview.

If `dry_run` turns out not to be supported by the live API, the adapter must surface that as `DryRunUnsupportedError` and the deployment must stop — it must not proceed to creation. This is asserted in `tests/unit/profound-payload.test.ts`.

### Reporting redesign (2026-08-10)

The original reporting design assumed a per-execution "run" — `run_id`, `mention_count`, `executions`, `brand_mentioned`, `mentions[]`, raw answer text. **None of that exists in the real API.** The real `/v2/reports/*` endpoints return one row per (asset × requested `group_by` dimension) bucket, and there is no raw-answer endpoint at all. This required a schema and pipeline redesign, not a path fix:

- **Schema**: `profound_result_snapshots` was replaced by `profoundResultBuckets` (`profound_result_buckets`) keyed on `(organizationId, profoundPromptId, bucketDate, modelId, topicId, regionId, personaId, asset)`, plus a separate `profoundSentimentBuckets` (`profound_sentiment_buckets`) — sentiment's request shape (requires an `asset` param, allows `group_by` dimensions like `tag`/`theme`/`claim`/`run`/`competitor` that visibility/citations don't have) can't share a key with the other two. `content_opportunities.relevantRunIds` and `content_briefs.runIds` were renamed to `relevantBucketIds`/`bucketIds` throughout — same hallucination-guard mechanism (validating an LLM only cites ids it was actually shown), different unit.
- **Visibility**: `POST /v2/reports/visibility`, `group_by: [date, model, topic, region, persona, prompt]`, `scope: "owned"` (or `"all"` when `competitorAssets` is requested). Returns real `visibility_score`/`share_of_voice`/`average_position`/`rank` per asset per bucket.
- **Citations**: `POST /v2/reports/citations`, `entity: "domain"`. **Its `group_by` is far more restrictive than visibility's** — verified live: a request grouped by `[date, model, topic, region, persona, prompt]` 422s with `"Unsupported group_by combination; use one dimension (or topic + model), optionally with date."` Fixed to `group_by: ["prompt", "date"]` — citations are therefore a `(prompt, date)` concept only, never per-model/topic/region/persona. `ProfoundCitationsRow` was simplified to drop those always-null fields entirely rather than keep dead ones. In `mergeVisibilityCitations` (`src/lib/profound-results.ts`), the same citation set for a `(prompt, date)` is attached to every model's visibility bucket for that prompt/date — that's the real attribution grain the API supports, not a per-model citation count.
- **Sentiment**: `POST /v2/reports/sentiment` requires `asset` (the brand name to analyze) and caps `group_by` at 2 dimensions — this product uses `["date", "prompt"]`, trading per-model sentiment granularity for prompt-level attribution. Confirmed live: returns real `positive_sentiment`/`negative_sentiment` percentages.
- **Server-side prompt filtering**: none of the three endpoints accept a `prompt_ids` list directly — they're category-scoped. But the generic `filter` tree accepts `{field: "prompt", op: "in", value: [...]}`, confirmed server-applied (echoed back in the response's `info.filter`). **This is not optional** — verified against a real 917-prompt category, an unfiltered category-wide pull for `queryCitations` did not terminate within a 50-page cap; the same call with the `prompt` filter returned in ~1 second. All three query methods pass this filter now, with the pre-existing client-side filter kept only as a defensive backstop.
- **Classification** (`classifyResult`) is computed from real fields only: `visibilityScore` at or below a near-zero threshold ⇒ `brand_absent`; a competitor's `shareOfVoice` (only present when `competitorAssets` was requested) exceeding the brand's own ⇒ `competitorVisible: true`. `competitorVisible` is `null`, not `false`, whenever competitor scope wasn't requested for that query — never coerced to a fabricated boolean.
- **Missing-expected-elements detection** (previously a substring match against Profound's nonexistent raw answer text) was retired from `src/lib/profound-results.ts` entirely and replaced by a new, separate, self-computed capability — see "Answer-coverage estimate" below.

Mock: `fixtures/profound/results.ts` and `fixtures/profound/account-reports.ts` were reworked to produce the same bucket-shaped rows as live (including synthetic competitor-asset buckets when competitor scope is requested), so mock and live share one honest data model instead of two.

### Answer-coverage estimate (new capability, 2026-08-10)

Since Profound exposes no raw AI-answer text, "does the answer cover what this persona needs to hear" is no longer something this product can read from Profound at all — so it estimates it itself. `src/jobs/handlers/estimate-answer-coverage.ts` calls OpenAI (`ANSWER_COVERAGE_ESTIMATE` template, `src/prompts/registry.ts`) with a prompt's text, persona context, `expected_answer_elements`, and whatever real evidence is available (citation domains from that prompt's own buckets), and stores a `{covered, missing, confidence, rationale}` estimate in `prompt_answer_coverage_estimates`, keyed by `(promptId, expectedElementsHash)` so it's cached rather than recomputed every retrieval. **Every row is `dataOrigin: "local"`** — the existing enum value meaning "calculated by this application, not a vendor" (see `OriginBadge`, `src/components/ui/index.tsx`) — and UI copy says explicitly "Estimated by this app — not confirmed by Profound." This is wired into the retrieval pipeline: `src/jobs/handlers/profound-results.ts` enqueues an estimate per retrieved prompt after storing its result buckets.

See Milestone 6 in `docs/progress.md` for the original mock-data generator design this reporting section evolved from.

## SparkToro

```
createAudienceReport(description, location?) → { reportId, status }
getSection(reportId, section) → { status: "ready"|"processing", data, creditsUsed }
```

Sections: demographics, bio keywords, websites, social accounts, networks, YouTube, podcasts, Reddit, press, apps-and-AI-tools, keywords, prompt topics, audience size. The user chooses which sections to request; each is a separate job so one failing section never discards the others.

Behaviour: bearer auth server-side; polling with backoff for `processing` sections; distinct typed errors for rate limit vs credit exhaustion (credit errors are **not** retried); results cached per `(reportId, section)`; credits recorded in `vendor_usage`.

**Verified 2026-08-10** against https://sparktoro.com/api/docs, base `https://api.sparktoro.com`:

- Auth (`Authorization: Bearer <api_key>`) was already correct as written.
- `createAudienceReport`: fixed from a guessed `POST /v1/audiences` (body `{description, location}`, response `{id, status}`) to the real `POST /v3/describe/create` (body `{prompt, location}`, response `{report_id, status, message}`). Confirmed working against a real account (report created, 10 credits charged).
- `getSection`: fixed to `GET /v3/{section}?report_id=...` (was `/v1/audiences/{id}/sections/{section}`). Replaced the single normalized `SparktoroAffinityRow` type with per-section real shapes for the two sections verified and confirmed working live (2026-08-10): `websites` (`{id, domain, affinity, category, visits, moz_da, moz_links, hidden_gem, meta_description}`, flat array) and `demographics` (a dict of category → `{name, value}[]` buckets — e.g. `{gender: [...], age: [...], salary: [...]}` — flattened at parse time into `{category, name, value}` rows). `documentifySection` (`src/jobs/handlers/sparktoro-section.ts`) has a dedicated prose template per verified section. Every other section in `SPARKTORO_SECTIONS` (bio_keywords, social_accounts, networks, youtube, podcasts, reddit, press, apps_and_ai_tools, keywords, prompt_topics) has its own, still-unverified real shape — `getSection` throws a clear error for those rather than guess, and `/v3/tam` returns a single object (`estimated_population`, ...) rather than a row array, so it must never be routed through this method even once verified. Mock mode was reworked to produce the same per-section shapes as live for `websites`/`demographics` (and dropped a fabricated `url` field it used to invent — confirmed to have zero downstream readers).

All SparkToro data is stored as `provenance = 'externally_supported'` and rendered with an "aggregated external audience evidence" label. The system never converts an aggregate affinity into an asserted individual behaviour.

## DataForSEO

Traditional search intelligence only:

```
getKeywordsForSite / getRankedKeywords / getRelatedKeywords /
getKeywordSuggestions / getKeywordMetrics / getSearchVolume /
getKeywordIntent / getOrganicSerp / getDomainCompetitors / getReviews
```

Behaviour: HTTP Basic auth from server-side credentials; both live and task-post/task-get patterns depending on endpoint; polling, retries with backoff, a concurrency limit, per-task cost recorded in `vendor_usage`, raw response retained, normalized into `search_datasets`.

**Verified 2026-08-10** against https://docs.dataforseo.com: base URL, the `search_volume/live` path, and the request body shape are all confirmed correct as written — no code changes needed. A live 401 ("You are not authorized... see your login details here") was traced to DataForSEO's own documented error code `40100` (credentials mismatch), most commonly caused by using the account dashboard login/password instead of the separate **API Access** login/password from `app.dataforseo.com/api-access`, or a rotated password. `GET /v3/appendix/user_data` is a free endpoint that confirms whether credentials authenticate at all, without a billable data call — worth calling first when diagnosing this.

**Not implemented, by design:** DataForSEO LLM Responses / LLM Mentions / LLM Scraper. Profound is the AI-search execution and visibility layer for this product; implementing a second one would violate the product boundary.

## Object storage

```ts
interface ObjectStorage {
  put(key, body, contentType): Promise<{ key: string; bytes: number }>;
  get(key): Promise<Buffer>;
  delete(key): Promise<void>;
  signedUrl(key, expiresInSeconds): Promise<string>;
}
```

`S3ObjectStorage` for production (any S3-compatible endpoint, incl. MinIO). `LocalObjectStorage` writes under `STORAGE_LOCAL_DIR` for development — chosen automatically when no S3 endpoint is configured, and reported as such on the integrations screen. Raw uploads are stored here; parsed text and evidence live in Postgres.

## Queue

```ts
interface JobQueue {
  enqueue(type, payload, opts?): Promise<Job>;   // opts: runAfter, maxAttempts, idempotencyKey
  claim(types, workerId): Promise<Job | null>;
  complete(jobId, result): Promise<void>;
  fail(jobId, error, retryable): Promise<void>;
  cancel(jobId): Promise<void>;
}
```

`PostgresJobQueue` is the implementation (see ADR-004). Claiming uses `SELECT … FOR UPDATE SKIP LOCKED` inside a transaction, so multiple workers are safe. Backoff is `min(2^attempts * 5s, 10m)` with jitter. `idempotencyKey` is uniquely indexed, so enqueueing the same logical job twice is a no-op.

## Adding a new vendor

1. Create `src/adapters/<vendor>/types.ts` with the interface and Zod schemas for normalized responses.
2. Implement `live.ts` (typed HTTP, retries, typed errors, `vendor_usage` recording, raw retention) and `mock.ts` (pure, fixture-backed, no clock or randomness).
3. Export a factory from `index.ts` returning `{ adapter, mode }`.
4. Add fixtures under `fixtures/<vendor>/`.
5. Add the vendor to the `vendor` enum, the integrations screen and `.env.example`.
6. Add a contract test asserting both implementations satisfy the interface and that the live one throws rather than degrading.
