import "server-only";

import path from "node:path";
import PptxGenJS from "pptxgenjs";
import { resolvePersonaPresentationProfile, type PersonaProfile } from "@/contracts/studio";
import { requireCapability, type ProjectContext } from "@/lib/auth/context";
import { ValidationError } from "@/lib/errors";
import { slugify } from "@/lib/ids";
import { recordAudit } from "@/services/audit";
import { listActivePersonas } from "@/services/personas";
import { getProject } from "@/services/projects";

const COLORS = {
  ink: "12131A",
  inkMuted: "3D3F50",
  quiet: "9EA0B5",
  line: "DDDDEB",
  navy: "101321",
  purple: "8B74D0",
  purpleDark: "251957",
  green: "2D7A49",
  red: "C85A4A",
  white: "FFFFFF",
} as const;

const FONT = {
  brand: "Onest",
  display: "Cambria",
  body: "Calibri",
} as const;

type PersonaDeckItem = {
  name: string;
  version: number;
  dataOrigin: "mock" | "live" | "local";
  profile: PersonaProfile;
};

export type PersonaDeckInput = {
  clientName: string;
  generatedAt: Date;
  personas: PersonaDeckItem[];
};

function addText(slide: PptxGenJS.Slide, text: string, options: PptxGenJS.TextPropsOptions) {
  slide.addText(text, {
    fontFace: FONT.body,
    color: COLORS.ink,
    margin: 0,
    breakLine: false,
    ...options,
  });
}

function addLogo(slide: PptxGenJS.Slide) {
  slide.addImage({
    path: path.join(process.cwd(), "public", "deck", "829-mark.png"),
    x: 0.28,
    y: 0.2,
    w: 0.28,
    h: 0.28,
    transparency: 4,
  });
}

function addNotes(slide: PptxGenJS.Slide, lines: string[]) {
  slide.addNotes(`[Sources]\n${lines.map((line) => `- ${line}`).join("\n")}`);
}

function addFooter(slide: PptxGenJS.Slide, clientName: string, demo: boolean) {
  addText(slide, `${clientName} | Audience Personas`, {
    x: 0.3,
    y: 5.4,
    w: 7,
    h: 0.18,
    fontSize: 7,
    color: COLORS.quiet,
  });
  if (demo) {
    addText(slide, "DEMO DATA · NOT FOR CLIENT USE", {
      x: 7.25,
      y: 5.4,
      w: 2.45,
      h: 0.18,
      align: "right",
      fontSize: 7,
      bold: true,
      color: COLORS.red,
    });
  }
}

function addDarkSlide(
  pptx: PptxGenJS,
  firstLine: string,
  secondLine: string,
  options: {
    topRight?: string;
    website?: string;
    demo?: boolean;
    scale?: "cover" | "divider";
  } = {},
) {
  const slide = pptx.addSlide();
  slide.background = { color: COLORS.navy };
  addLogo(slide);
  if (options.topRight) {
    addText(slide, options.topRight, {
      x: 7,
      y: 0.2,
      w: 2.7,
      h: 0.25,
      align: "right",
      fontSize: 7.5,
      color: COLORS.quiet,
    });
  }
  if (options.website) {
    addText(slide, options.website, {
      x: 7.5,
      y: 0.2,
      w: 2.2,
      h: 0.25,
      align: "right",
      fontSize: 7.5,
      color: COLORS.quiet,
    });
  }
  addText(slide, firstLine, {
    x: 0.55,
    y: 1.55,
    w: 8.55,
    h: 0.95,
    fontFace: FONT.brand,
    fontSize: options.scale === "cover" ? 54 : 72,
    color: COLORS.white,
    fit: "shrink",
    valign: "middle",
  });
  addText(slide, secondLine, {
    x: 0.55,
    y: 2.5,
    w: 8.55,
    h: 0.85,
    fontFace: FONT.brand,
    fontSize: options.scale === "cover" ? 54 : 72,
    color: COLORS.quiet,
    fit: "shrink",
    valign: "middle",
  });
  if (options.demo) {
    addText(slide, "DEMO DATA · NOT FOR CLIENT USE", {
      x: 0.55,
      y: 4.82,
      w: 4,
      h: 0.25,
      fontSize: 8,
      bold: true,
      color: "F08A7E",
    });
  }
  return slide;
}

