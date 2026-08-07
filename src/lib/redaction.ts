/**
 * Best-effort PII redaction.
 *
 * Runs before evidence extraction and before anything is sent to a model
 * provider. This is pattern matching, not classification — the product says so
 * in the UI, and `docs/security.md` records it as a known limitation:
 *
 *   Automated PII detection is not a substitute for legal or compliance review.
 *
 * Offsets are preserved where practical so `char_start`/`char_end` on an
 * evidence record still point into the redacted text.
 */

export type PiiType =
  "email" | "phone" | "ip" | "credit_card" | "ssn" | "street_address" | "url_credentials";

export type RedactionResult = {
  text: string;
  findings: Record<string, number>;
  count: number;
};

type Rule = {
  type: PiiType;
  pattern: RegExp;
  /** Extra validation for patterns that over-match, e.g. Luhn for card numbers. */
  validate?: (match: string) => boolean;
};

const RULES: Rule[] = [
  {
    type: "url_credentials",
    // https://user:secret@host — strip before anything else touches the string.
    pattern: /\b([a-z][a-z0-9+.-]*):\/\/[^\s/@]+:[^\s/@]+@/gi,
  },
  {
    type: "email",
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  },
  {
    type: "ssn",
    pattern: /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g,
  },
  {
    type: "credit_card",
    pattern: /\b(?:\d[ -]?){13,19}\b/g,
    validate: luhn,
  },
  {
    type: "phone",
    // E.164 and common national formats. Requires punctuation or a leading +
    // so bare 10-digit numbers (often IDs or volumes) are not swept up.
    // The lookarounds stop a longer digit run (a 16-digit order number that
    // failed the Luhn check, say) from having its middle redacted as a phone.
    pattern:
      /(?<!\d[\s.-]{0,2})(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?|\b\d{2,4}[\s.-])\d{3,4}[\s.-]\d{3,4}\b(?![\s.-]{0,2}\d)/g,
  },
  {
    type: "ip",
    pattern:
      /\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b|\b(?:[0-9A-Fa-f]{1,4}:){7}[0-9A-Fa-f]{1,4}\b/g,
  },
  {
    type: "street_address",
    pattern:
      /\b\d{1,5}\s+[A-Z][A-Za-z.'-]*(?:\s+[A-Z][A-Za-z.'-]*){0,3}\s+(?:Street|St|Avenue|Ave|Road|Rd|Boulevard|Blvd|Lane|Ln|Drive|Dr|Court|Ct|Way|Terrace|Ter|Place|Pl)\b\.?/g,
  },
];

function luhn(value: string): boolean {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let digit = Number(digits[i]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * Replaces detected PII with typed, numbered placeholders. Repeated values get
 * the same placeholder so a transcript still reads coherently ("[EMAIL_1] said
 * … [EMAIL_1] then asked …").
 */
export function redact(input: string): RedactionResult {
  let text = input;
  const findings: Record<string, number> = {};
  const assigned = new Map<string, string>();

  for (const rule of RULES) {
    const counters = new Map<PiiType, number>();
    text = text.replace(rule.pattern, (match) => {
      if (rule.validate && !rule.validate(match)) return match;

      const key = `${rule.type}:${match.trim().toLowerCase()}`;
      const existing = assigned.get(key);
      if (existing) return existing;

      const next = (counters.get(rule.type) ?? 0) + 1;
      counters.set(rule.type, next);
      const placeholder = `[${rule.type.toUpperCase()}_${next}]`;
      assigned.set(key, placeholder);
      findings[rule.type] = (findings[rule.type] ?? 0) + 1;
      return placeholder;
    });
  }

  const count = Object.values(findings).reduce((sum, n) => sum + n, 0);
  return { text, findings, count };
}

export type PiiStatus = "none" | "redacted" | "suspected";

/**
 * `suspected` flags text that looks like it may carry identity information the
 * patterns cannot reliably catch — named speakers, employers, job titles next
 * to names. It exists to prompt human review, not to claim detection.
 */
export function classifyPiiStatus(original: string, result: RedactionResult): PiiStatus {
  if (result.count > 0) return "redacted";

  const suspicious = [
    /\bmy name is\b/i,
    /\bI'?m\s+[A-Z][a-z]+\s+[A-Z][a-z]+/,
    /\bdate of birth\b/i,
    /\bpassport\b/i,
    /\bpatient\s+(?:id|number|record)\b/i,
    /\baccount number\b/i,
  ];
  return suspicious.some((pattern) => pattern.test(original)) ? "suspected" : "none";
}

export function redactWithStatus(input: string): RedactionResult & { status: PiiStatus } {
  const result = redact(input);
  return { ...result, status: classifyPiiStatus(input, result) };
}
