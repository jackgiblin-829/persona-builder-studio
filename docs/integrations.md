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
| OpenAI | Implemented against the Responses API with Structured Outputs | Not re-verified during this build (no network verification performed) | Endpoint/shape assumptions recorded below. Mock mode is the default and is what the seeded demo exercises. |
| Profound | Typed REST wrapper behind `ProfoundAdapter` | Not re-verified during this build | Endpoint assumptions recorded below and marked as assumptions in code comments. |
| SparkToro | Report-create + section-fetch with polling | Not re-verified during this build | Public API launched July 2026 per the research report. |
| DataForSEO | Live + task-based patterns, Basic auth | Not re-verified during this build | LLM-response endpoints deliberately **not** implemented (Profound is the execution layer). |
| Object storage | S3-compatible via `@aws-sdk/client-s3`; local filesystem driver for dev | n/a | |
| Queue | Postgres `jobs` table; BullMQ driver slot reserved | n/a | See ADR-004 |

> **Honest statement of limitation.** This build was produced without network access to vendor documentation, so no live endpoint was verified against current official docs and no live call has been executed. Every live adapter is written from the endpoint assumptions listed below and is marked `@unverified` in source. Before enabling any vendor in production: re-read that vendor's current official documentation, correct the endpoint/field assumptions, record the documentation date in the table above, and run the adapter's contract test against a sandbox account. The mock adapters are complete and are the only path exercised by the seeded demo and the automated tests.

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
queryVisibility / queryCitations / querySentiment / getPromptAnswers
queryAccountVisibility / queryAccountCitations / queryAccountSentiment
```

**`createPrompts` is no longer called by the app** (ADR-013 — deployment is export-only now; the user uploads an export into Profound's own UI by hand). It stays on the adapter and in both `live.ts`/`mock.ts` because it is still a real Profound operation and removing it would be removing correct code for no reason, but nothing in `src/` calls it. `listPrompts` is the one still-used read: `src/services/profound-reconcile.ts` calls it to find the account's prompts and link them back to this product's own prompt rows by normalized-text match.

**`queryAccountVisibility` / `queryAccountCitations` / `queryAccountSentiment`** are new (§ account-level evidence) and are scoped to a *category*, not to a list of prompts this product deployed — the brand's existing AI-visibility data across everything Profound already tracks, grouped by topic, used as an evidence source for persona building via `src/jobs/handlers/profound-evidence.ts`. This is the least-certain endpoint assumption in this adapter: `docs/integrations.md`'s existing `queryVisibility`/`queryCitations`/`querySentiment` assumptions are extended with `category_id`/`scope: "all"`/`group_by: "topic"` in place of an explicit `prompt_ids` list, which has not been checked against any real account-level reporting documentation. Re-verify this specifically, separately from the rest of the adapter, before enabling live mode for account-evidence pulls.

Endpoint assumptions (**unverified**, base `https://api.tryprofound.com`):

| Operation | Assumed request |
| --- | --- |
| Auth | `Authorization: Bearer <api key>`, server-side only |
| Categories | `GET /v1/categories` |
| Regions / models | `GET /v1/regions`, `GET /v1/models` |
| Topics / tags / assets | `GET /v1/categories/{id}/topics`, `/tags`, `GET /v1/assets` |
| Personas | `GET /v1/organizations/{id}/personas`, `GET /v1/categories/{id}/personas` |
| List prompts | `GET /v1/categories/{id}/prompts?limit&cursor` |
| Create prompts | `POST /v1/categories/{id}/prompts` with `{ prompts: [...], dry_run: boolean }` |
| Visibility / citations | `POST /v1/reports/visibility`, `POST /v1/reports/citations` |
| Sentiment | `POST /v1/reports/sentiment` |
| Raw answers | `GET /v1/prompts/{id}/answers?start_date&end_date` |

**Persona creation is deliberately absent.** The spec forbids assuming it exists. When no Profound persona matches, the mapping falls back to the deterministic tag `persona:<internal-slug>` with mapping status `tag_fallback` and a visible warning in the deployment preview.

If `dry_run` turns out not to be supported by the live API, the adapter must surface that as `DryRunUnsupportedError` and the deployment must stop — it must not proceed to creation. This is asserted in `tests/unit/profound-payload.test.ts`.

Mock: `fixtures/profound/account.ts` provides one category, existing prompts (including one exact duplicate and one near-duplicate of the seeded set), a successful dry run, and a partial creation failure (4 of 24 fail with a retryable error). `fixtures/profound/results.ts` generates the reporting side (§25): one deterministic run per UTC day, per prompt, per model, for whatever date range the caller asks for — not a fixed 30-day file, since the retrieval window is user-selected. See Milestone 6 in `docs/progress.md` for how that generator manufactures brand-absent and competitor-dominated cases.

## SparkToro

```
createAudienceReport(description, location?) → { reportId, status }
getSection(reportId, section) → { status: "ready"|"processing", data, creditsUsed }
```

Sections: demographics, bio keywords, websites, social accounts, networks, YouTube, podcasts, Reddit, press, apps-and-AI-tools, keywords, prompt topics, audience size. The user chooses which sections to request; each is a separate job so one failing section never discards the others.

Behaviour: bearer auth server-side; polling with backoff for `processing` sections; distinct typed errors for rate limit vs credit exhaustion (credit errors are **not** retried); results cached per `(reportId, section)`; credits recorded in `vendor_usage`.

All SparkToro data is stored as `provenance = 'externally_supported'` and rendered with an "aggregated external audience evidence" label. The system never converts an aggregate affinity into an asserted individual behaviour.

## DataForSEO

Traditional search intelligence only:

```
getKeywordsForSite / getRankedKeywords / getRelatedKeywords /
getKeywordSuggestions / getKeywordMetrics / getSearchVolume /
getKeywordIntent / getOrganicSerp / getDomainCompetitors / getReviews
```

Behaviour: HTTP Basic auth from server-side credentials; both live and task-post/task-get patterns depending on endpoint; polling, retries with backoff, a concurrency limit, per-task cost recorded in `vendor_usage`, raw response retained, normalized into `search_datasets`.

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
