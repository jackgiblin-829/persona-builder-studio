import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { getQueue } from "@/adapters/queue";
import { db } from "@/db/client";
import { generationRuns, marketResearchBriefs } from "@/db/schema";
import { requireCapability, type ProjectContext } from "@/lib/auth/context";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { ID_PREFIXES, newId } from "@/lib/ids";
import { JOB_TYPES } from "@/jobs/registry";
import { drainProjectJobs } from "@/jobs/runner";
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
  if (active) {
    await drainProjectJobs({ projectId: ctx.projectId, types: [JOB_TYPES.researchMarket] });
    return active.id;
  }
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
        refreshMode: "persona_grounding",
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
  await drainProjectJobs({ projectId: ctx.projectId, types: [JOB_TYPES.researchMarket] });
  return runId;
}

/**
 * Builds the grounding snapshot required by prompt-taxonomy generation and freezes it in the
 * same user action. The snapshot is derived from active personas, SparkToro
 * signals, and uploaded brand evidence; it does not run a second web-research
 * workflow.
 */
export async function buildAndApprovePersonaGroundingBrief(ctx: ProjectContext) {
  const runId = await startMarketResearch(ctx);
  const [run] = await db
    .select({ status: generationRuns.status, errorMessage: generationRuns.errorMessage })
    .from(generationRuns)
    .where(eq(generationRuns.id, runId))
    .limit(1);
  if (run?.status === "failed") {
    throw new ValidationError(run.errorMessage ?? "Persona grounding failed.");
  }
  const [draft] = await db
    .select()
    .from(marketResearchBriefs)
    .where(
      and(
        eq(marketResearchBriefs.projectId, ctx.projectId),
        eq(marketResearchBriefs.generationRunId, runId),
        eq(marketResearchBriefs.status, "draft"),
      ),
    )
    .orderBy(desc(marketResearchBriefs.version))
    .limit(1);
  if (!draft) throw new ValidationError("Persona grounding did not produce a usable brief.");
  await approveMarketResearchBrief(ctx, draft.id);
  return draft.id;
}

export async function approveMarketResearchBrief(ctx: ProjectContext, briefId: string) {
  requireCapability(ctx, "project:write");
  const project = await getProject(ctx);
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
        promptStrategy: {
          ...brief.content.strategy,
          workbook: project.promptStrategy.workbook,
        },
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
