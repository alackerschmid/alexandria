import { defineStore } from "pinia";
import { ref } from "vue";
import type { ReadStatus } from "@/types/book";
import type { GroupBy, SortOption } from "@/types/library";

export const useLibraryDefaultsStore = defineStore("libraryDefaults", () => {
  const defaultView = ref<"list" | "tile">(
    (localStorage.getItem("defaultView") as "list" | "tile") || "list",
  );
  const defaultScanStatus = ref<ReadStatus>(
    (localStorage.getItem("defaultScanStatus") as ReadStatus) || "unread",
  );
  const defaultPageSize = ref<number>(
    parseInt(localStorage.getItem("defaultPageSize") ?? "24", 10) || 24,
  );

  const boolFrom = (key: string, fallback: boolean) => {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === "true";
  };
  const mainOnly = ref<boolean>(boolFrom("libMainOnly", true));
  const highlightComplete = ref<boolean>(
    boolFrom("libHighlightComplete", true),
  );
  const showUnowned = ref<boolean>(boolFrom("libShowUnowned", false));

  const VALID_GROUP_BY: GroupBy[] = [
    "none",
    "author",
    "series",
    "genre",
    "status",
    "publisher",
    "language",
    "form",
    "country",
    "decade",
    "subject",
  ];
  const rawGroupBy = localStorage.getItem("libGroupBy") ?? "none";
  const isValidGroupBy = (v: string): v is GroupBy =>
    (VALID_GROUP_BY as string[]).includes(v) || /^cf:\d+$/.test(v);
  const groupBy = ref<GroupBy>(
    isValidGroupBy(rawGroupBy) ? rawGroupBy : "none",
  );
  const sortDirection = ref<SortOption>(
    (localStorage.getItem("libSortDirection") as SortOption) || "desc",
  );

  function setMainOnly(v: boolean) {
    mainOnly.value = v;
    localStorage.setItem("libMainOnly", String(v));
  }
  function setHighlightComplete(v: boolean) {
    highlightComplete.value = v;
    localStorage.setItem("libHighlightComplete", String(v));
  }
  function setShowUnowned(v: boolean) {
    showUnowned.value = v;
    localStorage.setItem("libShowUnowned", String(v));
  }
  function setGroupBy(v: GroupBy) {
    groupBy.value = v;
    localStorage.setItem("libGroupBy", v);
  }
  function setSortDirection(v: SortOption) {
    sortDirection.value = v;
    localStorage.setItem("libSortDirection", v);
  }

  function setView(v: "list" | "tile") {
    defaultView.value = v;
    localStorage.setItem("defaultView", v);
  }

  function setStatus(s: ReadStatus) {
    defaultScanStatus.value = s;
    localStorage.setItem("defaultScanStatus", s);
  }

  function setPageSize(n: number) {
    defaultPageSize.value = n;
    localStorage.setItem("defaultPageSize", String(n));
  }

  return {
    defaultView,
    defaultScanStatus,
    defaultPageSize,
    mainOnly,
    highlightComplete,
    showUnowned,
    groupBy,
    sortDirection,
    setView,
    setStatus,
    setPageSize,
    setMainOnly,
    setHighlightComplete,
    setShowUnowned,
    setGroupBy,
    setSortDirection,
  };
});
