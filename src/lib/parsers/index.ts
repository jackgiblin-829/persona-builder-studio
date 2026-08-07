import "server-only";
import Papa from "papaparse";
import { ValidationError } from "@/lib/errors";

/**
 * Source parsers.
 *
 * Each parser turns a raw upload into `ParsedDocument[]` — the unit that later
 * gets redacted, chunked and extracted. `location` must be specific enough for
 * the UI to show a user exactly where a piece of evidence came from.
 */

export type ParsedDocument = {
  title: string | null;
  /** e.g. "row 14", "https://…/pricing", "00:12:30–00:14:02" */
  location: string;
  text: string;
  speaker?: string | null;
  observedAt?: Date | null;
  metadata: Record<string, unknown>;
};

export type ParseResult = {
  documents: ParsedDocument[];
  warnings: string[];
};

export type SupportedFormat =
  | "csv"
  | "json"
  | "txt"
  | "markdown"
  | "docx"
  | "pdf"
  | "pasted_text"
  | "transcript"
  | "search_console_csv";

export function detectFormat(filename: string, contentType: string | null): SupportedFormat | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".csv")) return "csv";
  if (lower.endsWith(".json")) return "json";
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "markdown";
  if (lower.endsWith(".txt")) return "txt";
  if (lower.endsWith(".docx")) return "docx";
  if (lower.endsWith(".pdf")) return "pdf";
  if (contentType?.includes("csv")) return "csv";
  if (contentType?.includes("json")) return "json";
  if (contentType?.includes("markdown")) return "markdown";
  if (contentType?.includes("text/plain")) return "txt";
  if (contentType?.includes("wordprocessingml")) return "docx";
  if (contentType?.includes("pdf")) return "pdf";
  return null;
}

/**
 * Magic-byte check. Extensions and MIME types are attacker-controlled, so a
 * DOCX must actually be a ZIP and a text format must not be a binary.
 */
export function verifyMagicBytes(format: SupportedFormat, buffer: Buffer): void {
  if (format === "docx") {
    const isZip = buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
    if (!isZip)
      throw new ValidationError("This file is not a valid .docx (expected a ZIP container).");
    return;
  }
  if (format === "pdf") {
    const isPdf =
      buffer.length > 4 &&
      buffer[0] === 0x25 &&
      buffer[1] === 0x50 &&
      buffer[2] === 0x44 &&
      buffer[3] === 0x46;
    if (!isPdf) throw new ValidationError("This file is not a valid PDF (expected a %PDF header).");
    return;
  }
  // Reject files that begin with a known binary signature but claim to be text.
  const signatures: [number[], string][] = [
    [[0x25, 0x50, 0x44, 0x46], "PDF"],
    [[0x89, 0x50, 0x4e, 0x47], "PNG"],
    [[0xff, 0xd8, 0xff], "JPEG"],
    [[0x1f, 0x8b], "gzip"],
    [[0x7f, 0x45, 0x4c, 0x46], "ELF executable"],
    [[0x4d, 0x5a], "Windows executable"],
  ];
  for (const [bytes, label] of signatures) {
    if (bytes.every((byte, i) => buffer[i] === byte)) {
      throw new ValidationError(`This looks like a ${label} file, not ${format}.`);
    }
  }
  // Null bytes in the first kilobyte indicate binary content.
  if (buffer.subarray(0, 1024).includes(0)) {
    throw new ValidationError("This file contains binary data and cannot be parsed as text.");
  }
}

// ── CSV ─────────────────────────────────────────────────────────────────────

/** Column names we recognise, in preference order. */
const TEXT_COLUMNS = [
  "text",
  "body",
  "content",
  "message",
  "comment",
  "review",
  "answer",
  "note",
  "transcript",
  "verbatim",
  "feedback",
  "description",
  "query",
];
const SPEAKER_COLUMNS = ["speaker", "role", "author", "user", "participant", "actor", "from"];
const DATE_COLUMNS = [
  "date",
  "created_at",
  "createdat",
  "observed_at",
  "timestamp",
  "occurred_at",
  "time",
];
const TITLE_COLUMNS = ["title", "subject", "name", "topic"];

