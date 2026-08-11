import "server-only";
import { and, asc, count, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { getObjectStorage } from "@/adapters/storage";
import { db } from "@/db/client";
import {
  dataSources,
  generatedPrompts,
  generationRuns,
  jobs,
  marketResearchBriefs,
  personas,
  personaVersions,
  projects,
  promptSets,
  researchSignals,
} from "@/db/schema";
import { defaultPromptStrategy } from "@/contracts/prompt-strategy";
import type { PromptStrategy } from "@/contracts/prompt-strategy";
import { requireCapability, type ProjectContext, type ScopeContext } from "@/lib/auth/context";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { ID_PREFIXES, newId, slugify } from "@/lib/ids";
import { logger } from "@/lib/logger";
import { can, type Role } from "@/lib/auth/rbac";
import { recordAudit } from "./audit";

const DOMAIN_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/i;

function normalizeDomain(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//i, "")
    .replace(/^www\./, "")
    .split(/[/?#]/)[0]!
    .replace(/:\d+$/, "");
}

export const projectInputSchema = z.object({
  name: z.string().trim().min(2, "Project name is required").max(120),
  canonicalDomain: z
    .string()
    .transform(normalizeDomain)
    .pipe(z.string().min(3).max(253).regex(DOMAIN_PATTERN, "Enter a valid domain")),
  description: z.string().trim().min(10, "Describe the product or service").max(4000),
  primaryMarket: z.enum(["US", "CA", "UK"]),
  languageLocale: z.enum(["en-US", "en-CA", "en-GB", "fr-CA"]),
});
export type ProjectInput = z.infer<typeof projectInputSchema>;

const strategyLineList = z
  .string()
  .max(8000)
  .transform((value) =>
    [
      ...new Set(
        value
          .split(/\n+/)
          .map((item) => item.trim())
          .filter(Boolean),
      ),
    ].slice(0, 40),
  )
  .refine(
    (items) => items.every((item) => item.length <= 200),
    "Keep each line under 200 characters.",
  );

export const promptStrategyInputSchema = z
  .object({
    canonicalBrand: z.string().trim().min(2).max(160),
    parentCompany: z.string().trim().max(160),
    aliases: strategyLineList,
    entityCollisions: strategyLineList,
    categoryTerms: strategyLineList.refine((items) => items.length > 0, "Add a category term."),
    businessLines: strategyLineList.refine((items) => items.length > 0, "Add a business line."),
    competitors: strategyLineList,
    buyerQualifiers: strategyLineList,
    freshnessFacts: strategyLineList,
    pathwaysPerPersona: z.coerce.number().int().min(1).max(10),
    awarenessTarget: z.coerce.number().int().min(0).max(100),
    considerationTarget: z.coerce.number().int().min(0).max(100),
    decisionTarget: z.coerce.number().int().min(0).max(100),
  })
  .superRefine((input, ctx) => {
    const total = input.awarenessTarget + input.considerationTarget + input.decisionTarget;
    if (total < 12 || total > 100) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["awarenessTarget"],
        message: "Generate between 12 and 100 prompts per persona.",
      });
    }
    if (input.decisionTarget < input.pathwaysPerPersona) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["decisionTarget"],
        message: "Create at least one bottom-of-funnel anchor for every pathway.",
      });
    }
    if (input.considerationTarget < input.decisionTarget) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["considerationTarget"],
        message: "Middle-of-funnel prompts must equal or exceed bottom-of-funnel anchors.",
      });
    }
    if (input.awarenessTarget < input.considerationTarget) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["awarenessTarget"],
        message: "Top-of-funnel prompts must equal or exceed middle-of-funnel prompts.",
      });
    }
  });

export type PromptStrategyInput = z.infer<typeof promptStrategyInputSchema>;

function strategyFromInput(input: PromptStrategyInput): PromptStrategy {
  const funnelTargets = {
    awareness: input.awarenessTarget,
    consideration: input.considerationTarget,
    decision: input.decisionTarget,
  };
  return {
    canonicalBrand: input.canonicalBrand,
    parentCompany: input.parentCompany,
    aliases: input.aliases,
    entityCollisions: input.entityCollisions,
    categoryTerms: input.categoryTerms,
    businessLines: input.businessLines,
    competitors: input.competitors,
    buyerQualifiers: input.buyerQualifiers,
    freshnessFacts: input.freshnessFacts,
    pathwaysPerPersona: input.pathwaysPerPersona,
    targetPromptCount: Object.values(funnelTargets).reduce((sum, count) => sum + count, 0),
    funnelTargets,
  };
}

