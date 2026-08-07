import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  // TZ pinned west of UTC for the same reason as the root config: the worker's date logic
  // (usageHourStart/usageDayStart, the stats year helpers) is all meant to be UTC-absolute, and
  // running the suite on a UTC machine cannot tell that apart from accidental local-time use.
  test: { env: { TZ: 'America/New_York' } },
})
