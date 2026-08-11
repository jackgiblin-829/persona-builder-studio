import { randomBytes } from "node:crypto";

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz"; // Crockford base32, no i/l/o/u

/**
 * Prefixed, time-sortable identifiers. 10 chars of millisecond timestamp
 * followed by 16 chars of randomness — the same construction as a ULID, but
 * rendered with a human-readable entity prefix so ids are self-describing in
 * logs and exports.
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
  project: "prj",
  integration: "int",
  credential: "crd",
  dataSource: "src",
  sourceDocument: "doc",
  researchSignal: "sig",
  marketResearchBrief: "mrb",
  sparkReport: "spr",
  sparkReportSection: "sps",
  generationRun: "run",
  persona: "per",
  personaVersion: "pev",
  personaVersionSignal: "pvs",
  promptSet: "pst",
  promptSetVersion: "psv",
  promptCluster: "pcl",
  prompt: "prm",
  promptSignalLink: "psl",
  vendorUsage: "vus",
  auditLog: "log",
  job: "job",
} as const;

export type IdPrefix = (typeof ID_PREFIXES)[keyof typeof ID_PREFIXES];

/** URL/tag-safe slug used for stable project, persona, and cluster identifiers. */
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
