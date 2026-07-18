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
  },
});
