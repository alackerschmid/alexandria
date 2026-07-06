import { describe, it, expect } from "vitest";
import * as bcrypt from "bcryptjs";
import {
  hashPassword,
  verifyPassword,
  isLegacyHash,
  needsRehash,
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
