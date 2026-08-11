# Persona Builder Studio

Persona Builder Studio (PBS) is an evidence-backed persona, prompt strategy, and content planning workspace that sits in front of Profound. It turns customer research into reviewable personas, measurable prompt libraries, and content actions while keeping every generated claim traceable to its source.

## What the product does

PBS supports two connected workflows:

### Project workflow

1. **Data** — upload PDF, DOCX, TXT, Markdown, CSV, or JSON files, or paste transcripts. Sources are parsed, redacted, chunked, embedded, and converted into reviewable research signals.
2. **Personas** — combine first-party evidence with SparkToro audience research to identify candidate segments and generate evidence-backed persona versions. Persona fields retain provenance, confidence, supporting evidence, and contradictions.
3. **Prompts** — approve a cited market-research brief, configure the prompt strategy, build a 50-cell coverage blueprint, generate two candidates per cell, score and repair them, review the results, and export the approved library.

### Brand workflow

The brand workspace extends the same evidence through segments, personas, prompt sets, and Profound operations. It also supports content opportunities, SEO briefs, page audits, evidence review, and performance reporting for linked Profound prompts.

## Prompt quality and export guarantees

Prompt generation is a gated, reviewable pipeline rather than a single text-generation call:

- Market research combines uploaded evidence with OpenAI Responses API web search. The approved brief records cited facts, URLs, capture time, and a 30-day freshness warning.
- The default library has 50 coverage cells spanning topic class, persona, funnel stage, business line, prompt type, qualifier, competitor, and question archetype.
- Eight question archetypes are balanced across the library: recommendation, comparison, how-to, worth-it, migration, risk, entity verification, and workflow.
- Two candidates are generated for each cell. Candidates receive a 100-point rubric score, semantic duplicate checks using embeddings, and automatic repair attempts when they fail validation.
- Inline editing and single-row regeneration preserve the assigned coverage cell. Rows that still fail become `needs_revision` and cannot be approved or exported.
- A production export requires exactly 50 unique, complete, human-approved live prompts with passing scores and no unsupported entity claims or competitor leakage.
- The export remains Profound-compatible with exactly five columns: `Topic`, `Prompt`, `Tags`, `Regions`, and `Language`. Tags include the prompt's archetype, quality band, research snapshot, topic class, prompt type, funnel stage, business line, tracked signal, and review status.

Demo/mock libraries are visibly labelled and may be downloaded for testing, but are blocked from production export.

## Profound boundary

PBS does not execute prompts or recreate Profound's visibility dashboard. It exports approved prompt libraries, reconciles linked prompts, retrieves results for those linked prompts, and displays persona-versus-control performance. Profound remains the system of record for prompt execution, AI answers, visibility, citations, mentions, and sentiment.

## Integrations

- **OpenAI** — structured-output generation and evaluation, market research with web search, and embeddings. Live failures are surfaced; they never silently fall back to mock data.
- **SparkToro** — audience reports used for segment and persona research, with normalized report sections and cached requests.
- **Profound** — compatible CSV export plus configuration, reconciliation, linked-result retrieval, and performance views. The seeded demo uses a deterministic mock adapter.
- **DataForSEO** — traditional search-intelligence inputs for content planning where configured.

All vendor adapters have deterministic mock implementations so the seeded demo can run without credentials. Mock-origin data is labelled in the UI and stored on generated artefacts.

## Local setup

Requirements:

- Node.js 20.11+
- PostgreSQL 16+

The complete demo works offline with deterministic OpenAI and SparkToro mock adapters.

```bash
cp .env.example .env
npm install
npm run db:setup
npm run dev
```

Run the worker in a second terminal:

```bash
npm run worker
```

Open <http://localhost:3100> and sign in with one of the seeded accounts:

| Email | Password | Role |
| --- | --- | --- |
| `admin@example.com` | `demo-password-1` | owner |
| `analyst@example.com` | `demo-password-2` | editor |
| `viewer@example.com` | `demo-password-3` | viewer |

The seed contains a fictional project and brand, completed research signals, an approved synthetic market brief, personas, prompt libraries, a mock Profound account, performance snapshots, content opportunities, an SEO brief, and a page audit. Everything is synthetic and uses reserved `.example` domains. Demo-mode output is visibly labelled and cannot be mistaken for a production Profound export.

## Important database reset

The project-first schema is a new initial schema, not a compatibility migration. `npm run db:reset` drops and recreates the configured development database schema. The migration command also detects superseded migration history and performs this intentional reset; production requires `ALLOW_PERSONA_STUDIO_RESET=true`.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the app on port 3100 |
| `npm run worker` | Process ingestion and generation jobs |
| `npm run db:migrate` | Apply the clean initial migration |
| `npm run db:seed` | Seed the three-tab demo |
| `npm run db:reset` | Destructively recreate the development schema |
| `npm run test:unit` | Run fast contract and parser tests |
| `npm run test:integration` | Run database-backed tests |
| `npm run test:e2e` | Run the browser acceptance test |
| `npm run verify` | Formatting, lint, types, and all Vitest suites |

## Architecture

The Next.js application and background worker share PostgreSQL. Server actions call tenant-scoped services; services use explicit adapters for storage, queues, OpenAI, and SparkToro. Live failures never fall back to mock data.

Generated artifacts are immutable. Stable persona and prompt-set rows only switch their current-version pointers after a complete transaction succeeds, so a failed regeneration leaves the last completed result available.

See [product understanding](docs/product-understanding.md), [architecture](docs/architecture.md), [data model](docs/data-model.md), [integrations](docs/integrations.md), and [security](docs/security.md).
