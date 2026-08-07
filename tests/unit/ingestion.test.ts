import { describe, expect, it } from "vitest";
import { chunkText, chunkTranscript } from "@/lib/chunking";
import {
  detectFormat,
  isQuestionQuery,
  parseCsv,
  parseJson,
  parseMarkdown,
  parseSearchConsoleCsv,
  parseTranscript,
  verifyMagicBytes,
} from "@/lib/parsers";
import { generateEvidence } from "@/adapters/openai/mock/evidence";
import { cosineSimilarity, mockEmbed } from "@/adapters/openai/embedding";
import { ValidationError } from "@/lib/errors";
import { evidenceExtractionSchema } from "@/prompts/schemas";

describe("chunking", () => {
  it("returns a single chunk for short text with correct offsets", () => {
    const chunks = chunkText("A short passage about deployment constraints.");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.charStart).toBe(0);
  });

  it("splits long text and keeps offsets pointing into the source", () => {
    const paragraph = "Security review is the main constraint for this buyer. ".repeat(30);
    const source = `${paragraph}\n\n${paragraph}\n\n${paragraph}`;
    const chunks = chunkText(source, { maxChars: 600, overlapChars: 60 });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.charStart).toBeGreaterThanOrEqual(0);
      expect(chunk.charEnd).toBeGreaterThan(chunk.charStart);
      expect(chunk.charStart).toBeLessThan(source.length);
    }
  });

  it("never exceeds the size limit by more than the overlap", () => {
    const source = Array.from({ length: 40 }, (_, i) => `Paragraph ${i} about governance.`).join(
      "\n\n",
    );
    for (const chunk of chunkText(source, { maxChars: 300, overlapChars: 50 })) {
      expect(chunk.text.length).toBeLessThanOrEqual(300 + 50 + 10);
    }
  });

  it("returns nothing for empty input", () => {
    expect(chunkText("   \n  ")).toEqual([]);
  });

  it("splits transcripts by speaker turn and keeps the speaker", () => {
    const transcript = [
      "Facilitator: What is blocking you today?",
      "Prospect: Customer data cannot leave our approved cloud environment.",
      "Facilitator: Understood. What evidence do you need?",
      "Prospect: The SOC 2 report and an architecture diagram.",
    ].join("\n\n");

    const chunks = chunkTranscript(transcript);
    expect(chunks.length).toBe(4);
    expect(chunks[1]?.speaker).toBe("Prospect");
    expect(chunks[1]?.text).toContain("cannot leave");
    // Offsets must resolve back into the original transcript.
    expect(transcript.slice(chunks[1]!.charStart, chunks[1]!.charEnd)).toContain("cannot leave");
  });

  it("falls back to plain chunking when there are no speaker turns", () => {
    const chunks = chunkTranscript("Just a paragraph with no speakers at all in it.");
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.speaker).toBeUndefined();
  });
});

describe("format detection and magic bytes", () => {
  it("detects formats from extension and content type", () => {
    expect(detectFormat("tickets.csv", null)).toBe("csv");
    expect(detectFormat("notes.md", null)).toBe("markdown");
    expect(detectFormat("call.docx", null)).toBe("docx");
    expect(detectFormat("guidelines.pdf", null)).toBe("pdf");
    expect(detectFormat("file", "application/json")).toBe("json");
    expect(detectFormat("file", "application/pdf")).toBe("pdf");
    expect(detectFormat("archive.zip", "application/zip")).toBeNull();
  });

  it("rejects a PDF renamed to .txt", () => {
    const pdf = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
    expect(() => verifyMagicBytes("txt", pdf)).toThrow(ValidationError);
  });

  it("accepts a genuine PDF and rejects a fake one", () => {
    const pdf = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
    expect(() => verifyMagicBytes("pdf", pdf)).not.toThrow();
    expect(() => verifyMagicBytes("pdf", Buffer.from("not a pdf"))).toThrow(ValidationError);
  });

  it("rejects an executable renamed to .csv", () => {
    const elf = Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x02]);
    expect(() => verifyMagicBytes("csv", elf)).toThrow(ValidationError);
  });

  it("rejects a docx that is not a ZIP container", () => {
    expect(() => verifyMagicBytes("docx", Buffer.from("not a zip"))).toThrow(ValidationError);
  });

  it("accepts genuine text", () => {
    expect(() => verifyMagicBytes("csv", Buffer.from("a,b\n1,2\n"))).not.toThrow();
  });
});

