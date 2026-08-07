import { createHash } from "node:crypto";
import {
  MOCK_ASSETS,
  MOCK_CATEGORIES,
  MOCK_EXISTING_PROMPTS,
  MOCK_MODELS,
  MOCK_ORGANIZATIONS,
  MOCK_PERSONAS,
  MOCK_REGIONS,
  MOCK_TAGS,
  MOCK_TOPICS,
} from "@fixtures/profound/account";
import { eachDateInRange, generateRun } from "@fixtures/profound/results";
import {
  generateAccountCitations,
  generateAccountSentiment,
  generateAccountVisibility,
} from "@fixtures/profound/account-reports";
import { NotFoundError } from "@/lib/errors";
import { normalizePromptText } from "@/lib/prompt-dedupe";
import type {
  ProfoundAccountCitationsRow,
  ProfoundAccountReportQuery,
  ProfoundAccountSentimentRow,
  ProfoundAccountVisibilityRow,
  ProfoundAdapter,
  ProfoundAnswerRow,
  ProfoundAsset,
  ProfoundCategory,
  ProfoundCitationsRow,
  ProfoundCreateItemResult,
  ProfoundCreateRequest,
  ProfoundCreateResponse,
  ProfoundExistingPrompt,
  ProfoundModel,
  ProfoundOrganization,
  ProfoundPersona,
  ProfoundRegion,
  ProfoundResultQuery,
  ProfoundSentimentRow,
  ProfoundTag,
  ProfoundTopic,
  ProfoundVisibilityRow,
} from "./types";

/**
 * A deterministic emulator of a Profound account, not a canned response.
 *
 * The distinction matters. A fixture that always returns "24 created" would let
 * every guarantee this milestone exists to provide — the dry-run gate,
 * idempotency, duplicate detection, partial-failure retry — pass without ever
 * being exercised. So this mock behaves like an account instead:
 *
 * - A prompt id is derived from `(categoryId, normalized text)`, so creating the
 *   same prompt twice returns the *same* id. That is what makes ADR-007's
 *   idempotency claim testable rather than assumed.
 * - A prompt whose normalized text already exists in the account comes back as
 *   `duplicate`, with the id of the prompt that is already there.
 * - Over-long prompts fail validation permanently; a deterministic slice of
 *   prompts fails *transiently* on first write and succeeds on retry, which is
 *   the only way the failed-only retry path can be demonstrated end to end.
 *
 * The transient-failure ledger is the one piece of mutable state here. It is
 * per-process and resettable, because a flaky vendor cannot be modelled by a
 * pure function.
 */

/** Client references that have already suffered their one transient failure. */
const transientFailuresServed = new Set<string>();

/**
 * Prompts simulated as "manually uploaded" into the mock account, keyed by
 * category id.
 *
 * There is no automated push adapter call in the app anymore (§ export-only,
 * ADR replacing the old deploy pipeline) — the real flow is a human pasting
 * an export into Profound's own UI. A demo or test that wants reconciliation
 * to find something therefore has to model that upload having happened, the
 * same way `MOCK_EXISTING_PROMPTS` models prompts that were already in the
 * account before this product ever touched it. `seedMockProfoundUpload` is
 * that hook — used only by `src/seed/run.ts` and integration tests.
 */
const uploadedPrompts = new Map<string, ProfoundExistingPrompt[]>();

/** Tests reset between cases so the flake is reproducible rather than sticky. */
export function resetMockProfoundState(): void {
  transientFailuresServed.clear();
  uploadedPrompts.clear();
}

export function seedMockProfoundUpload(
  categoryId: string,
  prompts: ProfoundExistingPrompt[],
): void {
  const existing = uploadedPrompts.get(categoryId) ?? [];
  uploadedPrompts.set(categoryId, [...existing, ...prompts]);
}

/** Longer than any real question; a stand-in for the vendor's own limit. */
const MAX_PROMPT_LENGTH = 400;

export class MockProfoundAdapter implements ProfoundAdapter {
  readonly mode = "mock" as const;

  async getOrganizations(): Promise<ProfoundOrganization[]> {
    return [...MOCK_ORGANIZATIONS];
  }

  async getCategories(): Promise<ProfoundCategory[]> {
    return [...MOCK_CATEGORIES];
  }

  async getRegions(): Promise<ProfoundRegion[]> {
    return [...MOCK_REGIONS];
  }

  async getModels(): Promise<ProfoundModel[]> {
    return [...MOCK_MODELS];
  }

  async getAssets(): Promise<ProfoundAsset[]> {
    return [...MOCK_ASSETS];
  }

