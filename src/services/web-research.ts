import "server-only";
import { getQueue } from "@/adapters/queue";
import { requireCapability, type BrandContext } from "@/lib/auth/context";
import { JOB_TYPES } from "@/jobs/registry";
import { recordAudit } from "./audit";

/** Triggers deep web research (`src/jobs/handlers/web-research.ts`). */
export async function requestWebResearch(ctx: BrandContext): Promise<{ jobId: string }> {
  requireCapability(ctx, "source:upload");

  const queued = await getQueue().enqueue(
    JOB_TYPES.webResearch,
    { brandId: ctx.brandId },
    { organizationId: ctx.organizationId, brandId: ctx.brandId },
  );

  await recordAudit({
    organizationId: ctx.organizationId,
    brandId: ctx.brandId,
    actorUserId: ctx.userId,
    action: "web_research.run",
    entityType: "brand",
    entityId: ctx.brandId,
    metadata: { jobId: queued.id },
  });

  return { jobId: queued.id };
}
