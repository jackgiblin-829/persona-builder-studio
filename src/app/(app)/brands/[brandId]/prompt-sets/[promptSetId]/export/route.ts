import { type NextRequest } from "next/server";
import { requireBrandAccess, requireCapability } from "@/lib/auth/context";
import { toPublicError } from "@/lib/errors";
import { exportPromptSet, type ExportFormat } from "@/services/prompt-export";

const FORMATS: ExportFormat[] = ["json", "csv", "md"];

/**
 * Prompt-set export (§18).
 *
 * A GET route so the browser handles the download, authorised and audited on
 * every request — an export leaves the product, so the format and version are
 * recorded in the audit log.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ brandId: string; promptSetId: string }> },
) {
  const { brandId, promptSetId } = await params;

  try {
    const ctx = await requireBrandAccess(brandId);
    requireCapability(ctx, "export:read");

    const url = new URL(request.url);
    const requested = (url.searchParams.get("format") ?? "json") as ExportFormat;
    if (!FORMATS.includes(requested)) {
      return jsonError(400, `Unsupported export format. Use one of: ${FORMATS.join(", ")}.`);
    }

    const versionParam = url.searchParams.get("version");
    const version = versionParam && /^\d+$/.test(versionParam) ? Number(versionParam) : undefined;

    const { filename, contentType, body } = await exportPromptSet(
      ctx,
      promptSetId,
      requested,
      version,
    );

    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${filename}"`,
        // A point-in-time snapshot; caching it would hand back a stale set after
        // a prompt was edited or rejected.
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
