# Persona Builder Studio

Persona Builder Studio turns first-party research and SparkToro audience data into editable personas and client-ready prompt taxonomies for downstream SEO and GEO strategy.

The product is organized around one simple project workflow:

1. **Data** — upload PDF, DOCX, TXT, Markdown, CSV, or JSON files, or paste transcripts. Sources are parsed, redacted, and converted into research signals automatically.
2. **Personas** — generate an adaptive set of 3–5 descriptive personas from completed sources and a full SparkToro audience report, edit them as immutable versions, and export a client-facing PowerPoint with a two-slide profile and messaging strategy for every persona.
3. **Prompt Taxonomy** — define the products, audiences, markets, competitors, and tracking context; generate natural discovery, comparison, cost, risk, brand, and selection questions; then download a quality-checked client workbook.

Prompt execution, rank tracking, AI visibility reporting, audit decks, and performance reporting are intentionally outside this release. The exported baseline is designed to feed the team’s chosen SEO/GEO tracking workflow.

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

The seed contains one fictional project, completed research signals, an approved synthetic grounding brief, three personas, and three demo prompt-taxonomy libraries. Everything is synthetic and uses reserved `.example` domains. Demo-mode output is visibly labeled and cannot be mistaken for production research.

## Important database reset

The project-first schema is a new initial schema, not a compatibility migration. `npm run db:reset` drops and recreates the configured development database schema. The migration command also detects superseded migration history and performs this intentional reset; production requires `ALLOW_PERSONA_STUDIO_RESET=true`.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start the app on port 3100 |
| `npm run worker` | Process ingestion and generation jobs |
| `npm run db:migrate` | Apply the clean initial migration |
| `npm run db:migrate:safe` | Apply forward migrations and refuse any legacy reset |
| `npm run db:seed` | Seed the three-tab demo |
| `npm run db:reset` | Destructively recreate the development schema |
| `npm run test:unit` | Run fast contract and parser tests |
| `npm run test:integration` | Run database-backed tests |
| `npm run test:e2e` | Run the browser acceptance test |
| `npm run verify` | Formatting, lint, types, and all Vitest suites |

## Client persona decks

Every active persona includes a dedicated deck profile: title/role, industry, expertise level,
tone, point of view, care-abouts, language to avoid, and recommended content. The Personas page
exports these fields to a 16:9 PowerPoint that follows the supplied 829 Studios audience-persona
format. Mock-data exports are visibly labeled as demos; live and local-evidence exports are ready
for client review.

## Client prompt-taxonomy workbooks

The Prompt Taxonomy page captures the client and tracking context needed to create a six-tab Excel
deliverable: Read Me, Topic Architecture, Prompt Library, Profound Import, Competitor Tracking, and
Entity Watchlist. The workbook keeps the first ten Prompt Library columns compatible with the
supplied foundational workflow, adds persona, search-theme, related-prompt, quality, and evidence
fields for audit, and includes live topic-count formulas, filters, frozen headers, validation lists,
phase highlighting, and demo labeling when mock data is used.

Workbook planning supports the prepared-by line, primary commercial job, target regions, tracking
surfaces, competitor context, and entity-risk rows. Generated plans are deduplicated, topic-balanced,
limited to 180 prompts, and checked for a 10–16 topic architecture, unbranded coverage, Phase 1 size,
thin topics, and competitor coverage before export.

## Architecture

The Next.js application and background worker share PostgreSQL. Server actions call tenant-scoped services; services use explicit adapters for storage, queues, OpenAI, and SparkToro. Live failures never fall back to mock data.

Generated artifacts are immutable. Prompt-taxonomy runs persist as drafts until every row passes the structural and semantic quality contract, then all affected prompt-set pointers switch in one transaction. Failed generation and refreshes never mutate the current approved baseline.

See [architecture](docs/architecture.md), [data model](docs/data-model.md), [integrations](docs/integrations.md), and [security](docs/security.md).
