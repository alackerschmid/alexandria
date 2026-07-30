import { ref, reactive, computed } from "vue";
import { defineStore } from "pinia";
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
import {
  findAbsorbTarget,
  writesToAdopt,
  type ScanWrite,
} from "@/utils/import-cards";
import { importSortRank } from "@/utils/import-sort";
import type { ReadStatus, OwningStatus } from "@/types/book";

// The custom tag field Goodreads' "Bookshelves" column imports into, when the user opts in.
// Reused across imports (by exact name+type match) rather than minting a new field each time.
const SHELVES_FIELD_NAME = "Shelves";

// A single resumable session at a time — the import runs for the lifetime of the tab, so there's
// never a second one competing for this key.
const STORAGE_KEY = "bookscan_import_session";

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

interface ScanStateSummary {
  status: ReadStatus;
  rating: number | null;
  owning_status: OwningStatus;
}

// An edition of the same work already in the library, reported alongside a newly created scan — so
// only when `update` is off, since otherwise that copy is updated instead of a second scan being
// added. The import dedupes per ISBN, so a row carrying a different edition's ISBN is not a
// duplicate; with updates declined it lands at owning_status "unknown" next to a book the user may
// well have marked owned, which is worth saying out loud on the card.
export interface OtherEdition {
  isbn: string;
  publisher: string | null;
  publish_date: string | null;
  owning_status: OwningStatus;
}

interface ImportRowResult {
  isbn: string;
  outcome: "imported" | "updated" | "duplicate" | "invalid_isbn" | "failed";
  scan_id?: number;
  book?: ImportedBook;
  // Present only for "imported"/"updated" rows — the scan's status/rating/owning_status as
  // actually written server-side (Goodreads import never sets owning_status from the CSV — a
  // create writes "unknown", i.e. no ownership claim). The summary card shows these verbatim.
  resolved?: ScanStateSummary;
  // Present only for "updated" rows — the scan's state before this update (drives Undo).
  previous?: ScanStateSummary;
  // Present only for "imported" rows that added a second edition of an already-owned work.
  other_edition?: OtherEdition | null;
  // Present only for "updated" rows the server matched by *work* rather than by ISBN — the CSV
  // named a different edition than the copy in the library, and the copy is what was updated.
  matched_via_work?: true;
  // The other copies of that work whose status was written too, with their pre-update value.
  sibling_updates?: { scan_id: number; previous_status: ReadStatus }[];
}