export function proposeAudienceDescription(input: ProjectInput): string {
  const market = { US: "the United States", CA: "Canada", UK: "the United Kingdom" }[
    input.primaryMarket
  ];
  return `People in ${market} who evaluate, recommend, buy, or use ${input.description.replace(/[.!?]+$/, "").toLowerCase()} from ${input.canonicalDomain}`;
}

async function uniqueProjectSlug(organizationId: string, name: string) {
  const base = slugify(name);
  for (let suffix = 0; suffix < 50; suffix++) {
    const candidate = suffix === 0 ? base : `${base}-${suffix + 1}`;
    const [existing] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.organizationId, organizationId), eq(projects.slug, candidate)))
      .limit(1);
    if (!existing) return candidate;
  }
  throw new ValidationError("Could not create a unique project URL.");
}

export async function createProject(ctx: ScopeContext, input: ProjectInput) {
  requireCapability(ctx, "project:write");
  const [project] = await db
    .insert(projects)
    .values({
      id: newId(ID_PREFIXES.project),
      organizationId: ctx.organizationId,
      name: input.name,
      slug: await uniqueProjectSlug(ctx.organizationId, input.name),
      canonicalDomain: input.canonicalDomain,
      description: input.description,
      primaryMarket: input.primaryMarket,
      languageLocale: input.languageLocale,
      sparktoroAudienceDescription: proposeAudienceDescription(input),
      promptStrategy: defaultPromptStrategy(input.name, input.description),
      createdByUserId: ctx.userId,
    })
    .returning();
  if (!project) throw new ValidationError("Could not create the project.");
  await recordAudit({
    organizationId: ctx.organizationId,
    projectId: project.id,
    actorUserId: ctx.userId,
    action: "project.create",
    entityType: "project",
    entityId: project.id,
  });
  return project;
}

export async function listProjectsForSession(
  organizations: { organizationId: string; organizationName: string; role?: Role }[],
) {
  const organizationIds = organizations.map((item) => item.organizationId);
  if (!organizationIds.length) return [];
  const rows = await db
    .select()
    .from(projects)
    .where(inArray(projects.organizationId, organizationIds))
    .orderBy(asc(projects.name));

  return Promise.all(
    rows.map(async (project) => {
      const [sourceRows, personaRows, promptRows, latestRun] = await Promise.all([
        db
          .select({ value: count() })
          .from(dataSources)
          .where(eq(dataSources.projectId, project.id)),
        db
          .select({ value: count() })
          .from(personas)
          .where(and(eq(personas.projectId, project.id), isNull(personas.archivedAt))),
        db
          .select({ value: count() })
          .from(generatedPrompts)
          .where(eq(generatedPrompts.projectId, project.id)),
        db
          .select()
          .from(generationRuns)
          .where(eq(generationRuns.projectId, project.id))
          .orderBy(desc(generationRuns.createdAt))
          .limit(1),
      ]);
      const organization = organizations.find(
        (item) => item.organizationId === project.organizationId,
      );
      return {
        ...project,
        organizationName: organization?.organizationName ?? "Organization",
        canDelete: can(organization?.role ?? "viewer", "project:delete"),
        sourceCount: sourceRows[0]?.value ?? 0,
        personaCount: personaRows[0]?.value ?? 0,
        promptCount: promptRows[0]?.value ?? 0,
        latestRun: latestRun[0] ?? null,
      };
    }),
  );
}

export async function getProject(ctx: ProjectContext) {
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, ctx.projectId), eq(projects.organizationId, ctx.organizationId)))
    .limit(1);
  if (!project) throw new NotFoundError("Project");
  return project;
}

