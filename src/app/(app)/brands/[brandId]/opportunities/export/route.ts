import { type NextRequest } from "next/server";
import { requireBrandAccess, requireCapability } from "@/lib/auth/context";
import { toPublicError } from "@/lib/errors";
import { exportOpportunities, type ExportFormat } from "@/services/content-opportunities-export";
import type { OpportunityFilters } from "@/services/content-opportunities";

const FORMATS: ExportFormat[] = ["json", "csv", "md"];

/**
 * Content-opportunity export (§28). A GET route so the browser handles the
 * download; every request is authorised and audited, matching the export
 * routes milestones 3–5 already established.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ brandId: string }> },
) {
  const { brandId } = await params;

  try {
    const ctx = await requireBrandAccess(brandId);
    requireCapability(ctx, "export:read");

    const url = new URL(request.url);
    const requested = (url.searchParams.get("format") ?? "json") as ExportFormat;
    if (!FORMATS.includes(requested)) {
      return jsonError(400, `Unsupported export format. Use one of: ${FORMATS.join(", ")}.`);
    }

    const filters: OpportunityFilters = {
      reviewStatus: (url.searchParams.get("reviewStatus") ||
        undefined) as OpportunityFilters["reviewStatus"],
      recommendation: (url.searchParams.get("recommendation") ||
        undefined) as OpportunityFilters["recommendation"],
      priority: (url.searchParams.get("priority") || undefined) as OpportunityFilters["priority"],
      id: url.searchParams.get("id") || undefined,
    };

    const { filename, contentType, body } = await exportOpportunities(ctx, requested, filters);

    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    const publicError = toPublicError(error);
    return jsonError(publicError.code === "not_found" ? 404 : 403, publicError.message);
  }
}

function jsonError(status: number, message: string): Response {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });
}
