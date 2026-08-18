import { requireProjectAccess } from "@/lib/auth/context";
import { buildPersonaDeckPptx } from "@/services/persona-deck";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const ctx = await requireProjectAccess(projectId);
  const { buffer, filename } = await buildPersonaDeckPptx(ctx);
  return new Response(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "private, no-store",
    },
  });
}