function addContentsSlide(pptx: PptxGenJS, clientName: string, demo: boolean) {
  const slide = pptx.addSlide();
  slide.background = { color: COLORS.white };
  addText(slide, "Contents", {
    x: 0.42,
    y: 0.31,
    w: 9.2,
    h: 0.25,
    fontSize: 8,
    color: COLORS.inkMuted,
  });
  slide.addText(
    [
      { text: "1. / ", options: { color: COLORS.quiet } },
      { text: "Purpose of Personas\n", options: { color: "43516B", breakLine: true } },
      { text: "2. / ", options: { color: COLORS.quiet } },
      { text: `${clientName} Personas`, options: { color: "43516B" } },
    ],
    {
      x: 0.48,
      y: 0.88,
      w: 8.7,
      h: 2.1,
      margin: 0,
      fontFace: FONT.brand,
      fontSize: 21,
      breakLine: false,
      paraSpaceAfter: 8,
      fit: "shrink",
    },
  );
  if (demo) addFooter(slide, clientName, true);
  addNotes(slide, ["Deck structure follows the supplied 829 Studios audience-persona reference."]);
}

function addPurposeDefinitionSlide(pptx: PptxGenJS, clientName: string, demo: boolean) {
  const slide = pptx.addSlide();
  addText(slide, "What Personas Are, and What They Aren’t", {
    x: 0.5,
    y: 0.68,
    w: 9,
    h: 0.7,
    fontFace: FONT.brand,
    fontSize: 24,
    color: COLORS.purpleDark,
  });
  addText(slide, "What Personas ARE", {
    x: 0.5,
    y: 1.68,
    w: 4.15,
    h: 0.35,
    fontSize: 10,
    bold: true,
    color: COLORS.green,
  });
  addText(slide, "What Personas ARE NOT", {
    x: 5.35,
    y: 1.68,
    w: 4.15,
    h: 0.35,
    fontSize: 10,
    bold: true,
    color: COLORS.red,
  });
  const are = [
    "Distinct audience segments grounded in client and audience evidence",
    "Named lenses that shape every content brief and recommendation",
    "Working profiles that define tone, angles, proof, and guardrails",
    "Built to guide SEO, GEO, and content strategy",
  ];
  const areNot = [
    "Demographic buckets treated as individual facts",
    "One-size-fits-all reader profiles",
    "Static biographies that never change the work produced",
    "Generic personas borrowed from an unrelated framework",
  ];
  for (let index = 0; index < 4; index++) {
    const y = 2.16 + index * 0.75;
    slide.addShape(pptx.ShapeType.ellipse, {
      x: 0.5,
      y,
      w: 0.3,
      h: 0.3,
      line: { color: COLORS.green, transparency: 100 },
      fill: { color: COLORS.green },
    });
    addText(slide, "✓", {
      x: 0.5,
      y: y - 0.01,
      w: 0.3,
      h: 0.3,
      align: "center",
      valign: "middle",
      fontSize: 9,
      bold: true,
      color: COLORS.white,
    });
    addText(slide, are[index]!, {
      x: 0.95,
      y: y - 0.02,
      w: 3.7,
      h: 0.55,
      fontSize: 10,
      color: COLORS.ink,
      valign: "top",
      fit: "shrink",
    });
    slide.addShape(pptx.ShapeType.ellipse, {
      x: 5.35,
      y,
      w: 0.3,
      h: 0.3,
      line: { color: COLORS.red, transparency: 100 },
      fill: { color: COLORS.red },
    });
    addText(slide, "×", {
      x: 5.35,
      y: y - 0.01,
      w: 0.3,
      h: 0.3,
      align: "center",
      valign: "middle",
      fontSize: 11,
      bold: true,
      color: COLORS.white,
    });
    addText(slide, areNot[index]!, {
      x: 5.8,
      y: y - 0.02,
      w: 3.7,
      h: 0.55,
      fontSize: 10,
      color: COLORS.ink,
      valign: "top",
      fit: "shrink",
    });
  }
  addFooter(slide, clientName, demo);
  addNotes(slide, ["Persona definition adapted from the supplied 829 Studios reference deck."]);
}

