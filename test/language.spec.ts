import { describe, it, expect } from "vitest";
import {
  languageDisplayFormatter,
  resolveLanguageName,
} from "@/utils/language";

describe("languageDisplayFormatter", () => {
  it("maps codes to localised names and passes unknowns through", () => {
    const fmt = languageDisplayFormatter("en");
    expect(fmt("de")).toBe("German");
    expect(fmt("pt-BR")).toBe("Brazilian Portuguese");
    expect(fmt("notalang")).toBe("notalang");
    expect(fmt(null)).toBe("");
  });
});

describe("resolveLanguageName", () => {
  it("resolves real codes, including region and script subtags", () => {
    expect(resolveLanguageName("de", "en")).toBe("German");
    expect(resolveLanguageName("pt-BR", "en")).toBe("Brazilian Portuguese");
    expect(resolveLanguageName("zh-Hant", "en")).toBe("Traditional Chinese");
  });

  it("rejects a language name typed in place of a code", () => {
    // Structurally a valid subtag, so Intl doesn't throw — it just echoes it back lowercased.
    expect(resolveLanguageName("German", "en")).toBeNull();
    expect(resolveLanguageName("xx", "en")).toBeNull();
    expect(resolveLanguageName("notalang", "en")).toBeNull();
  });

  it("rejects structurally invalid tags without throwing", () => {
    expect(resolveLanguageName("12", "en")).toBeNull();
    expect(resolveLanguageName("", "en")).toBeNull();
    expect(resolveLanguageName(" ".repeat(3), "en")).toBeNull();
  });

  it("follows the display locale", () => {
    expect(resolveLanguageName("de", "de")).toBe("Deutsch");
  });
});
