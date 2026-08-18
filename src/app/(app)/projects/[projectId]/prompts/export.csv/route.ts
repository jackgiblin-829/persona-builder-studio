import { requireProjectAccess } from "@/lib/auth/context";
import { buildPromptBaselineCsv } from "@/services/prompts";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const ctx = await requireProjectAccess(projectId);
  const demo = new URL(request.url).searchParams.get("demo") === "1";
  const csv = await buildPromptBaselineCsv(ctx, { allowMock: demo });
  return new Response(csv, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${ctx.projectSlug}-${demo ? "demo-" : ""}prompt-taxonomy-baseline.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
