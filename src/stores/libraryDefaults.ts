import { defineStore } from "pinia";
import { computed } from "vue";
import type { ReadStatus } from "@/types/book";
import type {
  CoverSize,
  GroupBy,
  OwnershipScope,
  SortOption,
} from "@/types/library";
import { COVER_SIZE_VALUES, GROUP_BY_VALUES } from "@/types/library";
import {
  persistedBool,
  persistedNum,
  persistedStr,
} from "@/stores/preferences";

// Reads the shared list rather than repeating it — see GROUP_BY_VALUES for why. A stored value
// that fails this is discarded in favour of the fallback on *every read*, so anything missing
// here is a dimension the picker silently refuses to switch to.
const isValidGroupBy = (v: string): v is GroupBy =>
  (GROUP_BY_VALUES as readonly string[]).includes(v) || /^cf:\d+$/.test(v);

const VALID_OWNERSHIP_SCOPE: OwnershipScope[] = ["owned", "all", "missing"];
const isValidOwnershipScope = (v: string): v is OwnershipScope =>
  (VALID_OWNERSHIP_SCOPE as string[]).includes(v);

const isValidCoverSize = (v: string): v is CoverSize =>
  (COVER_SIZE_VALUES as readonly string[]).includes(v);

// These display defaults are per-user preferences, so they live in the preferences store
// (server-backed, per-user cache) rather than raw localStorage. Each setting is a writable
// computed over one preference key, so pages can still bind it directly (v-model /
// storeToRefs) and a write flows straight through to `preferences.set`.

export const useLibraryDefaultsStore = defineStore("libraryDefaults", () => {
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
  // Tile view only — a row card's width is set by how much text fits beside its
  // thumbnail, not by taste, so list view has no equivalent.
  const coverSize = persistedStr<CoverSize>(
    "libCoverSize",
    "default",
    isValidCoverSize,
  );

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
    coverSize,
    groupBy,
    sortDirection,
    setView,
    setStatus,
    setPageSize,
  };
});