describe("parsers", () => {
  it("parses CSV, choosing the text column and recording row locations", () => {
    const csv = [
      "ticket_id,role,text",
      'T-1,product manager,"We rolled out to forty product managers and only eight log in weekly."',
      'T-2,analytics lead,"Two teams report different numbers for activation and both say they are right."',
    ].join("\n");

    const result = parseCsv(csv);
    expect(result.documents).toHaveLength(2);
    expect(result.documents[0]?.location).toBe("row 2");
    expect(result.documents[0]?.speaker).toBe("product manager");
    expect(result.documents[0]?.text).toContain("forty product managers");
  });

  it("throws when a CSV has no usable text column", () => {
    expect(() => parseCsv("a,b\n1,2\n3,4")).toThrow(ValidationError);
  });

  it("parses a Search Console export into query documents with metrics", () => {
    const csv = [
      "query,clicks,impressions,ctr,position",
      "self-hosted product analytics,58,1420,4.08%,7.2",
      "what is data lineage,88,7210,1.22%,14.6",
    ].join("\n");

    const result = parseSearchConsoleCsv(csv);
    expect(result.documents).toHaveLength(2);
    expect(result.documents[0]?.metadata.clicks).toBe(58);
    expect(result.documents[0]?.metadata.impressions).toBe(1420);
    expect(result.documents[0]?.speaker).toBe("searcher");
    expect(result.documents[1]?.metadata.isQuestion).toBe(true);
  });

  it("rejects a CSV that is not a Search Console export", () => {
    expect(() => parseSearchConsoleCsv("name,value\na,1")).toThrow(ValidationError);
  });

  it("classifies question-shaped queries", () => {
    expect(isQuestionQuery("what is data lineage")).toBe(true);
    expect(isQuestionQuery("best product analytics for small teams")).toBe(true);
    expect(isQuestionQuery("tessellate bi alternatives")).toBe(false);
  });

  it("parses JSON wrapped in a records array", () => {
    const json = JSON.stringify({
      records: [
        {
          review_id: "R-1",
          author: "verified reviewer",
          text: "The lineage view won the security review for us.",
        },
      ],
    });
    const result = parseJson(json);
    expect(result.documents).toHaveLength(1);
    expect(result.documents[0]?.text).toContain("lineage view");
  });

  it("throws on invalid JSON", () => {
    expect(() => parseJson("{not json")).toThrow(ValidationError);
  });

  it("splits Markdown on headings so locations are navigable", () => {
    const md =
      "# Deployment\n\nRuns in your own cloud.\n\n## Governance\n\nRole-based access control.";
    const result = parseMarkdown(md, "homepage");
    expect(result.documents).toHaveLength(2);
    expect(result.documents[1]?.location).toBe('section "Governance"');
  });

  it("parses a transcript into per-speaker documents", () => {
    const transcript =
      "Facilitator: What blocks you?\n\nProspect: Security review blocks everything.";
    const result = parseTranscript(transcript, "call");
    expect(result.documents).toHaveLength(2);
    expect(result.documents[1]?.speaker).toBe("Prospect");
  });
});

describe("deterministic evidence extraction (mock mode)", () => {
  const context = {
    passage:
      "Customer data cannot leave our approved cloud environment. " +
      "The deciding factor is deployment model first, then governance. " +
      "Send me the SOC 2 Type II report and the architecture diagram. " +
      "Success means adoption above 60 percent within twelve months. " +
      "Can you explain how the Slack integration works?",
    speaker: "Prospect",
    sourceType: "sales_transcript",
    brandName: "Northwind Analytics",
    competitorNames: ["Cobalt Insights"],
  };

  it("produces output that satisfies its own schema", () => {
    const result = generateEvidence(context);
    expect(evidenceExtractionSchema.safeParse(result).success).toBe(true);
  });

  it("is deterministic — the same input gives the same output", () => {
    expect(JSON.stringify(generateEvidence(context))).toBe(
      JSON.stringify(generateEvidence(context)),
    );
  });

  it("splits a multi-claim passage into separate atomic records", () => {
    const result = generateEvidence(context);
    expect(result.records.length).toBeGreaterThanOrEqual(4);
  });

  it("classifies the constraint, criterion, proof requirement and question distinctly", () => {
    const categories = generateEvidence(context).records.map((r) => r.category);
    expect(categories).toContain("constraint");
    expect(categories).toContain("decision_criterion");
    expect(categories).toContain("proof_requirement");
    expect(categories).toContain("question");
  });

  it("returns offsets that resolve back to the quoted text", () => {
    for (const record of generateEvidence(context).records) {
      expect(context.passage.slice(record.char_start, record.char_end)).toBe(record.quote);
    }
  });

  it("marks brand-page content as a brand assertion, not customer belief", () => {
    const result = generateEvidence({
      ...context,
      sourceType: "brand_page",
      passage: "We deliver self-hosted deployment as a first-class option, not an afterthought.",
    });
    expect(result.records.every((r) => r.provenance === "brand_assertion")).toBe(true);
  });

  it("flags hedged statements as uncertain rather than firm requirements", () => {
    const result = generateEvidence({
      ...context,
      passage: "I think Perch Metrics is probably too small for us, but I'm not sure.",
    });
    expect(result.records.some((r) => r.uncertainty_note !== null)).toBe(true);
  });

  it("returns an empty array when nothing relevant is present", () => {
    const result = generateEvidence({ ...context, passage: "Ok. Sure. Thanks. Bye." });
    expect(result.records).toEqual([]);
  });

  it("preserves customer vocabulary verbatim", () => {
    const result = generateEvidence({
      ...context,
      passage:
        "We must have column-level lineage and a private cloud deployment for data residency.",
    });
    const vocabulary = result.records.flatMap((r) => r.vocabulary);
    expect(vocabulary).toContain("private cloud");
    expect(vocabulary).toContain("data residency");
  });
});

describe("deterministic embeddings", () => {
  it("produces normalised vectors of the right dimensionality", () => {
    const vector = mockEmbed("private cloud deployment with data lineage");
    expect(vector).toHaveLength(1536);
    const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
    expect(norm).toBeCloseTo(1, 5);
  });

  it("is deterministic", () => {
    expect(mockEmbed("security review")).toEqual(mockEmbed("security review"));
  });

  it("ranks a near-paraphrase above an unrelated sentence", () => {
    const query = mockEmbed("customer data cannot leave our cloud environment");
    const near = mockEmbed("customer data must stay inside our approved cloud environment");
    const far = mockEmbed("we want short training videos for a distributed team");
    expect(cosineSimilarity(query, near)).toBeGreaterThan(cosineSimilarity(query, far));
  });

  it("gives identical text a similarity of one", () => {
    const a = mockEmbed("data lineage");
    expect(cosineSimilarity(a, a)).toBeCloseTo(1, 6);
  });

  it("refuses to compare vectors of different dimensionality", () => {
    expect(() => cosineSimilarity([1, 0], [1, 0, 0])).toThrow();
  });
});
