export type RateLimitResult = { allowed: boolean; retryAfterSeconds: number }

// Fixed-window rate limiter backed by D1. `key` is caller-defined (e.g. `scan:<userId>`) so one
// table can back multiple rate-limited routes without a schema change. Not exact under bursts at
// a window boundary (a caller could in principle get up to ~2x the limit split across one) —
// fine for guarding against a runaway client bug/loop, not a precision-billing rate limiter.
export async function checkRateLimit(
  db: D1Database,
  key: string,
  limit: number,
  windowMinutes = 1,
): Promise<RateLimitResult> {
  const windowMs = windowMinutes * 60_000
  const now = Date.now()
  const windowStart = Math.floor(now / windowMs) * windowMs

  const row = await db
    .prepare(
      `INSERT INTO rate_limits (key, window_start, window_ms, count)
       VALUES (?, ?, ?, 1)
       ON CONFLICT(key, window_start) DO UPDATE SET count = count + 1
       RETURNING count`,
    )
    .bind(key, windowStart, windowMs)
    .first<{ count: number }>()

  const count = row?.count ?? 1
  const retryAfterSeconds = Math.max(0, Math.ceil((windowStart + windowMs - now) / 1000))
  return { allowed: count <= limit, retryAfterSeconds }
}
