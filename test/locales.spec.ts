import { describe, it, expect } from "vitest";
import en from "@/locales/en.json";
import de from "@/locales/de.json";
import { STATS_SCOPES } from "@/types/stats";

// Every user-visible string goes through $t()/t() and must exist in both locales.
// A key present in one file and missing from the other renders as the raw key path
// in the UI, which no type-check or lint catches — hence this test.
function flatten(value: unknown, prefix = ""): string[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return [prefix];
  }
  return Object.entries(value as Record<string, unknown>).flatMap(([key, val]) =>
    flatten(val, prefix ? `${prefix}.${key}` : key),
  );
}

const enKeys = flatten(en);
const deKeys = flatten(de);

describe("locale files", () => {
  it("has keys in en.json", () => {
    expect(enKeys.length).toBeGreaterThan(0);
  });

  it("defines every en.json key in de.json", () => {
    const missing = enKeys.filter((key) => !deKeys.includes(key));
    expect(missing).toEqual([]);
  });

  it("defines every de.json key in en.json", () => {
    const missing = deKeys.filter((key) => !enKeys.includes(key));
    expect(missing).toEqual([]);
  });

  // Keys built at runtime are invisible to both the parity checks above and vue-tsc: a key
  // missing from BOTH files still passes them, and the UI renders the raw key path. Each
  // runtime-keyed family therefore pins its value set here.
  it("has a stats.scope_* label for every StatsScope", () => {
    // stats.vue builds `stats.scope_${value}` from STATS_SCOPES for the scope pill.
    for (const scope of STATS_SCOPES) {
      expect(enKeys).toContain(`stats.scope_${scope}`);
    }
  });
});
