# Product understanding — Persona Evidence Studio

_Last updated: 2026-08-06. Source of truth: `1. Product purpose.md` (build spec) and `deep-research-report.md` (research basis)._

## 1. What this product is

Persona Evidence Studio (PES) is an **evidence-backed persona and prompt strategy layer that sits in front of Profound**.

It exists because tracking one generic prompt ("what are the best analytics platforms?") is an inadequate measure of AI visibility. Different buyers — a security-led technical evaluator, an adoption-led functional manager, a cost-constrained small-team buyer — ask materially different questions, apply different decision criteria, and require different proof. PES makes that difference explicit, traceable to real evidence, and measurable in Profound.

The product's job, in one sentence:

> Turn first-party customer evidence into reviewable persona hypotheses, turn those hypotheses into persona-specific prompts deployed safely into Profound, and turn Profound's results back into content actions — with every claim traceable to its source.

## 2. What this product is *not*

- **Not an AI-visibility platform.** Profound executes prompts and reports visibility. PES never executes prompts against ChatGPT/Claude/Gemini/Perplexity itself, and never re-implements Profound's dashboard.
- **Not a persona generator.** A persona here is a *testable research hypothesis*, not a person, a digital twin, or a decorative card with a stock photo and a coffee order.
- **Not an autonomous system.** Nothing reaches Profound without a dry run and an explicit human approval. Nothing is published anywhere.

## 3. The system-of-record boundary

This boundary is the single most important architectural constraint in the product.

| Profound owns | Persona Evidence Studio owns |
| --- | --- |
| Prompt execution | Source evidence and evidence classifications |
| AI visibility, share of voice, mentions | Candidate segments |
| Citations, sentiment, raw AI answers | Internal personas and persona versions |
| Search-query fanouts | Persona-to-evidence traceability |
| Models and platforms | Prompt strategy and prompt-to-evidence traceability |
| Historical prompt performance | Generic control pairs |
| | Profound mappings and synchronization history |
| | Content opportunities, briefs, page audits |

Practical consequences:

1. Profound result data is stored as **immutable snapshots** with a sync timestamp, never recomputed and re-labelled as ours.
2. Locally computed numbers (control lift, coverage, confidence) are labelled **locally calculated** in the UI and never presented as Profound metrics.
3. We only ever retrieve Profound results **for prompts we linked**, not the whole account.

## 4. The five provenance classes

The product must never let these blur into each other. Every record carries its class:

| Class | Meaning | Example | Confidence weight |
| --- | --- | --- | --- |
| `observed` | A customer/searcher said or did this | "We can't let customer data leave our cloud" (call transcript) | 1.00 first-party / 0.90 GSC |
| `externally_supported` | An aggregate external dataset supports this | SparkToro audience affinity, DataForSEO search demand | 0.70 / 0.65 |
| `brand_assertion` | The brand claims this about itself | Homepage copy | 0.40 |
| `inferred` | A model synthesised this from evidence | A persona hypothesis field | 0.00 on its own |
| `insufficient_evidence` | We looked and could not support the claim | An empty success-metric field | n/a — displayed as a gap |

An aggregate SparkToro signal is **never** converted into an asserted individual behaviour. A brand's own copy is evidence of *positioning*, not of customer belief.

## 5. The end-to-end workflow

```
Brand setup
  → Source ingestion (upload / paste / approved URL crawl)
    → Parse → Redact → Chunk → Extract evidence → Embed
      → Evidence explorer (search, filter, review, approve)
        → Candidate segments (3–7, with supporting + contradicting evidence)
          → Persona version (5 core fields, each with provenance + confidence)
            → Approval (immutable version)
              → Prompt set (15–30 persona prompts + generic controls)
                → Approval (immutable version)
                  → Profound mapping (persona → Profound persona or deterministic tag)
                    → Duplicate checks (exact hash + semantic)
                      → Dry run → Explicit approval → Idempotent creation
                        → Sync receipt (immutable)
                          → Profound result snapshots (linked prompts only)
                            → Persona performance panel (persona vs control)
                              → Content opportunity → SEO brief / page audit → Export
```

Every arrow is a job with explicit states; every artefact stores org, brand, evidence IDs, evidence cutoff, model, prompt-template version, schema version, initiating user and review status.

## 6. The five persona fields

Kevin Indig's framework, and the reason the persona is behavioural rather than theatrical:

| Field | Question it answers |
| --- | --- |
| Job to be done | What progress is this person trying to make? |
| Constraints | What limits the available choices? |
| Success metrics | How will they judge the outcome? |
| Decision criteria | What evidence determines the choice? |
| Vocabulary | How does this audience describe its problem? |

These five drive everything downstream: prompts derive from information needs derived from these fields — **never** from a brand keyword list with a persona invented around it. That inversion is the product's central anti-pattern.

Forbidden persona content, unless directly relevant, lawful and explicitly evidence-backed: age, gender, income, hobbies, family status, personality, political beliefs, health status, protected characteristics.

## 7. Confidence is a heuristic, not a probability

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

Every component is stored, displayed and configurable. The UI must never describe this number as "the probability the persona is correct". A field can have high quantity and low coverage (e.g. all evidence from enterprise calls) and the user must be able to see that.

## 8. Profound safety requirements

The deployment path is deliberately slow and explicit:

1. Load live Profound configuration (categories, regions, models, topics, tags, assets, personas).
2. Map the internal persona to a real Profound persona **or** fall back to a deterministic tag `persona:<internal-slug>` with a visible warning. Never silently map to an unrelated persona.
3. Load existing Profound prompts; check exact duplicates (normalized hash) and semantic near-duplicates (embeddings).
4. Build a proposed payload; call Profound with `dry_run: true`.
5. Show a deployment preview; require explicit user approval.
6. Create prompts idempotently — re-running an approved deployment must not duplicate the prompts that already succeeded.
7. Store Profound prompt IDs, write an immutable sync receipt, allow retry of **only** the failed prompts.

Sync states: `draft → ready → dry_run_passed → approved → syncing → synced | partially_synced | failed | archived`.

## 9. Working without credentials

Every vendor adapter (OpenAI, Profound, SparkToro, DataForSEO, object storage, queue) sits behind an interface with a **deterministic mock implementation**. The seeded demo runs the complete 16-step workflow with no credentials at all.

Two hard rules:

- Mock output is always visibly labelled as mock in the UI and in the database (`data_origin` on every generated artefact).
- A **failed live call never falls back to mock data**. It fails loudly with a retryable error state.

## 10. Priority order when trading off

1. Evidence traceability
2. Data integrity
3. Safe Profound synchronization
4. Persona and prompt versioning
5. Human review and approval
6. Working end-to-end workflows
7. Security
8. Testing
9. Usability
10. Visual polish

A decorative persona card that cannot show its evidence is a defect. A plain table that can is not.

## 11. Definition of done (condensed)

A new developer clones the repo, follows the README, runs `npm run db:setup`, signs in with seeded credentials, and completes all 16 demo steps — create/open brand, review evidence, inspect extracted records, generate segments, approve a persona, generate prompts, pair controls, review Profound metadata, mocked dry run, mocked deploy, sync receipt, mocked results, content opportunity, SEO brief, homepage audit, export — without a single credential and without encountering a control that looks functional but is not.
