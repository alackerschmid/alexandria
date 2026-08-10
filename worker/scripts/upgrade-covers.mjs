// Re-points existing `books.cover_url` values at a sharper image.
//
// Why there is anything to re-point: `fetchBookMetadata` merges Google over OpenLibrary and
// "primary's non-null values always win", so for every book both sources knew, Google's 128px
// `zoom=1` thumbnail overwrote OpenLibrary's ~330px `-L` that the same call had already fetched.
// 909 of the catalogue's 1,246 covers ended up at 128px, against the ~170 CSS px (before device
// pixel ratio) the library's cover grid paints them at. `src/cover-url.ts` fixes the rule; it only
// applies to *new* lookups, and nothing in the app ever overwrites a cover it already has
// (`fillMetadataStatement` is COALESCE-only), so the existing rows need this pass.
//
// It also takes something the worker deliberately cannot: Google's genuine 575px `zoom=3` image,
// which is publisher artwork and beats OpenLibrary's user-uploaded scan where it exists. It exists
// for only about a third of volumes — the rest answer **HTTP 200 with Google's grey "cover not
// available" graphic** — so it can only be had by fetching the image and looking at it, which is
// why this is a batch job and not a step in a lookup a user is waiting on.
//
// Preference order per book — a *tier*, highest first:
//   1. Google `zoom=3`, when the probe says it is a real cover  (~575px wide)
//   2. OpenLibrary `-L`                                         (~330px wide)
//   3. anything else: a 128px Google thumbnail, an OpenLibrary `-S`/`-M`, no cover at all
//
// The tier is computed for the URL we already hold as well as for each candidate, and a row is
// probed **only when what it holds is tier 3**. That is load-bearing rather than an optimization.
// Without it the winner was chosen purely on "is this candidate a plausible cover", never on "is
// it better than what we already store", and two things followed: a transient probe failure on an
// already-upgraded `zoom=3` cover fell through to the OpenLibrary tier and emitted a downgrade
// (irreversibly — the volume id is gone once the row holds an OpenLibrary URL), and every row
// already at `/b/id/<id>-L.jpg` was rewritten to a by-ISBN URL for no pixel gain, trading a pinned
// cover id for a mapping OpenLibrary can repoint later. `src/cover-url.ts` ships the same guard as
// `isGoogleThumbnail`; it is mirrored below.
//
// One consequence worth knowing: a row upgraded from a thumbnail to OpenLibrary `-L` is tier 2
// from then on, so a later run will not go looking for Google's 575px version for it. Probing for
// tier 1 needs the Google volume id, which only a Google URL carries.
//
// This script WRITES NOTHING. It prints a plan and emits SQL for review; apply it yourself:
//
//   node scripts/upgrade-covers.mjs                          # probe + plan (nothing written)
//   node scripts/upgrade-covers.mjs --sql > covers.sql       # emit SQL
//   npx wrangler d1 execute bookscan --remote --file covers.sql
//
// Flags: `--local` (target the local D1 instead of production), `--limit N`, `--concurrency N`
// (default 6), `--fill-missing` (also try OpenLibrary for rows with no cover at all),
// `--in <file>` (read the rows from a JSON file instead of querying D1). For `--in`, the file is
// whatever this printed — or any JSON array of `{isbn, cover_url}`:
//
//   npx wrangler d1 execute bookscan --remote --json \
//     --command "SELECT isbn, cover_url FROM books WHERE cover_url IS NOT NULL ORDER BY isbn"
//
// Re-running is safe: every UPDATE carries the old value in its WHERE clause, so a row that has
// moved on since the probe is skipped rather than clobbered, a row already upgraded produces no
// statement at all, and the tier gate above means a run cannot undo an earlier one. Worth
// re-running occasionally: books ingested since the last pass hold whatever `src/cover-url.ts`
// could choose without probing, which is OpenLibrary or a 128px thumbnail — never Google's 575px
// version.
//
// Querying D1 needs the shell's own wrangler auth (a token with D1 read). Without it, take the
// rows however you normally read production and pass them with `--in`.

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const DB = "bookscan";
// Kept as two literals rather than one with a substituted predicate, so the SELECT the `--in`
// instructions above tell you to paste is a statement wrangler can actually run.
const SELECT_WITH_COVER =
  "SELECT isbn, cover_url FROM books WHERE cover_url IS NOT NULL ORDER BY isbn";
