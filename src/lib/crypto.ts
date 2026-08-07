import "server-only";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";
import { env } from "./env";

// ── Vendor credential encryption (AES-256-GCM) ──────────────────────────────

export const CURRENT_KEY_VERSION = 1;

export type EncryptedValue = {
  ciphertext: string; // base64
  iv: string; // base64
  authTag: string; // base64
  keyVersion: number;
};

function encryptionKey(): Buffer {
  const key = Buffer.from(env.APP_ENCRYPTION_KEY, "base64");
  if (key.length !== 32) {
    throw new Error("APP_ENCRYPTION_KEY must decode to exactly 32 bytes (openssl rand -base64 32)");
  }
  return key;
}

export function encryptSecret(plaintext: string): EncryptedValue {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return {
    ciphertext: ciphertext.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    keyVersion: CURRENT_KEY_VERSION,
  };
}

export function decryptSecret(value: EncryptedValue): string {
  const decipher = createDecipheriv(
    "aes-256-gcm",
    encryptionKey(),
    Buffer.from(value.iv, "base64"),
  );
  decipher.setAuthTag(Buffer.from(value.authTag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(value.ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

/** Never render a secret. Show only enough to identify which key is stored. */
export function maskSecret(plaintext: string): string {
  if (plaintext.length <= 4) return "••••";
  return `••••${plaintext.slice(-4)}`;
}

// ── Password hashing (scrypt) ───────────────────────────────────────────────

const SCRYPT_N = 16384;
const SCRYPT_r = 8;
const SCRYPT_p = 1;
const KEY_LENGTH = 64;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password.normalize("NFKC"), salt, KEY_LENGTH, {
    N: SCRYPT_N,
    r: SCRYPT_r,
    p: SCRYPT_p,
    maxmem: 128 * SCRYPT_N * SCRYPT_r * 2,
  });
  return `scrypt$${SCRYPT_N}$${SCRYPT_r}$${SCRYPT_p}$${salt.toString("base64")}$${derived.toString("base64")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, nRaw, rRaw, pRaw, saltRaw, hashRaw] = parts as [
    string,
    string,
    string,
    string,
    string,
    string,
  ];
  const N = Number(nRaw);
  const r = Number(rRaw);
  const p = Number(pRaw);
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) return false;

  const expected = Buffer.from(hashRaw, "base64");
  const derived = scryptSync(
    password.normalize("NFKC"),
    Buffer.from(saltRaw, "base64"),
    expected.length,
    {
      N,
      r,
      p,
      maxmem: 128 * N * r * 2,
    },
  );
  return expected.length === derived.length && timingSafeEqual(expected, derived);
}

// ── Tokens and hashes ───────────────────────────────────────────────────────

/** Opaque, high-entropy token. Only its SHA-256 is persisted. */
export function generateToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/** Stable hash of an object, key-order independent — used for request hashes. */
export function stableHash(value: unknown): string {
  return sha256(stableStringify(value));
}

export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
