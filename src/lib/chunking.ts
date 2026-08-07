/**
 * Chunking for evidence extraction.
 *
 * Chunks must preserve enough context for the model to distinguish a direct
 * statement from an observation, and must carry offsets so every extracted
 * record can point back into the source document.
 */

export type Chunk = {
  index: number;
  text: string;
  charStart: number;
  charEnd: number;
  /** Speaker label when the chunk came from a labelled transcript turn. */
  speaker?: string;
};

export type ChunkOptions = {
  maxChars?: number;
  overlapChars?: number;
};

const DEFAULTS = { maxChars: 3200, overlapChars: 240 };

/**
 * Splits on paragraph boundaries, falling back to sentence boundaries, and
 * only ever hard-splits mid-sentence when a single sentence exceeds the limit.
 * Overlap keeps a claim that straddles a boundary recoverable.
 */
export function chunkText(input: string, options: ChunkOptions = {}): Chunk[] {
  const maxChars = options.maxChars ?? DEFAULTS.maxChars;
  const overlapChars = options.overlapChars ?? DEFAULTS.overlapChars;

  const text = input.replace(/\r\n/g, "\n");
  if (text.trim().length === 0) return [];
  if (text.length <= maxChars) {
    return [{ index: 0, text, charStart: 0, charEnd: text.length }];
  }

  const segments = splitWithOffsets(text, maxChars);
  const chunks: Chunk[] = [];
  let buffer = "";
  let bufferStart = 0;

  const flush = (end: number) => {
    if (buffer.trim().length === 0) return;
    chunks.push({
      index: chunks.length,
      text: buffer,
      charStart: bufferStart,
      charEnd: end,
    });
  };

  for (const segment of segments) {
    if (buffer.length === 0) {
      buffer = segment.text;
      bufferStart = segment.start;
      continue;
    }
    if (buffer.length + segment.text.length + 2 <= maxChars) {
      buffer = `${buffer}\n\n${segment.text}`;
      continue;
    }

    const bufferEnd = bufferStart + buffer.length;
    flush(bufferEnd);

    // Carry a tail of the previous chunk so a straddling claim survives.
    const overlap = overlapChars > 0 ? buffer.slice(-overlapChars) : "";
    if (overlap) {
      buffer = `${overlap}\n\n${segment.text}`;
      bufferStart = Math.max(0, bufferEnd - overlap.length);
    } else {
      buffer = segment.text;
      bufferStart = segment.start;
    }
  }

  flush(bufferStart + buffer.length);
  return chunks;
}

type Segment = { text: string; start: number };

function splitWithOffsets(text: string, maxChars: number): Segment[] {
  const paragraphs: Segment[] = [];
  const paragraphPattern = /\n\s*\n/g;
  let cursor = 0;
  let match: RegExpExecArray | null;

  while ((match = paragraphPattern.exec(text)) !== null) {
    const slice = text.slice(cursor, match.index);
    if (slice.trim()) paragraphs.push({ text: slice.trim(), start: cursor });
    cursor = match.index + match[0].length;
  }
  const tail = text.slice(cursor);
  if (tail.trim()) paragraphs.push({ text: tail.trim(), start: cursor });

  const out: Segment[] = [];
  for (const paragraph of paragraphs) {
    if (paragraph.text.length <= maxChars) {
      out.push(paragraph);
      continue;
    }
    out.push(...splitSentences(paragraph, maxChars));
  }
  return out;
}

function splitSentences(paragraph: Segment, maxChars: number): Segment[] {
  const out: Segment[] = [];
  const pattern = /[^.!?]+[.!?]+[\s]*|[^.!?]+$/g;
  let match: RegExpExecArray | null;
  let buffer = "";
  let bufferStart = paragraph.start;

  while ((match = pattern.exec(paragraph.text)) !== null) {
    const sentence = match[0];
    const absoluteStart = paragraph.start + match.index;

    if (sentence.length > maxChars) {
      if (buffer.trim()) out.push({ text: buffer.trim(), start: bufferStart });
      buffer = "";
      // A single sentence longer than the limit gets hard-split.
      for (let i = 0; i < sentence.length; i += maxChars) {
        out.push({ text: sentence.slice(i, i + maxChars), start: absoluteStart + i });
      }
      bufferStart = absoluteStart + sentence.length;
      continue;
    }

    if (buffer.length + sentence.length > maxChars) {
      if (buffer.trim()) out.push({ text: buffer.trim(), start: bufferStart });
      buffer = sentence;
      bufferStart = absoluteStart;
    } else {
      if (buffer.length === 0) bufferStart = absoluteStart;
      buffer += sentence;
    }
  }

  if (buffer.trim()) out.push({ text: buffer.trim(), start: bufferStart });
  return out;
}

/**
 * Transcripts chunk by speaker turn, because who said something determines
 * whether it is customer evidence or a vendor assertion.
 */
export function chunkTranscript(input: string, options: ChunkOptions = {}): Chunk[] {
  const maxChars = options.maxChars ?? DEFAULTS.maxChars;
  const text = input.replace(/\r\n/g, "\n");
  const turnPattern = /^([A-Z][A-Za-z0-9 ._'-]{0,40}):[ \t]*/gm;

  const turns: { speaker: string; start: number; bodyStart: number }[] = [];
  let match: RegExpExecArray | null;
  while ((match = turnPattern.exec(text)) !== null) {
    turns.push({
      speaker: match[1]!.trim(),
      start: match.index,
      bodyStart: match.index + match[0].length,
    });
  }

  if (turns.length < 2) return chunkText(text, options);

  const chunks: Chunk[] = [];
  for (let i = 0; i < turns.length; i++) {
    const turn = turns[i]!;
    const end = i + 1 < turns.length ? turns[i + 1]!.start : text.length;
    const body = text.slice(turn.bodyStart, end).trim();
    if (!body) continue;

    if (body.length <= maxChars) {
      chunks.push({
        index: chunks.length,
        text: body,
        charStart: turn.bodyStart,
        charEnd: end,
        speaker: turn.speaker,
      });
      continue;
    }

    for (const sub of chunkText(body, options)) {
      chunks.push({
        index: chunks.length,
        text: sub.text,
        charStart: turn.bodyStart + sub.charStart,
        charEnd: turn.bodyStart + sub.charEnd,
        speaker: turn.speaker,
      });
    }
  }

  return chunks.length > 0 ? chunks : chunkText(text, options);
}
