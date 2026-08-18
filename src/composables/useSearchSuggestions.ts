import { computed, ref, watch, type ComputedRef, type Ref } from "vue";
import { useI18n } from "vue-i18n";
import { cfIcon, type SuggestionFacet } from "@/composables/useLibrarySearch";
import type { CustomFieldMeta } from "@/composables/useGroupDimensions";
import type { Book } from "@/types/book";
import {
  parseSearchFragment,
  parseSearchSegments,
  type SearchSegment,
} from "@/utils/search-parse";

export type { SearchSegment } from "@/utils/search-parse";

// ── Suggestion shapes ─────────────────────────────────────────────────────────
export type SuggestionPrefix = {
  kind: "prefix";
  token: string;
  icon: string;
  label: string;
  typeLabel: string;
};
export type SuggestionBook = {
  kind: "book";
  book: Book;
  icon: string;
  label: string;
  typeLabel: string;
  token: "";
};
export type SuggestionExpand = {
  kind: "expand";
  token: string;
  icon: string;
  label: string;
  typeLabel: string;
};
export type Suggestion =
  | SuggestionPrefix
  | SuggestionFacet
  | SuggestionBook
  | SuggestionExpand;

// The core structured-token prefixes shown while the search bar is idle (before the
// user expands to the full set).
const CORE_PREFIX_KEYS = new Set([
  "status",
  "owning",
  "author",
  "genre",
  "series",
]);

/**
 * Owns the autocomplete suggestion engine for the library search bar: prefix
 * chips, facet-value matches, and title matches, plus the highlight-overlay
 * segmentation. Reads the search-pipeline outputs (knownKeys/facetEntries/
 * baseFiltered) from useLibrarySearch and turns the raw query into a ranked
 * suggestion list. The DOM-bound widget state (focus, keyboard nav) stays in
 * LibrarySearchBar.vue.
 */
