import { describe, expect, it } from "vitest";
import {
  encryptSecret,
  decryptSecret,
  hashPassword,
  verifyPassword,
  maskSecret,
  sha256,
  stableHash,
  stableStringify,
  safeEqual,
  CURRENT_KEY_VERSION,
} from "@/lib/crypto";

describe("credential encryption", () => {
  it("round-trips a secret", () => {
    const secret = "sk-live-not-a-real-key-0123456789";
    const encrypted = encryptSecret(secret);
    expect(encrypted.ciphertext).not.toContain(secret);
    expect(encrypted.keyVersion).toBe(CURRENT_KEY_VERSION);
    expect(decryptSecret(encrypted)).toBe(secret);
  });

  it("produces a different ciphertext each time (random IV)", () => {
    const a = encryptSecret("same-value");
    const b = encryptSecret("same-value");
    expect(a.ciphertext).not.toBe(b.ciphertext);
    expect(a.iv).not.toBe(b.iv);
    expect(decryptSecret(a)).toBe(decryptSecret(b));
  });

  it("rejects a tampered ciphertext instead of returning garbage", () => {
    const encrypted = encryptSecret("tamper-me");
    const bytes = Buffer.from(encrypted.ciphertext, "base64");
    bytes[0] = bytes[0]! ^ 0xff;
    expect(() => decryptSecret({ ...encrypted, ciphertext: bytes.toString("base64") })).toThrow();
  });

  it("rejects a tampered auth tag", () => {
    const encrypted = encryptSecret("tamper-my-tag");
    const tag = Buffer.from(encrypted.authTag, "base64");
    tag[0] = tag[0]! ^ 0xff;
    expect(() => decryptSecret({ ...encrypted, authTag: tag.toString("base64") })).toThrow();
  });

  it("masks a secret to the last four characters", () => {
    expect(maskSecret("abcdefghij")).toBe("••••ghij");
    expect(maskSecret("ab")).toBe("••••");
  });
});

describe("password hashing", () => {
  it("verifies a correct password", () => {
    const stored = hashPassword("correct horse battery staple");
    expect(verifyPassword("correct horse battery staple", stored)).toBe(true);
  });

  it("rejects an incorrect password", () => {
    const stored = hashPassword("correct horse battery staple");
    expect(verifyPassword("Correct horse battery staple", stored)).toBe(false);
    expect(verifyPassword("", stored)).toBe(false);
  });

  it("salts, so the same password hashes differently", () => {
    expect(hashPassword("repeat")).not.toBe(hashPassword("repeat"));
  });

  it("normalises unicode so equivalent inputs match", () => {
    // e + combining acute vs precomposed é
    const stored = hashPassword("café-password");
    expect(verifyPassword("café-password", stored)).toBe(true);
  });

  it("rejects a malformed stored hash rather than throwing", () => {
    expect(verifyPassword("anything", "not-a-hash")).toBe(false);
    expect(verifyPassword("anything", "scrypt$bad$8$1$aaaa$bbbb")).toBe(false);
  });
});

describe("hashing helpers", () => {
  it("hashes deterministically", () => {
    expect(sha256("abc")).toBe(sha256("abc"));
    expect(sha256("abc")).not.toBe(sha256("abd"));
  });

  it("stableStringify is key-order independent", () => {
    expect(stableStringify({ a: 1, b: 2 })).toBe(stableStringify({ b: 2, a: 1 }));
    expect(stableHash({ x: [1, { y: 2, z: 3 }] })).toBe(stableHash({ x: [1, { z: 3, y: 2 }] }));
  });

  it("stableStringify distinguishes different values", () => {
    expect(stableHash({ a: 1 })).not.toBe(stableHash({ a: 2 }));
  });

  it("stableStringify drops undefined but keeps null", () => {
    expect(stableStringify({ a: undefined, b: null })).toBe('{"b":null}');
  });

  it("safeEqual compares without throwing on length mismatch", () => {
    expect(safeEqual("abc", "abc")).toBe(true);
    expect(safeEqual("abc", "abcd")).toBe(false);
    expect(safeEqual("", "")).toBe(true);
  });
});
