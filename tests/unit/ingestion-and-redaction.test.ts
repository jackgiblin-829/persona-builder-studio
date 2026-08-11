import { describe, expect, it } from "vitest";
import {
  detectFormat,
  parseCsv,
  parseJson,
  parseMarkdown,
  parseText,
  parseTranscript,
  verifyMagicBytes,
} from "@/lib/parsers";
import { redactWithStatus } from "@/lib/redaction";

describe("batch source formats and redaction", () => {
  it("detects every supported upload type", () => {
    expect(
      ["file.pdf", "file.docx", "file.txt", "file.md", "file.csv", "file.json"].map((name) =>
        detectFormat(name, null),
      ),
    ).toEqual(["pdf", "docx", "txt", "markdown", "csv", "json"]);
  });

  it("parses tabular, structured, markdown, text, and transcript content", () => {
    expect(
      parseCsv("speaker,text\nBuyer,We need a better implementation plan").documents,
    ).toHaveLength(1);
    expect(
      parseJson('[{"text":"We need independent evidence before buying."}]').documents,
    ).toHaveLength(1);
    expect(
      parseMarkdown("# Research\n\nA sufficiently detailed research paragraph.", "notes").documents
        .length,
    ).toBeGreaterThan(0);
    expect(
      parseText("A sufficiently detailed plain-text research paragraph.", "notes").documents,
    ).toHaveLength(1);
    expect(
      parseTranscript(
        "Buyer: We need proof before choosing.\nSeller: What kind of proof matters?",
        "call",
      ).documents.length,
    ).toBeGreaterThan(0);
  });

  it("redacts PII before extraction and rejects disguised binaries", () => {
    const result = redactWithStatus("Email me at buyer@example.com or call +1 212-555-0199.");
    expect(result.status).toBe("redacted");
    expect(result.text).not.toContain("buyer@example.com");
    expect(() => verifyMagicBytes("txt", Buffer.from([0x25, 0x50, 0x44, 0x46]))).toThrow(/PDF/);
  });
});
