import { randomBytes } from "node:crypto";

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz"; // Crockford base32, no i/l/o/u

/**
 * Prefixed, time-sortable identifiers. 10 chars of millisecond timestamp
 * followed by 16 chars of randomness — the same construction as a ULID, but
 * rendered with a human-readable entity prefix so ids are self-describing in
 * logs, exports and Profound tags.
 */
export function newId(prefix: IdPrefix): string {
  return `${prefix}_${encodeTime(Date.now())}${encodeRandom(16)}`;
}

function encodeTime(ms: number): string {
  let out = "";
  let value = ms;
  for (let i = 0; i < 10; i++) {
    out = ALPHABET[value % 32]! + out;
    value = Math.floor(value / 32);
  }
  return out;
}

function encodeRandom(length: number): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i]! % 32]!;
  return out;
}

export const ID_PREFIXES = {
  organization: "org",
  user: "usr",
  membership: "mem",
  session: "ses",
  brand: "brd",
  brandProduct: "bpr",
  competitor: "cmp",
  integration: "int",
  credential: "crd",
  dataSource: "src",
  ingestionJob: "ing",
  sourceDocument: "doc",
  evidence: "ev",
  evidenceEmbedding: "emb",
  evidenceNote: "evn",
  audienceReport: "aud",
  audienceSignal: "asg",
  searchDataset: "sds",
  segmentCandidate: "seg",
  persona: "per",
  personaVersion: "pev",
  personaField: "pfd",
  promptSet: "pst",
  promptSetVersion: "psv",
  prompt: "pr",
  promptPair: "ppr",
  profoundConnection: "pcn",
  profoundCategoryMapping: "pcm",
  profoundPersonaMapping: "ppm",
  profoundPromptLink: "ppl",
  profoundSyncJob: "psj",
  profoundSyncItem: "psi",
  resultSnapshot: "rsn",
  contentOpportunity: "opp",
  contentBrief: "brf",
  pageAudit: "pau",
  auditFinding: "afd",
  pageInventory: "pgi",
  modelConfiguration: "mdc",
  promptTemplate: "tpl",
  evaluationRun: "evr",
  evaluationResult: "evs",
  vendorUsage: "vus",
  auditLog: "log",
  job: "job",
} as const;

export type IdPrefix = (typeof ID_PREFIXES)[keyof typeof ID_PREFIXES];

/** URL/tag-safe slug. Used for `persona:<slug>` Profound tags — must be stable. */
export function slugify(input: string, maxLength = 60): string {
  const slug = input
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLength)
    .replace(/-+$/g, "");
  return slug || "untitled";
}