export function useSearchSuggestions(options: {
  search: Ref<string>;
  knownKeys: Ref<Set<string>>;
  facetEntries: Ref<SuggestionFacet[]>;
  baseFiltered: Ref<Book[]>;
  /** The list's own "group editions into one card" preference — title suggestions collapse by
   *  work only when the cards behind them do. */
  groupEditions: Ref<boolean>;
  customFieldMetas: Ref<CustomFieldMeta[]> | ComputedRef<CustomFieldMeta[]>;
}) {
  const {
    search,
    knownKeys,
    facetEntries,
    baseFiltered,
    groupEditions,
    customFieldMetas,
  } = options;
  const { t } = useI18n();

  const showAllPrefixes = ref(false);

  const PREFIXES = computed(() => [
    { key: "status", icon: "mdi-progress-check", label: t("library.filter_status") },
    { key: "owning", icon: "mdi-bookshelf", label: t("library.filter_owning") },
    { key: "author", icon: "mdi-account-outline", label: t("library.group_author") },
    { key: "genre", icon: "mdi-tag-outline", label: t("library.group_genre") },
    { key: "series", icon: "mdi-bookshelf", label: t("library.group_series") },
    { key: "publisher", icon: "mdi-domain", label: t("library.group_publisher") },
    { key: "language", icon: "mdi-translate", label: t("library.group_language") },
    { key: "award", icon: "mdi-trophy-outline", label: t("library.filter_awards") },
    { key: "form", icon: "mdi-text-box-outline", label: t("library.group_form") },
    { key: "country", icon: "mdi-earth", label: t("library.group_country") },
    { key: "year", icon: "mdi-calendar-range", label: t("library.group_year") },
    { key: "subject", icon: "mdi-lightbulb-outline", label: t("library.group_subject") },
    { key: "location", icon: "mdi-map-marker-outline", label: t("library.group_location") },
    { key: "missing", icon: "mdi-help-circle-outline", label: t("library.filter_missing") },
    ...customFieldMetas.value
      .filter((m) => m.def.type !== "date" && m.def.type !== "integer")
      .map((m) => ({ key: m.slug, icon: cfIcon(m.def.type), label: m.def.name })),
  ]);

  const searchSegments = computed<SearchSegment[]>(() =>
    parseSearchSegments(search.value, knownKeys.value),
  );

  const searchFragment = computed(() =>
    parseSearchFragment(search.value, knownKeys.value),
  );

  const suggestions = computed<Suggestion[]>(() => {
    const frag = searchFragment.value.trim().toLowerCase();
    const titleLabel = t("library.facet_title");

    if (!frag) {
      // Empty/idle → show prefix chips, collapsed to the core set until expanded
      const list = showAllPrefixes.value
        ? PREFIXES.value
        : PREFIXES.value.filter((p) => CORE_PREFIX_KEYS.has(p.key));
      const chips: Suggestion[] = list.map((p) => ({
        kind: "prefix" as const,
        token: `${p.key}:`,
        icon: p.icon,
        label: p.label,
        typeLabel: p.label,
      }));
      if (!showAllPrefixes.value) {
        const remaining = PREFIXES.value.length - CORE_PREFIX_KEYS.size;
        chips.push({
          kind: "expand",
          token: t("library.search_show_more", { n: remaining }),
          icon: "mdi-dots-horizontal",
          label: t("library.search_show_more", { n: remaining }),
          typeLabel: "",
        });
      }
      return chips;
    }

    const results: Suggestion[] = [];
    const MAX = 8;

    // Typing inside a known key: eg "author:pyn"
    const matchedPrefix = PREFIXES.value.find((p) =>
      frag.startsWith(`${p.key}:`),
    );
    if (matchedPrefix) {
      const val = frag.slice(matchedPrefix.key.length + 1);
      const filtered = facetEntries.value
        .filter(
          (e) =>
            e.token.startsWith(`${matchedPrefix.key}:`) &&
            e.label.toLowerCase().includes(val),
        )
        .slice(0, MAX);
      return filtered.length
        ? filtered
        : [
            {
              kind: "facet",
              token: `${matchedPrefix.key}:`,
              icon: matchedPrefix.icon,
              label: t("library.search_no_matches"),
              typeLabel: matchedPrefix.label,
            },
          ];
    }

    // Free typing: match prefix words, facet values, and titles
    for (const p of PREFIXES.value) {
      if (p.key.startsWith(frag) || p.label.toLowerCase().startsWith(frag)) {
        results.push({
          kind: "prefix",
          token: `${p.key}:`,
          icon: p.icon,
          label: p.label,
          typeLabel: p.label,
        });
      }
    }
    for (const e of facetEntries.value) {
      if (e.label.toLowerCase().includes(frag)) {
        results.push(e);
        if (results.length >= MAX) break;
      }
    }
    if (results.length < MAX) {
      // One row per work rather than per edition, so a work owned twice doesn't offer its title
      // twice and fill half of the eight slots with rows that all open the same card. Gated on
      // the list's own grouping preference: with edition grouping off every edition is its own
      // card, and collapsing the suggestions would then describe a list the user isn't looking
      // at. The pool stays pre-collapse either way — search has to match per-edition fields —
      // and the bucket key is `useEditionGrouping`'s: `work_id` is null until enrichment links
      // the book, and an unlinked scan is its own work.
      //
      // The edition kept is the one that *matched*, not the card's representative, so typing a
      // title only one edition carries ("Der Wüstenplanet") still names and opens that edition.
      const seenWorks = new Set<string>();
      for (const b of baseFiltered.value) {
        if (b.title?.toLowerCase().includes(frag)) {
          if (groupEditions.value) {
            const workKey =
              b.work_id != null ? `work:${b.work_id}` : `book:${b.id}`;
            if (seenWorks.has(workKey)) continue;
            seenWorks.add(workKey);
          }
          results.push({
            kind: "book",
            book: b,
            icon: "mdi-book-outline",
            label: b.title!,
            typeLabel: titleLabel,
            token: "",
          });
          if (results.length >= MAX) break;
        }
      }
    }
    return results;
  });

  const dropdownHeading = computed(() => {
    const frag = searchFragment.value.trim().toLowerCase();
    if (!frag) return t("library.search_refine");
    const pm = PREFIXES.value.find((p) => frag.startsWith(`${p.key}:`));
    if (pm) return t("library.search_values", { facet: pm.label });
    return t("library.search_matches");
  });

  // Collapse the idle prefix chips back down once the user starts typing again
  watch(searchFragment, (frag) => {
    if (frag) showAllPrefixes.value = false;
  });

  return {
    searchFragment,
    searchSegments,
    suggestions,
    dropdownHeading,
    showAllPrefixes,
  };
}
