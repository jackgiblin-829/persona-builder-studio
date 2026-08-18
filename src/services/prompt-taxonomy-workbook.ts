import "server-only";
import ExcelJS from "exceljs";
import { buildPromptTaxonomyPlan, type PromptTaxonomyPlan } from "@/contracts/prompt-taxonomy";
import type { ProjectContext } from "@/lib/auth/context";
import { ValidationError } from "@/lib/errors";
import { recordAudit } from "./audit";
import { loadPromptBaselineExportData } from "./prompts";

const COLORS = {
  navy: "120829",
  navyMid: "24164B",
  accent: "43D7E8",
  accentLight: "DFF8FB",
  white: "FFFFFF",
  ink: "171326",
  muted: "676272",
  surface: "F6F5F8",
  border: "D9D6E2",
  gold: "FFF2CC",
  green: "DFF4E7",
  red: "FDE7E7",
} as const;

const FONT = "Arial";

export async function buildPromptTaxonomyWorkbook(
  ctx: ProjectContext,
  options: { allowMock?: boolean; allowDraft?: boolean } = {},
) {
  const { project, sets, containsMock, isDraft } = await loadPromptBaselineExportData(ctx, options);
  let sequence = 0;
  const rows = sets.flatMap((set) =>
    set.clusters.flatMap(({ cluster, prompts }) =>
      prompts
        .filter((prompt) => prompt.reviewStatus !== "excluded")
        .filter((prompt) => isDraft || containsMock || prompt.reviewStatus === "approved")
        .map((prompt) => ({
          promptText: prompt.promptText,
          promptType: prompt.promptType,
          topicClass: prompt.topicClass,
          persona: set.persona.name,
          funnelStage: prompt.journeyStage,
          businessLine: prompt.businessLine,
          region: project.primaryMarket,
          pathway: cluster.title,
          coverageKey: prompt.coverageKey,
          parentCoverageKey: prompt.parentCoverageKey,
          questionArchetype: prompt.questionArchetype,
          qualityScore: prompt.qualityScore,
          reviewStatus: prompt.reviewStatus,
          evidenceReferences: [...prompt.signalIds, ...prompt.researchFactIds],
          sequence: sequence++,
        })),
    ),
  );
  if (!rows.length) throw new ValidationError("Generate prompts before exporting the taxonomy.");

  const plan = buildPromptTaxonomyPlan({
    brand: project.promptStrategy.canonicalBrand || project.name,
    domain: project.canonicalDomain,
    primaryMarket: project.primaryMarket,
    strategy: project.promptStrategy,
    rows,
    containsMock,
    isDraft,
  });
  const buffer = await createPromptTaxonomyWorkbook(plan);
  await recordAudit({
    organizationId: ctx.organizationId,
    projectId: ctx.projectId,
    actorUserId: ctx.userId,
    action: "prompt.taxonomy_workbook_export",
    entityType: "project",
    entityId: ctx.projectId,
    metadata: {
      rows: plan.prompts.length,
      topics: plan.topics.length,
      unbrandedShare: plan.quality.unbrandedShare,
      phaseOne: plan.quality.phaseOneCount,
      demo: containsMock,
      draft: isDraft,
    },
  });
  return { buffer, plan };
}

export async function createPromptTaxonomyWorkbook(plan: PromptTaxonomyPlan) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = plan.preparedBy;
  workbook.company = plan.preparedBy;
  workbook.title = `${plan.brand} AI Search Topic & Prompt Tracking Plan`;
  workbook.subject = "Client-ready AI search prompt taxonomy and tracking plan";
  workbook.keywords = "AI search, GEO, AEO, prompt taxonomy, prompt tracking";
  workbook.created = new Date();
  workbook.modified = new Date();
  workbook.calcProperties.fullCalcOnLoad = true;

  addReadMe(workbook, plan);
  addTopicArchitecture(workbook, plan);
  addPromptLibrary(workbook, plan);
  addProfoundImport(workbook, plan);
  addCompetitors(workbook, plan);
  addEntityWatchlist(workbook, plan);

  const bytes = await workbook.xlsx.writeBuffer();
  return Buffer.from(bytes);
}

