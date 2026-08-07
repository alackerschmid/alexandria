import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vitest/config";

// Frontend unit tests cover pure logic only (search parsing, shelf packing,
// offline queue) — no component mounting, so a plain node environment suffices.
// Mirrors the worker's vitest setup (worker/vitest.config.ts). The `@` alias
// matches vite.config.mts so tests can import project modules the same way the
// app does.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("src", import.meta.url)),
    },
  },
  test: {
    include: ["test/**/*.spec.ts"],
    environment: "node",
    passWithNoTests: true,
    // Pinned *west* of UTC on purpose. The date helpers in `utils/book-display.ts` exist to stop
    // a calendar date rendering a day early for readers behind UTC, and every environment this
    // suite otherwise runs in — CI on UTC, development on CET — is east of or equal to UTC, where
    // the bug cannot reproduce. Without this the `timeZone: "UTC"` options could be deleted
    // outright and the whole suite would stay green. Do not "simplify" this to UTC.
    env: { TZ: "America/New_York" },
  },
});