export function parseCsv(content: string): ParseResult {
  const parsed = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (header) => header.trim(),
  });

  const warnings: string[] = [];
  if (parsed.errors.length > 0) {
    warnings.push(`${parsed.errors.length} row(s) could not be parsed and were skipped.`);
  }

  const rows = parsed.data.filter((row) => row && Object.keys(row).length > 0);
  if (rows.length === 0) return { documents: [], warnings: ["The CSV contained no data rows."] };

  const headers = Object.keys(rows[0]!);
  const textColumn = pickColumn(headers, TEXT_COLUMNS) ?? longestColumn(rows, headers);
  if (!textColumn) {
    throw new ValidationError(
      `Could not find a text column. Expected one of: ${TEXT_COLUMNS.slice(0, 6).join(", ")}.`,
    );
  }
  const speakerColumn = pickColumn(headers, SPEAKER_COLUMNS);
  const dateColumn = pickColumn(headers, DATE_COLUMNS);
  const titleColumn = pickColumn(headers, TITLE_COLUMNS);

  const documents: ParsedDocument[] = [];
  rows.forEach((row, index) => {
    const text = (row[textColumn] ?? "").trim();
    if (text.length < 10) return;
    documents.push({
      title: titleColumn ? (row[titleColumn] ?? null) : null,
      location: `row ${index + 2}`, // +2: 1-indexed plus the header row
      text,
      speaker: speakerColumn ? (row[speakerColumn] ?? null) : null,
      observedAt: dateColumn ? parseDate(row[dateColumn]) : null,
      metadata: { columns: headers, textColumn, row: index + 2 },
    });
  });

  if (documents.length === 0)
    warnings.push("No rows contained enough text to extract evidence from.");
  return { documents, warnings };
}

/** Search Console exports are query rows, not prose — kept as one doc per query. */
export function parseSearchConsoleCsv(content: string): ParseResult {
  const parsed = Papa.parse<Record<string, string>>(content, {
    header: true,
    skipEmptyLines: "greedy",
    transformHeader: (header) => header.trim().toLowerCase(),
  });

  const rows = parsed.data.filter((row) => row && Object.keys(row).length > 0);
  const headers = rows[0] ? Object.keys(rows[0]) : [];
  const queryColumn = headers.find(
    (h) => h.includes("query") || h.includes("keyword") || h.includes("search term"),
  );
  if (!queryColumn) {
    throw new ValidationError(
      "This does not look like a Search Console export — no query column was found.",
    );
  }

  const num = (value: string | undefined) => {
    const n = Number((value ?? "").replace(/[,%]/g, ""));
    return Number.isFinite(n) ? n : null;
  };
  const col = (fragment: string) => headers.find((h) => h.includes(fragment));

  const clicksCol = col("click");
  const impressionsCol = col("impression");
  const ctrCol = col("ctr");
  const positionCol = col("position");

  const documents: ParsedDocument[] = [];
  rows.forEach((row, index) => {
    const query = (row[queryColumn] ?? "").trim();
    if (!query) return;
    const clicks = clicksCol ? num(row[clicksCol]) : null;
    const impressions = impressionsCol ? num(row[impressionsCol]) : null;
    const position = positionCol ? num(row[positionCol]) : null;

    // Rendered as a sentence so the extractor treats it as observed search
    // behaviour rather than an opaque row.
    const parts = [`Searchers used the query "${query}".`];
    if (impressions !== null) parts.push(`It received ${impressions} impressions.`);
    if (clicks !== null) parts.push(`It received ${clicks} clicks.`);
    if (position !== null) parts.push(`Average position was ${position}.`);

    documents.push({
      title: query,
      location: `query "${query}" (row ${index + 2})`,
      text: parts.join(" "),
      speaker: "searcher",
      observedAt: null,
      metadata: {
        query,
        clicks,
        impressions,
        ctr: ctrCol ? num(row[ctrCol]) : null,
        position,
        isQuestion: isQuestionQuery(query),
      },
    });
  });

  return { documents, warnings: [] };
}

/**
 * Question-shaped query detection, adapted from the methodology in the research
 * report. Supplemented by semantic classification during extraction, because
 * many high-value questions are not interrogative ("SOC 2 analytics healthcare").
 */
