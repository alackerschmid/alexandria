import { computed, type ComputedRef, type Ref } from "vue";
import { useI18n } from "vue-i18n";
import { useLocaleStore } from "@/stores/locale";
import { parseTagList } from "@/utils/tags";
import { bookCustomValue } from "@/utils/custom-fields";
import { languageDisplayFormatter } from "@/utils/language";
import { authorNames, bookYear } from "@/utils/book-display";
import { STATUS_ORDER } from "@/composables/useBookStatus";
import { OWNING_ORDER } from "@/composables/useOwningStatus";
import type { Book, OwningStatus, ReadStatus } from "@/types/book";
import type { CustomFieldMeta } from "@/composables/useGroupDimensions";

// Structured search keys with first-class handling (status:, author:, genre:, …).
// Custom-field slugs are appended at runtime.
const STATUS_VALUES = new Set<ReadStatus>(STATUS_ORDER);
const OWNING_VALUES = new Set<OwningStatus>(OWNING_ORDER);

const BUILTIN_KEYS = [
  "status",
  "owning",
  "author",
  "genre",
  "series",
  "publisher",
  "language",
  "original_language",
  "award",
  "form",
  "country",
  "year",
  "subject",
  "location",
  "missing",
];

/**
 * `missing:` — the absence facet. Every other key matches a value a book *has*, which left the
 * catalogue gaps on the stats page with nowhere to link: "books with no cover" is not
 * expressible as `cover:something`.
 *
 * A small closed enum rather than a general negation grammar (`-cover:`), because these four are
 * the gaps worth acting on and a negation operator would have to answer much harder questions
 * about how it composes with the free-text half of the query.
 */
const MISSING_VALUES = {
  cover: (b: Book) => !b.cover_url,
  // `bookYear` prefers the edition's publish_date and falls back to the work's original year,
  // so this asks "no year from either source" — the same question the stats tile counts.
  year: (b: Book) => !bookYear(b),
  genre: (b: Book) => !b.genres?.length,
  pages: (b: Book) => !b.number_of_pages_median,
} as const satisfies Record<string, (b: Book) => boolean>;

export type MissingFacet = keyof typeof MISSING_VALUES;

export const MISSING_KEYS = Object.keys(MISSING_VALUES) as MissingFacet[];

/** Absence chips, offered only where the pool actually has such a book — a "no cover" chip that
 *  matches nothing is worse than no chip. Same present-in-pool rule as the status facets. */
function missingFacets(
  pool: Book[],
  t: (key: string) => string,
): SuggestionFacet[] {
  const typeLabel = t("library.filter_missing");
  return MISSING_KEYS.filter((val) => {
    const isMissing = MISSING_VALUES[val];
    return pool.some((b) => isMissing(b));
  }).map((val) => ({
    kind: "facet" as const,
    token: `missing:${val}`,
    icon: "mdi-help-circle-outline",
    label: t(`library.missing_${val}`),
    typeLabel,
  }));
}

export interface ParsedSearch {
  status: ReadStatus | null;
  owning: OwningStatus | null;
  series: string;
  award: string;
  author: string;
  genre: string;
  publisher: string;
  language: string;
  original_language: string;
  form: string;
  country: string;
  year: string;
  missing: MissingFacet | null;
  subject: string;
  location: string;
  custom: Record<string, string>; // custom-field slug → search value
  text: string;
  tokens: string[]; // the structured parts only, for the active-token pills
}

export interface SuggestionFacet {
  kind: "facet";
  token: string;
  icon: string;
  label: string;
  typeLabel: string;
}

export function cfIcon(type: string): string {
  switch (type) {
    case "tag":
      return "mdi-tag-multiple-outline";
    case "date":
      return "mdi-calendar-outline";
    case "integer":
      return "mdi-numeric";
    default:
      return "mdi-form-textbox";
  }
}

function tokenize(s: string): string[] {
  return s.match(/\S+:"[^"]*"|"[^"]*"|\S+/g) ?? [];
}

function quote(v: string): string {
  return /\s/.test(v) ? `"${v}"` : v;
}

/**
 * Owns the library search pipeline: raw query string → parsed tokens → filtered
 * book list → autocomplete facet entries. Pure derivation over the inputs; the
 * page keeps the DOM-bound autocomplete widget and feeds it these computeds.
 */
