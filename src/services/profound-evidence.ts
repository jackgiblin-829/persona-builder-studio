import "server-only";
import { getQueue } from "@/adapters/queue";
import { requireCapability, type BrandContext } from "@/lib/auth/context";
import { ValidationError } from "@/lib/errors";
import { JOB_TYPES } from "@/jobs/registry";
import { recordAudit } from "./audit";
import { getCategoryMapping } from "./profound-mapping";

/**
 * Triggers a pull of the brand's existing Profound AI-visibility data into
 * the evidence pipeline (`src/jobs/handlers/profound-evidence.ts`).
 */
export async function requestProfoundEvidencePull(
  ctx: BrandContext,
  input: { startDate: string; endDate: string },
): Promise<{ jobId: string }> {
  requireCapability(ctx, "profound:retrieve_results");

  const category = await getCategoryMapping(ctx);
  if (!category || category.status === "invalid") {
    throw new ValidationError(
      "Map this brand to a valid Profound category before pulling evidence.",
    );
  }

  const queued = await getQueue().enqueue(
    JOB_TYPES.profoundEvidence,
    { brandId: ctx.brandId, startDate: input.startDate, endDate: input.endDate },
    { organizationId: ctx.organizationId, brandId: ctx.brandId },
  );

  await recordAudit({
    organizationId: ctx.organizationId,
    brandId: ctx.brandId,
    actorUserId: ctx.userId,
    action: "profound.evidence_pull",
    entityType: "brand",
    entityId: ctx.brandId,
    metadata: { jobId: queued.id, startDate: input.startDate, endDate: input.endDate },
  });

  return { jobId: queued.id };
}
