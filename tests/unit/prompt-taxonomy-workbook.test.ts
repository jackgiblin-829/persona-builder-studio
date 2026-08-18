import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { buildCoverageBlueprint, type PromptStrategy } from "@/contracts/prompt-strategy";
import { buildPromptTaxonomyPlan, type PromptTaxonomySourceRow } from "@/contracts/prompt-taxonomy";
import { createPromptTaxonomyWorkbook } from "@/services/prompt-taxonomy-workbook";

const strategy: PromptStrategy = {
  canonicalBrand: "Northwind Flow",
  parentCompany: "Northwind Group",
  aliases: ["Northwind Workflow"],
  entityCollisions: ["Northwind Traders"],
  categoryTerms: ["enterprise workflow software"],
  businessLines: ["workflow automation", "governance workflows", "operations reporting"],
  competitors: ["Contoso Flow", "Fabrikam Work", "Adventure Works Cloud"],
  buyerQualifiers: ["a regulated enterprise", "a 500-person operations team"],
  freshnessFacts: ["current product name"],
  pathwaysPerPersona: 3,
  targetPromptCount: 50,
  funnelTargets: { awareness: 30, consideration: 15, decision: 5 },
  workbook: {
    preparedBy: "829 Studios",
    primaryCommercialJob:
      "Enter the enterprise evaluation shortlist before vendor outreach begins.",
    targetRegions: ["US"],
    trackingSurfaces: ["ChatGPT", "Perplexity", "Gemini"],
    competitorContext: [],
    entityRiskRows: [],
  },
};

const personas = [
  { slug: "operations-leader", name: "Operations Leader" },
  { slug: "technology-evaluator", name: "Technology Evaluator" },
  { slug: "risk-owner", name: "Risk Owner" },
];

describe("prompt taxonomy workbook", () => {
  it("creates the six-tab client plan with a foundational prompt mix", async () => {
    const blueprint = buildCoverageBlueprint(strategy, personas);
    const rows: PromptTaxonomySourceRow[] = blueprint.map((cell) => ({
      promptText:
        cell.promptType === "unbranded"
          ? `Which ${cell.businessLine} option fits the needs behind ${cell.key}?`
          : cell.promptType === "competitor_comparative"
            ? `How does ${strategy.canonicalBrand} compare with ${cell.competitor} for ${cell.key}?`
            : cell.promptType === "entity_disambiguation"
              ? `How is ${strategy.canonicalBrand} different from Northwind Traders for ${cell.key}?`
              : `Is ${strategy.canonicalBrand} a credible choice for ${cell.businessLine} in ${cell.key}?`,
      promptType: cell.promptType,
      topicClass: cell.topicClass,
      persona: personas.find((persona) => persona.slug === cell.personaSlug)!.name,
      funnelStage: cell.funnelStage,
      businessLine: cell.businessLine,
      region: "US",
      pathway: cell.pathwayLabel,
      coverageKey: cell.key,
      parentCoverageKey: cell.parentKey,
      questionArchetype: cell.questionArchetype,
      qualityScore: 90,
      evidenceReferences: [`signal-${cell.sequence + 1}`],
      sequence: cell.sequence,
    }));
    const plan = buildPromptTaxonomyPlan({
      brand: strategy.canonicalBrand,
      domain: "northwind.example",
      primaryMarket: "US",
      strategy,
      rows,
      containsMock: false,
      preparedAt: new Date("2026-08-18T12:00:00.000Z"),
    });
    expect(plan.prompts).toHaveLength(150);
    expect(plan.topics).toHaveLength(10);
    expect(plan.quality.unbrandedShare).toBeCloseTo(0.68, 2);
    expect(plan.quality.phaseOneCount).toBe(60);
    expect(plan.prompts.filter((prompt) => prompt.type === "Competitor-Comparative")).toHaveLength(
      15,
    );

    const bytes = await createPromptTaxonomyWorkbook(plan);
    expect(bytes.subarray(0, 2).toString("utf8")).toBe("PK");
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
    expect(workbook.worksheets.map((sheet) => sheet.name)).toEqual([
      "Read Me",
      "Topic Architecture",
      "Prompt Library",
      "Profound Import",
      "Competitor Tracking",
      "Entity Watchlist",
    ]);
    expect(workbook.getWorksheet("Prompt Library")!.rowCount).toBe(154);
    expect(workbook.getWorksheet("Prompt Library")!.getRow(4).values).toContain("Search Intent");
    expect(workbook.getWorksheet("Prompt Library")!.getRow(4).values).toContain("Search Theme");
    expect(workbook.getWorksheet("Prompt Library")!.getRow(4).values).toContain("Review Status");
    expect(workbook.getWorksheet("Topic Architecture")!.getCell("E5").value).toMatchObject({
      formula: expect.stringContaining("COUNTIF"),
    });

    const draftPlan = buildPromptTaxonomyPlan({
      brand: strategy.canonicalBrand,
      domain: "northwind.example",
      primaryMarket: "US",
      strategy,
      rows: rows.map((row, index) => ({
        ...row,
        reviewStatus: index === 0 ? "needs_revision" : "approved",
      })),
      containsMock: false,
      isDraft: true,
      preparedAt: new Date("2026-08-18T12:00:00.000Z"),
    });
    expect(draftPlan.quality.warnings[0]).toMatch(/working draft/i);
    const draftBytes = await createPromptTaxonomyWorkbook(draftPlan);
    const draftWorkbook = new ExcelJS.Workbook();
    await draftWorkbook.xlsx.load(draftBytes as unknown as ExcelJS.Buffer);
    expect(draftWorkbook.getWorksheet("Read Me")!.getCell("A3").value).toMatch(/working draft/i);
  });
});
