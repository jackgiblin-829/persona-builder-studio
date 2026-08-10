import "server-only";
import {
  generateAffinityRows,
  generateAudienceSize,
  generateDemographicsRows,
  generateWebsiteRows,
  mockReportId,
} from "@fixtures/sparktoro/generators";
import type {
  CreateAudienceReportRequest,
  CreateAudienceReportResult,
  GetSectionRequest,
  GetSectionResult,
  SparktoroAdapter,
  SparktoroResult,
} from "./types";

/**
 * Deterministic mock SparkToro adapter.
 *
 * `createAudienceReport` derives the report id from a hash of the
 * description + location, so `getSection` never needs the description again
 * — matching the live adapter's contract, where the vendor retains that
 * context server-side against `reportId`. There is no polling in mock mode:
 * every section is "ready" on the first call.
 */
export class MockSparktoroAdapter implements SparktoroAdapter {
  readonly mode = "mock" as const;

  async createAudienceReport(
    request: CreateAudienceReportRequest,
  ): Promise<SparktoroResult<CreateAudienceReportResult>> {
    const reportId = mockReportId(`${request.description}:${request.location ?? ""}`);
    const data: CreateAudienceReportResult = { reportId, status: "ready" };
    return { data, dataOrigin: "mock", creditsUsed: 0, raw: { mock: true, data } };
  }

  async getSection(request: GetSectionRequest): Promise<SparktoroResult<GetSectionResult>> {
    // The mock report id embeds the description hash; recover a stable seed
    // for row generation from the reportId itself rather than re-deriving it,
    // so this method never needs anything beyond what the live contract gives it.
    const seed = request.reportId;
    const rows =
      request.section === "audience_size"
        ? []
        : request.section === "demographics"
          ? generateDemographicsRows(seed)
          : request.section === "websites"
            ? generateWebsiteRows(seed)
            : generateAffinityRows(seed, request.section);
    const audienceSize = request.section === "audience_size" ? generateAudienceSize(seed) : null;

    const data: GetSectionResult = {
      status: "ready",
      section: request.section,
      rows,
      audienceSize,
    };
    return {
      data,
      dataOrigin: "mock",
      creditsUsed: request.section === "audience_size" ? 0 : 1,
      raw: { mock: true, data },
    };
  }
}
