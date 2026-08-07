/**
 * The Profound boundary (§19–§24).
 *
 * Profound is the system of record for prompt execution and AI visibility. This
 * product never executes a prompt itself and never invents a Profound concept:
 * every category, region, model, topic, tag, asset and persona below is read
 * back from the vendor, and anything the vendor does not offer is exposed as
 * absent rather than synthesised.
 *
 * Two absences are deliberate and load-bearing:
 *
 * - **There is no `createPersona`.** The specification forbids assuming Profound
 *   supports persona creation. When no Profound persona matches, the mapping
 *   falls back to the deterministic `persona:<slug>` tag (§20) — visibly, with
 *   the mapping recorded as `tag_fallback`, never silently.
 * - **Reporting is four narrow reads, not one.** Visibility, citations,
 *   sentiment and raw answers (§25) are separate vendor calls, each keyed by
 *   `(profoundPromptId, runId, modelId)`. This product merges them into one
 *   immutable snapshot row itself — classification (brand-absent,
 *   competitor-dominated, missing expected elements) is computed by the
 *   application from the merged row, never taken from a single vendor call.
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
  profoundPromptIds: string[];
  modelIds: string[];
  startDate: string;
  endDate: string;
};

/** One competitor's (or the account's own) share within a single run. */
export type ProfoundMentionRow = {
  entity: string;
  mentionCount: number;
  share: number;
};

export type ProfoundVisibilityRow = {
  profoundPromptId: string;
  runId: string;
  runDate: string;
  modelId: string;
  model: string | null;
  region: string | null;
  asset: string | null;
  topic: string | null;
  profoundPersona: string | null;
  tags: string[];
  visibilityScore: number | null;
  /** The brand's own share of voice for this run — not a competitor's. */
  shareOfVoice: number | null;
  mentionCount: number;
  executions: number;
  averagePosition: number | null;
  brandMentioned: boolean;
  /** Other entities mentioned in the same run, for competitor-dominance checks. */
  mentions: ProfoundMentionRow[];
};

export type ProfoundCitationsRow = {
  profoundPromptId: string;
  runId: string;
  modelId: string;
  citationCount: number;
  citationShare: number | null;
  citations: Record<string, unknown>[];
  searchQueries: string[];
};

export type ProfoundSentimentRow = {
  profoundPromptId: string;
  runId: string;
  modelId: string;
  sentimentThemes: Record<string, unknown>[];
};

export type ProfoundAnswerRow = {
  profoundPromptId: string;
  runId: string;
  modelId: string;
  rawAnswer: string;
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
};

export type ProfoundAccountVisibilityRow = {
  topic: string;
  date: string;
  visibilityScore: number;
  shareOfVoice: number;
  mentionCount: number;
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
  sentimentThemes: { theme: string; sentiment: "positive" | "neutral" | "negative" }[];
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

  /** One prompt at a time, per the documented endpoint shape. */
  getPromptAnswers(
    profoundPromptId: string,
    range: { startDate: string; endDate: string },
  ): Promise<ProfoundAnswerRow[]>;

  // ── Account-level reporting ─────────────────────────────────────────────

  queryAccountVisibility(
    query: ProfoundAccountReportQuery,
  ): Promise<ProfoundAccountVisibilityRow[]>;
  queryAccountCitations(query: ProfoundAccountReportQuery): Promise<ProfoundAccountCitationsRow[]>;
  queryAccountSentiment(query: ProfoundAccountReportQuery): Promise<ProfoundAccountSentimentRow[]>;
}