function addWhyPersonasMatterSlide(pptx: PptxGenJS, clientName: string, demo: boolean) {
  const slide = pptx.addSlide();
  addText(slide, "Why Personas Matter", {
    x: 0.45,
    y: 0.34,
    w: 9.1,
    h: 0.55,
    fontFace: FONT.brand,
    fontSize: 24,
    color: COLORS.purpleDark,
  });
  addText(
    slide,
    "Personas turn broad audience research into a consistent decision lens. They help strategy teams shape claims, proof, language, and content formats around distinct audience needs.",
    {
      x: 0.45,
      y: 1.0,
      w: 9.1,
      h: 0.72,
      align: "center",
      valign: "middle",
      fontSize: 10,
      color: COLORS.inkMuted,
      fit: "shrink",
    },
  );
  addText(slide, "Candidate Content Angles", {
    x: 1.05,
    y: 2.03,
    w: 1.9,
    h: 0.3,
    align: "center",
    fontSize: 8,
    color: COLORS.purpleDark,
  });
  addText(slide, "Persona Evidence & Consistency Filter", {
    x: 3.75,
    y: 1.92,
    w: 2.75,
    h: 0.3,
    align: "center",
    fontSize: 8,
    color: COLORS.purpleDark,
  });
  slide.addShape(pptx.ShapeType.rect, {
    x: 1.1,
    y: 2.5,
    w: 1.2,
    h: 2.35,
    fill: { color: COLORS.white, transparency: 100 },
    line: { color: COLORS.purpleDark, width: 1 },
  });
  slide.addShape(pptx.ShapeType.line, {
    x: 5.15,
    y: 2.38,
    w: 0,
    h: 2.55,
    line: { color: COLORS.purple, width: 1, dashType: "dash" },
  });
  for (let index = 0; index < 4; index++) {
    const y = 2.76 + index * 0.56;
    slide.addShape(pptx.ShapeType.ellipse, {
      x: 1.35,
      y,
      w: 0.22,
      h: 0.22,
      fill: { color: COLORS.white },
      line: { color: COLORS.purpleDark, width: 1 },
    });
    slide.addShape(pptx.ShapeType.line, {
      x: 1.57,
      y: y + 0.11,
      w: 6.2,
      h: 0,
      line: { color: COLORS.purple, width: 1.2 },
    });
    const accepted = index < 3;
    slide.addShape(pptx.ShapeType.ellipse, {
      x: accepted ? 7.72 : 7.78,
      y: accepted ? y - 0.02 : y + 0.42,
      w: accepted ? 0.28 : 0.32,
      h: accepted ? 0.28 : 0.32,
      fill: accepted ? { color: COLORS.purple } : { color: COLORS.white },
      line: { color: accepted ? COLORS.purple : COLORS.inkMuted, width: 1 },
    });
    if (!accepted) {
      slide.addShape(pptx.ShapeType.line, {
        x: 7.78,
        y: y + 0.11,
        w: 0,
        h: 0.47,
        line: { color: COLORS.purple, width: 1.2 },
      });
    }
  }
  addFooter(slide, clientName, demo);
  addNotes(slide, ["Explanatory model adapted from the supplied 829 Studios reference deck."]);
}

function evidenceIds(profile: PersonaProfile) {
  const deck = resolvePersonaPresentationProfile(profile);
  return [
    deck.role,
    deck.industry,
    deck.expertiseLevel,
    deck.tone,
    deck.povLens,
    ...deck.caresAbout,
    ...deck.neverSay,
    ...deck.contentBestSuitedFor,
  ].flatMap((item) => item.signalIds);
}

