import { describe, it, expect } from "vitest";
import * as bcrypt from "bcryptjs";
import {
  hashPassword,
  verifyPassword,
  isLegacyHash,
  needsRehash,
  DUMMY_PASSWORD_HASH,
} from "../src/password";

describe("hashPassword", () => {
  it("produces a self-describing pbkdf2 hash", async () => {
    const hash = await hashPassword("correct horse battery staple");
    const parts = hash.split("$");
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe("pbkdf2");
    expect(Number(parts[1])).toBeGreaterThanOrEqual(100_000);
  });

  it("salts every hash (same password, different hashes)", async () => {
    const [a, b] = await Promise.all([
      hashPassword("same"),
      hashPassword("same"),
    ]);
    expect(a).not.toBe(b);
  });
});

describe("verifyPassword (pbkdf2)", () => {
  it("accepts the original password", async () => {
    const hash = await hashPassword("sw0rdfish!");
    expect(await verifyPassword("sw0rdfish!", hash)).toBe(true);
  });

  it("rejects a wrong password", async () => {
    const hash = await hashPassword("sw0rdfish!");
    expect(await verifyPassword("sw0rdfish", hash)).toBe(false);
  });

  it("rejects malformed stored hashes without throwing", async () => {
    expect(await verifyPassword("pw", "")).toBe(false);
    expect(await verifyPassword("pw", "pbkdf2$notanumber$AAAA$AAAA")).toBe(
      false,
    );
    expect(await verifyPassword("pw", "pbkdf2$100000$!!!$!!!")).toBe(false);
    expect(await verifyPassword("pw", "scrypt$1$AAAA$AAAA")).toBe(false);
    expect(await verifyPassword("pw", "pbkdf2$100000$AAAA")).toBe(false);
  });

  it("honors the iteration count stored in the hash (forward compat)", async () => {
    const hash = await hashPassword("pw");
    const bumped = hash.replace(/^pbkdf2\$\d+\$/, "pbkdf2$50000$");
    // Different iteration count derives a different key — must no longer match.
    expect(await verifyPassword("pw", bumped)).toBe(false);
  });
});

// Login verifies against this when there is no user row, so that an unregistered email costs the
// same ~100k iterations a wrong password does and response time stops being a membership oracle.
// The property is entirely structural, and it fails *silently*: verifyPassword parses the base64
// halves inside a try/catch that returns false before deriveKey ever runs, so a dummy that drifted
// out of shape (a character short, or a digest length that stopped matching KEY_BYTES if 32 were
// raised) would return false in microseconds instead — login still 401s correctly, nothing type-
// errors, and the hole is quietly back. Hence assertions on the shape, not on the answer.
describe("DUMMY_PASSWORD_HASH", () => {
  it("is shaped exactly like a real hash, so verification does the full derivation", async () => {
    const real = (await hashPassword("pw")).split("$");
    const dummy = DUMMY_PASSWORD_HASH.split("$");

    expect(dummy).toHaveLength(4);
    expect(dummy[0]).toBe(real[0]);
    // Same iteration count as a live hash, or the two paths cost different amounts of work.
    expect(dummy[1]).toBe(real[1]);
    // Decodable, and byte-for-byte the same lengths — atob throws on malformed base64, and a
    // digest of the wrong length short-circuits in timingSafeEqual before any derivation.
    expect(atob(dummy[2])).toHaveLength(atob(real[2]).length);
    expect(atob(dummy[3])).toHaveLength(atob(real[3]).length);
  });

  it("no password matches it", async () => {
    expect(await verifyPassword("", DUMMY_PASSWORD_HASH)).toBe(false);
    expect(await verifyPassword("password", DUMMY_PASSWORD_HASH)).toBe(false);
  });

  it("is not mistaken for a legacy hash or flagged for rehash", () => {
    expect(isLegacyHash(DUMMY_PASSWORD_HASH)).toBe(false);
    expect(needsRehash(DUMMY_PASSWORD_HASH)).toBe(false);
  });
});

describe("verifyPassword (legacy bcrypt)", () => {
  it("still verifies pre-migration bcrypt hashes", async () => {
    const legacy = bcrypt.hashSync("old-password", 4); // low cost — test speed only
    expect(await verifyPassword("old-password", legacy)).toBe(true);
    expect(await verifyPassword("wrong", legacy)).toBe(false);
  });
});

describe("needsRehash", () => {
  it("flags legacy bcrypt hashes", () => {
    expect(needsRehash("$2b$10$abcdefghijklmnopqrstuv")).toBe(true);
  });

  it("does not flag a current pbkdf2 hash", async () => {
    expect(needsRehash(await hashPassword("pw"))).toBe(false);
  });

  it("flags a pbkdf2 hash minted with fewer iterations than the current setting", async () => {
    const stale = (await hashPassword("pw")).replace(
      /^pbkdf2\$\d+\$/,
      "pbkdf2$50000$",
    );
    expect(needsRehash(stale)).toBe(true);
  });

  it("does not flag unknown formats (they fail verification instead)", () => {
    expect(needsRehash("scrypt$1$AAAA$AAAA")).toBe(false);
    expect(needsRehash("")).toBe(false);
  });
});

describe("isLegacyHash", () => {
  it("detects bcrypt variants", () => {
    expect(isLegacyHash("$2a$10$abcdefghijklmnopqrstuv")).toBe(true);
    expect(isLegacyHash("$2b$10$abcdefghijklmnopqrstuv")).toBe(true);
    expect(isLegacyHash("$2y$10$abcdefghijklmnopqrstuv")).toBe(true);
  });

  it("does not flag pbkdf2 hashes", async () => {
    expect(isLegacyHash(await hashPassword("pw"))).toBe(false);
  });
});