function addReadMe(workbook: ExcelJS.Workbook, plan: PromptTaxonomyPlan) {
  const sheet = workbook.addWorksheet("Read Me", {
    views: [{ showGridLines: false }],
    properties: { tabColor: { argb: COLORS.navy } },
  });
  sheet.columns = [
    { key: "a", width: 29 },
    { key: "b", width: 30 },
    { key: "c", width: 22 },
    { key: "d", width: 22 },
    { key: "e", width: 22 },
    { key: "f", width: 22 },
    { key: "g", width: 22 },
    { key: "h", width: 22 },
  ];
  mergeTitle(sheet, "A1:H1", `${plan.brand} — AI Search Topic & Prompt Tracking Plan`, 20);
  sheet.mergeCells("A2:H2");
  sheet.getCell("A2").value = `${plan.preparedBy}  |  ${plan.domain}  |  ${plan.preparedAt}`;
  sheet.getCell("A2").style = subtitleStyle();
  if (plan.containsMock || plan.isDraft) {
    sheet.mergeCells("A3:H3");
    sheet.getCell("A3").value = plan.isDraft
      ? plan.containsMock
        ? "WORKING DRAFT · DEMO DATA · NOT FOR CLIENT USE"
        : "WORKING DRAFT · QUALITY REVIEW REQUIRED"
      : "DEMO DATA · NOT FOR CLIENT USE";
    sheet.getCell("A3").style = {
      fill: { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.gold } },
      font: { name: FONT, size: 10, bold: true, color: { argb: COLORS.ink } },
      alignment: { horizontal: "center", vertical: "middle" },
    };
  }

  const metrics = [
    ["TOPICS", plan.quality.topicCount],
    ["PROMPTS", plan.quality.exportedPromptCount],
    ["UNBRANDED", plan.quality.unbrandedShare],
    ["PHASE 1", plan.quality.phaseOneCount],
  ] as const;
  metrics.forEach(([label, value], index) => {
    const start = index * 2 + 1;
    sheet.mergeCells(5, start, 5, start + 1);
    sheet.mergeCells(6, start, 6, start + 1);
    const labelCell = sheet.getCell(5, start);
    labelCell.value = label;
    labelCell.style = {
      fill: { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.accentLight } },
      font: { name: FONT, size: 9, bold: true, color: { argb: COLORS.navy } },
      alignment: { horizontal: "center", vertical: "middle" },
      border: outlineBorder(),
    };
    const valueCell = sheet.getCell(6, start);
    valueCell.value = value;
    valueCell.style = {
      fill: { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.white } },
      font: { name: FONT, size: 16, bold: true, color: { argb: COLORS.navy } },
      alignment: { horizontal: "center", vertical: "middle" },
      border: outlineBorder(),
      numFmt: label === "UNBRANDED" ? "0%" : "0",
    };
  });

  let row = 9;
  row = addReadMeSection(sheet, row, "HOW TO USE THIS WORKBOOK", [
    [
      "Topic Architecture",
      "Create the reporting topics first; each topic is tied to a commercial objective, audience, phase, and success metric.",
    ],
    [
      "Prompt Library",
      "The complete client taxonomy. Filter by phase, prompt type, audience, search intent, product line, region, or signal.",
    ],
    [
      "Profound Import",
      "A paste-ready three-column view for Profound or another answer-engine tracking platform.",
    ],
    [
      "Competitor Tracking",
      "Configure competitors within relevant product-line buckets so share of voice remains meaningful.",
    ],
    [
      "Entity Watchlist",
      "Resolve name collisions and structural risks in parallel with the first month of measurement.",
    ],
  ]);
  row = addReadMeSection(
    sheet,
    row + 1,
    "HOW THE PROMPT SET IS CONSTRUCTED",
    plan.construction.map((item) => [item.label, item.text]),
  );
  row = addReadMeSection(
    sheet,
    row + 1,
    "PHASING",
    plan.phasing.map((item) => [item.label, item.text]),
  );
  row = addReadMeSection(
    sheet,
    row + 1,
    "BEFORE READING THE FIRST REPORT",
    plan.firstRead.map((item) => [item.label, item.text]),
  );
  if (plan.quality.warnings.length) {
    addReadMeSection(
      sheet,
      row + 1,
      "PLAN QUALITY NOTES",
      plan.quality.warnings.map((warning) => ["Review", warning]),
      true,
    );
  }
  sheet.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 };
}

