import { type NextRequest } from "next/server";
import { requireBrandAccess, requireCapability } from "@/lib/auth/context";
import { toPublicError } from "@/lib/errors";
import { exportBrief, type ExportFormat } from "@/services/content-brief-export";

const FORMATS: ExportFormat[] = ["json", "csv", "md"];

/** SEO brief export (§29). GET route so the browser handles the download. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ brandId: string; briefId: string }> },
) {
  const { brandId, briefId } = await params;

  try {
    const ctx = await requireBrandAccess(brandId);
    requireCapability(ctx, "export:read");

    const url = new URL(request.url);
    const requested = (url.searchParams.get("format") ?? "json") as ExportFormat;
    if (!FORMATS.includes(requested)) {
      return jsonError(400, `Unsupported export format. Use one of: ${FORMATS.join(", ")}.`);
    }

    const { filename, contentType, body } = await exportBrief(ctx, briefId, requested);

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
