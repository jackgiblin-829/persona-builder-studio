# Persona Builder Studio

Persona Builder Studio turns first-party research and SparkToro audience data into editable personas and evidence-led Query Funnel prompt baselines for downstream SEO and GEO strategy.

The product is organized around one simple project workflow:

1. **Data** — upload PDF, DOCX, TXT, Markdown, CSV, or JSON files, or paste transcripts. Sources are parsed, redacted, and converted into research signals automatically.
2. **Personas** — generate an adaptive set of 3–5 descriptive personas from completed sources and a full SparkToro audience report, then edit them as immutable versions.
3. **Query Funnels** — approve a cited grounding brief, generate five BOFU anchors, fifteen MOFU evaluation questions, and thirty TOFU awareness questions per persona, review the linked pathways, and export a versioned baseline CSV.

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

The seed contains one fictional project, completed research signals, an approved synthetic grounding brief, three personas, and three demo Query Funnel baselines. Everything is synthetic and uses reserved `.example` domains. Demo-mode output is visibly labeled and cannot be mistaken for production research.

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

## Architecture

The Next.js application and background worker share PostgreSQL. Server actions call tenant-scoped services; services use explicit adapters for storage, queues, OpenAI, and SparkToro. Live failures never fall back to mock data.

Generated artifacts are immutable. Stable persona and prompt-set rows only switch their current-version pointers after a complete transaction succeeds, so a failed regeneration leaves the last completed result available.

See [architecture](docs/architecture.md), [data model](docs/data-model.md), [integrations](docs/integrations.md), and [security](docs/security.md).
