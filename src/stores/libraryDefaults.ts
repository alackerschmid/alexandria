import { defineStore } from "pinia";
import { computed, customRef, type Ref } from "vue";
import type { ReadStatus } from "@/types/book";
import type { GroupBy, OwnershipScope, SortOption } from "@/types/library";

// A writable ref that persists to localStorage on every set — so pages can bind the
// setting directly (v-model / storeToRefs) without a per-setting computed wrapper or
// setX method.
function persistedBool(key: string, fallback: boolean): Ref<boolean> {
  const stored = localStorage.getItem(key);
  let value = stored === null ? fallback : stored === "true";
  return customRef((track, trigger) => ({
    get() {
      track();
      return value;
    },
    set(v) {
      value = v;
      localStorage.setItem(key, String(v));
      trigger();
    },
  }));
}

function persistedStr<T extends string>(
  key: string,
  fallback: T,
  isValid?: (v: string) => v is T,
): Ref<T> {
  const stored = localStorage.getItem(key);
  let value: T =
    stored !== null && (!isValid || isValid(stored)) ? (stored as T) : fallback;
  return customRef((track, trigger) => ({
    get() {
      track();
      return value;
    },
    set(v) {
      value = v;
      localStorage.setItem(key, v);
      trigger();
    },
  }));
}

function persistedNum(key: string, fallback: number): Ref<number> {
  const parsed = parseInt(localStorage.getItem(key) ?? "", 10);
  let value = Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  return customRef((track, trigger) => ({
    get() {
      track();
      return value;
    },
    set(v) {
      value = v;
      localStorage.setItem(key, String(v));
      trigger();
    },
  }));
}

const VALID_GROUP_BY: GroupBy[] = [
  "none",
  "author",
  "series",
  "genre",
  "status",
  "owning",
  "publisher",
  "language",
  "form",
  "country",
  "decade",
  "subject",
];
const isValidGroupBy = (v: string): v is GroupBy =>
  (VALID_GROUP_BY as string[]).includes(v) || /^cf:\d+$/.test(v);

const VALID_OWNERSHIP_SCOPE: OwnershipScope[] = ["owned", "all", "missing"];
const isValidOwnershipScope = (v: string): v is OwnershipScope =>
  (VALID_OWNERSHIP_SCOPE as string[]).includes(v);

// One-time migration: `ownershipScope` replaces the three booleans below. If the
// user never explicitly chose an ownershipScope (i.e. this is their first load
// post-migration), derive it from whichever of the old flags they'd set, instead
// of silently discarding a customized "owned only" / "show missing" preference.
function migrateOwnershipScope() {
  if (localStorage.getItem("libOwnershipScope") !== null) return;
  const scope: OwnershipScope =
    localStorage.getItem("libOnlyOwned") === "true"
      ? "owned"
      : localStorage.getItem("libShowUnowned") === "true"
        ? "missing"
        : "all";
  localStorage.setItem("libOwnershipScope", scope);
}

export const useLibraryDefaultsStore = defineStore("libraryDefaults", () => {
  migrateOwnershipScope();

  const defaultView = persistedStr<"list" | "tile">("defaultView", "list");
  const defaultScanStatus = persistedStr<ReadStatus>(
    "defaultScanStatus",
    "unread",
  );
  const defaultPageSize = persistedNum("defaultPageSize", 24);

  const mainOnly = persistedBool("libMainOnly", true);
  // Independent per-view defaults: the reading-status dot is the primary signal in
  // list view but visual clutter in the denser tile grid, so each view remembers
  // its own preference rather than sharing one flag.
  const showStatusIconsList = persistedBool("libShowStatusIconsList", true);
  const showStatusIconsTile = persistedBool("libShowStatusIconsTile", false);
  const groupEditions = persistedBool("libGroupEditions", true);

  // One control over the ownership axis. `onlyOwned`/`showUnowned` are the two
  // filters the library pipeline actually consumes; deriving them here keeps the
  // contradictory combination (hide unowned *and* reveal missing) unrepresentable.
  const ownershipScope = persistedStr<OwnershipScope>(
    "libOwnershipScope",
    "all",
    isValidOwnershipScope,
  );
  const onlyOwned = computed(() => ownershipScope.value === "owned");
  const showUnowned = computed(() => ownershipScope.value === "missing");

  const groupBy = persistedStr<GroupBy>("libGroupBy", "none", isValidGroupBy);
  const sortDirection = persistedStr<SortOption>("libSortDirection", "desc");

  // Retained as methods because they're called from other pages (settings, the
  // per-page-size watch) rather than bound directly.
  function setView(v: "list" | "tile") {
    defaultView.value = v;
  }
  function setStatus(s: ReadStatus) {
    defaultScanStatus.value = s;
  }
  function setPageSize(n: number) {
    defaultPageSize.value = n;
  }

  return {
    defaultView,
    defaultScanStatus,
    defaultPageSize,
    mainOnly,
    ownershipScope,
    showUnowned,
    showStatusIconsList,
    showStatusIconsTile,
    onlyOwned,
    groupEditions,
    groupBy,
    sortDirection,
    setView,
    setStatus,
    setPageSize,
  };
});