const SELECT_ALL = "SELECT isbn, cover_url FROM books ORDER BY isbn";

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const value = (name, fallback) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};
// Rejected rather than coerced: `Number('-5') || 0` is -5, and `--limit -5` then reached
// `slice(0, -5)` and probed everything *except* the last five books — the opposite of the small
// trial run being asked for. `--concurrency -1` started zero workers and crashed after the
// progress banner had already printed.
const count = (name, fallback) => {
  const raw = value(name, null);
  if (raw === null) return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1)
    throw new Error(`${name} takes a positive integer, got "${raw}"`);
  return n;
};

const EMIT_SQL = flag("--sql");
const REMOTE = !flag("--local");
const FILL_MISSING = flag("--fill-missing");
const LIMIT = count("--limit", 0);
const CONCURRENCY = count("--concurrency", 6);
const IN_FILE = value("--in", null);

// Progress goes to stderr so `--sql > file` stays clean.
const log = (...m) => console.error(...m);

// ---------------------------------------------------------------------------------------------
// URL predicates and builders — mirror src/cover-url.ts, which a .mjs cannot import. Keep the two
// in sync. They are written against a parsed URL here for the same reason the module is: the
// string-regex versions disagreed with it on an uppercased host, an explicit `:443`, and a
// `/books` path with no trailing segment.
// ---------------------------------------------------------------------------------------------

function parseUrl(url) {
  try {
    return new URL(url);
  } catch {
    return null;
  }
}

function isGoogleCoverUrl(parsed) {
  if (!parsed) return false;
  if (
    !(
      parsed.hostname === "google.com" || parsed.hostname.endsWith(".google.com")
    )
  )
    return false;
  return parsed.pathname === "/books" || parsed.pathname.startsWith("/books/");
}

const isGoogleCover = (url) => isGoogleCoverUrl(parseUrl(url));
const isOpenLibraryCover = (url) =>
  parseUrl(url)?.hostname === "covers.openlibrary.org";

/** Mirrors `isGoogleThumbnail`: `zoom=1`, or no zoom, is Google's 128px image. */
function isGoogleThumbnail(url) {
  const parsed = parseUrl(url);
  if (!isGoogleCoverUrl(parsed)) return false;
  const zoom = parsed.searchParams.get("zoom");
  return zoom === null || zoom === "1";
}

/** Mirrors `isDeletedOpenLibraryCover`: cover id `-1` is their removed-cover sentinel, and 503s. */
const isDeletedOpenLibraryCover = (url) =>
  /\/b\/id\/(?:-\d+|0+)-[SML]\.jpg(?:\?|$)/.test(url);

// Deliberately does *not* drop the deleted-cover sentinel the way the module's version does. Here
// this is only the "keep what we have, tidied" fallback, and a row holding a `-1` URL is tier 3,
// so it is already being probed for a replacement.
function normalizeCoverUrl(url) {
  if (!url) return null;
  const parsed = parseUrl(url);
  if (!parsed) return url;
  if (parsed.protocol === "http:") parsed.protocol = "https:";
  if (isGoogleCoverUrl(parsed)) parsed.searchParams.delete("edge");
  return parsed.toString();
}

// The tiers from the header. `TIER_NONE` is "nothing worth keeping over a candidate".
const TIER_GOOGLE_LARGE = 1;
const TIER_OPENLIBRARY_L = 2;
const TIER_NONE = 3;

