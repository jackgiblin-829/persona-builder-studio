import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { db } from "@/db/client";
import {
  profoundPromptLinks,
  promptEmbeddings,
  promptSets,
  promptSetVersions,
  prompts,
} from "@/db/schema";
import { getOpenAIAdapter } from "@/adapters/openai";
import { getProfoundAdapter } from "@/adapters/profound";
import type { ProfoundExistingPrompt } from "@/adapters/profound/types";
import { requireCapability, type BrandContext } from "@/lib/auth/context";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { newId, ID_PREFIXES } from "@/lib/ids";
import { stableHash } from "@/lib/crypto";
import { findDuplicate, promptHash, type DuplicateCandidate } from "@/lib/prompt-dedupe";
import { recordAudit } from "./audit";
import { getCategoryMapping } from "./profound-mapping";
import { withVendorUsage } from "./usage";

/**
 * Reconciliation: link this tool's approved prompts to Profound's own prompt
 * records after they were uploaded manually, instead of via an automated
 * push (§ replaces milestone 5's deploy pipeline).
 *
 * Matching runs in the same order of certainty `profound-deploy.ts` used for
 * its pre-write duplicate check — hash first, then semantic/lexical via
 * `findDuplicate` — because that check already solved "is this prompt of
 * ours already in the account," and reconciliation is that exact question
 * asked after the fact instead of before a write.
 *
 * - `exact` (normalized-hash match) and `semantic` (embedding cosine ≥ 0.92)
 *   are certain enough to link automatically.
 * - `lexical` (Jaccard ≥ 0.8, no embedding match) is corroborating but not
 *   certain — surfaced as ambiguous for a manual decision.
 * - No finding at all is unmatched — most likely not uploaded yet.
 */

export type ReconcileRow = {
  promptId: string;
  promptText: string;
  promptType: "persona" | "generic_control";
  status: "already_linked" | "matched" | "ambiguous" | "unmatched";
  profoundPromptId: string | null;
  matchKind: "hash" | "semantic" | "lexical" | null;
  score: number | null;
};

export type ReconcileSummary = {
  alreadyLinked: number;
  matched: number;
  ambiguous: number;
  unmatched: number;
  rows: ReconcileRow[];
};

export async function reconcilePromptSetVersion(
  ctx: BrandContext,
  promptSetVersionId: string,
): Promise<ReconcileSummary> {
  requireCapability(ctx, "profound:configure");

  await assertApprovedSet(ctx, promptSetVersionId);
  const category = await getCategoryMapping(ctx);
  if (!category || category.status === "invalid") {
    throw new ValidationError("Map this brand to a valid Profound category before reconciling.");
  }

  const approvedPrompts = await loadApprovedPromptsWithLinks(
    promptSetVersionId,
    category.profoundCategoryId,
  );
  if (approvedPrompts.length === 0) {
    throw new ValidationError("This prompt-set version has no approved prompts to reconcile.");
  }

  const { adapter, mode } = await getProfoundAdapter(ctx.organizationId);
  const accountPrompts: ProfoundExistingPrompt[] = await withVendorUsage(
    {
      organizationId: ctx.organizationId,
      brandId: ctx.brandId,
      vendor: "profound",
      operation: "listPrompts",
      mode,
    },
    () => adapter.listPrompts(category.profoundCategoryId),
  );

  const semanticCandidates = await embedAccountPrompts(ctx, accountPrompts, approvedPrompts);

  const rows: ReconcileRow[] = [];
  let matched = 0;
  let alreadyLinked = 0;
  let ambiguous = 0;
  let unmatched = 0;

  for (const prompt of approvedPrompts) {
    if (prompt.linkedProfoundPromptId) {
      rows.push({
        promptId: prompt.promptId,
        promptText: prompt.promptText,
        promptType: prompt.promptType,
        status: "already_linked",
        profoundPromptId: prompt.linkedProfoundPromptId,
        matchKind: null,
        score: null,
      });
      alreadyLinked++;
      continue;
    }

    const finding = findDuplicate(
      { promptId: prompt.promptId, promptText: prompt.promptText, embedding: prompt.embedding },
      semanticCandidates,
    );

    if (finding && (finding.kind === "exact" || finding.kind === "semantic")) {
      await linkPrompt(ctx, {
        promptId: prompt.promptId,
        promptSetVersionId,
        profoundCategoryId: category.profoundCategoryId,
        profoundPromptId: finding.promptId,
        normalizedHash: prompt.normalizedHash,
        dataOrigin: mode,
        matchKind: finding.kind === "exact" ? "hash" : "semantic",
      });
      rows.push({
        promptId: prompt.promptId,
        promptText: prompt.promptText,
        promptType: prompt.promptType,
        status: "matched",
        profoundPromptId: finding.promptId,
        matchKind: finding.kind === "exact" ? "hash" : "semantic",
        score: finding.score,
      });
      matched++;
    } else if (finding && finding.kind === "lexical") {
      rows.push({
        promptId: prompt.promptId,
        promptText: prompt.promptText,
        promptType: prompt.promptType,
        status: "ambiguous",
        profoundPromptId: finding.promptId,
        matchKind: "lexical",
        score: finding.score,
      });
      ambiguous++;
    } else {
      rows.push({
        promptId: prompt.promptId,
        promptText: prompt.promptText,
        promptType: prompt.promptType,
        status: "unmatched",
        profoundPromptId: null,
        matchKind: null,
        score: null,
      });
      unmatched++;
    }
  }

  await recordAudit({
    organizationId: ctx.organizationId,
    brandId: ctx.brandId,
    actorUserId: ctx.userId,
    action: "profound.reconcile",
    entityType: "prompt_set_version",
    entityId: promptSetVersionId,
    metadata: {
      alreadyLinked,
      matched,
      ambiguous,
      unmatched,
      profoundCategoryId: category.profoundCategoryId,
    },
  });

  return { alreadyLinked, matched, ambiguous, unmatched, rows };
}

