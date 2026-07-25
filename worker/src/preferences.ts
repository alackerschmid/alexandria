// Per-user UI preferences (appearance, locale, library display defaults) are stored as an
// opaque JSON blob on `users.preferences`. The frontend owns the key set and the meaning of
// each value (see `src/stores/preferences.ts`); the server only enforces the shape and size
// bounds that keep the blob safe to store and hand back, so adding a preference client-side
// never needs a worker change or a migration.

const MAX_KEYS = 64;
const MAX_KEY_LENGTH = 64;
const MAX_VALUE_LENGTH = 256;

/**
 * Validates a client-supplied preferences object. Returns the accepted map, or `null` if the
 * payload isn't a flat string→string object within bounds (rejected as a 400 by the route).
 */
export function sanitizePreferences(
  input: unknown,
): Record<string, string> | null {
  if (typeof input !== "object" || input === null || Array.isArray(input))
    return null;

  const entries = Object.entries(input as Record<string, unknown>);
  if (entries.length > MAX_KEYS) return null;

  const out: Record<string, string> = {};
  for (const [key, value] of entries) {
    if (!key || key.length > MAX_KEY_LENGTH) return null;
    if (typeof value !== "string" || value.length > MAX_VALUE_LENGTH)
      return null;
    out[key] = value;
  }
  return out;
}

/**
 * Reads the stored blob back. Anything unparseable or out of bounds degrades to "no
 * preferences" rather than an error — the client then falls back to its defaults.
 */
export function parsePreferences(stored: string | null): Record<string, string> {
  if (!stored) return {};
  try {
    return sanitizePreferences(JSON.parse(stored)) ?? {};
  } catch {
    return {};
  }
}