export function useLibrarySearch(options: {
  books: ComputedRef<Book[]> | Ref<Book[]>;
  search: Ref<string>;
  customFieldMetas: ComputedRef<CustomFieldMeta[]>;
  /** Resolves the status used for `status:` filtering — lets callers freeze a book's
   *  bucket membership after an in-place status edit instead of using the live value. */
  statusOf?: (b: Book) => ReadStatus;
  /** When true, restricts the whole pipeline (results, groups, facets) to owned books —
   *  backs the "owned books only" display setting. */
  onlyOwned?: ComputedRef<boolean> | Ref<boolean>;
}) {
  const {
    books,
    search,
    customFieldMetas,
    statusOf = (b: Book) => b.status,
    onlyOwned,
  } = options;
  const { t } = useI18n();
  const localeStore = useLocaleStore();
  const langFmt = computed(() => languageDisplayFormatter(localeStore.locale));

  const customSlugMap = computed(
    () => new Map(customFieldMetas.value.map((m) => [m.slug, m.def])),
  );

  const knownKeys = computed(
    () =>
      new Set<string>([
        ...BUILTIN_KEYS,
        ...customFieldMetas.value.map((m) => m.slug),
      ]),
  );

  const parsedSearch = computed<ParsedSearch>(() => {
    const parts = tokenize(search.value.trim());
    let status: ReadStatus | null = null;
    let owning: OwningStatus | null = null;
    let series = "";
    let award = "";
    let author = "";
    let genre = "";
    let publisher = "";
    let language = "";
    let originalLanguage = "";
    let form = "";
    let country = "";
    let year = "";
    let subject = "";
    let location = "";
    let missing: MissingFacet | null = null;
    const custom: Record<string, string> = {};
    const remaining: string[] = [];
    const tokens: string[] = [];

    // Fields that just capture their raw value verbatim (no enum validation) — folded into
    // a lookup to keep this loop's complexity in check as more facets are added.
    const simpleFields = new Map<string, (v: string) => void>([
      ["author", (v) => (author = v)],
      ["genre", (v) => (genre = v)],
      ["publisher", (v) => (publisher = v)],
      ["language", (v) => (language = v)],
      ["original_language", (v) => (originalLanguage = v)],
      ["form", (v) => (form = v)],
      ["country", (v) => (country = v)],
      ["year", (v) => (year = v)],
      ["subject", (v) => (subject = v)],
      ["location", (v) => (location = v)],
    ]);

    for (const part of parts) {
      const colon = part.indexOf(":");
      if (colon === -1) {
        remaining.push(part);
        continue;
      }
      const key = part.slice(0, colon).toLowerCase();
      const rawVal = part.slice(colon + 1);
      const val = rawVal.replace(/^"|"$/g, "").toLowerCase();
      if (key === "status" && STATUS_VALUES.has(val as ReadStatus)) {
        status = val as ReadStatus;
        tokens.push(part.toLowerCase());
      } else if (key === "owning" && OWNING_VALUES.has(val as OwningStatus)) {
        owning = val as OwningStatus;
        tokens.push(part.toLowerCase());
      } else if (key === "series" && val) {
        series = val;
        tokens.push(part.toLowerCase());
      } else if (key === "award" && val) {
        award = val;
        tokens.push(part.toLowerCase());
      } else if (key === "missing" && val in MISSING_VALUES) {
        missing = val as MissingFacet;
        tokens.push(part.toLowerCase());
      } else if (simpleFields.has(key) && val) {
        simpleFields.get(key)!(val);
        tokens.push(part);
      } else if (customSlugMap.value.has(key) && val) {
        custom[key] = val;
        tokens.push(part);
      } else if (!knownKeys.value.has(key)) {
        remaining.push(part);
      }
      // Known key with no/invalid value (in-progress token like "status:") — silently ignored
    }

    return {
      status,
      owning,
      series,
      award,
      author,
      genre,
      publisher,
      language,
      original_language: originalLanguage,
      form,
      country,
      year,
      subject,
      location,
      missing,
      custom,
      text: remaining.join(" ").toLowerCase(),
      tokens,
    };
  });

  function removeToken(token: string) {
    const lower = token.toLowerCase();
    search.value = tokenize(search.value.trim())
      .filter((p) => p.toLowerCase() !== lower)
      .join(" ");
  }

  // Pure filter — no sort. The series grouping sorts within groups by ordinal.
  const baseFiltered = computed<Book[]>(() => {
    const {
      status,
      owning,
      series,
      award,
      author,
      genre,
      publisher,
      language,
      original_language: originalLanguage,
      form,
      country,
      year,
      subject,
      location,
      missing,
      custom,
      text,
    } = parsedSearch.value;
    let list = books.value;

    if (onlyOwned?.value) {
      list = list.filter((b) => b.owning_status === "owned");
    }
    if (status) {
      list = list.filter((b) => statusOf(b) === status);
    }
    if (owning) {
      list = list.filter((b) => b.owning_status === owning);
    }
    if (series) {
      list = list.filter((b) => b.series_name?.toLowerCase().includes(series));
    }
    if (award) {
      list = list.filter(
        (b) =>
          b.awards?.some((a) => a.toLowerCase().includes(award)) ||
          b.nominations?.some((n) => n.toLowerCase().includes(award)),
      );
    }
    if (author) {
      list = list.filter((b) =>
        authorNames(b).some((n) => n.toLowerCase().includes(author)),
      );
    }
    if (genre) {
      list = list.filter((b) =>
        b.genres?.some((g) => g.toLowerCase().includes(genre)),
      );
    }
    if (publisher) {
      list = list.filter((b) => b.publisher?.toLowerCase().includes(publisher));
    }
    if (language) {
      list = list.filter((b) => b.language?.toLowerCase().includes(language));
    }
    if (originalLanguage) {
      list = list.filter((b) =>
        b.language_of_work?.toLowerCase().includes(originalLanguage),
      );
    }
    if (form) {
      list = list.filter((b) => b.form_of_work?.toLowerCase().includes(form));
    }
    if (country) {
      list = list.filter((b) =>
        b.countries_of_origin?.some((c) => c.toLowerCase().includes(country)),
      );
    }
    if (year) {
      list = list.filter((b) =>
        b.original_pub_date?.toLowerCase().includes(year),
      );
    }
    if (subject) {
      list = list.filter((b) =>
        b.main_subject?.toLowerCase().includes(subject),
      );
    }
    if (location) {
      list = list.filter((b) =>
        b.narrative_locations?.some((l) => l.toLowerCase().includes(location)),
      );
    }
    if (missing) {
      const isMissing = MISSING_VALUES[missing];
      list = list.filter((b) => isMissing(b));
    }
    for (const [slug, val] of Object.entries(custom)) {
      const def = customSlugMap.value.get(slug);
      if (!def) continue;
      list = list.filter((b) => {
        const raw = bookCustomValue(b, def.id);
        if (!raw) return false;
        return def.type === "tag"
          ? parseTagList(raw).some((tg) => tg.toLowerCase().includes(val))
          : raw.toLowerCase().includes(val);
      });
    }
    if (text) {
      // `review` is on every row already (the work_ratings JOIN), so searching it costs one more
      // string compare per book and no round-trip. It stays in the free-text match rather than
      // getting a `review:` key — you look for a phrase you wrote, not for "has a review".
      list = list.filter(
        (b) =>
          b.title?.toLowerCase().includes(text) ||
          authorNames(b).some((n) => n.toLowerCase().includes(text)) ||
          // `text` is lowercased and `books.isbn` is stored uppercased (`normalizeIsbn`), so
          // this has to lower the haystack too — otherwise an ISBN-10 with an `X` check digit
          // (~1 in 11 of them) is unfindable while the same book's ISBN-13 works.
          b.isbn.toLowerCase().includes(text) ||
          b.review?.toLowerCase().includes(text),
      );
    }

    return list;
  });

  const facetEntries = computed<SuggestionFacet[]>(() => {
    const pool = baseFiltered.value;
    const statusLabel = t("library.filter_status");
    const owningLabel = t("library.filter_owning");
    const authorLabel = t("library.group_author");
    const genreLabel = t("library.group_genre");
    const seriesLabel = t("library.group_series");

    const publisherLabel = t("library.group_publisher");
    const languageLabel = t("library.group_language");
    const originalLanguageLabel = t("library.group_original_language");
    const awardLabel = t("library.filter_awards");
    const formLabel = t("library.group_form");
    const countryLabel = t("library.group_country");
    const subjectLabel = t("library.group_subject");
    const locationLabel = t("library.group_location");

    const entries: SuggestionFacet[] = [];

    // Only suggest statuses that actually exist in the current filtered pool.
    // Driven off STATUS_ORDER so a new status is suggestable the moment it's filterable —
    // a hand-kept second list here is what left `status:dnf` searchable but never offered.
    const presentStatuses = new Set(pool.map((b) => statusOf(b)));
    for (const val of STATUS_ORDER) {
      if (presentStatuses.has(val))
        entries.push({
          kind: "facet",
          token: `status:${val}`,
          icon: "mdi-progress-check",
          label: t(`book.${val}`),
          typeLabel: statusLabel,
        });
    }

    // Same, for owning status
    const presentOwning = new Set(pool.map((b) => b.owning_status));
    for (const val of OWNING_ORDER) {
      if (presentOwning.has(val))
        entries.push({
          kind: "facet",
          token: `owning:${val}`,
          icon: "mdi-bookshelf",
          label: t(`owning.${val}`),
          typeLabel: owningLabel,
        });
    }

    entries.push(...missingFacets(pool, t));

    // Resolve a book's custom-field value entries to their meta in one lookup,
    // avoiding a per-field scan of custom_field_values for every book.
    const metaByDefId = new Map(
      customFieldMetas.value.map((m) => [m.def.id, m]),
    );

    const seen = new Set<string>();
    function pushFacet(
      prefix: string,
      value: string,
      icon: string,
      typeLabel: string,
      label: string = value,
    ) {
      const k = `${prefix}:${value.toLowerCase()}`;
      if (seen.has(k)) return;
      seen.add(k);
      entries.push({
        kind: "facet",
        token: `${prefix}:${quote(value)}`,
        icon,
        label,
        typeLabel,
      });
    }

    for (const b of pool) {
      for (const name of authorNames(b))
        pushFacet("author", name, "mdi-account-outline", authorLabel);
      for (const g of b.genres ?? [])
        pushFacet("genre", g, "mdi-tag-outline", genreLabel);
      if (b.series_name)
        pushFacet("series", b.series_name, "mdi-bookshelf", seriesLabel);
      if (b.publisher)
        pushFacet("publisher", b.publisher, "mdi-domain", publisherLabel);
      if (b.language)
        pushFacet(
          "language",
          b.language,
          "mdi-translate",
          languageLabel,
          langFmt.value(b.language),
        );
      if (b.language_of_work)
        pushFacet(
          "original_language",
          b.language_of_work,
          "mdi-translate-variant",
          originalLanguageLabel,
        );
      for (const a of b.awards ?? [])
        pushFacet("award", a, "mdi-trophy-outline", awardLabel);
      for (const a of b.nominations ?? [])
        pushFacet("award", a, "mdi-trophy-outline", awardLabel);
      if (b.form_of_work)
        pushFacet("form", b.form_of_work, "mdi-text-box-outline", formLabel);
      for (const c of b.countries_of_origin ?? [])
        pushFacet("country", c, "mdi-earth", countryLabel);
      if (b.main_subject)
        pushFacet(
          "subject",
          b.main_subject,
          "mdi-lightbulb-outline",
          subjectLabel,
        );
      for (const loc of b.narrative_locations ?? [])
        pushFacet("location", loc, "mdi-map-marker-outline", locationLabel);

      for (const cf of b.custom_field_values ?? []) {
        if (cf.value == null) continue;
        const meta = metaByDefId.get(cf.field_def_id);
        if (!meta || meta.def.type === "date" || meta.def.type === "integer")
          continue;
        const vals =
          meta.def.type === "tag" ? parseTagList(cf.value) : [cf.value];
        for (const v of vals) {
          const k = `${meta.slug}:${v.toLowerCase()}`;
          if (!seen.has(k)) {
            seen.add(k);
            entries.push({
              kind: "facet",
              token: `${meta.slug}:${quote(v)}`,
              icon: cfIcon(meta.def.type),
              label: v,
              typeLabel: meta.def.name,
            });
          }
        }
      }
    }
    return entries;
  });

  return {
    knownKeys,
    parsedSearch,
    baseFiltered,
    facetEntries,
    removeToken,
  };
}