/** Manual fallback for a prompt that didn't auto-match — an explicit human decision, not a guess. */
export async function linkPromptManually(
  ctx: BrandContext,
  input: { promptId: string; promptSetVersionId: string; profoundPromptId: string },
): Promise<void> {
  requireCapability(ctx, "profound:configure");

  const category = await getCategoryMapping(ctx);
  if (!category) throw new ValidationError("Map this brand to a Profound category first.");

  const [prompt] = await db
    .select({ promptText: prompts.promptText })
    .from(prompts)
    .where(
      and(
        eq(prompts.id, input.promptId),
        eq(prompts.organizationId, ctx.organizationId),
        eq(prompts.brandId, ctx.brandId),
      ),
    )
    .limit(1);
  if (!prompt) throw new NotFoundError("Prompt");

  await linkPrompt(ctx, {
    promptId: input.promptId,
    promptSetVersionId: input.promptSetVersionId,
    profoundCategoryId: category.profoundCategoryId,
    profoundPromptId: input.profoundPromptId,
    normalizedHash: promptHash(prompt.promptText),
    dataOrigin: "local",
    matchKind: "manual",
  });

  await recordAudit({
    organizationId: ctx.organizationId,
    brandId: ctx.brandId,
    actorUserId: ctx.userId,
    action: "profound.link_manual",
    entityType: "prompt",
    entityId: input.promptId,
    metadata: { profoundPromptId: input.profoundPromptId },
  });
}

export type ReconciliationStatusRow = {
  promptId: string;
  promptText: string;
  promptType: "persona" | "generic_control";
  linked: boolean;
  profoundPromptId: string | null;
};

/** Current link status for a prompt-set version, read-only — no vendor call. */
export async function getReconciliationStatus(
  ctx: BrandContext,
  promptSetVersionId: string,
): Promise<ReconciliationStatusRow[]> {
  const rows = await db
    .select({
      promptId: prompts.id,
      promptText: prompts.promptText,
      promptType: prompts.promptType,
      profoundPromptId: profoundPromptLinks.profoundPromptId,
    })
    .from(prompts)
    .leftJoin(
      profoundPromptLinks,
      and(
        eq(profoundPromptLinks.promptId, prompts.id),
        eq(profoundPromptLinks.brandId, ctx.brandId),
      ),
    )
    .where(
      and(
        eq(prompts.promptSetVersionId, promptSetVersionId),
        eq(prompts.organizationId, ctx.organizationId),
        eq(prompts.brandId, ctx.brandId),
        eq(prompts.reviewStatus, "approved"),
      ),
    )
    .orderBy(asc(prompts.id));

  return rows.map((row) => ({
    promptId: row.promptId,
    promptText: row.promptText,
    promptType: row.promptType,
    linked: row.profoundPromptId !== null,
    profoundPromptId: row.profoundPromptId,
  }));
}

// ── Helpers ─────────────────────────────────────────────────────────────────