  async getCategoryTopics(categoryId: string): Promise<ProfoundTopic[]> {
    this.requireCategory(categoryId);
    return MOCK_TOPICS.filter((topic) => topic.categoryId === categoryId);
  }

  async getCategoryTags(categoryId: string): Promise<ProfoundTag[]> {
    this.requireCategory(categoryId);
    return [...(MOCK_TAGS[categoryId] ?? [])];
  }

  async getOrganizationPersonas(organizationId: string): Promise<ProfoundPersona[]> {
    if (!MOCK_ORGANIZATIONS.some((org) => org.id === organizationId)) {
      throw new NotFoundError("Profound organization");
    }
    return [...MOCK_PERSONAS];
  }

  async getCategoryPersonas(categoryId: string): Promise<ProfoundPersona[]> {
    this.requireCategory(categoryId);
    return MOCK_PERSONAS.filter((persona) => persona.categoryId === categoryId);
  }

  async listPrompts(categoryId: string): Promise<ProfoundExistingPrompt[]> {
    this.requireCategory(categoryId);
    // Only the product-analytics category has a prompt history in this account.
    const fixture = categoryId === "pfc_product_analytics" ? [...MOCK_EXISTING_PROMPTS] : [];
    return [...fixture, ...(uploadedPrompts.get(categoryId) ?? [])];
  }

  async createPrompts(request: ProfoundCreateRequest): Promise<ProfoundCreateResponse> {
    this.requireCategory(request.categoryId);

    const existingByHash = new Map(
      (await this.listPrompts(request.categoryId)).map((prompt) => [
        hashText(prompt.text),
        prompt.id,
      ]),
    );

    const items: ProfoundCreateItemResult[] = request.prompts.map((prompt) => {
      const normalizedHash = hashText(prompt.prompt_text);

      const existingId = existingByHash.get(normalizedHash);
      if (existingId) {
        return {
          clientReference: prompt.client_reference,
          outcome: "duplicate" as const,
          profoundPromptId: existingId,
        };
      }

      if (prompt.prompt_text.length > MAX_PROMPT_LENGTH) {
        return {
          clientReference: prompt.client_reference,
          outcome: "failed" as const,
          profoundPromptId: null,
          errorCode: "prompt_too_long",
          errorMessage: `Prompt text is ${prompt.prompt_text.length} characters; the limit is ${MAX_PROMPT_LENGTH}.`,
          retryable: false,
        };
      }

      // A dry run validates; it does not attempt a write, so a transient write
      // failure cannot occur here. That is deliberate: a clean dry run is not a
      // promise that every create will succeed, and the deployment path has to
      // handle partial failure even after one.
      if (request.dryRun) {
        return {
          clientReference: prompt.client_reference,
          outcome: "validated" as const,
          profoundPromptId: null,
        };
      }

      if (isTransientlyFlaky(normalizedHash) && !transientFailuresServed.has(normalizedHash)) {
        transientFailuresServed.add(normalizedHash);
        return {
          clientReference: prompt.client_reference,
          outcome: "failed" as const,
          profoundPromptId: null,
          errorCode: "upstream_unavailable",
          errorMessage: "The prompt service was briefly unavailable. Retry this prompt.",
          retryable: true,
        };
      }

      return {
        clientReference: prompt.client_reference,
        outcome: "created" as const,
        profoundPromptId: mockPromptId(request.categoryId, normalizedHash),
      };
    });

    return {
      dryRun: request.dryRun,
      items,
      raw: {
        mock: true,
        category_id: request.categoryId,
        dry_run: request.dryRun,
        results: items.map((item) => ({
          client_reference: item.clientReference,
          status: item.outcome,
          prompt_id: item.profoundPromptId,
          error_code: item.errorCode ?? null,
        })),
      },
    };
  }

  async queryVisibility(query: ProfoundResultQuery): Promise<ProfoundVisibilityRow[]> {
    const rows: ProfoundVisibilityRow[] = [];
    for (const profoundPromptId of query.profoundPromptIds) {
      for (const modelId of query.modelIds) {
        for (const date of eachDateInRange(query.startDate, query.endDate)) {
          const run = generateRun(profoundPromptId, modelId, date);
          rows.push({
            profoundPromptId: run.profoundPromptId,
            runId: run.runId,
            runDate: run.date,
            modelId: run.modelId,
            model: MOCK_MODELS.find((m) => m.id === modelId)?.name ?? modelId,
            region: null,
            asset: null,
            topic: null,
            profoundPersona: null,
            tags: [],
            visibilityScore: run.visibilityScore,
            shareOfVoice: run.shareOfVoice,
            mentionCount: run.mentionCount,
            executions: run.executions,
            averagePosition: run.averagePosition,
            brandMentioned: run.brandMentioned,
            mentions: run.mentions,
          });
        }
      }
    }
    return rows;
  }

