/**
 * Page-audit text heuristics (§30), pure and clock-free.
 *
 * The mock adapter has no real reading comprehension, so "does this page
 * already cover this persona requirement" is decided here by normalized
 * token overlap between the requirement's own wording/vocabulary and the
 * pasted page text — the same style of heuristic
 * `src/adapters/openai/mock/persona.ts` uses to match evidence to field
 * types. It will under-count paraphrase and over-count coincidental word
 * reuse; that is an accepted limitation of not running a second model call
 * to grade the first one's reading, the same trade-off milestone 6 accepted
 * for `detectMissingElements`.
 */

const STOPWORDS = new Set([
  "the",
  "and",
  "for",
  "our",
  "we",
  "us",
  "you",
  "your",
  "that",
  "this",
  "with",
  "from",
  "have",
  "has",
  "had",
  "not",
  "but",
  "can",
  "cannot",
  "will",
  "would",
  "into",
  "than",
  "then",
  "they",
  "them",
  "their",
  "what",
  "when",
  "which",
  "who",
  "how",
  "are",
  "was",
  "were",
  "been",
  "its",
  "it",
  "a",
  "an",
  "of",
  "to",
  "in",
  "is",
  "be",
  "on",
  "at",
  "or",
  "if",
  "as",
  "so",
  "do",
  "does",
  "did",
  "get",
  "got",
  "any",
  "all",
  "one",
  "two",
  "about",
  "more",
  "most",
  "some",
]);

export function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length >= 3 && !STOPWORDS.has(token)),
  );
}

/** Fraction of `needle`'s tokens present in `haystack`, in [0, 1]. */
export function coverageOverlap(needle: Set<string>, haystack: Set<string>): number {
  if (needle.size === 0) return 0;
  let hits = 0;
  for (const token of needle) if (haystack.has(token)) hits++;
  return hits / needle.size;
}

export type CoverageItem = { id: string; statement: string };

/**
 * Which of a list of persona statements (constraints, objections, decision
 * criteria...) the page text already addresses. A statement counts as
 * covered once a third of its significant tokens appear in the page —
 * loose enough to tolerate paraphrase, strict enough that "we mentioned one
 * shared word" does not count.
 */
export function evaluateStatementCoverage(
  pageText: string,
  items: CoverageItem[],
  threshold = 0.34,
): { id: string; statement: string; covered: boolean; score: number }[] {
  const pageTokens = tokenize(pageText);
  return items.map((item) => {
    const score = coverageOverlap(tokenize(item.statement), pageTokens);
    return { id: item.id, statement: item.statement, covered: score >= threshold, score };
  });
}

export type ExtractabilitySignals = {
  hasHeadings: boolean;
  hasList: boolean;
  hasDirectAnswer: boolean;
  hasStructuredData: boolean;
  extractable: boolean;
};

const HEADING_PATTERN = /^\s{0,3}#{1,6}\s+\S/m;
const LIST_PATTERN = /^\s*(?:[-*•]|\d+[.)])\s+\S/m;
const DIRECT_ANSWER_PATTERN = /\b(?:is|are|means|refers to)\b[^.?!]{0,120}[.?!]/i;

/** Heuristics for whether a passage is shaped so an AI answer can quote it directly. */
export function detectExtractability(pageText: string): ExtractabilitySignals {
  const hasHeadings = HEADING_PATTERN.test(pageText);
  const hasList = LIST_PATTERN.test(pageText);
  const hasDirectAnswer = DIRECT_ANSWER_PATTERN.test(pageText);
  const hasStructuredData = /<script[^>]*application\/ld\+json/i.test(pageText);

  const signals = [hasHeadings, hasList, hasDirectAnswer, hasStructuredData].filter(Boolean).length;
  return { hasHeadings, hasList, hasDirectAnswer, hasStructuredData, extractable: signals >= 2 };
}

/**
 * A CTA element (link text, button label) qualifies as fit for a persona
 * when it names a concrete next step rather than a generic invitation. Vague
 * CTAs ("Learn more", "Get started", "Contact us") tell an AI answer nothing
 * about what happens next.
 */
const VAGUE_CTA_PATTERN =
  /^(learn more|get started|contact us|click here|read more|sign up|find out more)\.?$/i;

export function isVagueCta(ctaText: string): boolean {
  return VAGUE_CTA_PATTERN.test(ctaText.trim());
}
