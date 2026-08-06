import type { Context } from "hono";
import type { Env } from "./types";

export type RateLimitResult = { allowed: boolean; retryAfterSeconds: number };

// Cloudflare always sets CF-Connecting-IP in production, so this fallback only fires off-edge —
// `wrangler dev`, a direct-to-origin request, a test. A literal "unknown" put every such caller in
// one shared bucket, where a handful of local logins exhausted the 10/min budget for everyone
// (including other dev sessions against the same D1). One random token per isolate keeps the limit
// working as a runaway-loop guard without collapsing unrelated callers into a single counter.
//
// Generated lazily on first use, never at module scope: workerd forbids generating random values
// during initial script evaluation ("Disallowed operation called within global scope. Asynchronous
// I/O ..., setting a timeout, and generating random values are not allowed within global scope"),
// and this module is on the static import path from index.ts — a top-level `crypto.randomUUID()`
// here takes the *whole worker* down at startup, every request and every cron tick. Nothing local
// catches that: the worker's vitest runs in plain Node, where it is perfectly legal.
// `clientIp` is only ever called from inside a handler, so the lazy init always has a request
// context, and the token stays constant for the isolate's lifetime as intended.
let fallbackClientId: string | undefined;

export function clientIp(c: Context<Env>): string {
  const ip = c.req.header("CF-Connecting-IP");
  if (ip) return ip;
  fallbackClientId ??= `unknown-${crypto.randomUUID()}`;
  return fallbackClientId;
}

// Fixed-window rate limiter backed by D1. `key` is caller-defined (e.g. `scan:<userId>`) so one
// table can back multiple rate-limited routes without a schema change. Not exact under bursts at
// a window boundary (a caller could in principle get up to ~2x the limit split across one) —
// fine for guarding against a runaway client bug/loop, not a precision-billing rate limiter.
//
// `cost` lets one call account for more than one unit of work — e.g. a Goodreads import batch
// charges its row count in one shot, rather than the request count (which would let a 1-row
// request and a 10-row request cost the same, and made resolving one review-queue row at a time
// burn a full request's worth of budget).
export async function checkRateLimit(
  db: D1Database,
  key: string,
  limit: number,
  windowMinutes = 1,
  cost = 1,
): Promise<RateLimitResult> {
  const windowMs = windowMinutes * 60_000;
  const now = Date.now();
  const windowStart = Math.floor(now / windowMs) * windowMs;

  const row = await db
    .prepare(
      `INSERT INTO rate_limits (key, window_start, window_ms, count)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(key, window_start) DO UPDATE SET count = count + excluded.count
       RETURNING count`,
    )
    .bind(key, windowStart, windowMs, cost)
    .first<{ count: number }>();

  const count = row?.count ?? cost;
  const retryAfterSeconds = Math.max(
    0,
    Math.ceil((windowStart + windowMs - now) / 1000),
  );
  return { allowed: count <= limit, retryAfterSeconds };
}

// Checks the rate limit and, if exceeded, sets the Retry-After header and returns the 429
// response to send. Returns null when the request is allowed, so call sites read as:
//   const blocked = await rateLimitOrReject(c, key, limit, windowMinutes, message)
//   if (blocked) return blocked
export async function rateLimitOrReject(
  c: Context<Env>,
  key: string,
  limit: number,
  windowMinutes: number,
  message: string,
  cost = 1,
): Promise<Response | null> {
  const rateLimit = await checkRateLimit(c.env.DB, key, limit, windowMinutes, cost);
  if (rateLimit.allowed) return null;
  c.header("Retry-After", String(rateLimit.retryAfterSeconds));
  return c.json({ error: message }, 429);
}