const QUESTION_QUERY_PATTERN =
  /^(who|what|why|how|when|where|which|can|does|is|are|should|guide|tutorial|course|learn|examples?|definition|meaning|checklist|framework|template|tips?|ideas?|best|top|lists?|comparison|vs|difference|benefits|advantages|alternatives)\b/i;

export function isQuestionQuery(query: string): boolean {
  return QUESTION_QUERY_PATTERN.test(query.trim());
}

// ── JSON ────────────────────────────────────────────────────────────────────

export function parseJson(content: string): ParseResult {
  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    throw new ValidationError("This file is not valid JSON.");
  }

  const items = Array.isArray(data)
    ? data
    : typeof data === "object" && data !== null
      ? (findArray(data as Record<string, unknown>) ?? [data])
      : [];

  if (items.length === 0) throw new ValidationError("No records were found in this JSON file.");

  const documents: ParsedDocument[] = [];
  items.forEach((item, index) => {
    if (typeof item === "string") {
      if (item.trim().length >= 10) {
        documents.push({
          title: null,
          location: `item ${index}`,
          text: item.trim(),
          metadata: { index },
        });
      }
      return;
    }
    if (typeof item !== "object" || item === null) return;

    const record = item as Record<string, unknown>;
    const keys = Object.keys(record);
    const textKey =
      pickColumn(keys, TEXT_COLUMNS) ??
      keys.find((k) => typeof record[k] === "string" && (record[k] as string).length > 40);
    if (!textKey) return;

    const speakerKey = pickColumn(keys, SPEAKER_COLUMNS);
    const dateKey = pickColumn(keys, DATE_COLUMNS);
    const titleKey = pickColumn(keys, TITLE_COLUMNS);

    documents.push({
      title: titleKey ? String(record[titleKey] ?? "") || null : null,
      location: `item ${index}`,
      text: String(record[textKey] ?? "").trim(),
      speaker: speakerKey ? String(record[speakerKey] ?? "") || null : null,
      observedAt: dateKey ? parseDate(String(record[dateKey] ?? "")) : null,
      metadata: { index, keys },
    });
  });

  return { documents: documents.filter((d) => d.text.length >= 10), warnings: [] };
}

function findArray(obj: Record<string, unknown>): unknown[] | null {
  for (const key of ["records", "data", "items", "results", "rows", "messages"]) {
    const value = obj[key];
    if (Array.isArray(value)) return value;
  }
  for (const value of Object.values(obj)) {
    if (Array.isArray(value) && value.length > 0) return value;
  }
  return null;
}

// ── Plain text, Markdown, transcripts ───────────────────────────────────────

export function parseText(content: string, label: string): ParseResult {
  const text = content.trim();
  if (text.length < 10) throw new ValidationError("This file contains no usable text.");
  return {
    documents: [
      { title: label, location: "full document", text, metadata: { characters: text.length } },
    ],
    warnings: [],
  };
}