/** What tier the URL a row already holds sits at — the check whose absence caused the downgrades. */
function currentTier(url) {
  if (!url) return TIER_NONE;
  if (isGoogleCover(url))
    return isGoogleThumbnail(url) ? TIER_NONE : TIER_GOOGLE_LARGE;
  if (
    isOpenLibraryCover(url) &&
    /-L\.jpg(?:\?|$)/.test(url) &&
    !isDeletedOpenLibraryCover(url)
  )
    return TIER_OPENLIBRARY_L;
  return TIER_NONE;
}

function googleCoverAtZoom(url, zoom) {
  try {
    const parsed = new URL(url);
    parsed.searchParams.delete("edge");
    parsed.searchParams.set("zoom", String(zoom));
    return parsed.toString();
  } catch {
    return null;
  }
}

// `default=false` makes a missing cover a 404 instead of a 1x1 placeholder — the only way to tell
// "OpenLibrary has no cover for this ISBN" from "here is a blank image".
const openLibraryCoverByIsbn = (isbn) =>
  `https://covers.openlibrary.org/b/isbn/${encodeURIComponent(isbn)}-L.jpg?default=false`;

// `default=false` is a probe-only argument: stored, it would make a cover later removed from
// OpenLibrary 404 instead of serving their own placeholder.
const stripProbeArgs = (url) => url.replace("?default=false", "");

const openLibraryLargeVariant = (url) =>
  url.replace(/-[SM]\.jpg(\?|$)/, "-L.jpg$1");

// ---------------------------------------------------------------------------------------------
// Image probe
// ---------------------------------------------------------------------------------------------

/** Reads width/height straight out of the container — no image library for a one-off script. */
function imageSize(buf) {
  if (buf.length > 24 && buf.readUInt32BE(0) === 0x89_50_4e_47)
    return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let i = 2;
    while (i < buf.length - 9) {
      if (buf[i] !== 0xff) {
        i++;
        continue;
      }
      // Any number of 0xFF fill bytes may precede a marker (JFIF B.1.1.2). Treating one as the
      // marker itself read the *next* marker as a segment length and jumped clean past the buffer.
      let j = i + 1;
      while (j < buf.length && buf[j] === 0xff) j++;
      const marker = buf[j];
      // Standalone markers carry no length payload, so they must not be skipped by one.
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i = j + 1;
        continue;
      }
      // SOS/EOI: entropy-coded data follows, and a valid JPEG puts SOFn ahead of it. Walking into
      // it is what fabricated dimensions — stuffed 0xFF00 bytes and restart markers look enough
      // like segments for the resync above to latch onto, and a made-up size can pass
      // `looksLikeCover` and put a non-cover URL in the plan.
      if (marker === 0xda || marker === 0xd9) return null;
      // SOFn carries the dimensions; DHT/DAC/DRI sit in the same range and do not.
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker))
        return j + 7 < buf.length
          ? { h: buf.readUInt16BE(j + 4), w: buf.readUInt16BE(j + 6) }
          : null;
      if (j + 2 >= buf.length) return null;
      const length = buf.readUInt16BE(j + 1);
      if (length < 2) return null;
      i = j + 1 + length;
    }
    return null;
  }
  if (buf.subarray(0, 3).toString() === "GIF")
    return { w: buf.readUInt16LE(6), h: buf.readUInt16LE(8) };
  return null;
}

async function probe(url) {
  try {
    const res = await fetch(url, { redirect: "follow" });
    if (!res.ok) return { ok: false, why: `HTTP ${res.status}` };
    const buf = Buffer.from(await res.arrayBuffer());
    const size = imageSize(buf);
    if (!size) return { ok: false, why: "unrecognised image" };
    return {
      ok: true,
      ...size,
      hash: createHash("md5").update(buf).digest("hex"),
    };
  } catch (e) {
    return { ok: false, why: e.message };
  }
}

// A book cover is portrait. Google's "cover not available" graphic is 575x750 (ratio 1.304) and
// its library-scan sliver is 575x92; every genuine cover measured across a 50-book sample came in
// at 1.41 or taller. The gap is comfortable, and erring low only costs an upgrade — never a cover.
const MIN_ASPECT = 1.35;
const MIN_WIDTH = 250;

