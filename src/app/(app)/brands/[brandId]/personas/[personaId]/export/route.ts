import { type NextRequest } from "next/server";
import { requireBrandAccess, requireCapability } from "@/lib/auth/context";
import { toPublicError } from "@/lib/errors";
import { exportPersona, type ExportFormat } from "@/services/persona-export";

const FORMATS: ExportFormat[] = ["json", "csv", "md"];

/**
 * Persona export (§16).
 *
 * A GET route rather than a server action so the browser handles the download,
 * and every request is authorised and audited — an export leaves the product, so
 * it is recorded in the audit log with the format and version.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ brandId: string; personaId: string }> },
) {
  const { brandId, personaId } = await params;

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

    const { filename, contentType, body } = await exportPersona(ctx, personaId, requested, version);

    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `attachment; filename="${filename}"`,
        // An export is a point-in-time snapshot; caching it would hand back a
        // stale persona after evidence changed.
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
