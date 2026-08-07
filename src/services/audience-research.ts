import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { audienceReports, audienceSignals } from "@/db/schema";
import { getSparktoroAdapter } from "@/adapters/sparktoro";
import { SPARKTORO_SECTIONS, type SparktoroSection } from "@/adapters/sparktoro/types";
import { getQueue } from "@/adapters/queue";
import { requireCapability, type BrandContext } from "@/lib/auth/context";
import { NotFoundError, ValidationError } from "@/lib/errors";
import { newId, ID_PREFIXES } from "@/lib/ids";
import { JOB_TYPES } from "@/jobs/registry";
import { recordAudit } from "./audit";

/**
 * SparkToro audience research (docs/integrations.md).
 *
 * Each requested section is its own job (`sparktoro_section`), so one
 * section failing — rate limit, credit exhaustion, an unmapped affinity
 * field — never discards the others. `audienceReports` records the vendor
 * report id once, up front, so every section job can call `getSection`
 * without racing to create the report itself.
 */

export async function requestAudienceReport(
  ctx: BrandContext,
  input: { description: string; location?: string | null; sections: SparktoroSection[] },
): Promise<{ audienceReportId: string }> {
  requireCapability(ctx, "source:upload");

  const description = input.description.trim();
  if (!description) {
    throw new ValidationError("Describe the audience you want SparkToro to research.");
  }
  const sections = input.sections.length > 0 ? input.sections : [...SPARKTORO_SECTIONS];

  const { adapter, mode } = await getSparktoroAdapter(ctx.organizationId);
  const created = await adapter.createAudienceReport({
    description,
    location: input.location ?? null,
  });

  const audienceReportId = newId(ID_PREFIXES.audienceReport);
  await db.insert(audienceReports).values({
    id: audienceReportId,
    organizationId: ctx.organizationId,
    brandId: ctx.brandId,
    vendor: "sparktoro",
    description,
    location: input.location ?? null,
    vendorReportId: created.data.reportId,
    requestedSections: sections,
    status: "running",
    dataOrigin: mode,
    createdByUserId: ctx.userId,
  });

  for (const section of sections) {
    await db.insert(audienceSignals).values({
      id: newId(ID_PREFIXES.audienceSignal),
      organizationId: ctx.organizationId,
      brandId: ctx.brandId,
      audienceReportId,
      section,
      status: "queued",
      dataOrigin: mode,
    });

    await getQueue().enqueue(
      JOB_TYPES.sparktoroSection,
      { audienceReportId, section },
      {
        organizationId: ctx.organizationId,
        brandId: ctx.brandId,
        idempotencyKey: `sparktoro:${audienceReportId}:${section}`,
      },
    );
  }

  await recordAudit({
    organizationId: ctx.organizationId,
    brandId: ctx.brandId,
    actorUserId: ctx.userId,
    action: "audience_report.request",
    entityType: "audience_report",
    entityId: audienceReportId,
    metadata: { description, location: input.location ?? null, sections },
  });

  return { audienceReportId };
}

export async function listAudienceReports(ctx: BrandContext) {
  return db
    .select()
    .from(audienceReports)
    .where(
      and(
        eq(audienceReports.organizationId, ctx.organizationId),
        eq(audienceReports.brandId, ctx.brandId),
      ),
    )
    .orderBy(audienceReports.createdAt);
}

export async function getAudienceReportDetail(ctx: BrandContext, audienceReportId: string) {
  const [report] = await db
    .select()
    .from(audienceReports)
    .where(
      and(
        eq(audienceReports.id, audienceReportId),
        eq(audienceReports.organizationId, ctx.organizationId),
        eq(audienceReports.brandId, ctx.brandId),
      ),
    )
    .limit(1);
  if (!report) throw new NotFoundError("Audience report");

  const sections = await db
    .select()
    .from(audienceSignals)
    .where(eq(audienceSignals.audienceReportId, audienceReportId))
    .orderBy(audienceSignals.section);

  return { report, sections };
}
