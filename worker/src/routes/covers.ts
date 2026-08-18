import { Hono } from "hono";
import type { Env } from "../types";
import { isCoverKey } from "../covers";

/**
 * `GET /api/covers/:isbn/:file` — the stored cover for a book.
 *
 * **Public, deliberately.** An `<img>` cannot send an `Authorization` header, so an authenticated
 * route here would mean no covers at all; and a cover is a publisher's artwork, not user data. What
 * the route *does* protect is the reader: with it, the library's covers come from this origin
 * instead of every reader's browser announcing their shelf to Google.
 *
 * A miss is a **404, never a redirect upstream.** Redirecting would hand the request back to the
 * third party and reintroduce exactly the leak this exists to close; `CoverImage` already falls
 * back to `PlaceholderCover` when an `<img>` fails, so the degradation is already designed.
 */
const covers = new Hono<Env>();

/**
 * A year, `immutable`. Safe only because the key contains a hash of the bytes (`coverKeyFor`): a
 * book whose cover we later replace is served under a *new* key, so no browser is ever holding a
 * stale one. Do not weaken the key without weakening this.
 */
const CACHE_CONTROL = "public, max-age=31536000, immutable";

covers.get("/:isbn/:file", async (c) => {
  const key = `${c.req.param("isbn")}/${c.req.param("file")}`;
  // Shape-checked before it reaches R2: the params are caller-controlled, and this is what keeps
  // them from naming an object outside the covers namespace.
  if (!isCoverKey(key)) return c.notFound();

  // The colo's cache, checked before R2. Nothing caches a worker's response for us — this runs on
  // `workers.dev`, where no zone cache rule applies — so without this every tile on every library
  // page load, for every reader, is its own R2 round trip: measured at 150-250ms each, which is
  // what made a shelf of covers arrive in waves. `Cache-Control` above is already a year, so the
  // stored copy is as long-lived as the browser's, and the content hash in the key means a
  // replaced cover is a different URL rather than a stale entry.
  //
  // `match` evaluates If-None-Match against the stored ETag itself and answers 304 on a match, so
  // the conditional path below is only reached on a miss.
  const cache = caches.default;
  const hit = await cache.match(c.req.raw);
  if (hit) return hit;

  // Passing the request headers as `onlyIf` lets R2 evaluate If-None-Match itself; on a match it
  // returns the object's metadata with no `body`, which is exactly a 304.
  const object = await c.env.COVERS.get(key, {
    onlyIf: c.req.raw.headers,
  });
  if (!object) return c.notFound();

  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("etag", object.httpEtag);
  headers.set("cache-control", CACHE_CONTROL);

  if (!("body" in object) || !object.body)
    return new Response(null, { status: 304, headers });

  const response = new Response(object.body, { headers });
  // Deliberately only the 200: a 304 has no body to serve anyone else, and a 404 must stay a live
  // question — a cover the sweeper stores a minute from now would otherwise 404 for a year.
  // Stored before the CORS middleware runs, so the entry holds no `Access-Control-Allow-Origin`;
  // a hit is returned through that same middleware, which puts the header back either way.
  c.executionCtx.waitUntil(cache.put(c.req.raw, response.clone()));
  return response;
});

export default covers;
