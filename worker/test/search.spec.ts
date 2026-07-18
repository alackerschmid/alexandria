import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { searchBooksByTitle, UpstreamSearchError } from "../src/editions";

// searchBooksByTitle retries with backoff, so drive the clock rather than really waiting.
function mockFetch(...responses: Array<() => Response | Promise<never>>) {
  const fn = vi.fn();
  for (const r of responses) fn.mockImplementationOnce(async () => r());
  // Any further calls repeat the last response.
  const last = responses.at(-1)!;
  fn.mockImplementation(async () => last());
  vi.stubGlobal("fetch", fn);
  return fn;
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers });

const volume = (isbn: string, title: string) => ({
  volumeInfo: {
    title,
    authors: ["Ursula K. Le Guin"],
    industryIdentifiers: [{ type: "ISBN_13", identifier: isbn }],
  },
});

/** Runs `p` to completion while fast-forwarding the retry backoff sleeps. */
async function withTimersFlushed<T>(p: Promise<T>): Promise<T> {
  const settled = p.then(
    (v) => ({ ok: true as const, v }),
    (e) => ({ ok: false as const, e }),
  );
  await vi.advanceTimersByTimeAsync(60_000);
  const r = await settled;
  if (r.ok) return r.v;
  throw r.e;
}

const search = () => searchBooksByTitle("the dispossessed", undefined, "key");

describe("searchBooksByTitle", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("returns candidates when Google Books answers with items", async () => {
    mockFetch(() => json({ items: [volume("9781473206069", "The Dispossessed")] }));
    const out = await withTimersFlushed(search());
    expect(out).toHaveLength(1);
    expect(out[0].isbn).toBe("9781473206069");
  });

  // The bug this guards: a 200 with no `items` is a real "nothing found", and must NOT throw.
  it("returns an empty array for a genuine zero-result search", async () => {
    mockFetch(() => json({ totalItems: 0 }));
    await expect(withTimersFlushed(search())).resolves.toEqual([]);
  });

  // The bug this guards: a quota rejection used to fall through and look like zero results.
  it("throws on 429 rather than reporting zero results", async () => {
    mockFetch(() =>
      json({ error: { code: 429, message: "Quota exceeded" } }, 429, {
        "Retry-After": "120",
      }),
    );
    const err = await withTimersFlushed(search()).catch((e) => e);
    expect(err).toBeInstanceOf(UpstreamSearchError);
    expect(err.status).toBe(429);
    expect(err.retryAfterSeconds).toBe(120);
  });

  // Retrying a *daily* quota 429 can only fail, and each attempt costs backoff. Search gets one
  // extra shot (to rescue a per-minute rate limit), not the full 5xx budget.
  it("retries a 429 only once, unlike a 5xx", async () => {
    const fetchMock = mockFetch(() => json({ error: {} }, 429));
    await withTimersFlushed(search()).catch(() => {});
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws when 5xx persists across every retry", async () => {
    const fetchMock = mockFetch(() => json({ error: {} }, 503));
    const err = await withTimersFlushed(search()).catch((e) => e);
    expect(err).toBeInstanceOf(UpstreamSearchError);
    expect(err.status).toBe(503);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("still recovers when a transient 503 is followed by success", async () => {
    mockFetch(
      () => json({ error: {} }, 503),
      () => json({ items: [volume("9780060512750", "The Dispossessed")] }),
    );
    const out = await withTimersFlushed(search());
    expect(out).toHaveLength(1);
  });

  it("throws when the network call itself fails", async () => {
    mockFetch(() => Promise.reject(new Error("connection reset")));
    await expect(withTimersFlushed(search())).rejects.toBeInstanceOf(
      UpstreamSearchError,
    );
  });
});
