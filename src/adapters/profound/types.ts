/**
 * The Profound boundary (§19–§24).
 *
 * Profound is the system of record for prompt execution and AI visibility. This
 * product never executes a prompt itself and never invents a Profound concept:
 * every category, region, model, topic, tag, asset and persona below is read
 * back from the vendor, and anything the vendor does not offer is exposed as
 * absent rather than synthesised.
 *
 * Absences that are deliberate and load-bearing:
 *
 * - **There is no `createPersona`.** The specification forbids assuming Profound
 *   supports persona creation. When no Profound persona matches, the mapping
 *   falls back to the deterministic `persona:<slug>` tag (§20) — visibly, with
 *   the mapping recorded as `tag_fallback`, never silently.
 * - **Reporting is bucket-shaped, not per-execution (redesigned 2026-08-10).**
 *   Visibility, citations, and sentiment (§25) are separate vendor calls, each
 *   returning one row per (asset x requested `group_by` dimension) bucket —
 *   never a per-execution "run." There is no vendor concept of a mention
 *   count, a brand-mentioned flag, or raw per-execution answer text; this
 *   product does not fabricate any of those. `visibilityScore`/`shareOfVoice`/
 *   `averagePosition`/citation counts are real vendor fields read straight
 *   through. Answer-coverage estimation (what used to depend on Profound's
 *   nonexistent raw-answer endpoint) is now a separate, self-computed
 *   capability — see `promptAnswerCoverageEstimates` in `src/db/schema.ts`
 *   and `src/jobs/handlers/estimate-answer-coverage.ts` — always labeled
 *   `dataOrigin: "local"`, never mistaken for vendor-confirmed data.
 */

export type ProfoundOrganization = {
  id: string;
  name: string;
};

export type ProfoundCategory = {
  id: string;
  name: string;
  /** The brand or domain the category tracks, when the vendor reports one. */
  brandName: string | null;
  domain: string | null;
};

export type ProfoundRegion = {
  code: string;
  name: string;
};

export type ProfoundModel = {
  id: string;
  name: string;
  /** e.g. "chatgpt", "perplexity", "google-ai-overviews". */
  platform: string;
};

export type ProfoundTopic = {
  id: string;
  name: string;
  categoryId: string;
};

export type ProfoundTag = {
  name: string;
  promptCount: number;
};

export type ProfoundAsset = {
  id: string;
  name: string;
  domain: string | null;
};

export type ProfoundPersona = {
  id: string;
  name: string;
  description: string | null;
  /** Null for an organization-level persona that is not scoped to a category. */
  categoryId: string | null;
};

/** A prompt that already exists in the customer's Profound account. */
export type ProfoundExistingPrompt = {
  id: string;
  text: string;
  topic: string | null;
  tags: string[];
  personaId: string | null;
  regions: string[];
  platforms: string[];
  status: string;
};

/**
 * One prompt as Profound receives it.
 *
 * `client_reference` is this product's prompt id, echoed back on every item
 * result. Without it a partial failure could only be matched back by prompt
 * text, which breaks the moment two prompts differ by punctuation alone.
 */
export type ProfoundPromptPayload = {
  client_reference: string;
  prompt_text: string;
  topic: string;
  language: string;
  regions: string[];
  platforms: string[];
  tags: string[];
  persona_id: string | null;
  analysis_types: string[];
  prompt_type: "persona" | "generic_control";
  asset: string | null;
};

export type ProfoundCreateRequest = {
  categoryId: string;
  /** §22.10 — never defaulted. The caller must state its intent explicitly. */
  dryRun: boolean;
  prompts: ProfoundPromptPayload[];
};

export type ProfoundItemOutcome = "validated" | "created" | "duplicate" | "failed";

export type ProfoundCreateItemResult = {
  clientReference: string;
  outcome: ProfoundItemOutcome;
  /** Set for `created` and for `duplicate` (the id of the prompt that exists). */
  profoundPromptId: string | null;
  errorCode?: string;
  errorMessage?: string;
  retryable?: boolean;
};

export type ProfoundCreateResponse = {
  dryRun: boolean;
  items: ProfoundCreateItemResult[];
  /** Retained verbatim so a normalization bug stays debuggable after the fact. */
  raw: Record<string, unknown>;
};

// ── Reporting (§25) ──────────────────────────────────────────────────────────

/**
 * A user-selected retrieval window. Dates are `YYYY-MM-DD`, inclusive on both
 * ends, always given by the caller — a reporting call must never reach for
 * "now" internally, or a retry hours later would silently cover a different
 * window than the one the user asked for.
 */
export type ProfoundResultQuery = {
  /** The real API is category-scoped, not prompt-list-scoped — see `ProfoundVisibilityRow`'s doc comment. */
  categoryId: string;
  profoundPromptIds: string[];
  modelIds: string[];
  startDate: string;
  endDate: string;
  /** Required by `querySentiment` specifically — the brand name being analyzed. */
  asset?: string;
  /** Include competitor assets in scope, not just the brand's own. Needed for a real competitor-visibility signal — see `classifyResult` in `src/lib/profound-results.ts`. */
  competitorAssets?: string[];
};

/** A named vendor dimension — `{id, name}` is the real API's shape for model/topic/region/persona/prompt. */
export type ProfoundDimension = { id: string; name: string | null };