async function linkPrompt(
  ctx: BrandContext,
  input: {
    promptId: string;
    promptSetVersionId: string;
    profoundCategoryId: string;
    profoundPromptId: string;
    normalizedHash: string;
    dataOrigin: "mock" | "live" | "local";
    matchKind: "hash" | "semantic" | "manual";
  },
): Promise<void> {
  await db
    .insert(profoundPromptLinks)
    .values({
      id: newId(ID_PREFIXES.profoundPromptLink),
      organizationId: ctx.organizationId,
      brandId: ctx.brandId,
      promptId: input.promptId,
      promptSetVersionId: input.promptSetVersionId,
      profoundCategoryId: input.profoundCategoryId,
      profoundPromptId: input.profoundPromptId,
      normalizedHash: input.normalizedHash,
      requestHash: stableHash({
        method: "reconcile",
        matchKind: input.matchKind,
        promptId: input.promptId,
      }),
      syncJobId: null,
      dataOrigin: input.dataOrigin,
    })
    .onConflictDoNothing({
      target: [
        profoundPromptLinks.organizationId,
        profoundPromptLinks.profoundCategoryId,
        profoundPromptLinks.normalizedHash,
      ],
    });
}

type LoadedApprovedPrompt = {
  promptId: string;
  promptType: "persona" | "generic_control";
  promptText: string;
  normalizedHash: string;
  embedding: number[] | null;
  embeddingModelId: string | null;
  linkedProfoundPromptId: string | null;
};

async function loadApprovedPromptsWithLinks(
  promptSetVersionId: string,
  profoundCategoryId: string,
): Promise<LoadedApprovedPrompt[]> {
  const rows = await db
    .select({
      promptId: prompts.id,
      promptType: prompts.promptType,
      promptText: prompts.promptText,
      normalizedHash: prompts.normalizedHash,
      embedding: promptEmbeddings.embedding,
      embeddingModelId: promptEmbeddings.modelId,
      linkedProfoundPromptId: profoundPromptLinks.profoundPromptId,
    })
    .from(prompts)
    .leftJoin(promptEmbeddings, eq(promptEmbeddings.promptId, prompts.id))
    .leftJoin(
      profoundPromptLinks,
      and(
        eq(profoundPromptLinks.promptId, prompts.id),
        eq(profoundPromptLinks.profoundCategoryId, profoundCategoryId),
      ),
    )
    .where(
      and(eq(prompts.promptSetVersionId, promptSetVersionId), eq(prompts.reviewStatus, "approved")),
    )
    .orderBy(asc(prompts.id));

  return rows;
}

async function assertApprovedSet(ctx: BrandContext, promptSetVersionId: string): Promise<void> {
  const [row] = await db
    .select({ status: promptSetVersions.status })
    .from(promptSetVersions)
    .innerJoin(promptSets, eq(promptSets.id, promptSetVersions.promptSetId))
    .where(
      and(
        eq(promptSetVersions.id, promptSetVersionId),
        eq(promptSetVersions.organizationId, ctx.organizationId),
        eq(promptSetVersions.brandId, ctx.brandId),
      ),
    )
    .limit(1);

  if (!row) throw new NotFoundError("Prompt-set version");
  if (row.status !== "approved") {
    throw new ValidationError("Only an approved prompt-set version can be reconciled.");
  }
}

async function embedAccountPrompts(
  ctx: BrandContext,
  accountPrompts: ProfoundExistingPrompt[],
  approvedPrompts: LoadedApprovedPrompt[],
): Promise<DuplicateCandidate[]> {
  if (accountPrompts.length === 0) return [];

  const base: DuplicateCandidate[] = accountPrompts.map((prompt) => ({
    promptId: prompt.id,
    promptText: prompt.text,
    normalizedHash: promptHash(prompt.text),
  }));

  const ourModelId = approvedPrompts.find((p) => p.embeddingModelId)?.embeddingModelId ?? null;
  if (!ourModelId) return base;

  const { adapter, mode } = await getOpenAIAdapter(ctx.organizationId);

  // A failed embedding weakens semantic matching but must not block
  // reconciliation: hash matching is unaffected.
  const result = await withVendorUsage(
    {
      organizationId: ctx.organizationId,
      brandId: ctx.brandId,
      vendor: "openai",
      operation: "embed_profound_prompts",
      mode,
    },
    () => adapter.embed({ texts: accountPrompts.map((p) => p.text) }),
    (embedResult) => ({ tokensIn: embedResult.tokensIn, costCents: embedResult.costCents }),
    { swallow: true },
  );

  if (!result || result.modelId !== ourModelId) return base;
  return base.map((candidate, index) => ({
    ...candidate,
    embedding: result.embeddings[index] ?? null,
  }));
}