function addTopicArchitecture(workbook: ExcelJS.Workbook, plan: PromptTaxonomyPlan) {
  const sheet = tableSheet(workbook, "Topic Architecture", COLORS.accent);
  addTableTitle(
    sheet,
    "Topic Architecture",
    `Create these ${plan.topics.length} reporting topics first. Prompt counts are formula-driven from the Prompt Library tab.`,
    6,
  );
  const headers = [
    "Topic",
    "Business Objective",
    "Primary Audience",
    "Phase",
    "Prompts",
    "Success Metric",
  ];
  addHeader(sheet, 4, headers);
  setWidths(sheet, [39, 70, 26, 9, 10, 43]);
  plan.topics.forEach((topic, index) => {
    const rowNumber = index + 5;
    const row = sheet.getRow(rowNumber);
    row.values = [
      topic.topic,
      topic.objective,
      topic.audience,
      topic.phase,
      topic.promptCount,
      topic.metric,
    ];
    row.getCell(5).value = {
      formula: `COUNTIF('Prompt Library'!$B$5:$B$${plan.prompts.length + 4},A${rowNumber})`,
      result: topic.promptCount,
    };
    styleDataRow(row, index, [4, 5]);
    row.height = 46;
  });
  const totalRow = plan.topics.length + 5;
  sheet.getCell(totalRow, 1).value = "TOTAL";
  sheet.getCell(totalRow, 5).value = {
    formula: `SUM(E5:E${totalRow - 1})`,
    result: plan.prompts.length,
  };
  sheet.getRow(totalRow).eachCell({ includeEmpty: true }, (cell) => {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.gold } };
    cell.font = { name: FONT, size: 10, bold: true, color: { argb: COLORS.ink } };
    cell.border = outlineBorder();
  });
  sheet.autoFilter = `A4:F${totalRow - 1}`;
  freeze(sheet, 4, 0);
}

function addPromptLibrary(workbook: ExcelJS.Workbook, plan: PromptTaxonomyPlan) {
  const sheet = tableSheet(workbook, "Prompt Library", COLORS.navyMid);
  addTableTitle(
    sheet,
    "Prompt Library",
    "Filter Phase = 1 for the initial build. Unbranded prompts are the majority by design—they measure competitive position honestly.",
    17,
  );
  const headers = [
    "ID",
    "Topic",
    "Prompt",
    "Prompt Type",
    "Primary Audience",
    "Search Intent",
    "Business Line",
    "Region",
    "Phase",
    "Signal Tracked",
    "Persona",
    "Search Theme",
    "Source Prompt ID",
    "Related Prompt ID",
    "Quality Score",
    "Evidence References",
    "Review Status",
  ];
  addHeader(sheet, 4, headers);
  setWidths(sheet, [8, 38, 78, 23, 25, 16, 24, 11, 9, 25, 28, 32, 18, 18, 14, 44, 18]);
  plan.prompts.forEach((prompt, index) => {
    const row = sheet.getRow(index + 5);
    row.values = [
      prompt.id,
      prompt.topic,
      prompt.prompt,
      prompt.type,
      prompt.audience,
      prompt.stage,
      prompt.line,
      prompt.region,
      prompt.phase,
      prompt.signal,
      prompt.persona,
      prompt.pathway,
      prompt.promptId,
      prompt.parentPromptId || null,
      prompt.qualityScore,
      prompt.evidenceReferences,
      prompt.reviewStatus.replaceAll("_", " "),
    ];
    styleDataRow(row, index, [1, 8, 9, 15]);
    row.height = Math.max(28, Math.min(58, 18 + Math.ceil(prompt.prompt.length / 85) * 12));
    row.getCell(9).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: {
        argb: prompt.phase === 1 ? COLORS.green : prompt.phase === 2 ? COLORS.gold : COLORS.surface,
      },
    };
    row.getCell(15).numFmt = "0";
    row.getCell(4).dataValidation = {
      type: "list",
      allowBlank: false,
      formulae: ['"Branded,Unbranded,Competitor-Comparative,Entity Disambiguation"'],
    };
    row.getCell(6).dataValidation = {
      type: "list",
      allowBlank: false,
      formulae: ['"Explore,Evaluate,Choose,Trust"'],
    };
    row.getCell(9).dataValidation = {
      type: "list",
      allowBlank: false,
      formulae: ['"1,2,3"'],
    };
  });
  const end = plan.prompts.length + 4;
  sheet.autoFilter = `A4:Q${end}`;
  freeze(sheet, 4, 2);
}

