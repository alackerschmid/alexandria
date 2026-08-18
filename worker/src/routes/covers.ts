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

  return new Response(object.body, { headers });
});

export default covers;