// Response shape of POST /api/import/match — the title/author matching pass for rows with no
// usable ISBN. No "failed"/"invalid_isbn" outcome: a row either matches (confidently, against
// the user's own library) or it doesn't, and a request-level failure degrades to "no_match"
// (see postMatchBatchWithRetry) so it falls to manual review rather than guessing.
interface MatchRowResult {
  outcome: "duplicate" | "updated" | "no_match";
  scan_id?: number;
  book?: ImportedBook;
  resolved?: ScanStateSummary;
  previous?: ScanStateSummary;
  // A title match resolves to a work as much as an ISBN one does, so it writes every copy too.
  sibling_updates?: { scan_id: number; previous_status: ReadStatus }[];
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
  /** The ParsedGoodreadsRow this came from — lets a resumed run recognize this row as already
   *  resolved (see resolvedRowIds) without re-deriving it from isbn, which a title-matched item
   *  doesn't share with its source row at all. */
  rowId: number;
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
  previous: ScanStateSummary | null;
  /** True when the CSV row's ISBN named a *different* edition than the copy in the library, and
   *  that copy was updated instead of a second scan being created. Worth saying on the card: the
   *  edition shown isn't the one the export listed. */
  matchedViaWork: boolean;
  /** The other copies of the same work whose status this row also wrote, with their pre-import
   *  value — Undo has to restore each of them, not just `scanId`. Non-empty whenever the work has
   *  more than one copy in the library, on every match kind (ISBN, work or title), and grows when
   *  `absorbIntoExistingCard` folds a later row's writes into this card. */
  siblingUpdates: ScanWrite[];
  /** Set when a title score — not an ISBN the export carried — decided which edition this card
   *  points at, with the score (0-1) behind it. `source` says what the title was scored against,
   *  which is the whole difference between the two title-driven passes and what the card's note
   *  and its warning colouring key on:
   *
   *  - `library` — matched against the user's own scans (`/match`), so the row is `preexisting`
   *    and the card says "matched by title" rather than the ISBN-confirmed "already in your
   *    library".
   *  - `catalog` — no usable ISBN in the export, so the auto-assign pass picked one from a title
   *    search (`/suggest-isbn`). The edition shown is the wizard's answer rather than anything the
   *    export named, which is why that one is worth a second look.
   *
   *  Null when the export's own ISBN identified the row. `changeImportedEdition` clears it: a
   *  hand-picked edition is the user's choice, not a match. */
  titleMatch: { confidence: number; source: "library" | "catalog" } | null;
  /** Where this card sits in the Matched list (`importSortRank` — owning, then reading status, then
   *  rating descending). Captured once, at creation, and not persisted: the cards are editable in
   *  place, and re-ranking on every edit would make a card jump out from under the click that changed
   *  it — but a reload has no click in flight, so rehydration re-derives it from current state. An
   *  edition swap keeps it too — same book, same place in the list. */
  sortRank: number;
  /** Set when this row created a *second* edition of a work already in the library — the copy
   *  that was already there. The new scan is real and wanted in the ISBN sense, but it carries no
   *  ownership claim, so the card names the edition it sits beside. */
  otherEdition: OtherEdition | null;
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
  | "in_file"
  | "in_library"
  | "request_failed"
  | "invalid_isbn"
  | "no_isbn"
  | "unreadable_row"
  | "cancelled";

export interface ImportLogEntry {
  /** The source row's id, when this entry came from one (absent for nothing today, but keeps
   *  the field non-optional simple — see resolvedRowIds). */
  rowId: number;
  title: string;
  author: string;
  isbn: string | null;
  outcome: "imported" | "duplicate" | "failed" | "skipped";
  reason: ImportLogReason;
}

// Strips hyphens/spaces and upper-cases, so `978-0-14…` and its bare form share one dedupe key
// (and one shape check). Mirrors the worker's normalizeIsbn (worker/src/isbn.ts), which can't be
// imported across the package boundary.
function normalizeIsbnKey(raw: string): string {
  return raw.replace(/[-\s]/g, "").toUpperCase();
}

// Client-side ISBN shape check only (no checksum) — just enough to decide whether a row is
// worth sending to the server at all. The server does the authoritative checksum validation
// (worker/src/import-validation.ts) and routes checksum failures back as invalid_isbn.
function isIsbnShaped(raw: string): boolean {
  return /^(?:\d{9}[\dX]|\d{13})$/.test(normalizeIsbnKey(raw));
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

// The fields stripped before persisting an ImportedItem/ReviewItem to localStorage — candidate
// lists are the bulk of the payload and cost nothing to re-fetch the next time their dropdown
// opens, and sortRank is a pure derivation re-computed on revive (see its field doc).
type PersistedImportedItem = Omit<
  ImportedItem,
  | "candidates"
  | "candidatesLoaded"
  | "loadingCandidates"
  | "searchUnavailable"
  | "candidatesFromStorage"
  | "busy"
  | "error"
  | "editingEdition"
  | "sortRank"
>;
type PersistedReviewItem = Omit<
  ReviewItem,
  "candidates" | "candidatesLoaded" | "loadingCandidates" | "searchUnavailable" | "searching"
>;

interface PersistedSession {
  sessionKey: string;
  step: ImportStep;
  fileName: string;
  fileSize: number;
  rows: ParsedGoodreadsRow[];
  shelfCounts: [string, number][];
  mapping: Record<string, ShelfMapping>;
  updateExisting: boolean;
  importShelvesAsTags: boolean;
  nextReviewId: number;
  reviewQueue: PersistedReviewItem[];
  log: ImportLogEntry[];
  importedItems: PersistedImportedItem[];
}

// A session in localStorage may have been written by an older build — loadPersistedSession is a bare
// `as` cast, so the fields listed here (all added since the persisted shape first shipped) aren't
// guaranteed to be present.
type NewerImportedItemFields =
  | "otherEdition"
  | "matchedViaWork"
  | "siblingUpdates"
  | "titleMatch";

type StoredImportedItem = Omit<PersistedImportedItem, NewerImportedItemFields> &
  Partial<Pick<PersistedImportedItem, NewerImportedItemFields>>;

// Defaulting those newer fields matters more than it looks: anything the review screen reads
// *through* while rendering (`item.x.y`) throws mid-render on an older session and paints an
// empty page rather than degrading.
function reviveImportedItem(p: StoredImportedItem): ImportedItem {
  return {
    ...p,
    otherEdition: p.otherEdition ?? null,
    matchedViaWork: p.matchedViaWork ?? false,
    siblingUpdates: p.siblingUpdates ?? [],
    // A session written before `titleMatch` replaced the two flag/confidence pairs revives without
    // a provenance note on its title-matched cards. Deliberately not migrated from the old fields:
    // the app is pre-release, and a card losing one caption is a better trade than carrying a
    // translation for a shape no live session has.
    titleMatch: p.titleMatch ?? null,
    // Not persisted, always re-derived: the freeze exists so a card doesn't jump out from under the
    // click that edited it, and a reload has no click in flight — re-ranking from current state is
    // the correct order for a fresh render (and what an edited card's rank *should* become).
    sortRank: importSortRank(p),
    candidates: [],
    candidatesLoaded: false,
    loadingCandidates: false,
    searchUnavailable: false,
    candidatesFromStorage: false,
    busy: false,
    error: "",
    editingEdition: false,
  };
}

function reviveReviewItem(p: PersistedReviewItem): ReviewItem {
  return {
    ...p,
    candidates: [],
    candidatesLoaded: false,
    loadingCandidates: false,
    searchUnavailable: false,
    searching: false,
  };
}

export const useImportStore = defineStore("import", () => {
  const { apiFetch } = useApi();
  const fieldDefsStore = useFieldDefsStore();

  const step = ref<ImportStep>("upload");
  const error = ref("");
  const fileName = ref("");
  const fileSize = ref(0);

  const rows = ref<ParsedGoodreadsRow[]>([]);
  const shelfCounts = ref<Map<string, number>>(new Map());
  const mapping = reactive<Record<string, ShelfMapping>>({});

  const reviewQueue = ref<ReviewItem[]>([]);
  const nextReviewId = ref(0);
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

  // True only while startImport's send loop is actually executing (guards against a duplicate
  // invocation, e.g. a stray double-click, and drives the beforeunload guard together with
  // batchInFlight below). False again as soon as it returns, whether by finishing, cancelling,
  // or hitting an unhandled error.
  const isRunning = ref(false);
  // Narrower than isRunning: true only while a batch request is actually awaiting a response —
  // the moment an interrupted page load could lose real work in flight. isRunning also covers the
  // synchronous gaps between batches, which reloading doesn't put at risk.
  //
  // A count rather than a flag, because autoAssignPass deliberately overlaps two requests: with a
  // boolean, whichever finished first would clear the beforeunload guard while the other was still
  // out — exactly the window the guard exists for.
  const inFlightBatches = ref(0);
  const batchInFlight = computed(() => inFlightBatches.value > 0);
  // Set when a persisted session from a previous tab/reload is rehydrated mid-run. Surfaced by
  // the confirm-adjacent "paused" panel and the global chip; never auto-cleared by resuming
  // silently — the user has to explicitly resume or discard.
  const sessionPaused = ref(false);
  // The completion chip stays visible until dismissed or the user visits /import — set back to
  // false whenever a new session starts.
  const chipDismissed = ref(false);

  // An import worth navigating back to: sending, paused mid-run, or waiting in the review screen
  // to be finalized. Deliberately not the upload/confirm steps — nothing is in flight there and
  // walking away costs the user nothing. Drives the header's Import nav entry; the chip needs to
  // tell those three apart (and honours its own dismissal), so it keeps its finer-grained state.
  const sessionActive = computed(
    () => isRunning.value || sessionPaused.value || step.value === "review",
  );

  function cancelImporting(): void {
    cancelRequested.value = true;
  }

  // ── Persistence ─────────────────────────────────────────────────────────────

  function stripImportedItem(item: ImportedItem): PersistedImportedItem {
    const {
      candidates: _candidates,
      candidatesLoaded: _candidatesLoaded,
      loadingCandidates: _loadingCandidates,
      searchUnavailable: _searchUnavailable,
      candidatesFromStorage: _candidatesFromStorage,
      busy: _busy,
      error: _error,
      editingEdition: _editingEdition,
      sortRank: _sortRank,
      ...rest
    } = item;
    return rest;
  }

  function stripReviewItem(item: ReviewItem): PersistedReviewItem {
    const {
      candidates: _candidates,
      candidatesLoaded: _candidatesLoaded,
      loadingCandidates: _loadingCandidates,
      searchUnavailable: _searchUnavailable,
      searching: _searching,
      ...rest
    } = item;
    return rest;
  }

  function clearPersistedSession(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Storage unavailable (private browsing, quota) — nothing to clean up either way.
    }
  }

  // Called after every batch and after any post-import edit that mutates reviewQueue/
  // importedItems/log, so a reload mid-run (or mid-review) resumes from a state that matches
  // what the server actually has, not a stale snapshot from the last batch boundary.
  function persistSession(): void {
    if (step.value === "upload") {
      clearPersistedSession();
      return;
    }
    const payload: PersistedSession = {
      sessionKey: `${fileName.value}:${fileSize.value}:${rows.value.length}`,
      step: step.value,
      fileName: fileName.value,
      fileSize: fileSize.value,
      rows: rows.value,
      shelfCounts: [...shelfCounts.value.entries()],
      mapping: { ...mapping },
      updateExisting: updateExisting.value,
      importShelvesAsTags: importShelvesAsTags.value,
      nextReviewId: nextReviewId.value,
      reviewQueue: reviewQueue.value.map((item) => stripReviewItem(item)),
      log: log.value,
      importedItems: importedItems.value.map((item) => stripImportedItem(item)),
    };
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Storage full or unavailable — resume just won't be offered next time; not worth failing
      // the import over.
    }
  }

  function loadPersistedSession(): PersistedSession | null {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? (JSON.parse(raw) as PersistedSession) : null;
    } catch {
      return null;
    }
  }

