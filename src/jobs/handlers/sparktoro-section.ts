import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db/client";
import { audienceReports, audienceSignals, dataSources, sourceDocuments } from "@/db/schema";
import { getSparktoroAdapter } from "@/adapters/sparktoro";
import {
  sparktoroSectionSchema,
  type SparktoroAffinityRow,
  type SparktoroSection,
} from "@/adapters/sparktoro/types";
import { getQueue } from "@/adapters/queue";
import { AppError } from "@/lib/errors";
import { newId, ID_PREFIXES } from "@/lib/ids";
import { withVendorUsage } from "@/services/usage";
import { JOB_TYPES, registerJob } from "../registry";

/**
 * Fetches one SparkToro section for an already-created audience report, then
 * feeds it into the ordinary evidence pipeline: render the section into
 * prose, attach it to a shared `dataSources` row for the report, and enqueue
 * `extractEvidence` — the same pipeline every other source goes through
 * (§ "new vendor job → sourceDocuments → extractEvidence").
 *
 * All sections of one report share a single `dataSources` row, found or
 * created by the deterministic checksum `sparktoro:<audienceReportId>`
 * (unique on `(brandId, checksum)`), so re-extraction after each new section
 * completes regenerates evidence from every section fetched so far rather
 * than duplicating it.
 */
registerJob(JOB_TYPES.sparktoroSection, async ({ job }) => {
  const audienceReportId = String(job.payload.audienceReportId ?? "");
  const section = sparktoroSectionSchema.parse(job.payload.section);
  if (!audienceReportId) {
    throw new AppError("validation", "sparktoro_section requires audienceReportId");
  }

  const [report] = await db
    .select()
    .from(audienceReports)
    .where(eq(audienceReports.id, audienceReportId))
    .limit(1);
  if (!report)
    throw new AppError("not_found", `Audience report ${audienceReportId} no longer exists`);
  if (!report.vendorReportId) {
    throw new AppError("validation", `Audience report ${audienceReportId} has no vendor report id`);
  }
  const vendorReportId = report.vendorReportId;

  await db
    .update(audienceSignals)
    .set({ status: "running", updatedAt: new Date() })
    .where(
      and(
        eq(audienceSignals.audienceReportId, audienceReportId),
        eq(audienceSignals.section, section),
      ),
    );

  const { adapter, mode } = await getSparktoroAdapter(report.organizationId);

  try {
    const result = await withVendorUsage(
      {
        organizationId: report.organizationId,
        brandId: report.brandId,
        vendor: "sparktoro",
        operation: `get_section:${section}`,
        mode,
        jobId: job.id,
      },
      () => adapter.getSection({ reportId: vendorReportId, section }),
      (sectionResult) => ({ credits: sectionResult.creditsUsed }),
    );

    await db
      .update(audienceSignals)
      .set({
        status: "succeeded",
        normalized: result.data as unknown as Record<string, unknown>,
        rawResponse: result.raw,
        dataOrigin: result.dataOrigin,
        fetchedAt: new Date(),
        errorMessage: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(audienceSignals.audienceReportId, audienceReportId),
          eq(audienceSignals.section, section),
        ),
      );

    await refreshReportStatus(audienceReportId);

    const text = documentifySection(section, result.data.rows, result.data.audienceSize);
    if (text) {
      const dataSourceId = await findOrCreateDataSource(report);
      await upsertSectionDocument(dataSourceId, report, section, text);

      await getQueue().enqueue(
        JOB_TYPES.extractEvidence,
        { dataSourceId },
        {
          organizationId: report.organizationId,
          brandId: report.brandId,
          idempotencyKey: `extract:${dataSourceId}:${section}:${job.id}`,
        },
      );
    }

    return { status: "succeeded", result: { section, rows: result.data.rows.length } };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db
      .update(audienceSignals)
      .set({ status: "failed", errorMessage: message, updatedAt: new Date() })
      .where(
        and(
          eq(audienceSignals.audienceReportId, audienceReportId),
          eq(audienceSignals.section, section),
        ),
      );
    await refreshReportStatus(audienceReportId);
    throw error;
  }
});