export async function deleteProject(ctx: ProjectContext) {
  requireCapability(ctx, "project:delete");

  const sourceRows = await db
    .select({ storageKey: dataSources.storageKey })
    .from(dataSources)
    .where(
      and(
        eq(dataSources.projectId, ctx.projectId),
        eq(dataSources.organizationId, ctx.organizationId),
      ),
    );
  const storageKeys = sourceRows.flatMap((row) => (row.storageKey ? [row.storageKey] : []));

  await db.transaction(async (tx) => {
    // Jobs are intentionally not foreign-keyed so workers can finish their
    // current claim. Remove queued work before deleting the project itself.
    await tx.delete(jobs).where(eq(jobs.projectId, ctx.projectId));
    const deleted = await tx
      .delete(projects)
      .where(and(eq(projects.id, ctx.projectId), eq(projects.organizationId, ctx.organizationId)))
      .returning({ id: projects.id });
    if (!deleted.length) throw new NotFoundError("Project");

    // Project-scoped audit rows cascade with the project, so retain the event
    // as an organization-level record with the deleted project ID in metadata.
    await recordAudit(
      {
        organizationId: ctx.organizationId,
        projectId: null,
        actorUserId: ctx.userId,
        action: "project.delete",
        entityType: "project",
        entityId: ctx.projectId,
        metadata: { projectName: ctx.projectName },
      },
      tx,
    );
  });

  if (storageKeys.length) {
    const results = await Promise.allSettled(
      storageKeys.map((storageKey) => getObjectStorage().delete(storageKey)),
    );
    const failedCount = results.filter((result) => result.status === "rejected").length;
    if (failedCount) {
      logger.warn(
        { organizationId: ctx.organizationId, projectId: ctx.projectId, failedCount },
        "project storage cleanup incomplete after deletion",
      );
    }
  }
}

export async function updateAudienceDescription(ctx: ProjectContext, description: string) {
  requireCapability(ctx, "project:write");
  const value = description.trim();
  if (value.length < 20 || value.length > 1200) {
    throw new ValidationError("Describe the audience in 20–1,200 characters.");
  }
  await db
    .update(projects)
    .set({
      sparktoroAudienceDescription: value,
      audienceDescriptionEdited: true,
      updatedAt: new Date(),
    })
    .where(and(eq(projects.id, ctx.projectId), eq(projects.organizationId, ctx.organizationId)));
  await recordAudit({
    organizationId: ctx.organizationId,
    projectId: ctx.projectId,
    actorUserId: ctx.userId,
    action: "project.audience_description.update",
    entityType: "project",
    entityId: ctx.projectId,
  });
}

export async function updatePromptStrategy(ctx: ProjectContext, input: PromptStrategyInput) {
  requireCapability(ctx, "project:write");
  const strategy = strategyFromInput(input);
  await db
    .update(projects)
    .set({ promptStrategy: strategy, promptStrategyEdited: true, updatedAt: new Date() })
    .where(and(eq(projects.id, ctx.projectId), eq(projects.organizationId, ctx.organizationId)));
  await recordAudit({
    organizationId: ctx.organizationId,
    projectId: ctx.projectId,
    actorUserId: ctx.userId,
    action: "project.prompt_strategy.update",
    entityType: "project",
    entityId: ctx.projectId,
    metadata: { targetPromptCount: strategy.targetPromptCount },
  });
}