function looksLikeCover(p) {
  return p.ok && p.w >= MIN_WIDTH && p.h / p.w >= MIN_ASPECT;
}

// ---------------------------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------------------------

function loadRows() {
  if (IN_FILE) return extractRows(readFileSync(IN_FILE, "utf8"));
  const sql = FILL_MISSING ? SELECT_ALL : SELECT_WITH_COVER;
  const cmd = `npx wrangler d1 execute ${DB} ${REMOTE ? "--remote" : "--local"} --json --command "${sql}"`;
  log(`> ${cmd}`);
  const res = spawnSync(cmd, {
    shell: true,
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
  // `status` is null when the shell could not start the command at all (no npx on PATH), and
  // `stderr` is null with it — reading only those reported "wrangler failed:\nnull".
  if (res.error) throw new Error(`could not run wrangler: ${res.error.message}`);
  if (res.status !== 0)
    throw new Error(`wrangler failed:\n${res.stderr || res.stdout}`);
  return extractRows(res.stdout);
}

function extractRows(text) {
  // Wrangler prints a banner before the JSON in some versions; take from the first bracket on.
  const start = text.search(/[[{]/);
  if (start < 0) throw new Error(`no JSON in query output:\n${text.slice(0, 400)}`);
  const parsed = JSON.parse(text.slice(start));
  // Three shapes: wrangler's `[{results:[…]}]`, a bare `{results:[…]}`, and a plain array of rows
  // — the last being what `--in` gets when the file was assembled by hand rather than by wrangler.
  const results = Array.isArray(parsed)
    ? (parsed[0]?.results ?? parsed)
    : (parsed.results ?? parsed);
  if (!Array.isArray(results)) throw new Error("unexpected query output shape");
  return results;
}

// ---------------------------------------------------------------------------------------------
// Plan
// ---------------------------------------------------------------------------------------------

/**
 * Google's placeholders are byte-identical across volumes, so one image body behind two
 * *different* volume URLs is one — a check the aspect-ratio rule can't make on its own, and the
 * reason this runs as a batch rather than per book.
 *
 * Distinct URLs, not probe count, and Google only. Both narrowings exist to stop a genuine cover
 * being condemned: two `books` rows that are the ISBN-10 and ISBN-13 of one edition (a state this
 * repo's `isbnForms` note says predates the dedupe) resolve to the same Google volume, so counting
 * probes flagged their real cover; and OpenLibrary serves byte-identical bodies for both of those
 * ISBNs under two different URLs, so it cannot be included at all. It needs no detection anyway —
 * `default=false` makes a missing OpenLibrary cover a 404, so there is no shared placeholder there.
 *
 * `looksLikeCover`'s aspect rule is the primary defence (Google's graphic is 575x750, ratio 1.304);
 * this is the backstop for one that slips past it.
 */
function placeholderHashes(candidates) {
  const urlsByHash = new Map();
  for (const c of candidates) {
    if (c.source !== "google-zoom3" || !c.probe?.hash) continue;
    let urls = urlsByHash.get(c.probe.hash);
    if (!urls) urlsByHash.set(c.probe.hash, (urls = new Set()));
    urls.add(c.url);
  }
  return new Set(
    [...urlsByHash].filter(([, urls]) => urls.size > 1).map(([h]) => h),
  );
}

async function mapLimit(items, limit, fn) {
  const out = Array.from({length: items.length});
  let next = 0;
  let done = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i], i);
        if (++done % 25 === 0) log(`  probed ${done}/${items.length}`);
      }
    }),
  );
  return out;
}

