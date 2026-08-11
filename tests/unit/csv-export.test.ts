import { describe, expect, it } from "vitest";
import { protectSpreadsheetFormula, quoteCsv } from "@/services/prompts";

describe("Profound CSV formatting", () => {
  it("quotes RFC 4180 fields and protects spreadsheet formulas", () => {
    expect(quoteCsv('A "quoted", topic')).toBe('"A ""quoted"", topic"');
    expect(protectSpreadsheetFormula('=HYPERLINK("bad")')).toBe('\'=HYPERLINK("bad")');
    expect(quoteCsv("+1-212-555-0199")).toBe('"\'+1-212-555-0199"');
  });
});