function addProfoundImport(workbook: ExcelJS.Workbook, plan: PromptTaxonomyPlan) {
  const sheet = tableSheet(workbook, "Profound Import", COLORS.accent);
  addTableTitle(
    sheet,
    "Import — paste-ready",
    plan.isDraft
      ? "Working draft. Resolve quality notes before importing. Filter Phase = 1 for the initial build."
      : "Two columns plus phase. Filter Phase = 1 for the initial build, then copy or save this tab as CSV.",
    3,
  );
  addHeader(sheet, 4, ["Topic", "Prompt", "Phase"]);
  setWidths(sheet, [42, 94, 10]);
  plan.prompts.forEach((prompt, index) => {
    const row = sheet.getRow(index + 5);
    row.values = [prompt.topic, prompt.prompt, prompt.phase];
    styleDataRow(row, index, [3]);
    row.height = Math.max(26, Math.min(52, 18 + Math.ceil(prompt.prompt.length / 95) * 11));
  });
  const end = plan.prompts.length + 4;
  sheet.autoFilter = `A4:C${end}`;
  freeze(sheet, 4, 0);
}

function addCompetitors(workbook: ExcelJS.Workbook, plan: PromptTaxonomyPlan) {
  const sheet = tableSheet(workbook, "Competitor Tracking", COLORS.navyMid);
  addTableTitle(
    sheet,
    "Competitor Set",
    "Configure competitors by product line. Comparing unrelated markets in one share-of-voice set produces noise, not insight.",
    4,
  );
  addHeader(sheet, 4, ["Competitor", "Line / Bucket", "Why Track", "Phase"]);
  setWidths(sheet, [35, 27, 82, 10]);
  plan.competitors.forEach((competitor, index) => {
    const row = sheet.getRow(index + 5);
    row.values = [competitor.name, competitor.bucket, competitor.why, competitor.phase];
    styleDataRow(row, index, [4]);
    row.height = 42;
  });
  if (plan.competitors.length) sheet.autoFilter = `A4:D${plan.competitors.length + 4}`;
  freeze(sheet, 4, 0);
}

function addEntityWatchlist(workbook: ExcelJS.Workbook, plan: PromptTaxonomyPlan) {
  const sheet = tableSheet(workbook, "Entity Watchlist", COLORS.navyMid);
  addTableTitle(
    sheet,
    "Entity & Structural Watchlist",
    "Resolve these alongside month one. Each issue can distort the measurement independently of content quality.",
    4,
  );
  addHeader(sheet, 4, ["Issue", "Why It Distorts Results", "Severity", "Recommended Action"]);
  setWidths(sheet, [35, 67, 13, 75]);
  plan.entityRisks.forEach((risk, index) => {
    const row = sheet.getRow(index + 5);
    row.values = [risk.issue, risk.why, risk.severity, risk.action];
    styleDataRow(row, index, [3]);
    row.height = 58;
    row.getCell(3).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: {
        argb:
          risk.severity === "High"
            ? COLORS.red
            : risk.severity === "Low"
              ? COLORS.green
              : COLORS.gold,
      },
    };
  });
  if (plan.entityRisks.length) sheet.autoFilter = `A4:D${plan.entityRisks.length + 4}`;
  freeze(sheet, 4, 0);
}

