# Integrations

Only OpenAI and SparkToro are configured at organization level in this release. Local storage and the PostgreSQL queue are infrastructure adapters.

## OpenAI

Persona, signal, market-research, prompt-planning, stage-specific writing, targeted repair, and semantic-evaluation calls use the Responses API with strict JSON Schema Structured Outputs. Query Funnel planner, writer, evaluator, and repair templates are versioned independently. Live market research enables the built-in web-search tool and stores the returned source URLs with the brief. Every result is validated again with Zod before it can be stored or published. A live request failure is surfaced and never replaced with mock output. Embeddings measure semantic similarity across candidates and selected prompts, excluding ancestor pairs from duplicate blocking.

Official references: <https://developers.openai.com/api/docs/guides/structured-outputs>, <https://developers.openai.com/api/docs/guides/tools-web-search>, <https://developers.openai.com/api/docs/guides/latest-model>

## SparkToro

Persona generation preflights the free credit-balance endpoint and shows the maximum estimated report cost. Reports are cached by normalized audience description, market, and locale.

The full normalized report includes demographics, bios, websites, social accounts, networks, YouTube, podcasts, Reddit, press, apps/AI tools, brands, keywords, AI prompt topics, and market size. Demographics, bios, keywords, and prompt topics are required. Other failures create retryable warnings.

Reddit, brands, and prompt topics poll documented `202` warm-up responses using `Retry-After`. `402` credit exhaustion and `429` rate limiting are handled as distinct typed failures.

Official reference: <https://sparktoro.com/api/docs>

## Query Funnel baseline CSV

There is no prompt execution or tracking integration in this release. The Query Funnels tab exports one neutral RFC 4180 CSV containing baseline version, persona, pathway, prompt ID, parent prompt ID, funnel stage, intent, prompt text, brand mode, topic class, archetype, business line, buyer context, quality score, market, language, evidence references, research snapshot, generation date, and generation mode. Formula-leading cells are protected for spreadsheet safety. Mock-origin baselines are clearly labeled; production exports require a complete, approved, quality-passed baseline for every active persona.
