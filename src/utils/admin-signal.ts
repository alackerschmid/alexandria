/**
 * Shared colour vocabulary for the admin board. Kept apart from the data helpers in
 * `admin-usage.ts` because this is the one piece that maps state to *appearance* — several
 * components colour themselves from the same levels, providers and statuses, and they must agree.
 * `admin-usage.ts` stays free of Tailwind tokens so it can be unit-tested on numbers alone.
 */

/** `neutral` is "no reading yet" (loading or failed), not a fourth severity. */
export type SignalLevel = "neutral" | "ok" | "warning" | "critical";

// One row per level rather than three parallel switches: `Record<SignalLevel, …>` makes a new
// level a type error until all three classes are given, which three switches could not.
const SIGNAL: Record<
  SignalLevel,
  { text: string; bg: string; border: string }
> = {
  neutral: {
    text: "text-text-secondary",
    bg: "bg-charcoal-border",
    border: "border-charcoal-border",
  },
  ok: {
    text: "text-signal-ok",
    bg: "bg-signal-ok",
    border: "border-signal-ok",
  },
  warning: {
    text: "text-signal-warn",
    bg: "bg-signal-warn",
    border: "border-signal-warn",
  },
  critical: {
    text: "text-signal-critical",
    bg: "bg-signal-critical",
    border: "border-signal-critical",
  },
};

export const signalText = (level: SignalLevel): string => SIGNAL[level].text;
export const signalBg = (level: SignalLevel): string => SIGNAL[level].bg;
export const signalBorder = (level: SignalLevel): string =>
  SIGNAL[level].border;

/** google_books leads on the accent because it's the one with a cap to watch. */
const PROVIDER_BG: Record<string, string> = {
  google_books: "bg-orange-neon",
  openlibrary: "bg-chart-total",
  wikidata: "bg-chart-muted",
};

/** `works.enrichment_status`, as the enrichment bar's segments. */
const STATUS_BG: Record<string, string> = {
  done: "bg-signal-ok",
  pending: "bg-chart-total",
  failed: "bg-signal-critical",
  exhausted: "bg-chart-muted",
};

/** `enrichment_runs.outcome`, as the run bar's segments — `failed` matches the status above. */
const OUTCOME_BG: Record<string, string> = {
  done: "bg-signal-ok",
  not_found: "bg-chart-total",
  failed: "bg-signal-critical",
};

/**
 * Swatch colour for a provider. A provider this build doesn't know about still gets a bar, just a
 * neutral one — the counters are written by the worker and can outrun the frontend across a
 * deploy. Shared so the chart legend and the endpoint table can't colour the same provider
 * differently.
 */
export const providerBg = (provider: string): string =>
  PROVIDER_BG[provider] ?? "bg-chart-muted";

export const statusBg = (status: string): string =>
  STATUS_BG[status] ?? "bg-chart-muted";

export const outcomeBg = (outcome: string): string =>
  OUTCOME_BG[outcome] ?? "bg-chart-muted";

/** Share of enrichment runs that failed, banded: a few failures are normal, a lot are not. */
export function failureLevel(percent: number): SignalLevel {
  if (percent >= 25) return "critical";
  if (percent >= 10) return "warning";
  return "ok";
}

/**
 * Share of works that are terminally un-enriched (`failed` + `exhausted`), banded.
 *
 * Deliberately *not* banded on "percent done", which is what the enrichment pip displays. A large
 * `pending` share is normal right after a bulk import — a Goodreads library queues hundreds of
 * works at once and the sweeper drains `BATCH_SIZE` every two minutes — so a threshold on progress
 * would go amber exactly when someone is most likely to be looking at the board, and would mean
 * nothing when it did. `failed` and `exhausted` are different in kind: they don't drain with time,
 * so any real share of them is a problem whatever the progress figure says.
 */
export function enrichmentLevel(terminalPercent: number): SignalLevel {
  if (terminalPercent >= 15) return "critical";
  if (terminalPercent >= 5) return "warning";
  return "ok";
}

// Generous against a cron that fires every two minutes: the warn threshold is ~7 missed ticks, so
// Cloudflare's scheduling jitter and a tick spent entirely on slow SPARQL can't trip it.
const SWEEPER_WARN_MS = 15 * 60_000;
const SWEEPER_CRITICAL_MS = 60 * 60_000;

/**
 * Whether the cron sweeper is keeping up, from the age of the last `enrichment_runs` row and the
 * number of works currently due.
 *
 * Both halves are needed. Age alone is meaningless when the queue is empty — the sweeper writes a
 * run row only when it enriches something, so an idle instance's last run is legitimately ancient.
 * Queue depth alone is meaningless too: a bulk import queues hundreds of works and takes hours to
 * drain at `BATCH_SIZE` every two minutes, which is normal. Only "there is work due *and* nothing
 * has finished in a long time" means the cron itself has stopped — the failure the status counts
 * cannot show, because a dead sweeper and a draining backlog both just read `pending`.
 *
 * A null age with work due is `warning`, not `critical`: it's a brand-new instance whose cron
 * hasn't fired yet *or* one dead long enough for the 30-day run retention to have pruned the
 * evidence, and nothing in the data distinguishes them.
 */
export function sweeperLevel(
  lastRunAgeMs: number | null,
  dueCount: number,
): SignalLevel {
  if (dueCount <= 0) return "ok";
  if (lastRunAgeMs === null) return "warning";
  if (lastRunAgeMs >= SWEEPER_CRITICAL_MS) return "critical";
  if (lastRunAgeMs >= SWEEPER_WARN_MS) return "warning";
  return "ok";
}

const SEVERITY: Record<SignalLevel, number> = {
  neutral: 0,
  ok: 1,
  warning: 2,
  critical: 3,
};

/**
 * The most severe of several readings — for one indicator fed by more than one signal. `neutral`
 * ranks below `ok` so a missing reading never outranks a real one.
 */
export function worstLevel(...levels: SignalLevel[]): SignalLevel {
  return levels.reduce(
    (worst, l) => (SEVERITY[l] > SEVERITY[worst] ? l : worst),
    "neutral" as SignalLevel,
  );
}
