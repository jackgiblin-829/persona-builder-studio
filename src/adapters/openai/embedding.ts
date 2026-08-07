import { createHash } from "node:crypto";
import { EMBEDDING_DIMENSIONS } from "./types";

/**
 * Deterministic mock embedder (ADR-005).
 *
 * Projects hashed tokens (unigrams + bigrams) into the same 1536 dimensions a
 * real embedding model uses, then L2-normalises. Lexically similar texts get
 * high cosine similarity, so semantic search and near-duplicate detection are
 * exercisable and testable with no API key.
 *
 * Limitation, recorded in ADR-005: this captures lexical overlap, not meaning.
 * Similarity thresholds tuned against mock embeddings must be re-tuned when a
 * real embedding model is enabled. Every stored vector records its `model_id`
 * so mock and live vectors are never compared to each other.
 */
export function mockEmbed(text: string, dimensions = EMBEDDING_DIMENSIONS): number[] {
  const vector = new Float64Array(dimensions);
  const tokens = tokenize(text);
  if (tokens.length === 0) {
    vector[0] = 1;
    return Array.from(vector);
  }

  const grams: string[] = [...tokens];
  for (let i = 0; i < tokens.length - 1; i++) {
    grams.push(`${tokens[i]} ${tokens[i + 1]}`);
  }

  // Term frequency, so a repeated term matters more than a single mention.
  const counts = new Map<string, number>();
  for (const gram of grams) counts.set(gram, (counts.get(gram) ?? 0) + 1);

  for (const [gram, count] of counts) {
    const digest = createHash("sha256").update(gram).digest();
    // Three hashed positions per term reduces collision sensitivity.
    for (let k = 0; k < 3; k++) {
      const offset = k * 4;
      const slot = digest.readUInt32BE(offset) % dimensions;
      const sign = (digest[offset + 3]! & 1) === 0 ? 1 : -1;
      vector[slot] = (vector[slot] ?? 0) + sign * (1 + Math.log(count));
    }
  }

  let norm = 0;
  for (let i = 0; i < dimensions; i++) norm += vector[i]! * vector[i]!;
  norm = Math.sqrt(norm);
  if (norm === 0) {
    vector[0] = 1;
    return Array.from(vector);
  }
  for (let i = 0; i < dimensions; i++) vector[i] = vector[i]! / norm;
  return Array.from(vector);
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s'-]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1 && !STOP_WORDS.has(token));
}

const STOP_WORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "but",
  "if",
  "of",
  "to",
  "in",
  "on",
  "for",
  "with",
  "as",
  "by",
  "at",
  "from",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "it",
  "its",
  "this",
  "that",
  "these",
  "those",
  "we",
  "our",
  "you",
  "your",
  "they",
  "their",
  "i",
  "me",
  "my",
  "he",
  "she",
  "do",
  "does",
  "did",
  "so",
  "not",
  "no",
  "can",
  "will",
  "would",
  "should",
  "could",
  "have",
  "has",
  "had",
  "there",
  "here",
  "what",
  "which",
  "who",
  "when",
  "where",
  "how",
  "than",
  "then",
]);

export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(
      `Cannot compare embeddings of different dimensions (${a.length} vs ${b.length})`,
    );
  }
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
