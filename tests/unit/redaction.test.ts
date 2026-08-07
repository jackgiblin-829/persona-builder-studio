import { describe, expect, it } from "vitest";
import { classifyPiiStatus, redact, redactWithStatus } from "@/lib/redaction";

describe("PII redaction", () => {
  it("redacts email addresses", () => {
    const result = redact("Contact rowan.kestrel@northwind-payer.example about the ticket.");
    expect(result.text).toBe("Contact [EMAIL_1] about the ticket.");
    expect(result.findings.email).toBe(1);
  });

  it("gives a repeated value the same placeholder", () => {
    const result = redact("a@b.example replied. Then a@b.example asked again.");
    expect(result.text).toBe("[EMAIL_1] replied. Then [EMAIL_1] asked again.");
    expect(result.findings.email).toBe(1);
  });

  it("numbers distinct values separately", () => {
    const result = redact("a@b.example and c@d.example");
    expect(result.text).toContain("[EMAIL_1]");
    expect(result.text).toContain("[EMAIL_2]");
    expect(result.findings.email).toBe(2);
  });

  it("redacts phone numbers in several formats", () => {
    expect(redact("Call +1 (555) 010-8842 today").text).toContain("[PHONE_1]");
    expect(redact("Reach me on 020 7946 0018").text).toContain("[PHONE_1]");
  });

  it("redacts IPv4 and IPv6 addresses", () => {
    expect(redact("from 192.168.4.19 last night").text).toContain("[IP_1]");
    expect(redact("host 2001:0db8:85a3:0000:0000:8a2e:0370:7334 rejected").text).toContain(
      "[IP_1]",
    );
  });

  it("redacts only card-shaped numbers that pass Luhn", () => {
    // 4111 1111 1111 1111 is the standard Luhn-valid test number.
    expect(redact("card 4111 1111 1111 1111 declined").text).toContain("[CREDIT_CARD_1]");
    // A number of the same shape that fails Luhn is left alone.
    expect(redact("order 4111 1111 1111 1112 shipped").text).toContain("4111 1111 1111 1112");
  });

  it("redacts US SSN-shaped values but not invalid prefixes", () => {
    expect(redact("ssn 123-45-6789 on file").text).toContain("[SSN_1]");
    expect(redact("code 000-45-6789 here").text).toContain("000-45-6789");
  });

  it("strips credentials embedded in a URL", () => {
    const result = redact("Use https://admin:hunter2@internal.example/api");
    expect(result.text).not.toContain("hunter2");
    expect(result.findings.url_credentials).toBe(1);
  });

  it("redacts street addresses", () => {
    expect(redact("Ship to 221 Baker Street please").text).toContain("[STREET_ADDRESS_1]");
  });

  it("leaves clean text untouched and reports no findings", () => {
    const text = "Customer data cannot leave our approved cloud environment.";
    const result = redact(text);
    expect(result.text).toBe(text);
    expect(result.count).toBe(0);
  });

  it("does not treat ordinary numbers as PII", () => {
    const text = "Adoption reached 70 percent within 90 days across 40 teams.";
    expect(redact(text).text).toBe(text);
  });
});

describe("PII status classification", () => {
  it("reports redacted when something was replaced", () => {
    const text = "Email a@b.example";
    expect(classifyPiiStatus(text, redact(text))).toBe("redacted");
  });

  it("reports suspected for identity-shaped text the patterns cannot catch", () => {
    const text = "My name is Alex Moreau and I lead procurement.";
    expect(classifyPiiStatus(text, redact(text))).toBe("suspected");
    expect(redactWithStatus("Please provide the patient ID for this record.").status).toBe(
      "suspected",
    );
  });

  it("reports none for ordinary business text", () => {
    const text = "The deciding factor is deployment model, then governance.";
    expect(classifyPiiStatus(text, redact(text))).toBe("none");
  });
});