function mergeUnique(existing: string[], additions: string[], limit = 40) {
  const seen = new Set<string>();
  return [...existing, ...additions]
    .map((value) => value.trim())
    .filter((value) => {
      if (!value) return false;
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

export async function applyPromptStrategySuggestions(ctx: ProjectContext) {
  requireCapability(ctx, "project:write");
  const project = await getProject(ctx);
  const signals = await db
    .select({ category: researchSignals.category, text: researchSignals.displayText })
    .from(researchSignals)
    .where(eq(researchSignals.projectId, ctx.projectId));
  const byCategory = (category: string) =>
    signals.filter((signal) => signal.category === category).map((signal) => signal.text);
  const current = project.promptStrategy;
  const suggested: PromptStrategy = {
    ...current,
    canonicalBrand: current.canonicalBrand || byCategory("brand_name")[0] || project.name,
    parentCompany: current.parentCompany || byCategory("parent_company")[0] || "",
    aliases: mergeUnique(current.aliases, byCategory("brand_alias")),
    entityCollisions: mergeUnique(current.entityCollisions, byCategory("entity_collision")),
    categoryTerms: mergeUnique(current.categoryTerms, byCategory("category_term")),
    businessLines: mergeUnique(current.businessLines, byCategory("business_line")),
    competitors: mergeUnique(current.competitors, byCategory("competitor")),
    buyerQualifiers: mergeUnique(current.buyerQualifiers, byCategory("buyer_qualifier")),
    freshnessFacts: mergeUnique(current.freshnessFacts, byCategory("freshness_fact")),
  };
  const additions =
    suggested.aliases.length -
    current.aliases.length +
    (suggested.parentCompany && !current.parentCompany ? 1 : 0) +
    suggested.entityCollisions.length -
    current.entityCollisions.length +
    suggested.categoryTerms.length -
    current.categoryTerms.length +
    suggested.businessLines.length -
    current.businessLines.length +
    suggested.competitors.length -
    current.competitors.length +
    suggested.buyerQualifiers.length -
    current.buyerQualifiers.length +
    suggested.freshnessFacts.length -
    current.freshnessFacts.length;
  await db
    .update(projects)
    .set({ promptStrategy: suggested, updatedAt: new Date() })
    .where(and(eq(projects.id, ctx.projectId), eq(projects.organizationId, ctx.organizationId)));
  await recordAudit({
    organizationId: ctx.organizationId,
    projectId: ctx.projectId,
    actorUserId: ctx.userId,
    action: "project.prompt_strategy.apply_suggestions",
    entityType: "project",
    entityId: ctx.projectId,
    metadata: { additions },
  });
  return additions;
}

export async function getProjectWorkflowSummary(ctx: ProjectContext) {
  const project = await getProject(ctx);
  const [sources, activePersonas, promptSetRows, runRows, researchBriefRows, signalRows] =
    await Promise.all([
      db
        .select()
        .from(dataSources)
        .where(eq(dataSources.projectId, ctx.projectId))
        .orderBy(desc(dataSources.createdAt)),
      db
        .select({ persona: personas, version: personaVersions })
        .from(personas)
        .innerJoin(personaVersions, eq(personaVersions.id, personas.currentVersionId))
        .where(and(eq(personas.projectId, ctx.projectId), isNull(personas.archivedAt)))
        .orderBy(asc(personas.name)),
      db.select().from(promptSets).where(eq(promptSets.projectId, ctx.projectId)),
      db
        .select()
        .from(generationRuns)
        .where(eq(generationRuns.projectId, ctx.projectId))
        .orderBy(desc(generationRuns.createdAt))
        .limit(10),
      db
        .select()
        .from(marketResearchBriefs)
        .where(eq(marketResearchBriefs.projectId, ctx.projectId))
        .orderBy(desc(marketResearchBriefs.version)),
      db
        .select({ category: researchSignals.category, sourceKind: researchSignals.sourceKind })
        .from(researchSignals)
        .where(eq(researchSignals.projectId, ctx.projectId)),
    ]);
  const signalCategories = new Set(signalRows.map((signal) => signal.category));
  const hasAnyCategory = (categories: string[]) =>
    categories.some((category) => signalCategories.has(category));
  const readinessAreas = [
    {
      label: "Brand and category foundation",
      ready: Boolean(
        project.promptStrategy.canonicalBrand &&
        project.promptStrategy.categoryTerms.length &&
        project.promptStrategy.businessLines.length,
      ),
    },
    {
      label: "Customer needs and outcomes",
      ready: hasAnyCategory([
        "job_to_be_done",
        "pain_point",
        "goal",
        "desired_outcome",
        "success_measure",
      ]),
    },
    {
      label: "Buying criteria and objections",
      ready: hasAnyCategory([
        "decision_criterion",
        "objection",
        "constraint",
        "proof_need",
        "buying_trigger",
        "comparison",
      ]),
    },
    {
      label: "Customer questions and vocabulary",
      ready: hasAnyCategory(["question", "vocabulary"]),
    },
    {
      label: "Competitors and buyer context",
      ready: Boolean(
        project.promptStrategy.competitors.length || project.promptStrategy.buyerQualifiers.length,
      ),
    },
    {
      label: "External audience behavior",
      ready: signalRows.some((signal) => signal.sourceKind === "sparktoro"),
    },
  ];
  const readyAreaCount = readinessAreas.filter((area) => area.ready).length;
  return {
    project,
    sources,
    activePersonas,
    promptSets: promptSetRows,
    runs: runRows,
    researchBriefs: researchBriefRows,
    approvedResearchBrief: researchBriefRows.find((brief) => brief.status === "approved") ?? null,
    draftResearchBrief: researchBriefRows.find((brief) => brief.status === "draft") ?? null,
    completedSourceCount: sources.filter(
      (source) => source.status === "completed" || source.status === "completed_with_warnings",
    ).length,
    brandReadiness: {
      score: Math.round((readyAreaCount / readinessAreas.length) * 100),
      readyAreaCount,
      totalAreaCount: readinessAreas.length,
      areas: readinessAreas,
      missing: readinessAreas.filter((area) => !area.ready).map((area) => area.label),
    },
    newDataAvailable:
      project.sourceRevision > project.activePersonaRevision && activePersonas.length > 0,
  };
}
