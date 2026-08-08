import { defineStore } from "pinia";
import { persistedStr } from "@/stores/preferences";
import { STATS_SCOPES, type StatsScope } from "@/types/stats";

const isValidStatsScope = (v: string): v is StatsScope =>
  (STATS_SCOPES as readonly string[]).includes(v);

// The /stats page's own persisted display state, kept out of `libraryDefaults` because none of
// it applies to the library — the two pages' ownership scopes are separate settings on purpose
// (the library's has a third value, and narrowing one shouldn't silently narrow the other).
//
// Defaults to "owned", matching every other ownership gate in the app. A library that measures
// as empty under it is not left stranded there: the page's empty state offers the switch.
export const useStatsDefaultsStore = defineStore("statsDefaults", () => {
  const scope = persistedStr<StatsScope>(
    "statsScope",
    "owned",
    isValidStatsScope,
  );

  return { scope };
});