  function hydrate(persisted: PersistedSession): void {
    step.value = persisted.step;
    fileName.value = persisted.fileName;
    fileSize.value = persisted.fileSize;
    rows.value = persisted.rows;
    shelfCounts.value = new Map(persisted.shelfCounts);
    for (const key of Object.keys(mapping)) delete mapping[key];
    Object.assign(mapping, persisted.mapping);
    updateExisting.value = persisted.updateExisting;
    importShelvesAsTags.value = persisted.importShelvesAsTags;
    nextReviewId.value = persisted.nextReviewId;
    reviewQueue.value = persisted.reviewQueue.map((item) => reviveReviewItem(item));
    log.value = persisted.log;
    importedItems.value = persisted.importedItems.map((item) => reviveImportedItem(item));
  }

  // Runs once, when the store is first used (Pinia setup stores execute their body once, on
  // creation — this isn't re-run on navigation, only on a fresh tab/reload). Never auto-resumes
  // network writes: a run interrupted mid-batch surfaces as "paused" for the user to confirm.
  const persistedOnBoot = loadPersistedSession();
  if (persistedOnBoot) {
    hydrate(persistedOnBoot);
    if (persistedOnBoot.step === "importing") sessionPaused.value = true;
  }

  if (typeof window !== "undefined") {
    window.addEventListener("beforeunload", (e) => {
      if (batchInFlight.value) {
        e.preventDefault();
        e.returnValue = "";
      }
    });
  }