async function refreshReportStatus(audienceReportId: string): Promise<void> {
  const sections = await db
    .select({ status: audienceSignals.status })
    .from(audienceSignals)
    .where(eq(audienceSignals.audienceReportId, audienceReportId));

  const terminal = sections.every((s) => s.status === "succeeded" || s.status === "failed");
  if (!terminal) return;

  const anySucceeded = sections.some((s) => s.status === "succeeded");
  const anyFailed = sections.some((s) => s.status === "failed");
  const status = !anyFailed ? "succeeded" : anySucceeded ? "partially_succeeded" : "failed";

  await db
    .update(audienceReports)
    .set({ status, updatedAt: new Date() })
    .where(eq(audienceReports.id, audienceReportId));
}

async function findOrCreateDataSource(report: {
  id: string;
  organizationId: string;
  brandId: string;
  description: string;
}): Promise<string> {
  const checksum = `sparktoro:${report.id}`.slice(0, 500);
  const newDataSourceId = newId(ID_PREFIXES.dataSource);

  const [row] = await db
    .insert(dataSources)
    .values({
      id: newDataSourceId,
      organizationId: report.organizationId,
      brandId: report.brandId,
      label: `SparkToro: ${report.description}`,
      sourceType: "sparktoro",
      sourceSystem: "sparktoro_report",
      checksum,
      status: "running",
    })
    .onConflictDoNothing({ target: [dataSources.brandId, dataSources.checksum] })
    .returning({ id: dataSources.id });

  if (row) return row.id;

  const [existing] = await db
    .select({ id: dataSources.id })
    .from(dataSources)
    .where(and(eq(dataSources.brandId, report.brandId), eq(dataSources.checksum, checksum)))
    .limit(1);
  if (!existing) throw new AppError("internal", "Failed to resolve SparkToro data source");
  return existing.id;
}

async function upsertSectionDocument(
  dataSourceId: string,
  report: { organizationId: string; brandId: string },
  section: SparktoroSection,
  text: string,
): Promise<void> {
  const location = `SparkToro: ${section.replace(/_/g, " ")}`;

  // Re-fetching a section replaces its document rather than duplicating it;
  // other sections' documents for this data source are untouched.
  await db
    .delete(sourceDocuments)
    .where(
      and(eq(sourceDocuments.dataSourceId, dataSourceId), eq(sourceDocuments.location, location)),
    );

  const existingCount = await db
    .select({ id: sourceDocuments.id })
    .from(sourceDocuments)
    .where(eq(sourceDocuments.dataSourceId, dataSourceId));

  await db.insert(sourceDocuments).values({
    id: newId(ID_PREFIXES.sourceDocument),
    organizationId: report.organizationId,
    brandId: report.brandId,
    dataSourceId,
    title: section.replace(/_/g, " "),
    location,
    sequence: existingCount.length,
    rawText: text,
    redactedText: text,
    piiFindings: {},
    metadata: { section, piiStatus: "none" },
    speaker: null,
    observedAt: null,
    contentHash: `${dataSourceId}:${section}`,
  });

  await db
    .update(dataSources)
    .set({ documentCount: existingCount.length + 1, updatedAt: new Date() })
    .where(eq(dataSources.id, dataSourceId));
}

/** Renders one section's normalized data into prose the extractor can read. */
function documentifySection(
  section: SparktoroSection,
  rows: SparktoroAffinityRow[],
  audienceSize: { estimatedSize: number | null; confidence: string } | null,
): string | null {
  if (section === "audience_size") {
    if (!audienceSize?.estimatedSize) return null;
    return `SparkToro estimates this audience at approximately ${audienceSize.estimatedSize.toLocaleString()} people (${audienceSize.confidence} confidence).`;
  }

  if (rows.length === 0) return null;
  const label = SECTION_PROSE_LABEL[section];
  const sentences = rows.map((row) => {
    const pct = row.percentage !== null ? `, reaching ${row.percentage}% of the audience` : "";
    return `"${row.label}" (${row.affinityScore}x baseline affinity${pct})`;
  });
  return `This audience over-indexes on the following ${label}: ${sentences.join("; ")}.`;
}

const SECTION_PROSE_LABEL: Record<Exclude<SparktoroSection, "audience_size">, string> = {
  demographics: "demographic and firmographic traits",
  bio_keywords: "social bio keywords",
  websites: "websites",
  social_accounts: "social accounts",
  networks: "social networks",
  youtube: "YouTube channels",
  podcasts: "podcasts",
  reddit: "subreddits",
  press: "press and publications",
  apps_and_ai_tools: "apps and AI tools",
  keywords: "keywords",
  prompt_topics: "AI prompt topics",
};