/** One asset x bucket row from `POST /v2/reports/visibility`. */
export type ProfoundVisibilityRow = {
  profoundPromptId: string | null;
  bucketDate: string;
  modelId: string;
  model: string | null;
  topicId: string | null;
  topic: string | null;
  regionId: string | null;
  region: string | null;
  personaId: string | null;
  profoundPersona: string | null;
  asset: string;
  assetOwned: boolean | null;
  rank: number | null;
  visibilityScore: number | null;
  shareOfVoice: number | null;
  averagePosition: number | null;
};

/**
 * One cited-domain x (prompt, date) row from `POST /v2/reports/citations`
 * (default `entity: "domain"`). No model/topic/region/persona fields: the
 * real endpoint rejects any `group_by` wider than one dimension (or
 * topic+model), optionally plus date — verified live 2026-08-10, a request
 * grouped by prompt+date+model+topic+region+persona 422s with "Unsupported
 * group_by combination." `prompt` + `date` is the combination this product
 * needs for per-prompt attribution, so citations are never model-scoped here.
 */
export type ProfoundCitationsRow = {
  profoundPromptId: string | null;
  bucketDate: string;
  domain: string;
  count: number;
  citationShare: number | null;
  rank: number | null;
};

/** One bucket row from `POST /v2/reports/sentiment` — a distinct request/grouping shape from visibility/citations, never joined onto them. */
export type ProfoundSentimentRow = {
  profoundPromptId: string | null;
  asset: string;
  bucketDate: string | null;
  modelId: string | null;
  model: string | null;
  topicId: string | null;
  topic: string | null;
  regionId: string | null;
  region: string | null;
  personaId: string | null;
  profoundPersona: string | null;
  tag: string | null;
  theme: string | null;
  claim: string | null;
  /** Profound's own "run" group_by dimension for sentiment specifically — a real vendor concept, unrelated to the retired per-execution run_id this schema used to invent. */
  profoundRun: string | null;
  competitor: string | null;
  positiveSentiment: number | null;
  negativeSentiment: number | null;
  occurrence: number | null;
  citedWebsites: string[];
  rank: number | null;
};

// ── Account-level reporting (distinct from prompt-scoped §25 reporting) ────

/**
 * Scoped to a category, not to a list of prompts this product deployed — the
 * brand's existing AI-visibility data across everything Profound already
 * tracks for that category, used as an evidence source for persona building
 * rather than for tracking this product's own prompts.
 */
export type ProfoundAccountReportQuery = {
  categoryId: string;
  startDate: string;
  endDate: string;
  /** Required by the real sentiment endpoint; the brand name being analyzed. */
  asset?: string;
};

export type ProfoundAccountVisibilityRow = {
  topic: string;
  date: string;
  visibilityScore: number;
  shareOfVoice: number;
};

export type ProfoundAccountCitationsRow = {
  topic: string;
  date: string;
  citationCount: number;
  citationShare: number | null;
  topDomains: string[];
};

export type ProfoundAccountSentimentRow = {
  topic: string;
  date: string;
  positiveSentiment: number | null;
  negativeSentiment: number | null;
};

/**
 * Everything §19 requires reading back before a deployment can be configured,
 * fetched in one pass and cached on the connection.
 */
export type ProfoundConfiguration = {
  organizations: ProfoundOrganization[];
  categories: ProfoundCategory[];
  regions: ProfoundRegion[];
  models: ProfoundModel[];
  assets: ProfoundAsset[];
  organizationPersonas: ProfoundPersona[];
  topicsByCategory: Record<string, ProfoundTopic[]>;
  tagsByCategory: Record<string, ProfoundTag[]>;
  personasByCategory: Record<string, ProfoundPersona[]>;
};

export interface ProfoundAdapter {
  readonly mode: "mock" | "live";

  /** Cheap authenticated read used by the connection test. */
  getOrganizations(): Promise<ProfoundOrganization[]>;

  getCategories(): Promise<ProfoundCategory[]>;
  getRegions(): Promise<ProfoundRegion[]>;
  getModels(): Promise<ProfoundModel[]>;
  getAssets(): Promise<ProfoundAsset[]>;
  getCategoryTopics(categoryId: string): Promise<ProfoundTopic[]>;
  getCategoryTags(categoryId: string): Promise<ProfoundTag[]>;
  getOrganizationPersonas(organizationId: string): Promise<ProfoundPersona[]>;
  getCategoryPersonas(categoryId: string): Promise<ProfoundPersona[]>;

  /** Paginates internally; returns every prompt in the category. */
  listPrompts(categoryId: string): Promise<ProfoundExistingPrompt[]>;

  /**
   * Creates prompts, or validates them when `dryRun` is true.
   *
   * Throws `DryRunUnsupportedError` if the vendor ignores or rejects the
   * dry-run flag. A vendor that cannot preview must not be deployed to blind.
   */
  createPrompts(request: ProfoundCreateRequest): Promise<ProfoundCreateResponse>;

  // ── Reporting (§25) ────────────────────────────────────────────────────────

  queryVisibility(query: ProfoundResultQuery): Promise<ProfoundVisibilityRow[]>;
  queryCitations(query: ProfoundResultQuery): Promise<ProfoundCitationsRow[]>;
  querySentiment(query: ProfoundResultQuery): Promise<ProfoundSentimentRow[]>;

  // ── Account-level reporting ─────────────────────────────────────────────

  queryAccountVisibility(
    query: ProfoundAccountReportQuery,
  ): Promise<ProfoundAccountVisibilityRow[]>;
  queryAccountCitations(query: ProfoundAccountReportQuery): Promise<ProfoundAccountCitationsRow[]>;
  queryAccountSentiment(query: ProfoundAccountReportQuery): Promise<ProfoundAccountSentimentRow[]>;
}