async function buildPlan(rows) {
  log(`Probing ${rows.length} books (concurrency ${CONCURRENCY})…`);
  const probed = await mapLimit(rows, CONCURRENCY, async (row) => {
    const current = row.cover_url;
    const candidates = [];

    // Nothing is probed for a row that already holds tier 1 or tier 2. There is nothing to ask
    // for: tier 1 is the best image this script can find, and tier 2 can only be beaten by
    // Google's `zoom=3`, which needs a volume id an OpenLibrary URL doesn't carry. Skipping the
    // probe is also what makes a probe *failure* harmless — a failure can no longer be read as
    // "nothing better exists" for a row whose incumbent was never in the running.
    if (currentTier(current) === TIER_NONE) {
      if (current && isGoogleCover(current)) {
        const url = googleCoverAtZoom(current, 3);
        if (url)
          candidates.push({ source: "google-zoom3", url, probe: await probe(url) });
      } else if (current && isOpenLibraryCover(current)) {
        const url = openLibraryLargeVariant(current);
        if (url !== current)
          candidates.push({ source: "openlibrary-L", url, probe: await probe(url) });
      }

      // OpenLibrary by ISBN backs up every other route: a Google volume with no large version, an
      // OpenLibrary `-S`/`-M` whose `-L` isn't there, a deleted-cover sentinel, and a row with no
      // cover at all. Probed only when nothing better already answered.
      const url = openLibraryCoverByIsbn(row.isbn);
      if (
        !candidates.some((c) => looksLikeCover(c.probe)) &&
        current !== stripProbeArgs(url)
      )
        candidates.push({ source: "openlibrary-isbn", url, probe: await probe(url) });
    }

    return { ...row, candidates };
  });

  const placeholders = placeholderHashes(probed.flatMap((r) => r.candidates));

  const plan = [];
  const skipped = [];
  for (const row of probed) {
    const winner = row.candidates.find(
      (c) => looksLikeCover(c.probe) && !placeholders.has(c.probe.hash),
    );
    const url = winner
      ? normalizeCoverUrl(stripProbeArgs(winner.url))
      : normalizeCoverUrl(row.cover_url);
    if (!url || url === row.cover_url) {
      skipped.push(row);
      continue;
    }
    plan.push({
      isbn: row.isbn,
      from: row.cover_url,
      to: url,
      why: winner ? winner.source : "normalize",
      size: winner ? `${winner.probe.w}x${winner.probe.h}` : "—",
    });
  }
  return { plan, skipped };
}

// ---------------------------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------------------------

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

function render({ plan, skipped }, total) {
  if (!EMIT_SQL) {
    const byWhy = {};
    for (const p of plan) byWhy[p.why] = (byWhy[p.why] ?? 0) + 1;
    // The URL being replaced goes on its own line: without it the plan says what each row is
    // getting but not what it is giving up, which is exactly the check a reviewer is here to make.
    const lines = plan.flatMap((p) => [
      `  ${p.isbn.padEnd(14)} ${p.why.padEnd(18)} ${p.size.padEnd(10)} ${p.to}`,
      `  ${"was".padStart(17)} ${p.from ?? "(none)"}`,
    ]);
    return [
      `${total} books examined, ${plan.length} to update, ${skipped.length} left alone.`,
      ...Object.entries(byWhy).map(([why, n]) => `  ${why}: ${n}`),
      "",
      ...lines,
      "",
      "Re-run with --sql to emit the UPDATE statements.",
    ].join("\n");
  }

  const out = [
    "-- Generated by scripts/upgrade-covers.mjs. Every statement carries the old value, so a row",
    "-- changed since the probe is skipped rather than overwritten; re-running is safe.",
  ];
  for (const p of plan) {
    const guard = p.from === null ? "cover_url IS NULL" : `cover_url = ${q(p.from)}`;
    out.push(
      `UPDATE books SET cover_url = ${q(p.to)} WHERE isbn = ${q(p.isbn)} AND ${guard};  -- ${p.why} ${p.size}`,
    );
  }
  out.push(
    "",
    "-- Verify: no 128px Google thumbnails should be left for books OpenLibrary has a cover for.",
    "SELECT COUNT(*) AS google_thumbnails FROM books WHERE cover_url LIKE '%books.google%zoom=1%';",
  );
  return out.join("\n");
}

const all = loadRows();
const rows = LIMIT ? all.slice(0, LIMIT) : all;
console.log(render(await buildPlan(rows), rows.length));
