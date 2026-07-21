import { ref, reactive, computed } from "vue";
import Papa from "papaparse";
import { useApi } from "@/composables/useApi";
import { useFieldDefsStore } from "@/stores/fieldDefs";
import {
  isGoodreadsExport,
  parseGoodreadsRow,
  DEFAULT_SHELF_MAPPING,
  buildImportPayload,
  shelfMappingFor,
  stripTitleAnnotations,
  type ParsedGoodreadsRow,
  type ShelfMapping,
  type ImportPayloadRow,
} from "@/utils/goodreads";
import type { ReadStatus, OwningStatus } from "@/types/book";

// The custom tag field Goodreads' "Bookshelves" column imports into, when the user opts in.
// Reused across imports (by exact name+type match) rather than minting a new field each time.
const SHELVES_FIELD_NAME = "Shelves";

export type ImportStep = "upload" | "confirm" | "importing" | "review";

interface ImportedBook {
  isbn: string;
  title: string | null;
  author: string | null;
  cover_url: string | null;
  publisher: string | null;
  language: string | null;
  work_id: number | null;
}

interface ImportRowResult {
  isbn: string;
  outcome: "imported" | "updated" | "duplicate" | "invalid_isbn" | "failed";
  scan_id?: number;
  book?: ImportedBook;
  // Present only for "updated" rows — the scan's status/rating/owning_status before this update.
  previous?: { status: ReadStatus; rating: number | null; owning_status: OwningStatus };
}

// Response shape of POST /api/import/match — the title/author matching pass for rows with no
// usable ISBN. No "failed"/"invalid_isbn" outcome: a row either matches (confidently, against
// the user's own library) or it doesn't, and a request-level failure degrades to "no_match"
// (see postMatchBatchWithRetry) so it falls to manual review rather than guessing.
interface MatchRowResult {
  outcome: "duplicate" | "updated" | "no_match";
  scan_id?: number;
  book?: ImportedBook;
  previous?: { status: ReadStatus; rating: number | null; owning_status: OwningStatus };
  confidence?: number;
}

export interface EditionCandidate {
  isbn: string;
  title: string;
  author: string;
  cover_url: string | null;
  publisher?: string | null;
}

// A successfully imported book, shown as an editable card in the summary step. Its status/
// owning_status/rating live server-side (the scan is already saved); the card mirrors them
// locally and PATCHes on change. `searchTitle`/`searchAuthor` seed the "change edition" search.
export interface ImportedItem {
  scanId: number;
  isbn: string;
  title: string;
  author: string;
  coverUrl: string | null;
  publisher: string | null;
  language: string | null;
  status: ReadStatus;
  owningStatus: OwningStatus;
  rating: number | null;
  /** The Goodreads "date added", carried along so changing edition doesn't lose it. */
  createdAt: string | null;
  /** The linked work, if resolved server-side — lets "change edition" fall back to already
   *  known editions of this work when the live title search is unavailable. */
  workId: number | null;
  /** True when this row matched a book already in the library and was updated in place, rather
   *  than creating a new scan. Changes what "remove" means (see previous) and how the row is
   *  labeled. */
  preexisting: boolean;
  /** The scan's status/rating/owning_status before this update — only set when preexisting.
   *  Lets "remove" become "undo" (PATCH status/rating back) instead of deleting a scan that
   *  predates the import. */
  previous: { status: ReadStatus; rating: number | null; owning_status: OwningStatus } | null;
  /** True when this row had no usable ISBN and was matched to its (preexisting) library entry
   *  by title/author instead — shown as "matched by title" rather than "already in your
   *  library" so the user knows this one was a fuzzy match, not an ISBN-confirmed duplicate. */
  matchedByTitle: boolean;
  /** The title-match confidence (0-1) — only set when matchedByTitle. */
  matchConfidence: number | null;
  editingEdition: boolean;
  candidates: EditionCandidate[];
  candidatesLoaded: boolean;
  loadingCandidates: boolean;
  /** The last search failed upstream (503) — distinct from "ran, found nothing". */
  searchUnavailable: boolean;
  /** True when `candidates` came from already-stored work editions rather than a live search
   *  (set alongside `searchUnavailable` when that fallback found something to show). */
  candidatesFromStorage: boolean;
  busy: boolean;
  error: "" | "duplicate" | "failed" | "remove_failed" | "orphaned_duplicate";
  searchTitle: string;
  searchAuthor: string;
}

// A row that couldn't be imported automatically. Resolved rows leave the queue (they become
// ImportedItems); skipped ones stay so the skip can be undone before the import is finalized.
// `id` is a stable v-for key, since rows are spliced out of the middle of the queue.
export interface ReviewItem {
  id: number;
  row: ParsedGoodreadsRow;
  reason: "no_isbn" | "invalid_isbn" | "cancelled";
  status: "pending" | "skipped";
  candidates: EditionCandidate[];
  candidatesLoaded: boolean;
  loadingCandidates: boolean;
  /** The last search failed upstream (503) — distinct from "ran, found nothing". */
  searchUnavailable: boolean;
  searchQuery: string;
  searching: boolean;
}