function addPersonaProfileSlide(
  pptx: PptxGenJS,
  clientName: string,
  persona: PersonaDeckItem,
  index: number,
  total: number,
  demo: boolean,
) {
  const slide = pptx.addSlide();
  const deck = resolvePersonaPresentationProfile(persona.profile);
  addText(slide, `Persona ${index + 1} of ${total}`, {
    x: 0.3,
    y: 0.18,
    w: 9,
    h: 0.22,
    fontSize: 9,
  });
  addText(slide, persona.name, {
    x: 0.55,
    y: 0.5,
    w: 9,
    h: 0.75,
    fontFace: FONT.display,
    fontSize: 34,
    fit: "shrink",
    valign: "middle",
  });
  const rows = [
    { label: "Title / Role", value: deck.role.text, y: 1.38, h: 0.28 },
    { label: "Industry", value: deck.industry.text, y: 1.88, h: 0.28 },
    { label: "Expertise Level", value: deck.expertiseLevel.text, y: 2.38, h: 0.28 },
    { label: "Tone", value: deck.tone.text, y: 2.88, h: 0.6 },
    { label: "POV / Lens", value: deck.povLens.text, y: 3.62, h: 0.95 },
  ];
  const separators = [1.3, 1.76, 2.26, 2.76, 3.49];
  for (const y of separators) {
    slide.addShape(pptx.ShapeType.line, {
      x: 0.55,
      y,
      w: 9,
      h: 0,
      line: { color: COLORS.line, width: 1 },
    });
  }
  for (const row of rows) {
    addText(slide, row.label, {
      x: 0.65,
      y: row.y,
      w: 2.4,
      h: 0.25,
      fontSize: 9,
      bold: true,
      color: COLORS.inkMuted,
      valign: "top",
    });
    addText(slide, row.value, {
      x: 3.15,
      y: row.y,
      w: 6.35,
      h: row.h,
      fontSize: 11,
      color: COLORS.ink,
      valign: "top",
      fit: "shrink",
    });
  }
  addFooter(slide, clientName, demo);
  addNotes(slide, [
    `Persona Builder Studio persona version ${persona.version}.`,
    `Evidence IDs: ${[...new Set(evidenceIds(persona.profile))].join(", ") || "none"}.`,
  ]);
}

function listCopy(items: string[], marker: string, limit: number) {
  return items
    .slice(0, limit)
    .map((item) => `${marker}  ${item}`)
    .join("\n\n");
}

function addPersonaStrategySlide(
  pptx: PptxGenJS,
  clientName: string,
  persona: PersonaDeckItem,
  index: number,
  total: number,
  demo: boolean,
) {
  const slide = pptx.addSlide();
  const deck = resolvePersonaPresentationProfile(persona.profile);
  addText(slide, `Persona ${index + 1} of ${total}`, {
    x: 0.3,
    y: 0.18,
    w: 9,
    h: 0.22,
    fontSize: 9,
  });
  addText(slide, persona.name, {
    x: 0.55,
    y: 0.48,
    w: 9,
    h: 0.62,
    fontFace: FONT.display,
    fontSize: 30,
    fit: "shrink",
    valign: "middle",
  });
  slide.addShape(pptx.ShapeType.line, {
    x: 0.55,
    y: 1.12,
    w: 9,
    h: 0,
    line: { color: COLORS.line, width: 1 },
  });
  const columns = [
    {
      title: "What They Care About",
      x: 0.65,
      w: 2.75,
      body: listCopy(
        deck.caresAbout.map((item) => item.text),
        "✓",
        5,
      ),
    },
    {
      title: "What They Would Never Say",
      x: 3.85,
      w: 2.75,
      body: listCopy(
        deck.neverSay.map((item) => item.text),
        "→",
        4,
      ),
    },
    {
      title: "Content Best Suited For",
      x: 7.05,
      w: 2.65,
      body: deck.contentBestSuitedFor
        .slice(0, 3)
        .map((item) => item.text)
        .join("\n\n"),
    },
  ];
  for (const x of [3.55, 6.75]) {
    slide.addShape(pptx.ShapeType.line, {
      x,
      y: 1.2,
      w: 0,
      h: 3.97,
      line: { color: COLORS.line, width: 1 },
    });
  }
  for (const column of columns) {
    addText(slide, column.title, {
      x: column.x,
      y: 1.2,
      w: column.w,
      h: 0.34,
      fontSize: 9,
      bold: true,
      color: COLORS.inkMuted,
    });
    addText(slide, column.body, {
      x: column.x,
      y: 1.58,
      w: column.w,
      h: 3.65,
      fontSize: 10.5,
      breakLine: true,
      color: COLORS.ink,
      valign: "middle",
      fit: "shrink",
    });
  }
  addFooter(slide, clientName, demo);
  addNotes(slide, [
    `Persona Builder Studio persona version ${persona.version}.`,
    `Evidence IDs: ${[...new Set(evidenceIds(persona.profile))].join(", ") || "none"}.`,
  ]);
}

