import type { Context } from "hono";

// `c.req.json()` rejects on a malformed body, and every route that awaited it unguarded turned a
// squarely client-side mistake (truncated POST, wrong Content-Type, a hand-rolled curl) into an
// unhandled 500. This returns null instead, so the call site can answer 400.
//
// A non-object top level (`"foo"`, `[…]`, `null`) is also null here: every route using this reads
// named properties off the body, and an array would otherwise sail through as an object whose
// fields are all undefined — or worse, coerce (a JSON array binds to D1 as neither string nor
// number and throws deep inside the query).
export async function readJsonBody<T>(c: Context): Promise<T | null> {
  try {
    const body = await c.req.json();
    if (typeof body !== "object" || body === null || Array.isArray(body)) {
      return null;
    }
    return body as T;
  } catch {
    return null;
  }
}

// The one 400 every readJsonBody miss answers with, so the shape is identical across routes.
export const INVALID_JSON_BODY = { error: "Invalid JSON body" } as const;
