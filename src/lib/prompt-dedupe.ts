import { createHash } from "node:crypto";

/**
 * Prompt normalization and duplicate detection (§17, §18).
 *
 * Two prompts that ask the same thing must not both be tracked: they cost twice
 * as much to run in Profound and they split the same measurement across two
 * rows. Detection runs at three levels, deliberately, because each catches
 * something the others miss:
 *
 * 1. **Normalized hash** — an exact match after case, punctuation, politeness
 *    wrapper and whitespace are removed. Cheap, certain, and the only one used
 *    to *block* an insert.
 * 2. **Lexical overlap** — Jaccard over content tokens. Catches reordering and
 *    small edits without needing an embedding, so it works before the embed job
 *    has run.
 * 3. **Embedding cosine** — catches paraphrase. Only meaningful between vectors
 *    from the same model, which is why every comparison is keyed by model id.
 *
 * Levels 2 and 3 produce a **warning**, never a silent removal. A reviewer who
 * deliberately wants a near-identical pair (a persona prompt and its generic
 * control frequently are near-identical by design) must be able to keep it.
 *
 * Pure and clock-free: everything here is a function of its arguments.
 */

/** Politeness and framing wrappers that change no information need. */
const LEADING_FILLER = [
  /^(?:hi|hey|hello)[,!.\s]+/,
  /^(?:please|kindly)\s+/,
  /^(?:can|could|would|will)\s+you\s+(?:please\s+)?/,
  /^(?:i(?:'|’)?d\s+like\s+to\s+know|i\s+want\s+to\s+know|i\s+need\s+to\s+know|tell\s+me)\s+/,
  /^(?:what\s+(?:i|we)\s+(?:want|need)\s+to\s+know\s+is)\s+/,
];

/**
 * Collapses a prompt to the words that carry its information need.
 *
 * Deliberately preserves word order: "SOC 2 vs ISO 27001" and
 * "ISO 27001 vs SOC 2" are different questions to an AI search engine, and
 * order-insensitive normalization would merge them into one tracked prompt.
 */
export function normalizePromptText(text: string): string {
  let out = text
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .trim();

  // Filler can nest ("hi, can you please tell me…"), so strip repeatedly.
  let changed = true;
  while (changed) {
    changed = false;
    for (const pattern of LEADING_FILLER) {
      const stripped = out.replace(pattern, "");
      if (stripped !== out) {
        out = stripped.trimStart();
        changed = true;
      }
    }
  }

  return out
    .replace(/['"]/g, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+-\s+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The exact-duplicate key. Stored on every prompt and unique per prompt-set
 * version, so the database itself refuses to hold the same question twice.
 */
export function promptHash(text: string): string {
  return createHash("sha256").update(normalizePromptText(text), "utf8").digest("hex");
}

const STOPWORDS = new Set([
  "a",
  "about",
  "an",
  "and",
  "any",
  "are",
  "as",
  "at",
  "be",
  "been",
  "best",
  "but",
  "by",
  "can",
  "do",
  "does",
  "for",
  "from",
  "has",
  "have",
  "how",
  "i",
  "if",
  "in",
  "is",
  "it",
  "its",
  "me",
  "my",
  "of",
  "on",
  "or",
  "our",
  "should",
  "so",
  "that",
  "the",
  "their",
  "them",
  "then",
  "there",
  "these",
  "they",
  "this",
  "to",
  "us",
  "was",
  "we",
  "were",
  "what",
  "when",
  "which",
  "who",
  "why",
  "will",
  "with",
  "would",
  "you",
  "your",
]);

/** Content tokens only — the words that decide what is being asked. */
export function contentTokens(text: string): string[] {
  return [
    ...new Set(
      normalizePromptText(text)
        .split(" ")
        .filter((token) => token.length > 1 && !STOPWORDS.has(token)),
    ),
  ];
}

/** Jaccard over content tokens. 1 means the same words, 0 means nothing shared. */
export function lexicalSimilarity(a: string, b: string): number {
  const left = new Set(contentTokens(a));
  const right = new Set(contentTokens(b));
  if (left.size === 0 || right.size === 0) return 0;

  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection++;
  const union = left.size + right.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Thresholds.
 *
 * Tuned against the mock embedder, which measures lexical rather than semantic
 * similarity (ADR-005) and therefore scores paraphrase lower than a real model
 * would. They are exported so a live-embedding deployment can re-tune them
 * without editing the detection logic, and so the tests can assert on the
 * boundary rather than on a magic number buried in a function.
 */
export const DUPLICATE_THRESHOLDS = {
  /** Above this, the two prompts ask the same question in different words. */
  embedding: 0.92,
  /** Above this, they share nearly all their content words. */
  lexical: 0.8,
} as const;

export type DuplicateCandidate = {
  promptId: string;
  promptText: string;
  normalizedHash: string;
  /** Absent until the embed job has run for this prompt. */
  embedding?: number[] | null;
  /** Which prompt set the candidate belongs to, for the warning copy. */
  promptSetLabel?: string;
};

export type DuplicateFinding = {
  promptId: string;
  text: string;
  score: number;
  kind: "exact" | "lexical" | "semantic";
  promptSetLabel?: string;
};

/**
 * Finds the strongest duplicate signal for one prompt against a candidate pool.
 *
 * Returns the *single* best finding rather than a list: a reviewer acting on
 * "this duplicates X" needs one thing to compare against, and a list of six
 * near-identical variants is noise. Exact beats semantic beats lexical, because
 * that is the order of certainty.
 */
export function findDuplicate(
  subject: { promptId?: string; promptText: string; embedding?: number[] | null },
  candidates: DuplicateCandidate[],
  thresholds: { embedding: number; lexical: number } = DUPLICATE_THRESHOLDS,
): DuplicateFinding | null {
  const hash = promptHash(subject.promptText);
  let best: DuplicateFinding | null = null;

  for (const candidate of candidates) {
    if (subject.promptId && candidate.promptId === subject.promptId) continue;

    if (candidate.normalizedHash === hash) {
      // Certain: nothing scores higher, so stop looking.
      return {
        promptId: candidate.promptId,
        text: candidate.promptText,
        score: 1,
        kind: "exact",
        promptSetLabel: candidate.promptSetLabel,
      };
    }

    const semantic =
      subject.embedding && candidate.embedding
        ? cosine(subject.embedding, candidate.embedding)
        : null;

    if (semantic !== null && semantic >= thresholds.embedding) {
      if (!best || best.kind === "lexical" || semantic > best.score) {
        best = {
          promptId: candidate.promptId,
          text: candidate.promptText,
          score: semantic,
          kind: "semantic",
          promptSetLabel: candidate.promptSetLabel,
        };
      }
      continue;
    }

    const lexical = lexicalSimilarity(subject.promptText, candidate.promptText);
    if (
      lexical >= thresholds.lexical &&
      (!best || (best.kind === "lexical" && lexical > best.score))
    ) {
      best = {
        promptId: candidate.promptId,
        text: candidate.promptText,
        score: lexical,
        kind: "lexical",
        promptSetLabel: candidate.promptSetLabel,
      };
    }
  }

  return best;
}

/**
 * Deduplicates a freshly generated batch before anything is written.
 *
 * Only exact normalized-hash collisions are dropped here. A near-duplicate is
 * kept and flagged, because at generation time the application cannot know
 * which of two similar prompts the reviewer wants — and dropping one silently
 * would hide the fact that the generator produced redundant output.
 */
export function dedupeExact<T extends { promptText: string }>(
  items: T[],
): { kept: (T & { normalizedHash: string })[]; dropped: T[] } {
  const seen = new Set<string>();
  const kept: (T & { normalizedHash: string })[] = [];
  const dropped: T[] = [];

  for (const item of items) {
    const normalizedHash = promptHash(item.promptText);
    if (seen.has(normalizedHash)) {
      dropped.push(item);
      continue;
    }
    seen.add(normalizedHash);
    kept.push({ ...item, normalizedHash });
  }

  return { kept, dropped };
}

function cosine(a: number[], b: number[]): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}
