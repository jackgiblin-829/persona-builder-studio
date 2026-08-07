import { z } from "zod";

/**
 * The SparkToro boundary (docs/integrations.md).
 *
 * SparkToro returns aggregated audience-affinity data ("this audience
 * over-indexes on X"), never an assertion about an individual's behaviour.
 * `audience_signals.provenance` is hard-defaulted to `externally_supported`
 * for exactly this reason — see the column comment in `src/db/schema.ts`.
 *
 * Every operation returns a `SparktoroResult<T>`, where `data` is exactly the
 * shape persisted to `audience_signals.normalized` — no second mapping step
 * between what the adapter returns and what gets stored, matching the
 * DataForSEO and Profound adapters.
 */

export const SPARKTORO_SECTIONS = [
  "demographics",
  "bio_keywords",
  "websites",
  "social_accounts",
  "networks",
  "youtube",
  "podcasts",
  "reddit",
  "press",
  "apps_and_ai_tools",
  "keywords",
  "prompt_topics",
  "audience_size",
] as const;
export const sparktoroSectionSchema = z.enum(SPARKTORO_SECTIONS);
export type SparktoroSection = (typeof SPARKTORO_SECTIONS)[number];

/** One affinity row: "this audience over-indexes on X by N times baseline." */
export const sparktoroAffinityRowSchema = z.object({
  label: z.string(),
  /** Multiple of baseline audience affinity, e.g. 4.2 = 4.2x more likely. */
  affinityScore: z.number(),
  /** Share of the audience matching this row, when SparkToro reports one. */
  percentage: z.number().min(0).max(100).nullable(),
  url: z.string().nullable(),
});
export type SparktoroAffinityRow = z.infer<typeof sparktoroAffinityRowSchema>;

export const sparktoroAudienceSizeSchema = z.object({
  estimatedSize: z.number().int().nullable(),
  confidence: z.enum(["low", "medium", "high"]),
});
export type SparktoroAudienceSize = z.infer<typeof sparktoroAudienceSizeSchema>;

export type SparktoroResult<T> = {
  data: T;
  dataOrigin: "mock" | "live";
  creditsUsed: number;
  raw: Record<string, unknown>;
};

export type CreateAudienceReportRequest = {
  /** Free-text audience description, e.g. "product managers at B2B SaaS companies". */
  description: string;
  location?: string | null;
};
export type CreateAudienceReportResult = {
  reportId: string;
  status: "queued" | "processing" | "ready";
};

export type GetSectionRequest = {
  reportId: string;
  section: SparktoroSection;
};
export type GetSectionResult = {
  status: "ready" | "processing";
  section: SparktoroSection;
  rows: SparktoroAffinityRow[];
  audienceSize: SparktoroAudienceSize | null;
};

// ── Adapter interface ───────────────────────────────────────────────────────

export interface SparktoroAdapter {
  readonly mode: "mock" | "live";

  createAudienceReport(
    request: CreateAudienceReportRequest,
  ): Promise<SparktoroResult<CreateAudienceReportResult>>;

  /**
   * Fetches one section of an existing report. The live adapter polls
   * internally with backoff until the section is ready (docs/integrations.md)
   * and only returns `status: "processing"` if it gives up — the caller never
   * has to poll itself. The mock adapter always returns `"ready"` immediately.
   */
  getSection(request: GetSectionRequest): Promise<SparktoroResult<GetSectionResult>>;
}
