import { requireProjectAccess } from "@/lib/auth/context";
import { buildPromptTaxonomyWorkbook } from "@/services/prompt-taxonomy-workbook";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  const { projectId } = await params;
  const ctx = await requireProjectAccess(projectId);
  const searchParams = new URL(request.url).searchParams;
  const allowMock = searchParams.get("demo") === "1";
  const allowDraft = searchParams.get("draft") === "1";
  const { buffer, plan } = await buildPromptTaxonomyWorkbook(ctx, { allowMock, allowDraft });
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${ctx.projectSlug}-${plan.isDraft ? "draft-" : ""}${allowMock ? "demo-" : ""}ai-search-prompt-plan.xlsx"`,
      "Cache-Control": "private, no-store",
    },
  });
}