export function createPersonaDeckPresentation(input: PersonaDeckInput) {
  if (!input.personas.length)
    throw new ValidationError("Generate personas before exporting a deck.");
  const personas = input.personas.slice(0, 5);
  const demo = personas.some((persona) => persona.dataOrigin === "mock");
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_16x9";
  pptx.author = "Persona Builder Studio";
  pptx.company = "829 Studios";
  pptx.subject = `${input.clientName} audience personas`;
  pptx.title = `${input.clientName} Audience Personas`;
  pptx.theme = { headFontFace: FONT.display, bodyFontFace: FONT.body };
  pptx.defineSlideMaster({
    title: "PERSONA_WHITE",
    background: { color: COLORS.white },
    objects: [],
    slideNumber: {
      x: 9.55,
      y: 5.4,
      w: 0.2,
      h: 0.15,
      fontFace: FONT.body,
      fontSize: 6,
      color: COLORS.quiet,
    },
  });

  const period = new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(
    input.generatedAt,
  );
  const cover = addDarkSlide(pptx, input.clientName, "Audience Personas", {
    topRight: period,
    demo,
    scale: "cover",
  });
  addNotes(cover, [
    "Visual format follows the supplied 829 Studios audience-persona reference deck.",
  ]);
  addContentsSlide(pptx, input.clientName, demo);
  const purpose = addDarkSlide(pptx, "Purpose of", "Personas", { demo });
  addNotes(purpose, [
    "Visual format follows the supplied 829 Studios audience-persona reference deck.",
  ]);
  addPurposeDefinitionSlide(pptx, input.clientName, demo);
  addWhyPersonasMatterSlide(pptx, input.clientName, demo);
  const section = addDarkSlide(pptx, input.clientName, "Personas", { demo });
  addNotes(section, [
    "Visual format follows the supplied 829 Studios audience-persona reference deck.",
  ]);
  personas.forEach((persona, index) => {
    addPersonaProfileSlide(pptx, input.clientName, persona, index, personas.length, demo);
    addPersonaStrategySlide(pptx, input.clientName, persona, index, personas.length, demo);
  });
  const closing = addDarkSlide(pptx, "Thank", "You", { website: "829studios.com", demo });
  addNotes(closing, [
    "Visual format follows the supplied 829 Studios audience-persona reference deck.",
  ]);
  return pptx;
}

export async function buildPersonaDeckPptx(ctx: ProjectContext) {
  requireCapability(ctx, "export:read");
  const [project, active] = await Promise.all([getProject(ctx), listActivePersonas(ctx)]);
  if (!active.length) throw new ValidationError("Generate personas before exporting a deck.");
  const presentation = createPersonaDeckPresentation({
    clientName: project.name,
    generatedAt: new Date(),
    personas: active.map(({ version }) => ({
      name: version.name,
      version: version.version,
      dataOrigin: version.dataOrigin,
      profile: version.profile,
    })),
  });
  const bytes = await presentation.write({ outputType: "nodebuffer", compression: true });
  const buffer = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes as Uint8Array);
  await recordAudit({
    organizationId: ctx.organizationId,
    projectId: ctx.projectId,
    actorUserId: ctx.userId,
    action: "persona.deck_export",
    entityType: "project",
    entityId: ctx.projectId,
    metadata: { personaCount: active.length, format: "pptx" },
  });
  return {
    buffer,
    filename: `${slugify(project.name)}-audience-personas.pptx`,
  };
}