  async queryCitations(query: ProfoundResultQuery): Promise<ProfoundCitationsRow[]> {
    const rows: ProfoundCitationsRow[] = [];
    for (const profoundPromptId of query.profoundPromptIds) {
      for (const modelId of query.modelIds) {
        for (const date of eachDateInRange(query.startDate, query.endDate)) {
          const run = generateRun(profoundPromptId, modelId, date);
          rows.push({
            profoundPromptId: run.profoundPromptId,
            runId: run.runId,
            modelId: run.modelId,
            citationCount: run.citationCount,
            citationShare: run.citationShare,
            citations: run.citations,
            searchQueries: run.searchQueries,
          });
        }
      }
    }
    return rows;
  }

  async querySentiment(query: ProfoundResultQuery): Promise<ProfoundSentimentRow[]> {
    const rows: ProfoundSentimentRow[] = [];
    for (const profoundPromptId of query.profoundPromptIds) {
      for (const modelId of query.modelIds) {
        for (const date of eachDateInRange(query.startDate, query.endDate)) {
          const run = generateRun(profoundPromptId, modelId, date);
          rows.push({
            profoundPromptId: run.profoundPromptId,
            runId: run.runId,
            modelId: run.modelId,
            sentimentThemes: run.sentimentThemes,
          });
        }
      }
    }
    return rows;
  }

  async getPromptAnswers(
    profoundPromptId: string,
    range: { startDate: string; endDate: string },
  ): Promise<ProfoundAnswerRow[]> {
    const rows: ProfoundAnswerRow[] = [];
    for (const model of MOCK_MODELS) {
      for (const date of eachDateInRange(range.startDate, range.endDate)) {
        const run = generateRun(profoundPromptId, model.id, date);
        rows.push({
          profoundPromptId: run.profoundPromptId,
          runId: run.runId,
          modelId: run.modelId,
          rawAnswer: run.rawAnswer,
        });
      }
    }
    return rows;
  }

  async queryAccountVisibility(
    query: ProfoundAccountReportQuery,
  ): Promise<ProfoundAccountVisibilityRow[]> {
    this.requireCategory(query.categoryId);
    const topics = MOCK_TOPICS.filter((topic) => topic.categoryId === query.categoryId);
    const rows: ProfoundAccountVisibilityRow[] = [];
    for (const topic of topics) {
      for (const date of eachDateInRange(query.startDate, query.endDate)) {
        rows.push(generateAccountVisibility(topic.name, date));
      }
    }
    return rows;
  }

  async queryAccountCitations(
    query: ProfoundAccountReportQuery,
  ): Promise<ProfoundAccountCitationsRow[]> {
    this.requireCategory(query.categoryId);
    const topics = MOCK_TOPICS.filter((topic) => topic.categoryId === query.categoryId);
    const rows: ProfoundAccountCitationsRow[] = [];
    for (const topic of topics) {
      for (const date of eachDateInRange(query.startDate, query.endDate)) {
        rows.push(generateAccountCitations(topic.name, date));
      }
    }
    return rows;
  }

  async queryAccountSentiment(
    query: ProfoundAccountReportQuery,
  ): Promise<ProfoundAccountSentimentRow[]> {
    this.requireCategory(query.categoryId);
    const topics = MOCK_TOPICS.filter((topic) => topic.categoryId === query.categoryId);
    const rows: ProfoundAccountSentimentRow[] = [];
    for (const topic of topics) {
      for (const date of eachDateInRange(query.startDate, query.endDate)) {
        rows.push(generateAccountSentiment(topic.name, date));
      }
    }
    return rows;
  }

  private requireCategory(categoryId: string): void {
    if (!MOCK_CATEGORIES.some((category) => category.id === categoryId)) {
      throw new NotFoundError("Profound category");
    }
  }
}

function hashText(text: string): string {
  return createHash("sha256").update(normalizePromptText(text), "utf8").digest("hex");
}

/**
 * The same prompt in the same category always gets the same id.
 *
 * A real API deduplicates server-side; modelling that here is what lets the
 * idempotency test assert that a re-run produces no second Profound prompt,
 * rather than only that this product declined to send one.
 */
export function mockPromptId(categoryId: string, normalizedHash: string): string {
  const digest = createHash("sha256")
    .update(`${categoryId}:${normalizedHash}`, "utf8")
    .digest("hex")
    .slice(0, 16);
  return `pfp_${digest}`;
}

/** One prompt in eight fails its first write attempt, keyed on its own text. */
function isTransientlyFlaky(normalizedHash: string): boolean {
  return parseInt(normalizedHash.slice(0, 2), 16) % 8 === 0;
}
