# Integrations

Only OpenAI and SparkToro are configured at organization level in this release. Local storage and the PostgreSQL queue are infrastructure adapters.

## OpenAI

Persona, signal, market-research, candidate-generation, and rubric-evaluation calls use the Responses API with strict JSON Schema Structured Outputs. Live market research enables the built-in web-search tool and stores the returned source URLs with the brief. Every result is validated again with Zod before it can be stored or published. A live request failure is surfaced and never replaced with mock output. Embeddings measure semantic similarity across candidates and selected prompts.

Official references: <https://developers.openai.com/api/docs/guides/structured-outputs>, <https://developers.openai.com/api/docs/guides/tools-web-search>

## SparkToro

Persona generation preflights the free credit-balance endpoint and shows the maximum estimated report cost. Reports are cached by normalized audience description, market, and locale.

The full normalized report includes demographics, bios, websites, social accounts, networks, YouTube, podcasts, Reddit, press, apps/AI tools, brands, keywords, AI prompt topics, and market size. Demographics, bios, keywords, and prompt topics are required. Other failures create retryable warnings.

Reddit, brands, and prompt topics poll documented `202` warm-up responses using `Retry-After`. `402` credit exhaustion and `429` rate limiting are handled as distinct typed failures.

Official reference: <https://sparktoro.com/api/docs>

## Profound CSV

There is no Profound API synchronization. The Prompts tab exports one RFC 4180 CSV with `Topic`, `Prompt`, `Tags`, `Regions`, and `Language`. Tags include persona, archetype, quality band, research snapshot, topic class, prompt type, funnel stage, business line, tracked signal, and review status. Formula-leading cells are protected for spreadsheet safety. Mock-origin libraries are downloaded only as clearly labeled demo files; production exports require exactly 50 approved live prompts with passing quality scores and complete coverage.

Official reference: <https://help.tryprofound.com/articles/3730240593-create-manage-and-tag-prompts>