  // Every row an import run has already made a decision about, keyed by ParsedGoodreadsRow.id —
  // startImport filters these out so resuming (or a stray re-invocation) never re-sends or
  // double-counts a row. Rows loadFile excluded outright (in-file duplicates, unreadable rows)
  // never appear in `rows` in the first place, so they don't need to be considered here.
  function resolvedRowIds(): Set<number> {
    const ids = new Set<number>();
    for (const item of importedItems.value) ids.add(item.rowId);
    for (const entry of log.value) ids.add(entry.rowId);
    for (const item of reviewQueue.value) ids.add(item.row.id);
    return ids;
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

    // A thrown network failure here must degrade to "no shelves field" like a non-ok response
    // does, not propagate — this runs inline in startImport/confirmReviewItem, which have no
    // catch of their own, so an uncaught throw would abort the whole import.
    try {
      const res = await apiFetch("/api/field-definitions", {
        method: "POST",
        body: JSON.stringify({ name: SHELVES_FIELD_NAME, type: "tag" }),
      });
      if (!res.ok) return null;
      const created = (await res.json()) as { id: number; name: string; type: string };
      fieldDefsStore.add(created);
      return created.id;
    } catch {
      return null;
    }
  }

  function buildImportedItem(
    row: ParsedGoodreadsRow,
    result: ImportRowResult,
    // Null for a row the export's own ISBN identified — the two title-driven passes each pass
    // their own `source`. See ImportedItem.titleMatch.
    titleMatch: ImportedItem["titleMatch"] = null,
  ): ImportedItem {
    const book = result.book;
    const preexisting = result.outcome === "updated";
    // The server reports the scan state it actually wrote (status/rating/owning_status), so the
    // card shows real state rather than re-deriving the shelf-mapping/rating rules client-side —
    // always present for the "imported"/"updated" outcomes reaching here.
    const resolved = result.resolved!;
    const previous = preexisting ? (result.previous ?? null) : null;
    return {
      rowId: row.id,
      scanId: result.scan_id!,
      isbn: result.isbn,
      title: book?.title ?? row.title,
      author: book?.author ?? row.author,
      coverUrl: book?.cover_url ?? null,
      publisher: book?.publisher ?? null,
      language: book?.language ?? null,
      status: resolved.status,
      owningStatus: resolved.owning_status,
      rating: resolved.rating,
      createdAt: row.createdAt,
      workId: book?.work_id ?? null,
      preexisting,
      previous,
      titleMatch,
      sortRank: importSortRank({
        status: resolved.status,
        owningStatus: resolved.owning_status,
        rating: resolved.rating,
      }),
      matchedViaWork: result.matched_via_work ?? false,
      siblingUpdates: (result.sibling_updates ?? []).map((s) => ({
        scanId: s.scan_id,
        previousStatus: s.previous_status,
      })),
      otherEdition: result.other_edition ?? null,
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

  // Every scan an "updated" result wrote, each with the status it held beforehand.
  function scansWritten(result: ImportRowResult): ScanWrite[] {
    return [
      ...(result.previous && result.scan_id != null
        ? [{ scanId: result.scan_id, previousStatus: result.previous.status }]
        : []),
      ...(result.sibling_updates ?? []).map((s) => ({
        scanId: s.scan_id,
        previousStatus: s.previous_status,
      })),
    ];
  }

  // True when this result wrote a scan an earlier row of the same session already has a card for.
  // Reachable since an update now resolves by work: two *different* editions of one book in the
  // export (the file pre-dedupe below only catches identical ISBNs) write overlapping sets of copies,
  // and two cards over one scan would fight over Remove/Undo — one PATCHing a scan the other's
  // Remove deleted, or the two restoring it to different values on cancel. Fold the write into the
  // card that's already there and log the row as an in-file duplicate, which is what it is.
  function absorbIntoExistingCard(
    row: ParsedGoodreadsRow,
    result: ImportRowResult,
  ): boolean {
    // An "imported" row's scan_id is a freshly minted rowid and it writes nothing else, so it can
    // never overlap an existing card — skip the scan of importedItems, which a large import makes
    // long.
    if (result.outcome !== "updated" || result.scan_id == null) return false;
    const written = scansWritten(result);
    const existing = findAbsorbTarget(importedItems.value, written);
    if (!existing) return false;
    // The server applied this row's status/rating on top, so the existing card would otherwise sit
    // on a stale value.
    if (result.resolved) {
      existing.status = result.resolved.status;
      existing.rating = result.resolved.rating;
    }
    existing.siblingUpdates.push(...writesToAdopt(existing, written));
    pushLog(row, row.isbn, "duplicate", "in_file");
    return true;
  }

  // The card side of every pass's result ladder: a row that wrote a scan either folds into the card
  // already covering it or gets one of its own. All three passes do exactly this — they differ only
  // in the provenance they attach and in where their *non*-imported outcomes go.
  function pushOrAbsorb(
    row: ParsedGoodreadsRow,
    result: ImportRowResult,
    titleMatch: ImportedItem["titleMatch"] = null,
  ): void {
    if (!absorbIntoExistingCard(row, result)) {
      importedItems.value.push(buildImportedItem(row, result, titleMatch));
    }
  }

  // Why a row that reached the end of the passes still needs a human: the export had no ISBN at all,
  // or had something that isn't one.
  function reviewReason(row: ParsedGoodreadsRow): ReviewItem["reason"] {
    return row.isbn ? "invalid_isbn" : "no_isbn";
  }

  function pushLog(
    row: Pick<ParsedGoodreadsRow, "id" | "title" | "author">,
    isbn: string | null,
    outcome: ImportLogEntry["outcome"],
    reason: ImportLogReason,
  ) {
    log.value.push({
      rowId: row.id,
      title: row.title,
      author: row.author,
      isbn,
      outcome,
      reason,
    });
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

  // The ISBNs of the scans this session itself created (updated rows are excluded — those scans
  // predate the import).
  const sessionCreatedIsbnKeys = computed(
    () =>
      new Set(
        importedItems.value
          .filter((item) => !item.preexisting)
          .map((item) => normalizeIsbnKey(item.isbn)),
      ),
  );

  // True when the edition the server reported as "another edition already in your library" is in
  // fact one this run just added. `findWorkSiblingScans` reads the DB, which by then holds the scans
  // of earlier batches (and of earlier rows of the same batch), so a CSV listing two editions of
  // one work would otherwise have its second row warn about a copy that didn't exist before the
  // import. Only the client knows what the session itself created, so the filter lives here
  // rather than in the route — same reasoning as changeImportedEdition discarding the field.
  function isSessionCreatedEdition(isbn: string): boolean {
    return sessionCreatedIsbnKeys.value.has(normalizeIsbnKey(isbn));
  }

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
        rowId: item.row.id,
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
    fileSize.value = file.size;
    chipDismissed.value = false;

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
      const row = parseGoodreadsRow(raw, i);
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
      const key = row.isbn ? normalizeIsbnKey(row.isbn) : undefined;
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
      mapping[shelf] = DEFAULT_SHELF_MAPPING[shelf] ?? { status: "unread" };
    }

    step.value = "confirm";
    persistSession();
  }

  function setMapping(shelf: string, next: ShelfMapping) {
    mapping[shelf] = next;
  }

  // 429s wait for Retry-After and retry the same batch (bounded — a 30/min budget against
  // 10-row batches should never realistically exhaust this). A network error gets exactly one
  // retry before the batch is given up on, degrading every row to whatever onFail() returns.
  async function postWithRetry<T>(
    url: string,
    body: unknown,
    onFail: () => T[],
  ): Promise<T[]> {
    let networkRetried = false;
    inFlightBatches.value++;
    try {
      for (let attempt = 0; attempt < 10; attempt++) {
        try {
          const res = await apiFetch(url, {
            method: "POST",
            body: JSON.stringify(body),
          });
          if (res.status === 429) {
            const retryAfter = Number(res.headers.get("Retry-After") ?? "5");
            await sleep(retryAfter * 1000);
            continue;
          }
          if (!res.ok) return onFail();
          const data = (await res.json()) as { results: T[] };
          return data.results;
        } catch {
          if (!networkRetried) {
            networkRetried = true;
            continue;
          }
          return onFail();
        }
      }
      return onFail();
    } finally {
      inFlightBatches.value--;
    }
  }

  // A failed /goodreads batch degrades every row to "failed".
  function postBatchWithRetry(
    payloads: ReturnType<typeof buildImportPayload>[],
    update: boolean,
    shelvesFieldDefId: number | null = null,
  ): Promise<ImportRowResult[]> {
    return postWithRetry<ImportRowResult>(
      "/api/import/goodreads",
      {
        rows: payloads,
        update,
        ...(shelvesFieldDefId != null
          ? { shelves_field_def_id: shelvesFieldDefId }
          : {}),
      },
      () => payloads.map((p) => ({ isbn: p.isbn, outcome: "failed" as const })),
    );
  }

  // How a row is named to the two title-driven routes. Annotations are stripped because
  // "(Discworld, #3)" is Goodreads' shelf furniture, not part of the title anyone catalogued the
  // book under — and both routes score against catalogued titles.
  function titleAuthorQuery(row: ParsedGoodreadsRow): {
    title: string;
    author: string;
  } {
    return {
      title: stripTitleAnnotations(row.title).trim(),
      author: row.author.trim(),
    };
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
      ...titleAuthorQuery(row),
      status,
      rating: row.rating,
    };
  }