export function parseMarkdown(content: string, label: string): ParseResult {
  const text = content.trim();
  if (text.length < 10) throw new ValidationError("This file contains no usable text.");

  // Split on H1/H2 so headings become locations a reader can navigate to.
  const sections = text.split(/^(?=#{1,2}\s)/m).filter((section) => section.trim().length > 0);
  if (sections.length <= 1) {
    return {
      documents: [{ title: label, location: "full document", text, metadata: {} }],
      warnings: [],
    };
  }

  const documents = sections.map((section, index) => {
    const heading = section.match(/^#{1,2}\s+(.+)$/m)?.[1]?.trim() ?? `section ${index + 1}`;
    return {
      title: heading,
      location: `section "${heading}"`,
      text: section.trim(),
      metadata: { index },
    };
  });
  return { documents, warnings: [] };
}

const TRANSCRIPT_TURN = /^([A-Z][A-Za-z0-9 ._'-]{0,40}):[ \t]*/gm;
const TIMESTAMP = /\[?(\d{1,2}:\d{2}(?::\d{2})?)\]?/;

export function parseTranscript(content: string, label: string): ParseResult {
  const text = content.replace(/\r\n/g, "\n").trim();
  if (text.length < 10) throw new ValidationError("This transcript contains no usable text.");

  const turns: { speaker: string; start: number; bodyStart: number }[] = [];
  let match: RegExpExecArray | null;
  TRANSCRIPT_TURN.lastIndex = 0;
  while ((match = TRANSCRIPT_TURN.exec(text)) !== null) {
    turns.push({
      speaker: match[1]!.trim(),
      start: match.index,
      bodyStart: match.index + match[0].length,
    });
  }

  if (turns.length < 2) return parseText(text, label);

  const documents: ParsedDocument[] = [];
  turns.forEach((turn, index) => {
    const end = index + 1 < turns.length ? turns[index + 1]!.start : text.length;
    const body = text.slice(turn.bodyStart, end).trim();
    if (body.length < 10) return;
    const timestamp = body.match(TIMESTAMP)?.[1] ?? null;
    documents.push({
      title: null,
      location: timestamp
        ? `${turn.speaker} at ${timestamp}`
        : `${turn.speaker}, turn ${index + 1}`,
      text: body,
      speaker: turn.speaker,
      metadata: { turn: index + 1, timestamp },
    });
  });

  return { documents, warnings: [] };
}

// ── DOCX ────────────────────────────────────────────────────────────────────

export async function parseDocx(buffer: Buffer, label: string): Promise<ParseResult> {
  const mammoth = await import("mammoth");
  const result = await mammoth.extractRawText({ buffer });
  const text = result.value.trim();
  if (text.length < 10) throw new ValidationError("This document contains no extractable text.");

  const warnings = result.messages
    .filter((message) => message.type === "warning")
    .slice(0, 5)
    .map((message) => message.message);

  // Docx often holds transcripts; try the transcript shape first.
  const transcript = parseTranscript(text, label);
  if (transcript.documents.length > 1) {
    return { documents: transcript.documents, warnings };
  }
  return { documents: [{ title: label, location: "full document", text, metadata: {} }], warnings };
}

// ── PDF ─────────────────────────────────────────────────────────────────────

export async function parsePdf(buffer: Buffer, label: string): Promise<ParseResult> {
  const pdfParse = (await import("pdf-parse")).default;
  const pages: string[] = [];
  const result = await pdfParse(buffer, {
    pagerender: async (pageData) => {
      const textContent = await pageData.getTextContent();
      const text = textContent.items.map((item: { str: string }) => item.str).join(" ");
      pages.push(text);
      return text;
    },
  });

  const nonEmptyPages = pages.map((text) => text.trim()).filter((text) => text.length > 0);
  if (nonEmptyPages.length === 0) {
    const fallback = result.text.trim();
    if (fallback.length < 10) throw new ValidationError("This PDF contains no extractable text.");
    return {
      documents: [{ title: label, location: "full document", text: fallback, metadata: {} }],
      warnings: [],
    };
  }

  if (nonEmptyPages.length === 1) {
    return {
      documents: [
        {
          title: label,
          location: "full document",
          text: nonEmptyPages[0]!,
          metadata: { pages: 1 },
        },
      ],
      warnings: [],
    };
  }

  const documents: ParsedDocument[] = nonEmptyPages.map((text, index) => ({
    title: label,
    location: `page ${index + 1}`,
    text,
    metadata: { page: index + 1, totalPages: nonEmptyPages.length },
  }));
  return { documents, warnings: [] };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function pickColumn(headers: string[], candidates: string[]): string | undefined {
  const normalized = headers.map((h) => ({ raw: h, key: h.toLowerCase().replace(/[\s_-]/g, "") }));
  for (const candidate of candidates) {
    const target = candidate.replace(/[\s_-]/g, "");
    const hit = normalized.find((h) => h.key === target);
    if (hit) return hit.raw;
  }
  for (const candidate of candidates) {
    const target = candidate.replace(/[\s_-]/g, "");
    const hit = normalized.find((h) => h.key.includes(target));
    if (hit) return hit.raw;
  }
  return undefined;
}

function longestColumn(rows: Record<string, string>[], headers: string[]): string | undefined {
  let best: { header: string; length: number } | undefined;
  for (const header of headers) {
    const total = rows.slice(0, 50).reduce((sum, row) => sum + (row[header]?.length ?? 0), 0);
    if (!best || total > best.length) best = { header, length: total };
  }
  return best && best.length > 200 ? best.header : undefined;
}

function parseDate(value: string | undefined): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
