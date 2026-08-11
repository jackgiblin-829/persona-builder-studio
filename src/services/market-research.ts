import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getQueue } from "@/adapters/queue";
import { db } from "@/db/client";
import { generationRuns, marketResearchBriefs } from "@/db/schema";
import { requireCapability, type ProjectContext } from "@/lib/auth/context";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { ID_PREFIXES, newId } from "@/lib/ids";
import { JOB_TYPES } from "@/jobs/registry";
import { recordAudit } from "./audit";
import { getProject } from "./projects";

export async function listMarketResearchBriefs(ctx: ProjectContext) {
  return db
    .select()
    .from(marketResearchBriefs)
    .where(
      and(
        eq(marketResearchBriefs.organizationId, ctx.organizationId),
        eq(marketResearchBriefs.projectId, ctx.projectId),
      ),
    )
    .orderBy(desc(marketResearchBriefs.version));
}

export async function getApprovedMarketResearchBrief(ctx: ProjectContext) {
  const [brief] = await db
    .select()
    .from(marketResearchBriefs)
    .where(
      and(
        eq(marketResearchBriefs.organizationId, ctx.organizationId),
        eq(marketResearchBriefs.projectId, ctx.projectId),
        eq(marketResearchBriefs.status, "approved"),
      ),
    )
    .orderBy(desc(marketResearchBriefs.version))
    .limit(1);
  return brief ?? null;
}

export async function startMarketResearch(ctx: ProjectContext) {
  requireCapability(ctx, "project:write");
  const project = await getProject(ctx);
  const [active] = await db
    .select({ id: generationRuns.id })
    .from(generationRuns)
    .where(
      and(
        eq(generationRuns.projectId, ctx.projectId),
        eq(generationRuns.workflowType, "market_research"),
        inArray(generationRuns.status, ["queued", "running"]),
      ),
    )
    .limit(1);
  if (active) return active.id;
  const runId = newId(ID_PREFIXES.generationRun);
  await db.transaction(async (tx) => {
    await tx.insert(generationRuns).values({
      id: runId,
      organizationId: ctx.organizationId,
      projectId: ctx.projectId,
      workflowType: "market_research",
      status: "queued",
      stage: "researching_market",
      progress: 0,
      inputSnapshot: {
        sourceRevision: project.sourceRevision,
        promptStrategy: project.promptStrategy,
        refreshMode: "manual",
      },
      initiatedByUserId: ctx.userId,
    });
    await getQueue().enqueue(
      JOB_TYPES.researchMarket,
      { runId },
      {
        organizationId: ctx.organizationId,
        projectId: ctx.projectId,
        idempotencyKey: `market-research:${runId}`,
        tx,
      },
    );
  });
  await recordAudit({
    organizationId: ctx.organizationId,
    projectId: ctx.projectId,
    actorUserId: ctx.userId,
    action: "market_research.refresh",
    entityType: "generation_run",
    entityId: runId,
  });
  return runId;
}

export async function approveMarketResearchBrief(ctx: ProjectContext, briefId: string) {
  requireCapability(ctx, "project:write");
  const [brief] = await db
    .select()
    .from(marketResearchBriefs)
    .where(
      and(
        eq(marketResearchBriefs.id, briefId),
        eq(marketResearchBriefs.organizationId, ctx.organizationId),
        eq(marketResearchBriefs.projectId, ctx.projectId),
      ),
    )
    .limit(1);
  if (!brief) throw new NotFoundError("Market research brief");
  if (brief.status !== "draft") throw new ValidationError("Only a draft brief can be approved.");
  await db.transaction(async (tx) => {
    await tx
      .update(marketResearchBriefs)
      .set({ status: "superseded" })
      .where(
        and(
          eq(marketResearchBriefs.projectId, ctx.projectId),
          eq(marketResearchBriefs.status, "approved"),
        ),
      );
    await tx
      .update(marketResearchBriefs)
      .set({ status: "approved", approvedAt: new Date(), approvedByUserId: ctx.userId })
      .where(eq(marketResearchBriefs.id, brief.id));
    const { projects } = await import("@/db/schema");
    await tx
      .update(projects)
      .set({
        promptStrategy: brief.content.strategy,
        promptStrategyEdited: false,
        updatedAt: new Date(),
      })
      .where(eq(projects.id, ctx.projectId));
  });
  await recordAudit({
    organizationId: ctx.organizationId,
    projectId: ctx.projectId,
    actorUserId: ctx.userId,
    action: "market_research.approve",
    entityType: "market_research_brief",
    entityId: brief.id,
    metadata: { version: brief.version, factCount: brief.content.facts.length },
  });
}