  // Same retry policy, against /api/import/match. A request-level failure degrades every row in
  // the batch to "no_match" (not a "failed" outcome — see MatchRowResult) so it falls to manual
  // review rather than silently guessing.
  function postMatchBatchWithRetry(
    payloads: MatchPayloadRow[],
    update: boolean,
  ): Promise<MatchRowResult[]> {
    return postWithRetry<MatchRowResult>(
      "/api/import/match",
      { rows: payloads, update },
      () => payloads.map(() => ({ outcome: "no_match" as const })),
    );
  }

  interface SuggestPayloadRow {
    title: string;
    author: string;
  }

  interface SuggestRowResult {
    isbn: string | null;
    confidence?: number;
  }

  // Same retry policy, against /api/import/suggest-isbn. A request-level failure degrades every row
  // to "no suggestion", which sends it to manual review — the same place it would have gone before
  // this pass existed.
  function postSuggestBatchWithRetry(
    payloads: SuggestPayloadRow[],
  ): Promise<SuggestRowResult[]> {
    return postWithRetry<SuggestRowResult>(
      "/api/import/suggest-isbn",
      { rows: payloads },
      () => payloads.map(() => ({ isbn: null })),
    );
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
      resolved: result.resolved,
      previous: result.previous,
      sibling_updates: result.sibling_updates,
    };
  }

  function queueForReview(
    row: ParsedGoodreadsRow,
    reason: ReviewItem["reason"],
  ): void {
    reviewQueue.value.push({
      id: nextReviewId.value++,
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

  // The last pass over a row the export gave no usable ISBN: /match has already ruled out the
  // user's own library, so the server is asked to name an edition from the title/author (see
  // POST /api/import/suggest-isbn) and the row is imported under it like any other. The point is
  // that the user picks nothing — but the server only answers when the answer is confident and
  // unambiguous, so a row it declines still goes to manual review rather than being guessed at.
  // Every imported card carries a `catalog`-sourced `titleMatch`, which is what the summary card
  // says out loud.
  //
  // Cancelling mid-pass queues the remaining rows as "cancelled", same as the passes before it —
  // and since this is the last one, it needs no early return of its own: startImport moves to the
  // review step either way.
  async function autoAssignPass(
    unassigned: ParsedGoodreadsRow[],
    shelvesFieldDefId: number | null,
  ): Promise<void> {
    // One suggest batch's picks always fit one import batch, both being capped at BATCH_SIZE.
    const batches = chunk(unassigned, BATCH_SIZE);
    if (batches.length === 0) return;
    const searchFor = (batch: ParsedGoodreadsRow[]) =>
      postSuggestBatchWithRetry(batch.map((row) => titleAuthorQuery(row)));

    // The one place in the wizard that keeps two requests in flight at once. A batch's searches
    // share nothing with the previous batch's import, so waiting for that import before starting
    // them idled ~3s of every ~7.5s batch — hence the prefetch below, which always holds the
    // search for the batch this loop is about to handle.
    let pending = searchFor(batches[0]);
    for (let b = 0; b < batches.length; b++) {
      if (cancelRequested.value) {
        for (const rest of batches.slice(b)) queueRemainderAsCancelled(rest);
        // The outstanding prefetch is left to settle and its answer dropped: one search already
        // charged against the rate limit, and postWithRetry never rejects, so there's no unhandled
        // rejection to guard against either.
        return;
      }
      const batch = batches[b];
      const suggestions = await pending;
      // Start the next batch's searches *before* awaiting this batch's import, not after it. The
      // last iteration has none to start and never reads `pending` again.
      const next = batches[b + 1];
      if (next) pending = searchFor(next);

      const assigned: {
        row: ParsedGoodreadsRow;
        isbn: string;
        titleMatch: ImportedItem["titleMatch"];
      }[] = [];
      suggestions.forEach((suggestion, i) => {
        const row = batch[i];
        if (suggestion.isbn) {
          assigned.push({
            row,
            isbn: suggestion.isbn,
            titleMatch:
              suggestion.confidence != null
                ? { confidence: suggestion.confidence, source: "catalog" }
                : null,
          });
        } else {
          queueForReview(row, reviewReason(row));
        }
      });

      if (assigned.length > 0) {
        const results = await postBatchWithRetry(
          assigned.map((a) =>
            buildImportPayload({ ...a.row, isbn: a.isbn }, mapping),
          ),
          updateExisting.value,
          shelvesFieldDefId,
        );
        results.forEach((result, i) => {
          const { row, titleMatch } = assigned[i];
          if (result.outcome === "imported" || result.outcome === "updated") {
            pushOrAbsorb(row, result, titleMatch);
          } else if (result.outcome === "duplicate") {
            pushLog(row, result.isbn, "duplicate", "in_library");
          } else {
            // Including invalid_isbn: the suggestion turned out not to be importable, which leaves
            // the row exactly where it started — with no usable ISBN and a human to ask.
            queueForReview(row, reviewReason(row));
          }
        });
      }
      persistSession();
    }
  }

  // Rows left in a stage that's been abandoned (cancel, or everything after it) go to the
  // review queue rather than vanishing — startImport is done deciding their fate for this run
  // just like a genuine no-match, and the progress accounting (Phase 7) depends on every row
  // ending up either resolved or queued.
  function queueRemainderAsCancelled(remaining: ParsedGoodreadsRow[]): void {
    for (const row of remaining) queueForReview(row, "cancelled");
  }

  // Also serves as the resume entry point: rows already accounted for (imported, logged, or
  // queued for review — see resolvedRowIds) are filtered out before building the send batches, so
  // calling this again after a rehydrated "paused" session picks up exactly where it left off
  // instead of re-sending or double-counting anything.
  async function startImport(): Promise<void> {
    if (isRunning.value) return;
    isRunning.value = true;
    sessionPaused.value = false;
    step.value = "importing";
    cancelRequested.value = false;

    try {
      const resolved = resolvedRowIds();
      const unresolvedRows = rows.value.filter((r) => !resolved.has(r.id));

      // Resolved once per session, not per row/batch — see ensureShelvesFieldDef.
      const shelvesFieldDefId = importShelvesAsTags.value
        ? await ensureShelvesFieldDef()
        : null;

      const sendable = unresolvedRows.filter((r) => r.isbn && isIsbnShaped(r.isbn));
      // Distinguish "nothing in the export" from "something was there but doesn't look like an
      // ISBN" — used as the review reason (reason_no_isbn vs reason_invalid_isbn) if title/author
      // matching below also comes up empty.
      const noIsbnRows = unresolvedRows.filter((r) => !r.isbn);
      const malformedIsbnRows = unresolvedRows.filter(
        (r) => r.isbn && !isIsbnShaped(r.isbn),
      );
      const unmatched = [...noIsbnRows, ...malformedIsbnRows];

      const sendableBatches = chunk(sendable, BATCH_SIZE);
      for (let b = 0; b < sendableBatches.length; b++) {
        if (cancelRequested.value) {
          for (const rest of sendableBatches.slice(b)) queueRemainderAsCancelled(rest);
          queueRemainderAsCancelled(unmatched);
          step.value = "review";
          persistSession();
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
              pushOrAbsorb(row, result);
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
        persistSession();
      }

      // Rows with no usable ISBN aren't given up on outright — try matching them against the
      // existing library by title/author first (see worker/src/title-match.ts). A Goodreads
      // export commonly has these for books added by hand, and many turn out to already be here.
      // Rows the library pass didn't recognize either — they still have no ISBN, and the
      // auto-assign pass below tries to name one for each rather than sending them all to review.
      const unassigned: ParsedGoodreadsRow[] = [];
      const unmatchedBatches = chunk(unmatched, MATCH_BATCH_SIZE);
      for (let b = 0; b < unmatchedBatches.length; b++) {
        if (cancelRequested.value) {
          for (const rest of unmatchedBatches.slice(b)) queueRemainderAsCancelled(rest);
          queueRemainderAsCancelled(unassigned);
          step.value = "review";
          persistSession();
          return;
        }
        const batch = unmatchedBatches[b];
        const payloads = batch.map((row) => buildMatchPayload(row));
        const results = await postMatchBatchWithRetry(payloads, updateExisting.value);
        results.forEach((result, i) => {
          const row = batch[i];
          if (result.outcome === "updated") {
            // pushOrAbsorb's aliasing guard matters here too: this pass scores against the user's
            // whole library, which by now includes the scans this session created.
            pushOrAbsorb(
              row,
              matchResultToImportRowResult(result),
              result.confidence != null
                ? { confidence: result.confidence, source: "library" }
                : null,
            );
          } else if (result.outcome === "duplicate") {
            // A confident match was found but updateExisting is off — nothing was written, and
            // unlike "no_match" there's nothing for the user to resolve, so this isn't a review
            // row: it's resolved, just declined.
            pushLog(row, row.isbn, "duplicate", "in_library");
          } else {
            unassigned.push(row);
          }
        });
        persistSession();
      }

      await autoAssignPass(unassigned, shelvesFieldDefId);

      step.value = "review";
      persistSession();
    } finally {
      isRunning.value = false;
    }
  }

  // Discards a rehydrated "paused" session without resuming it — the parsed rows/mapping/results
  // so far are all dropped, same as a full reset.
  function discardSession(): void {
    reset();
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
    persistSession();
  }

  // Skips stay in the queue so they can be undone until the import is finalized — `notImported`
  // surfaces them without touching `log`.
  function skipReviewItem(item: ReviewItem): void {
    if (item.status === "skipped") return;
    item.status = "skipped";
    persistSession();
  }

  function undoSkipReviewItem(item: ReviewItem): void {
    if (item.status !== "skipped") return;
    item.status = "pending";
    persistSession();
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
    // Never for a preexisting/title-matched row: the swap creates a new scan and deletes the
    // old one, but here "old" is the user's own scan that predated the import — deleting it
    // (and its overrides/custom fields) is silent data loss. The UI hides the picker for these
    // rows; this is the backstop.
    if (item.busy || item.preexisting) return;
    item.busy = true;
    item.error = "";
    try {
      // No title/author/publisher fallback here — the candidate ISBN comes from a resolved
      // search/library result, not a bare CSV row, so a metadata-lookup miss is unexpected and
      // there's nothing better than null to fall back to.
      const payload: ImportPayloadRow = {
        isbn,
        status: item.status,
        // Explicit, unlike a plain CSV-import row — the swap re-creates the scan under a new
        // ISBN and must carry the item's current owning_status through rather than losing it to
        // the `scans` table default.
        owning_status: item.owningStatus,
        rating: item.rating,
        created_at: item.createdAt,
        title: null,
        author: null,
        publisher: null,
        publish_date: null,
        number_of_pages: null,
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
        // Don't take result.other_edition here: the server looked for a sibling edition before
        // this swap's own INSERT, so what it found is the item's *previous* scan — the one the
        // DELETE below removes. Clear the note rather than restate a copy that's on its way out.
        item.otherEdition = null;
        // The ISBN is the user's choice now, so no title score describes this card any more. Only
        // a `catalog` one can be here — a `library` match is preexisting, which this path refuses
        // above — but clearing the field outright is the honest statement either way.
        item.titleMatch = null;
        item.editingEdition = false;
        // The candidate list just shown belonged to the *previous* work — reopening the picker
        // must re-fetch for the new one, not silently show stale editions of the old book.
        item.candidates = [];
        item.candidatesLoaded = false;
        item.candidatesFromStorage = false;
        // The new scan is already saved and reflected above regardless — but if the old one
        // couldn't be removed, it's now an orphaned duplicate the user can't see from this card.
        // Surface that rather than silently leaving it behind — including on a thrown network
        // error, not just a non-ok response.
        try {
          const deleteRes = await apiFetch(`/api/scans/${oldScanId}`, {
            method: "DELETE",
          });
          if (!deleteRes.ok && deleteRes.status !== 404) {
            item.error = "orphaned_duplicate";
          }
        } catch {
          item.error = "orphaned_duplicate";
        }
      } else if (result.outcome === "duplicate") {
        item.editingEdition = false;
        item.error = "duplicate";
      } else {
        item.editingEdition = false;
        item.error = "failed";
      }
    } finally {
      item.busy = false;
      persistSession();
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

  // Best-effort status writes for the *other* copies of a work-matched row's work (see
  // `siblingUpdates`). Deliberately quiet: the card is an editor for `item.scanId`, these scans
  // have no error surface of their own, and a failure leaves a copy on its previous status rather
  // than losing anything.
  async function patchScanStatuses(
    writes: { scanId: number; status: ReadStatus }[],
  ): Promise<void> {
    await Promise.allSettled(
      writes.map((w) =>
        apiFetch(`/api/scans/${w.scanId}`, {
          method: "PATCH",
          body: JSON.stringify({ status: w.status }),
        }),
      ),
    );
  }

  // Puts a preexisting row back the way the import found it: the primary's status and rating, plus
  // each other copy's *own* prior status — one work-matched update wrote a single value across
  // copies that may well have had different ones. The rating needs no per-copy equivalent, being one
  // per-work value. Shared by the per-row Undo and the whole-import cancel, which have to mean
  // exactly the same thing. The sibling writes don't depend on the primary's response, so they go
  // out together.
  async function restorePreImport(item: ImportedItem): Promise<boolean> {
    if (!item.previous) return false;
    const [ok] = await Promise.all([
      patchImported(item, {
        status: item.previous.status,
        rating: item.previous.rating,
      }),
      patchScanStatuses(
        item.siblingUpdates.map((s) => ({
          scanId: s.scanId,
          status: s.previousStatus,
        })),
      ),
    ]);
    return ok;
  }

  // busy gates the row's CyclePills (see MatchedRow) so a rapid double-click can't fire a second
  // PATCH before the first one's response lands and land out of order. applyLocal runs only on a
  // successful PATCH, mutating the item to match what the server now has — and may await a
  // follow-up write that has to stay inside the same busy window.
  async function patchImportedField(
    item: ImportedItem,
    body: Record<string, unknown>,
    applyLocal: () => void | Promise<void>,
  ): Promise<void> {
    if (item.busy) return;
    item.busy = true;
    try {
      if (await patchImported(item, body)) {
        await applyLocal();
        persistSession();
      }
    } catch {
      // Same no-op as a non-ok response above — these are quick, retryable toggles with no
      // dedicated error UI, so a thrown network failure shouldn't escape uncaught either.
    } finally {
      item.busy = false;
    }
  }

  function setImportedStatus(item: ImportedItem, status: ReadStatus): Promise<void> {
    return patchImportedField(item, { status }, async () => {
      item.status = status;
      // A work-matched row's card stands for every copy of that work, because that's what the import
      // wrote — without this the import touches all of them and the very next tweak on the same card
      // touches one, and they silently drift apart. A no-op for an ordinary row.
      await patchScanStatuses(
        item.siblingUpdates.map((s) => ({ scanId: s.scanId, status })),
      );
    });
  }

  function setImportedOwning(item: ImportedItem, owning: OwningStatus): Promise<void> {
    return patchImportedField(item, { owning_status: owning }, () => {
      item.owningStatus = owning;
    });
  }

  function setImportedRating(item: ImportedItem, rating: number | null): Promise<void> {
    return patchImportedField(item, { rating }, () => {
      // A rating is stored per work, so it applies to every imported row of the same work — two
      // editions of one book in the same CSV would otherwise show conflicting scores.
      for (const other of importedItems.value) {
        if (other === item || (other.workId != null && other.workId === item.workId))
          other.rating = rating;
      }
    });
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
        persistSession();
      } else {
        item.error = "remove_failed";
      }
    } catch {
      item.error = "remove_failed";
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
      if (await restorePreImport(item)) {
        const idx = importedItems.value.indexOf(item);
        if (idx !== -1) importedItems.value.splice(idx, 1);
        persistSession();
      } else {
        item.error = "remove_failed";
      }
    } catch {
      item.error = "remove_failed";
    } finally {
      item.busy = false;
    }
  }

  // Cancels the whole import: deletes every scan this session created, and reverts every scan
  // it updated back to its pre-import status/rating instead (those scans predate the import and
  // must survive a cancel). Best-effort — a failed request still drops the item from the local
  // list so the user isn't stuck. Resets to a fresh session afterward — there's nothing left to
  // review once every row has been undone or removed.
  async function cancelImport(): Promise<void> {
    await Promise.allSettled(
      importedItems.value.map((item) =>
        item.preexisting
          ? restorePreImport(item)
          : apiFetch(`/api/scans/${item.scanId}`, { method: "DELETE" }),
      ),
    );
    reset();
  }

  // The normal end of a session: nothing left to revert, just clear the slate so the next visit
  // to /import starts fresh instead of resuming a finished run.
  function finalizeImport(): void {
    reset();
  }

  function dismissChip(): void {
    chipDismissed.value = true;
  }

  function reset(): void {
    step.value = "upload";
    error.value = "";
    fileName.value = "";
    fileSize.value = 0;
    rows.value = [];
    shelfCounts.value = new Map();
    for (const key of Object.keys(mapping)) delete mapping[key];
    reviewQueue.value = [];
    nextReviewId.value = 0;
    candidateCache.clear();
    log.value = [];
    importedItems.value = [];
    updateExisting.value = true;
    importShelvesAsTags.value = false;
    cancelRequested.value = false;
    sessionPaused.value = false;
    chipDismissed.value = false;
    clearPersistedSession();
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
    isSessionCreatedEdition,
    reviewRemaining,
    isInProgress,
    isRunning,
    sessionPaused,
    sessionActive,
    chipDismissed,
    loadFile,
    setMapping,
    startImport,
    cancelRequested,
    cancelImporting,
    discardSession,
    dismissChip,
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
    finalizeImport,
    reset,
  };
});