export type ImportLogReason =
  | "direct"
  | "review_match"
  | "in_file"
  | "in_library"
  | "request_failed"
  | "invalid_isbn"
  | "no_isbn"
  | "unreadable_row"
  | "cancelled";

export interface ImportLogEntry {
  title: string;
  author: string;
  isbn: string | null;
  outcome: "imported" | "duplicate" | "failed" | "skipped";
  reason: ImportLogReason;
}

// Client-side ISBN shape check only (no checksum) — just enough to decide whether a row is
// worth sending to the server at all. The server does the authoritative checksum validation
// (worker/src/import-validation.ts) and routes checksum failures back as invalid_isbn.
function isIsbnShaped(raw: string): boolean {
  return /^(?:\d{9}[\dX]|\d{13})$/.test(raw.replace(/[-\s]/g, "").toUpperCase());
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Matches MAX_BATCH_SIZE in worker/src/routes/import.ts. Batches are sent sequentially, so this
// mostly amortizes per-request overhead: 10 halves the request count of a large import, keeping it
// clear of the 30/min import rate limit. The worker resolves the rows within a batch concurrently.
const BATCH_SIZE = 10;
// Matches MAX_MATCH_BATCH_SIZE in worker/src/routes/import.ts. Larger than BATCH_SIZE because
// title matching costs no external fetches — it's pure in-memory scoring against the user's own
// library, so a batch is cheap regardless of size.
const MATCH_BATCH_SIZE = 50;

export function useGoodreadsImport() {
  const { apiFetch } = useApi();
  const fieldDefsStore = useFieldDefsStore();

  const step = ref<ImportStep>("upload");
  const error = ref("");
  const fileName = ref("");

  const rows = ref<ParsedGoodreadsRow[]>([]);
  const shelfCounts = ref<Map<string, number>>(new Map());
  const mapping = reactive<Record<string, ShelfMapping>>({});

  const reviewQueue = ref<ReviewItem[]>([]);
  let nextReviewId = 0;
  const log = ref<ImportLogEntry[]>([]);
  // Imported rows get editable summary cards (see ImportedItem); the compact `log` holds only the
  // non-imported outcomes (in-file/library duplicates, failures, skips).
  const importedItems = ref<ImportedItem[]>([]);
  // Whether a row matching a book already in the library applies its status/rating to the
  // existing scan, rather than being logged as a no-op duplicate. Defaults on.
  const updateExisting = ref(true);
  // Whether to write Goodreads' "Bookshelves" column into a "Shelves" tag field on each newly
  // imported book. Off by default — creating schema on the user's behalf shouldn't be silent.
  const importShelvesAsTags = ref(false);
  // Checked between batches in startImport — lets the user back out of a long-running import
  // without losing what already completed.
  const cancelRequested = ref(false);

  function cancelImporting(): void {
    cancelRequested.value = true;
  }

  // Finds (or creates) the "Shelves" tag field, called once per import session rather than per
  // row. Returns null on failure — callers treat that as "don't write shelf tags this session"
  // rather than failing the whole import over it.
  async function ensureShelvesFieldDef(): Promise<number | null> {
    await fieldDefsStore.load();
    const existing = fieldDefsStore.defs.find(
      (d) => d.name === SHELVES_FIELD_NAME && d.type === "tag",
    );
    if (existing) return existing.id;

    const res = await apiFetch("/api/field-definitions", {
      method: "POST",
      body: JSON.stringify({ name: SHELVES_FIELD_NAME, type: "tag" }),
    });
    if (!res.ok) return null;
    const created = (await res.json()) as { id: number; name: string; type: string };
    fieldDefsStore.add(created);
    return created.id;
  }

  function buildImportedItem(
    row: ParsedGoodreadsRow,
    result: ImportRowResult,
    matchConfidence: number | null = null,
  ): ImportedItem {
    const { status, owning_status } = shelfMappingFor(row.shelf, mapping);
    const book = result.book;
    const preexisting = result.outcome === "updated";
    const previous = preexisting ? (result.previous ?? null) : null;
    // An update only overwrites rating when Goodreads actually has one (row.rating is already
    // null when the CSV had none) — otherwise the scan's existing rating carries over, unless
    // status is moving off "read", which clears it. Mirrors resolveRatingForUpdate server-side.
    const rating =
      preexisting && row.rating == null
        ? status === "read"
          ? (previous?.rating ?? null)
          : null
        : status === "read"
          ? row.rating
          : null;
    return {
      scanId: result.scan_id!,
      isbn: result.isbn,
      title: book?.title ?? row.title,
      author: book?.author ?? row.author,
      coverUrl: book?.cover_url ?? null,
      publisher: book?.publisher ?? null,
      language: book?.language ?? null,
      status,
      // An update never touches owning_status server-side — show the scan's real (untouched)
      // value rather than the shelf-mapping guess, which would otherwise misrepresent state the
      // import didn't actually change.
      owningStatus: previous?.owning_status ?? owning_status,
      rating,
      createdAt: row.createdAt,
      workId: book?.work_id ?? null,
      preexisting,
      previous,
      matchedByTitle: matchConfidence != null,
      matchConfidence,
      editingEdition: false,
      candidates: [],
      candidatesLoaded: false,
      loadingCandidates: false,
      searchUnavailable: false,
      candidatesFromStorage: false,
      busy: false,
      error: "",
      searchTitle: row.title,
      searchAuthor: row.author,
    };
  }

  function pushLog(
    row: Pick<ParsedGoodreadsRow, "title" | "author">,
    isbn: string | null,
    outcome: ImportLogEntry["outcome"],
    reason: ImportLogReason,
  ) {
    log.value.push({ title: row.title, author: row.author, isbn, outcome, reason });
  }

  // Derived from the arrays that already carry this information, rather than tracked by hand —
  // every outcome that would justify a manual increment already lands in one of these arrays
  // (importedItems, log, reviewQueue), so a computed can't drift from the data it summarizes.
  const counts = computed(() => ({
    imported: importedItems.value.filter((i) => !i.preexisting).length,
    updated: importedItems.value.filter((i) => i.preexisting).length,
    duplicate: log.value.filter((e) => e.outcome === "duplicate").length,
    failed: log.value.filter((e) => e.outcome === "failed").length,
    skipped: reviewQueue.value.filter((item) => item.status === "skipped")
      .length,
    total: rows.value.length,
  }));

  const isInProgress = computed(
    () => step.value === "importing" || step.value === "review",
  );

  // The import can only be finalized once every review row is resolved (leaves the queue) or
  // skipped — this is the gate on the "Finalize import" button.
  const reviewRemaining = computed(
    () => reviewQueue.value.filter((item) => item.status === "pending").length,
  );

  // Everything that won't end up in the library: the recorded outcomes plus the still-undoable
  // skips. Derived rather than pushed into `log` on skip, so undo needs no bookkeeping.
  const notImported = computed<ImportLogEntry[]>(() => [
    ...log.value,
    ...reviewQueue.value
      .filter((item) => item.status === "skipped")
      .map((item) => ({
        title: item.row.title,
        author: item.row.author,
        isbn: item.row.isbn,
        outcome: "skipped" as const,
        reason: item.reason,
      })),
  ]);

  async function loadFile(file: File): Promise<void> {
    error.value = "";
    log.value = [];
    fileName.value = file.name;

    let parsed: Papa.ParseResult<Record<string, string>>;
    try {
      parsed = await new Promise<Papa.ParseResult<Record<string, string>>>(
        (resolve, reject) => {
          Papa.parse<Record<string, string>>(file, {
            header: true,
            skipEmptyLines: true,
            complete: resolve,
            error: reject,
          });
        },
      );
    } catch {
      // A fatal read/parse failure (Papa's error callback) — e.g. an unreadable file. Previously
      // this rejected into an uncaught promise: the spinner just stopped with nothing shown.
      error.value = "parse_failed";
      fileName.value = "";
      return;
    }

    const headers = parsed.meta.fields ?? [];
    if (!isGoodreadsExport(headers)) {
      error.value = "not_goodreads_export";
      return;
    }
    if (parsed.data.length === 0) {
      error.value = "empty_file";
      return;
    }

    // Row-level parse errors (mismatched quotes, wrong field count, etc.) — Papa still returns a
    // best-effort `data` entry for these, but its shape is unreliable, so the row is logged and
    // excluded rather than silently imported with possibly-shifted fields.
    const badRowIndices = new Set(
      parsed.errors.map((e) => e.row).filter((r): r is number => r != null),
    );

    const parsedRows: ParsedGoodreadsRow[] = [];
    parsed.data.forEach((raw, i) => {
      const row = parseGoodreadsRow(raw);
      if (badRowIndices.has(i)) {
        pushLog(row, row.isbn, "failed", "unreadable_row");
      } else {
        parsedRows.push(row);
      }
    });

    // Client pre-dedupe: same ISBN appearing twice in the file counts as a duplicate with no
    // request sent — the server only ever sees one row per distinct ISBN in this file.
    const seen = new Set<string>();
    const deduped: ParsedGoodreadsRow[] = [];
    for (const row of parsedRows) {
      const key = row.isbn?.replace(/[-\s]/g, "").toUpperCase();
      if (key) {
        if (seen.has(key)) {
          pushLog(row, row.isbn, "duplicate", "in_file");
          continue;
        }
        seen.add(key);
      }
      deduped.push(row);
    }

    rows.value = deduped;

    const shelfTally = new Map<string, number>();
    for (const row of deduped) {
      shelfTally.set(row.shelf, (shelfTally.get(row.shelf) ?? 0) + 1);
    }
    shelfCounts.value = shelfTally;

    for (const key of Object.keys(mapping)) delete mapping[key];
    for (const shelf of shelfTally.keys()) {
      mapping[shelf] = DEFAULT_SHELF_MAPPING[shelf] ?? {
        status: "unread",
        owning_status: "owned",
      };
    }

    step.value = "confirm";
  }

  function setMapping(shelf: string, next: ShelfMapping) {
    mapping[shelf] = next;
  }

  // 429s wait for Retry-After and retry the same batch (bounded — a 30/min budget against
  // 10-row batches should never realistically exhaust this). A network error gets exactly one
  // retry before the whole batch is marked failed, per plan.
  async function postBatchWithRetry(
    payloads: ReturnType<typeof buildImportPayload>[],
    update: boolean,
    shelvesFieldDefId: number | null = null,
  ): Promise<ImportRowResult[]> {
    const asFailed = () =>
      payloads.map((p) => ({ isbn: p.isbn, outcome: "failed" as const }));

    let networkRetried = false;
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        const res = await apiFetch("/api/import/goodreads", {
          method: "POST",
          body: JSON.stringify({
            rows: payloads,
            update,
            ...(shelvesFieldDefId != null
              ? { shelves_field_def_id: shelvesFieldDefId }
              : {}),
          }),
        });
        if (res.status === 429) {
          const retryAfter = Number(res.headers.get("Retry-After") ?? "5");
          await sleep(retryAfter * 1000);
          continue;
        }
        if (!res.ok) return asFailed();
        const data = (await res.json()) as { results: ImportRowResult[] };
        return data.results;
      } catch {
        if (!networkRetried) {
          networkRetried = true;
          continue;
        }
        return asFailed();
      }
    }
    return asFailed();
  }

  interface MatchPayloadRow {
    title: string;
    author: string;
    status: ReadStatus;
    rating: number | null;
  }

  function buildMatchPayload(row: ParsedGoodreadsRow): MatchPayloadRow {
    const { status } = shelfMappingFor(row.shelf, mapping);
    return {
      title: stripTitleAnnotations(row.title).trim(),
      author: row.author.trim(),
      status,
      rating: row.rating,
    };
  }

  // Same retry policy as postBatchWithRetry, against /api/import/match. A request-level failure
  // degrades every row in the batch to "no_match" (not a "failed" outcome — see MatchRowResult)
  // so it falls to manual review rather than silently guessing.
  async function postMatchBatchWithRetry(
    payloads: MatchPayloadRow[],
    update: boolean,
  ): Promise<MatchRowResult[]> {
    const asNoMatch = (): MatchRowResult[] =>
      payloads.map(() => ({ outcome: "no_match" as const }));

    let networkRetried = false;
    for (let attempt = 0; attempt < 10; attempt++) {
      try {
        const res = await apiFetch("/api/import/match", {
          method: "POST",
          body: JSON.stringify({ rows: payloads, update }),
        });
        if (res.status === 429) {
          const retryAfter = Number(res.headers.get("Retry-After") ?? "5");
          await sleep(retryAfter * 1000);
          continue;
        }
        if (!res.ok) return asNoMatch();
        const data = (await res.json()) as { results: MatchRowResult[] };
        return data.results;
      } catch {
        if (!networkRetried) {
          networkRetried = true;
          continue;
        }
        return asNoMatch();
      }
    }
    return asNoMatch();
  }

  // Adapts a "updated" MatchRowResult into the shape buildImportedItem expects, so both the
  // ISBN-driven and title-matched paths build their cards through the same function. isbn comes
  // from the matched book's own record — the row itself never had one.
  function matchResultToImportRowResult(result: MatchRowResult): ImportRowResult {
    return {
      isbn: result.book?.isbn ?? "",
      outcome: "updated",
      scan_id: result.scan_id,
      book: result.book,
      previous: result.previous,
    };
  }

  function queueForReview(
    row: ParsedGoodreadsRow,
    reason: ReviewItem["reason"],
  ): void {
    reviewQueue.value.push({
      id: nextReviewId++,
      row,
      reason,
      status: "pending",
      candidates: [],
      candidatesLoaded: false,
      loadingCandidates: false,
      searchUnavailable: false,
      searchQuery: "",
      searching: false,
    });
  }

  // Rows left in a stage that's been abandoned (cancel, or everything after it) go to the
  // review queue rather than vanishing — startImport is done deciding their fate for this run
  // just like a genuine no-match, and the progress accounting (Phase 7) depends on every row
  // ending up either resolved or queued.
  function queueRemainderAsCancelled(remaining: ParsedGoodreadsRow[]): void {
    for (const row of remaining) queueForReview(row, "cancelled");
  }

  async function startImport(): Promise<void> {
    step.value = "importing";
    cancelRequested.value = false;

    // Resolved once per session, not per row/batch — see ensureShelvesFieldDef.
    const shelvesFieldDefId = importShelvesAsTags.value
      ? await ensureShelvesFieldDef()
      : null;

    const sendable = rows.value.filter((r) => r.isbn && isIsbnShaped(r.isbn));
    // Distinguish "nothing in the export" from "something was there but doesn't look like an
    // ISBN" — used as the review reason (reason_no_isbn vs reason_invalid_isbn) if title/author
    // matching below also comes up empty.
    const noIsbnRows = rows.value.filter((r) => !r.isbn);
    const malformedIsbnRows = rows.value.filter(
      (r) => r.isbn && !isIsbnShaped(r.isbn),
    );
    const unmatched = [...noIsbnRows, ...malformedIsbnRows];

    const sendableBatches = chunk(sendable, BATCH_SIZE);
    for (let b = 0; b < sendableBatches.length; b++) {
      if (cancelRequested.value) {
        for (const rest of sendableBatches.slice(b)) queueRemainderAsCancelled(rest);
        queueRemainderAsCancelled(unmatched);
        step.value = "review";
        return;
      }
      const batch = sendableBatches[b];
      const payloads = batch.map((row) =>
        buildImportPayload(row as ParsedGoodreadsRow & { isbn: string }, mapping),
      );
      const results = await postBatchWithRetry(
        payloads,
        updateExisting.value,
        shelvesFieldDefId,
      );
      results.forEach((result, i) => {
        const row = batch[i];
        if (result.outcome === "invalid_isbn") {
          queueForReview(row, "invalid_isbn");
        } else {
          if (result.outcome === "imported" || result.outcome === "updated") {
            importedItems.value.push(buildImportedItem(row, result));
          } else {
            pushLog(
              row,
              row.isbn,
              result.outcome,
              result.outcome === "duplicate" ? "in_library" : "request_failed",
            );
          }
        }
      });
    }

    // Rows with no usable ISBN aren't given up on outright — try matching them against the
    // existing library by title/author first (see worker/src/title-match.ts). A Goodreads
    // export commonly has these for books added by hand, and many turn out to already be here.
    const unmatchedBatches = chunk(unmatched, MATCH_BATCH_SIZE);
    for (let b = 0; b < unmatchedBatches.length; b++) {
      if (cancelRequested.value) {
        for (const rest of unmatchedBatches.slice(b)) queueRemainderAsCancelled(rest);
        step.value = "review";
        return;
      }
      const batch = unmatchedBatches[b];
      const payloads = batch.map((row) => buildMatchPayload(row));
      const results = await postMatchBatchWithRetry(payloads, updateExisting.value);
      results.forEach((result, i) => {
        const row = batch[i];
        if (result.outcome === "updated") {
          importedItems.value.push(
            buildImportedItem(
              row,
              matchResultToImportRowResult(result),
              result.confidence ?? null,
            ),
          );
        } else if (result.outcome === "duplicate") {
          // A confident match was found but updateExisting is off — nothing was written, and
          // unlike "no_match" there's nothing for the user to resolve, so this isn't a review
          // row: it's resolved, just declined.
          pushLog(row, row.isbn, "duplicate", "in_library");
        } else {
          queueForReview(row, row.isbn ? "invalid_isbn" : "no_isbn");
        }
      });
    }

    step.value = "review";
  }

  // A whole import re-searches the same title/author repeatedly (open the edition dropdown,
  // close it, open it again; resolve a row, change its edition). Memoize per session so those
  // repeats don't spend Google Books quota. `force` re-fetches and refreshes the entry — that's
  // what the retry buttons want.
  //
  // Only non-empty results are cached. An empty result is usually a transient upstream failure
  // (a Google Books 429/503 returns no `items` and surfaces as []), not an established fact about
  // the title — caching it would make one blip stick for the rest of the session and leak onto
  // every other row that searches the same title.
  const candidateCache = new Map<string, EditionCandidate[]>();

  // `unavailable` = the search itself failed (the worker returns 503 when Google Books rejects it,
  // e.g. daily quota exhausted). Kept distinct from empty `candidates`, which means the search ran
  // and this title genuinely has no matches — the two need different UI.
  interface CandidateResult {
    candidates: EditionCandidate[];
    unavailable: boolean;
  }

  async function loadCandidates(
    title: string,
    author: string,
    force = false,
  ): Promise<CandidateResult> {
    const searchTitle = stripTitleAnnotations(title);
    // A title that's blank, or entirely parenthetical annotations stripped away, has nothing to
    // search — skip the request rather than hitting the server's 400 "Title required" guard.
    if (!searchTitle) return { candidates: [], unavailable: false };

    // JSON-encoded (not plain concatenation) so distinct (title, author) pairs can't collide
    // onto the same key — e.g. title="Foo", author="Bar Baz" vs title="Foo Bar", author="Baz".
    const cacheKey = JSON.stringify([searchTitle, author]);
    if (!force) {
      const cached = candidateCache.get(cacheKey);
      if (cached) return { candidates: cached, unavailable: false };
    }

    const params = new URLSearchParams({ title: searchTitle });
    if (author) params.set("author", author);
    const res = await apiFetch(`/api/books/search?${params.toString()}`);
    // Only a 503 means "the search itself failed, try again" — any other non-ok (e.g. a 400 from
    // a malformed query) isn't a transient condition retrying would fix, so it's surfaced as a
    // plain no-match instead of the misleading "temporarily unavailable" message.
    if (res.status === 503) return { candidates: [], unavailable: true };
    if (!res.ok) return { candidates: [], unavailable: false };

    const candidates = (await res.json()) as EditionCandidate[];
    if (candidates.length > 0) candidateCache.set(cacheKey, candidates);
    return { candidates, unavailable: false };
  }

  // Fallback for an ImportedItem's "change edition" list when the live title search is
  // unavailable (e.g. Google Books quota exhausted) — pulls editions already known for the
  // linked work straight from the DB, so an upstream outage doesn't leave the dropdown empty
  // for a book we already have data on. `fallbackAuthor` covers `work_edition_isbns` candidate
  // rows, which have no author column of their own (see worker/src/routes/catalog.ts).
  async function loadStoredEditions(
    workId: number,
    fallbackAuthor: string,
  ): Promise<EditionCandidate[]> {
    const res = await apiFetch(`/api/works/${workId}/editions`);
    if (!res.ok) return [];
    const data = (await res.json()) as {
      editions: Array<{
        isbn: string;
        title: string | null;
        author: string | null;
        cover_url: string | null;
        publisher: string | null;
      }>;
    };
    return data.editions.map((ed) => ({
      isbn: ed.isbn,
      title: ed.title ?? ed.isbn,
      author: ed.author ?? fallbackAuthor,
      cover_url: ed.cover_url,
      publisher: ed.publisher,
    }));
  }

  // Lazy — only fetched once the resolve drawer actually opens on this item.
  async function ensureCandidatesLoaded(item: ReviewItem): Promise<void> {
    if (item.candidatesLoaded || item.loadingCandidates) return;
    item.loadingCandidates = true;
    try {
      const result = await loadCandidates(item.row.title, item.row.author);
      item.candidates = result.candidates;
      item.searchUnavailable = result.unavailable;
    } finally {
      item.candidatesLoaded = true;
      item.loadingCandidates = false;
    }
  }

  // Re-runs the title search for a review item that came back with no candidates (either a
  // genuine miss, or an upstream failure the server-side retries didn't absorb).
  async function retryCandidates(item: ReviewItem): Promise<void> {
    if (item.loadingCandidates) return;
    item.loadingCandidates = true;
    try {
      const result = await loadCandidates(
        item.row.title,
        item.row.author,
        true,
      );
      item.candidates = result.candidates;
      item.searchUnavailable = result.unavailable;
    } finally {
      item.candidatesLoaded = true;
      item.loadingCandidates = false;
    }
  }

  // Free-text search from the resolve drawer, for when the Goodreads title/author found nothing.
  async function searchReviewCandidates(item: ReviewItem): Promise<void> {
    const query = item.searchQuery.trim();
    if (!query || item.searching) return;
    item.searching = true;
    try {
      const result = await loadCandidates(query, "");
      item.candidates = result.candidates;
      item.searchUnavailable = result.unavailable;
    } finally {
      item.candidatesLoaded = true;
      item.searching = false;
    }
  }

  function dropFromQueue(item: ReviewItem): void {
    const idx = reviewQueue.value.indexOf(item);
    if (idx !== -1) reviewQueue.value.splice(idx, 1);
  }

  // Resolving imports the chosen edition immediately: on success the row leaves the queue and
  // reappears in the matched list (where its edition can still be changed); anything else is a
  // dead end and drops into the not-imported log.
  async function confirmReviewItem(item: ReviewItem, isbn: string): Promise<void> {
    const payload = buildImportPayload({ ...item.row, isbn }, mapping);
    const shelvesFieldDefId = importShelvesAsTags.value
      ? await ensureShelvesFieldDef()
      : null;
    const [result] = await postBatchWithRetry(
      [payload],
      updateExisting.value,
      shelvesFieldDefId,
    );
    const outcome = result.outcome === "invalid_isbn" ? "failed" : result.outcome;
    if (outcome === "imported" || outcome === "updated") {
      importedItems.value.push(buildImportedItem(item.row, result));
    } else {
      pushLog(
        item.row,
        isbn,
        outcome,
        outcome === "duplicate" ? "in_library" : "request_failed",
      );
    }
    dropFromQueue(item);
  }

  // Skips stay in the queue so they can be undone until the import is finalized — `notImported`
  // surfaces them without touching `log`.
  function skipReviewItem(item: ReviewItem): void {
    if (item.status === "skipped") return;
    item.status = "skipped";
  }

  function undoSkipReviewItem(item: ReviewItem): void {
    if (item.status !== "skipped") return;
    item.status = "pending";
  }

  // ── Post-import editing (summary step) ────────────────────────────────────────

  // Opens/closes the change-edition candidate list. Loads from already-stored work editions on
  // first open — a plain DB read, not a Google Books call — since every ImportedItem already has
  // a linked work. Live search is a separate, explicit action (see searchOnlineForImportedEdition)
  // rather than something every dropdown open pays for.
  async function toggleImportedEdition(item: ImportedItem): Promise<void> {
    item.editingEdition = !item.editingEdition;
    item.error = "";
    if (
      item.editingEdition &&
      !item.candidatesLoaded &&
      !item.loadingCandidates
    ) {
      item.loadingCandidates = true;
      try {
        if (item.workId != null) {
          item.candidates = await loadStoredEditions(
            item.workId,
            item.searchAuthor,
          );
          item.candidatesFromStorage = true;
        } else {
          // No linked work yet (shouldn't normally happen for an imported item) — only option
          // left is a live search.
          const result = await loadCandidates(item.searchTitle, item.searchAuthor);
          item.candidates = result.candidates;
          item.searchUnavailable = result.unavailable;
          item.candidatesFromStorage = false;
        }
      } finally {
        item.candidatesLoaded = true;
        item.loadingCandidates = false;
      }
    }
  }

  function closeImportedEdition(item: ImportedItem): void {
    item.editingEdition = false;
  }

  // User-triggered live search, merged into whatever's already showing (stored editions, or a
  // previous search) rather than replacing it — so a search that comes back unavailable doesn't
  // blank out editions we already know about.
  async function retryImportedCandidates(item: ImportedItem): Promise<void> {
    if (item.loadingCandidates) return;
    item.loadingCandidates = true;
    try {
      const result = await loadCandidates(
        item.searchTitle,
        item.searchAuthor,
        true,
      );
      if (result.unavailable) {
        item.searchUnavailable = true;
      } else {
        const known = new Set(item.candidates.map((c) => c.isbn));
        item.candidates = [
          ...item.candidates,
          ...result.candidates.filter((c) => !known.has(c.isbn)),
        ];
        item.candidatesFromStorage = false;
        item.searchUnavailable = false;
      }
    } finally {
      item.loadingCandidates = false;
    }
  }

  // Swaps the scan to a different edition: create the new scan first, then delete the old one
  // (POST-then-DELETE ordering means a failed swap leaves the original scan untouched). Counts
  // are unchanged — one imported row replaces another.
  //
  // This goes through the import endpoint rather than the dedicated PATCH /api/scans/:id/edition
  // (used by EditionsDialog elsewhere) because that route only accepts ISBNs already known to be
  // an edition of the current work; candidates here come from a free Google Books title search
  // and are frequently not yet linked to the work at all.
  async function changeImportedEdition(
    item: ImportedItem,
    isbn: string,
  ): Promise<void> {
    if (item.busy) return;
    item.busy = true;
    item.error = "";
    try {
      // No title/author/publisher fallback here — the candidate ISBN comes from a resolved
      // search/library result, not a bare CSV row, so a metadata-lookup miss is unexpected and
      // there's nothing better than null to fall back to.
      const payload: ImportPayloadRow = {
        isbn,
        status: item.status,
        owning_status: item.owningStatus,
        rating: item.rating,
        created_at: item.createdAt,
        title: null,
        author: null,
        publisher: null,
        publish_date: null,
        number_of_pages: null,
        owned_copies: 0,
        shelves: [],
      };
      // update: false — this is an edition swap on the item's own scan, not an import row; the
      // candidate ISBN could coincidentally match a *different* scan already in the library, and
      // that scan must not be silently overwritten as a side effect of this swap.
      const [result] = await postBatchWithRetry([payload], false);
      if (result.outcome === "imported" && result.scan_id != null) {
        const oldScanId = item.scanId;
        item.scanId = result.scan_id;
        item.isbn = result.isbn;
        item.title = result.book?.title ?? item.title;
        item.author = result.book?.author ?? item.author;
        item.coverUrl = result.book?.cover_url ?? null;
        item.publisher = result.book?.publisher ?? null;
        item.language = result.book?.language ?? null;
        item.workId = result.book?.work_id ?? item.workId;
        item.editingEdition = false;
        const deleteRes = await apiFetch(`/api/scans/${oldScanId}`, {
          method: "DELETE",
        });
        // The new scan is already saved and reflected above regardless — but if the old one
        // couldn't be removed, it's now an orphaned duplicate the user can't see from this card.
        // Surface that rather than silently leaving it behind.
        if (!deleteRes.ok && deleteRes.status !== 404) {
          item.error = "orphaned_duplicate";
        }
      } else if (result.outcome === "duplicate") {
        item.error = "duplicate";
      } else {
        item.error = "failed";
      }
    } finally {
      item.busy = false;
    }
  }

  async function patchImported(
    item: ImportedItem,
    body: Record<string, unknown>,
  ): Promise<boolean> {
    const res = await apiFetch(`/api/scans/${item.scanId}`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    return res.ok;
  }

  async function setImportedStatus(
    item: ImportedItem,
    status: ReadStatus,
  ): Promise<void> {
    if (await patchImported(item, { status })) {
      item.status = status;
      // Mirror the server: moving off "read" clears any rating.
      if (status !== "read") item.rating = null;
    }
  }

  async function setImportedOwning(
    item: ImportedItem,
    owning: OwningStatus,
  ): Promise<void> {
    if (await patchImported(item, { owning_status: owning })) {
      item.owningStatus = owning;
    }
  }

  async function setImportedRating(
    item: ImportedItem,
    rating: number | null,
  ): Promise<void> {
    if (await patchImported(item, { rating })) item.rating = rating;
  }

  // Removes a single imported book (deletes its scan). A 404 is treated as success — the row is
  // already gone server-side, so drop the card either way. Only for rows this import created —
  // preexisting rows go through undoImportedUpdate instead, which never deletes.
  async function removeImportedItem(item: ImportedItem): Promise<void> {
    if (item.busy || item.preexisting) return;
    item.busy = true;
    item.error = "";
    try {
      const res = await apiFetch(`/api/scans/${item.scanId}`, {
        method: "DELETE",
      });
      if (res.ok || res.status === 404) {
        const idx = importedItems.value.indexOf(item);
        if (idx !== -1) importedItems.value.splice(idx, 1);
      } else {
        item.error = "remove_failed";
      }
    } finally {
      item.busy = false;
    }
  }

  // The "remove" action for a preexisting (updated-in-place) row: restores its pre-import
  // status/rating via PATCH rather than deleting a scan the import didn't create.
  async function undoImportedUpdate(item: ImportedItem): Promise<void> {
    if (item.busy || !item.preexisting || !item.previous) return;
    item.busy = true;
    item.error = "";
    try {
      const ok = await patchImported(item, {
        status: item.previous.status,
        rating: item.previous.rating,
      });
      if (ok) {
        const idx = importedItems.value.indexOf(item);
        if (idx !== -1) importedItems.value.splice(idx, 1);
      } else {
        item.error = "remove_failed";
      }
    } finally {
      item.busy = false;
    }
  }

  // Cancels the whole import: deletes every scan this session created, and reverts every scan
  // it updated back to its pre-import status/rating instead (those scans predate the import and
  // must survive a cancel). Best-effort — a failed request still drops the item from the local
  // list so the user isn't stuck.
  async function cancelImport(): Promise<void> {
    await Promise.allSettled(
      importedItems.value.map((item) =>
        item.preexisting && item.previous
          ? apiFetch(`/api/scans/${item.scanId}`, {
              method: "PATCH",
              body: JSON.stringify({
                status: item.previous.status,
                rating: item.previous.rating,
              }),
            })
          : apiFetch(`/api/scans/${item.scanId}`, { method: "DELETE" }),
      ),
    );
    importedItems.value = [];
  }

  function reset(): void {
    step.value = "upload";
    error.value = "";
    fileName.value = "";
    rows.value = [];
    shelfCounts.value = new Map();
    for (const key of Object.keys(mapping)) delete mapping[key];
    reviewQueue.value = [];
    candidateCache.clear();
    log.value = [];
    importedItems.value = [];
    updateExisting.value = true;
    importShelvesAsTags.value = false;
    cancelRequested.value = false;
  }

  return {
    step,
    error,
    fileName,
    rows,
    shelfCounts,
    importShelvesAsTags,
    mapping,
    updateExisting,
    counts,
    reviewQueue,
    log,
    notImported,
    importedItems,
    reviewRemaining,
    isInProgress,
    loadFile,
    setMapping,
    startImport,
    cancelRequested,
    cancelImporting,
    ensureCandidatesLoaded,
    retryCandidates,
    searchReviewCandidates,
    confirmReviewItem,
    skipReviewItem,
    undoSkipReviewItem,
    toggleImportedEdition,
    closeImportedEdition,
    retryImportedCandidates,
    changeImportedEdition,
    setImportedStatus,
    setImportedOwning,
    setImportedRating,
    removeImportedItem,
    undoImportedUpdate,
    cancelImport,
    reset,
  };
}