function tableSheet(workbook: ExcelJS.Workbook, name: string, tabColor: string) {
  const sheet = workbook.addWorksheet(name, {
    views: [{ showGridLines: false }],
    properties: { tabColor: { argb: tabColor } },
    pageSetup: { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  return sheet;
}

function addTableTitle(sheet: ExcelJS.Worksheet, title: string, subtitle: string, columns: number) {
  mergeTitle(sheet, `A1:${columnLetter(columns)}1`, title, 18);
  sheet.mergeCells(`A2:${columnLetter(columns)}2`);
  const cell = sheet.getCell("A2");
  cell.value = subtitle;
  cell.style = subtitleStyle();
  sheet.getRow(2).height = 27;
}

function mergeTitle(sheet: ExcelJS.Worksheet, range: string, title: string, size: number) {
  sheet.mergeCells(range);
  const cell = sheet.getCell(range.split(":")[0]!);
  cell.value = title;
  cell.style = {
    fill: { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.navy } },
    font: { name: FONT, size, bold: true, color: { argb: COLORS.white } },
    alignment: { vertical: "middle", horizontal: "left" },
  };
  sheet.getRow(Number(cell.row)).height = 36;
}

function addHeader(sheet: ExcelJS.Worksheet, rowNumber: number, headers: string[]) {
  const row = sheet.getRow(rowNumber);
  row.values = headers;
  row.height = 30;
  row.eachCell((cell) => {
    cell.style = {
      fill: { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.navyMid } },
      font: { name: FONT, size: 10, bold: true, color: { argb: COLORS.white } },
      alignment: { wrapText: true, vertical: "middle", horizontal: "left" },
      border: outlineBorder(),
    };
  });
}

function styleDataRow(row: ExcelJS.Row, index: number, centeredColumns: number[]) {
  row.eachCell({ includeEmpty: true }, (cell, columnNumber) => {
    cell.style = {
      fill: {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: index % 2 ? COLORS.surface : COLORS.white },
      },
      font: { name: FONT, size: 10, color: { argb: COLORS.ink } },
      alignment: {
        wrapText: true,
        vertical: "top",
        horizontal: centeredColumns.includes(columnNumber) ? "center" : "left",
      },
      border: outlineBorder(),
    };
  });
}

function addReadMeSection(
  sheet: ExcelJS.Worksheet,
  startRow: number,
  heading: string,
  items: string[][],
  warning = false,
) {
  sheet.mergeCells(startRow, 1, startRow, 8);
  const headingCell = sheet.getCell(startRow, 1);
  headingCell.value = heading;
  headingCell.style = {
    fill: { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.navyMid } },
    font: { name: FONT, size: 10, bold: true, color: { argb: COLORS.white } },
    alignment: { vertical: "middle" },
  };
  sheet.getRow(startRow).height = 24;
  items.forEach(([label, text], index) => {
    const row = startRow + index + 1;
    sheet.mergeCells(row, 2, row, 8);
    sheet.getCell(row, 1).value = label;
    sheet.getCell(row, 2).value = text;
    for (let column = 1; column <= 8; column++) {
      const cell = sheet.getCell(row, column);
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: warning ? COLORS.gold : index % 2 ? COLORS.surface : COLORS.white },
      };
      cell.font = {
        name: FONT,
        size: 10,
        bold: column === 1,
        color: { argb: column === 1 ? COLORS.navy : COLORS.ink },
      };
      cell.alignment = { wrapText: true, vertical: "top" };
      cell.border = outlineBorder();
    }
    sheet.getRow(row).height = Math.max(
      30,
      Math.min(58, 22 + Math.ceil((text?.length ?? 0) / 120) * 11),
    );
  });
  return startRow + items.length + 1;
}

function subtitleStyle(): Partial<ExcelJS.Style> {
  return {
    fill: { type: "pattern", pattern: "solid", fgColor: { argb: COLORS.surface } },
    font: { name: FONT, size: 10, color: { argb: COLORS.muted } },
    alignment: { vertical: "middle", wrapText: true },
  };
}

function outlineBorder(): Partial<ExcelJS.Borders> {
  const side = { style: "thin" as const, color: { argb: COLORS.border } };
  return { top: side, left: side, bottom: side, right: side };
}

function setWidths(sheet: ExcelJS.Worksheet, widths: number[]) {
  widths.forEach((width, index) => {
    sheet.getColumn(index + 1).width = width;
  });
}

function freeze(sheet: ExcelJS.Worksheet, ySplit: number, xSplit: number) {
  sheet.views = [{ state: "frozen", xSplit, ySplit, showGridLines: false }];
}

function columnLetter(index: number) {
  let value = index;
  let result = "";
  while (value > 0) {
    value--;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}
