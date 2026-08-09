<template>
  <div class="bg-charcoal min-h-screen flex flex-col">
    <AppHeader />

    <!-- Top band -->
    <div class="shrink-0 w-full max-w-300 mx-auto px-6 md:px-10 pt-5 md:pt-8 pb-3">
      <p
        class="font-mono text-[9px] tracking-[0.3em] uppercase text-orange-neon mb-4"
      >
        {{ $t("stats.kicker") }}
      </p>
      <h1
        class="font-heading font-bold text-[2.2rem] md:text-[2.75rem] leading-[1.02] tracking-[-0.02em] text-text-primary mb-2"
      >
        {{ headline }}
      </h1>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <p
          v-if="stats"
          class="font-mono text-[10px] md:text-[11px] tracking-[0.05em] text-text-secondary"
        >
          {{ metaLine }}
        </p>
        <!-- ml-auto so the pill stays right-aligned even before the meta line has a payload
             to render from — justify-between alone would park it on the left. -->
        <AppSegmented
          v-model="scope"
          class="ml-auto"
          :options="scopeOptions"
          variant="highlight"
          size="sm"
          :aria-label="$t('stats.scope_label')"
        />
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex-1 flex items-center justify-center py-20">
      <v-progress-circular indeterminate color="primary" size="24" width="2" />
    </div>

    <!-- Load error, but only when there is nothing to fall back on. A failed *refetch* keeps the
         numbers it already has and says so through the toast; a failed first load used to render
         all three branches false, leaving an empty page under a headline claiming zero books —
         strictly less than the genuine empty state below. -->
    <div
      v-else-if="loadError && !stats"
      class="flex-1 flex flex-col items-center justify-center gap-4 px-6 py-20"
    >
      <p class="text-sm text-text-secondary text-center">
        {{ $t("stats.load_failed") }}
      </p>
      <button
        type="button"
        class="text-xs font-bold tracking-[0.25em] uppercase border-b border-text-primary pb-0.5 text-text-primary hover:opacity-70 transition-opacity cursor-pointer"
        @click="load"
      >
        {{ $t("stats.retry") }}
      </button>
    </div>

    <!-- Empty state. Two of them: a genuinely empty library, and one whose books are all
         outside the current scope — a Goodreads import writes every row at owning_status
         "unknown", so "nothing to measure" would be plainly false there. -->
    <div
      v-else-if="stats && stats.total === 0"
      class="flex-1 flex flex-col items-center justify-center gap-3 px-6 py-20"
    >
      <!-- Also gated on the scope: after a failed refetch the payload can lag the pill, and a
           "Measure all books" button while the pill already reads All would be inert. -->
      <template v-if="unscopedCount > 0 && scope === 'owned'">
        <p class="font-heading font-bold text-3xl text-text-primary text-center">
          {{ $t("stats.empty_scoped_heading") }}
        </p>
        <p class="text-sm text-text-secondary text-center max-w-sm">
          {{ $t("stats.empty_scoped_body", { count: unscopedCount }) }}
        </p>
        <AppButton class="mt-2" @click="scope = 'all'">
          {{ $t("stats.empty_scoped_action") }}
        </AppButton>
      </template>
      <template v-else>
        <p class="font-heading font-bold text-3xl text-text-primary text-center">
          {{ $t("stats.empty_heading") }}
        </p>
        <p class="text-sm text-text-secondary text-center max-w-xs">
          {{ $t("stats.empty_body") }}
        </p>
      </template>
    </div>

    <!-- Content. pb-28 on mobile clears the fixed bottom tab bar. -->
    <div
      v-else-if="stats"
      class="flex-1 w-full max-w-300 mx-auto px-6 md:px-10 pb-28 md:pb-10 flex flex-col gap-5"
    >
      <!-- Stat tiles -->
      <div
        class="grid grid-cols-2 md:grid-cols-4 border-t border-l border-charcoal-border"
      >
        <StatTile
          v-for="tile in tiles"
          :key="tile.key"
          :label="tile.label"
          :value="tile.value"
          :unit="tile.unit"
          :coverage="tile.coverage"
          :color="tile.color"
        />
      </div>

      <!-- Ratings + decades/length -->
      <div class="flex flex-col md:flex-row gap-5 md:gap-9">
        <section
          class="w-full md:w-100 md:flex-none bg-charcoal-light border border-charcoal-border p-5 md:px-6.5"
        >
          <header class="flex justify-between items-baseline gap-3 mb-4.5">
            <h2 class="micro-label !text-[9px] !tracking-[0.3em] !text-orange-neon !opacity-100">
              {{ $t("stats.ratings_title") }}
            </h2>
            <span
              v-if="stats.avgRating != null"
              class="font-mono text-[10px] text-text-secondary"
              >{{ $t("stats.avg_short", { value: stats.avgRating }) }}</span
            >
          </header>

          <p
            v-if="ratings.ratedCount === 0"
            class="text-sm text-text-secondary leading-relaxed"
          >
            {{ $t("stats.ratings_empty") }}
          </p>
          <div v-else class="flex flex-col gap-3.5">
            <!-- Not linked: there is no `rating:` search key, and the library's rating facet is
                 a grouping dimension rather than a filter. A row that looked clickable and
                 landed on an unfiltered library would be worse than one that doesn't. -->
            <StatBarRow
              v-for="rowData in ratings.rows"
              :key="rowData.rating"
              :width="rowData.width"
              :color="ratingColor(rowData.rating)"
              :tail="$t('stats.rating_tail', { count: rowData.count, pct: rowData.pct })"
              label-class="shrink-0"
            >
              <template #label>
                <RatingStars :rating="rowData.rating" size="sm" />
              </template>
            </StatBarRow>
          </div>

          <p
            class="mt-4.5 pt-3.5 border-t border-charcoal-border text-[13px] text-text-secondary leading-relaxed"
          >
            <template v-if="stats.genreRatings.best">
              {{ $t("stats.rating_best") }}
              <span class="text-text-primary"
                >{{ stats.genreRatings.best.label }},
                {{ stats.genreRatings.best.avg }}</span
              >.
            </template>
            <template v-if="stats.genreRatings.worst">
              {{ $t("stats.rating_worst") }}
              <span class="text-text-primary"
                >{{ stats.genreRatings.worst.label }},
                {{ stats.genreRatings.worst.avg }}</span
              >.
            </template>
            {{ $t("stats.rating_unrated", { count: stats.catalogueGaps.readUnrated }) }}
            <template v-if="ratings.zeroCount > 0">
              {{ $t("stats.rating_zero", { count: ratings.zeroCount }) }}
            </template>
          </p>
        </section>

        <!-- justify-between on desktop: at ten rating rows the left card is much taller than
             decades + length, and letting the slack fall between the two blocks reads as
             spacing rather than as a hole at the bottom of the column. -->
        <div class="flex-1 min-w-0 flex flex-col md:justify-between">
          <header class="flex justify-between items-baseline gap-3 mb-4.5">
            <h2 class="micro-label !text-[9px] !tracking-[0.3em] !text-orange-neon !opacity-100">
              {{ $t("stats.decades_title") }}
            </h2>
            <span class="font-mono text-[10px] text-text-secondary">{{
              $t("stats.no_year_count", { count: stats.catalogueGaps.noYear })
            }}</span>
          </header>
          <DecadeHistogram
            v-if="decades.length"
            :bars="decades"
            :ramp="ramp"
            :compact="isMobile"
          />
          <p v-else class="text-sm text-text-secondary">
            {{ $t("stats.decades_empty") }}
          </p>

          <section class="mt-6.5 pt-5 border-t border-charcoal-border">
            <header class="flex justify-between items-baseline gap-3 mb-4">
              <h2 class="micro-label !text-[9px] !tracking-[0.3em] !text-orange-neon !opacity-100">
                {{ $t("stats.length_title") }}
              </h2>
              <span class="font-mono text-[10px] text-text-secondary">{{
                $t("stats.total_pages", { count: formatCount(stats.totalPages) })
              }}</span>
            </header>
            <LengthDistribution v-if="stats.pagesKnownCount > 0" :segments="lengthSegments" />
            <p v-else class="text-sm text-text-secondary">
              {{ $t("stats.length_empty") }}
            </p>
          </section>
        </div>
      </div>

      <!-- Breakdown + origins -->
      <div
        class="flex flex-col md:flex-row gap-5 md:gap-9 pt-5 border-t border-charcoal-border"
      >
        <section class="flex-1 min-w-0">
          <header
            class="flex flex-col md:flex-row md:justify-between md:items-center gap-3 mb-5"
          >
            <h2 class="micro-label !text-[9px] !tracking-[0.3em] !text-orange-neon !opacity-100">
              {{ $t("stats.breakdown_title") }}
            </h2>
            <AppSelect
              v-model="dimension"
              :options="dimensionOptions"
              :min-width="150"
              :aria-label="$t('stats.breakdown_dimension')"
            />
          </header>

          <div v-if="breakdownRows.length" class="flex flex-col gap-3.5">
            <StatBarRow
              v-for="rowData in breakdownRows"
              :key="rowData.label"
              :label="rowData.label"
              :tail="rowData.tail"
              :width="rowData.width"
              :color="rowData.color"
              :to="rowData.to"
            />
          </div>
          <p v-else class="text-sm text-text-secondary">
            {{ $t("stats.breakdown_empty") }}
          </p>

          <button
            v-if="breakdownAll.length > COLLAPSED_ROWS"
            type="button"
            class="w-full flex justify-between items-center mt-4.5 pt-3.5 border-t border-charcoal-border cursor-pointer"
            @click="expanded = !expanded"
          >
            <span
              class="font-mono text-[10px] tracking-[0.14em] text-text-secondary"
              >{{ shownCaption }}</span
            >
            <span
              class="font-mono text-[10px] tracking-[0.14em] uppercase text-orange-neon"
              >{{
                expanded
                  ? $t("stats.collapse")
                  : $t("stats.show_all", { count: breakdownAll.length })
              }}</span
            >
          </button>

          <p
            v-if="topAuthorsLine"
            class="mt-5 p-4 md:px-5 bg-charcoal-light border border-charcoal-border text-[13px] text-text-secondary leading-relaxed"
          >
            {{ topAuthorsLine }}
          </p>
        </section>

        <section
          class="w-full md:w-82.5 md:flex-none md:border-l md:border-charcoal-border md:pl-9 pt-5 md:pt-0 border-t border-charcoal-border md:border-t-0"
        >
          <header class="flex justify-between items-baseline gap-3 mb-5">
            <h2 class="micro-label !text-[9px] !tracking-[0.3em] !text-orange-neon !opacity-100">
              {{ $t("stats.origins_title") }}
            </h2>
            <span class="font-mono text-[10px] text-text-secondary">{{
              $t(
                "stats.language_count",
                { count: stats.languageCount },
                stats.languageCount,
              )
            }}</span>
          </header>

          <div v-if="languageRows.length" class="flex flex-col gap-3.5">
            <StatBarRow
              v-for="rowData in languageRows"
              :key="rowData.label"
              :label="rowData.label"
              :tail="rowData.tail"
              :width="rowData.width"
              :color="rowData.color"
              :to="rowData.to"
            />
          </div>
          <p v-else class="text-sm text-text-secondary">
            {{ $t("stats.origins_empty") }}
          </p>

          <div
            v-if="stats.countries.length"
            class="mt-5.5 pt-4.5 border-t border-charcoal-border"
          >
            <h3 class="micro-label !text-[9px] !tracking-[0.2em] !opacity-100 mb-3.5">
              {{ $t("stats.countries_title") }}
            </h3>
            <div class="flex flex-col gap-2.5">
              <router-link
                v-for="c in topCountries"
                :key="c.label"
                :to="{ name: 'library', query: { q: `country:${quoteToken(c.label)}` } }"
                class="flex items-baseline justify-between gap-3 hover:opacity-70 transition-opacity"
              >
                <span class="text-xs text-text-primary min-w-0 truncate">{{
                  c.label
                }}</span>
                <span class="font-mono text-[11px] text-text-secondary flex-none">{{
                  c.count.toLocaleString()
                }}</span>
              </router-link>
              <div
                v-if="moreCountries > 0"
                class="flex items-baseline justify-between gap-3"
              >
                <span class="text-xs text-text-secondary">{{
                  $t(
                    "stats.countries_more",
                    { count: moreCountries },
                    moreCountries,
                  )
                }}</span>
              </div>
            </div>
          </div>

          <p
            v-if="stats.translationRatio"
            class="mt-4.5 text-xs text-text-secondary leading-relaxed"
          >
            {{
              $t("stats.translations_line", {
                count: stats.translationRatio.translatedCount,
                known: stats.translationRatio.knownCount,
                pct: stats.translationRatio.pct,
              })
            }}
          </p>
        </section>
      </div>

      <!-- Series + gaps -->
      <div
        class="flex flex-col md:flex-row gap-5 md:gap-9 pt-5 border-t border-charcoal-border"
      >
        <section class="flex-1 min-w-0">
          <header class="flex justify-between items-baseline gap-3 mb-1.5">
            <h2 class="micro-label !text-[9px] !tracking-[0.3em] !text-orange-neon !opacity-100">
              {{ $t("stats.series_title") }}
            </h2>
            <span
              v-if="scope === 'owned' && !seriesFailed"
              class="font-mono text-[10px] text-text-secondary text-right"
              >{{
                $t("stats.series_meta", {
                  tracked: series.tracked,
                  missing: series.missingTotal,
                })
              }}</span
            >
          </header>

          <!-- Completeness is owned-only by definition — "which volumes are missing from your
               shelf" is a question about possession, and `/api/series` answers it against its
               own ownership gate rather than this page's scope. Rather than show an
               owned-derived figure beside all-scope numbers, the block says why it's absent. -->
          <p v-if="scope !== 'owned'" class="text-sm text-text-secondary pt-2">
            {{ $t("stats.series_owned_only") }}
          </p>
          <p v-else-if="seriesFailed" class="text-sm text-text-secondary pt-2">
            {{ $t("stats.series_unavailable") }}
          </p>
          <SeriesCompleteness
            v-else-if="series.rows.length"
            :rows="visibleSeries"
            :ramp="ramp"
          />
          <p v-else class="text-sm text-text-secondary pt-2">
            {{ $t("stats.series_empty") }}
          </p>

          <button
            v-if="scope === 'owned' && series.rows.length > SERIES_ROWS"
            type="button"
            class="mt-3.5 font-mono text-[10px] tracking-[0.14em] uppercase text-orange-neon cursor-pointer"
            @click="allSeries = !allSeries"
          >
            {{
              allSeries
                ? $t("stats.collapse")
                : $t("stats.series_show_all", { count: series.rows.length })
            }}
          </button>
        </section>

        <section
          class="w-full md:w-82.5 md:flex-none md:border-l md:border-charcoal-border md:pl-9 pt-5 md:pt-0 border-t border-charcoal-border md:border-t-0"
        >
          <h2
            class="micro-label !text-[9px] !tracking-[0.3em] !text-orange-neon !opacity-100 mb-1.5"
          >
            {{ $t("stats.gaps_title") }}
          </h2>
          <p class="text-xs text-text-secondary leading-relaxed mb-2.5">
            {{ $t("stats.gaps_body") }}
          </p>
          <CatalogueGaps :gaps="stats.catalogueGaps" />
        </section>
      </div>
    </div>

    <AppFooter class="mt-auto" />

    <AppToast
      v-model="errorToast"
      :message="errorMessage"
      type="error"
      :timeout="4000"
    />
  </div>
</template>

<script lang="ts" setup>
import { computed, onMounted, ref, watch } from "vue";
import { storeToRefs } from "pinia";
import { useI18n } from "vue-i18n";
import { useDisplay } from "vuetify";
import { useLocaleStore } from "@/stores/locale";
import { useThemeStore } from "@/stores/theme";
import { useFieldDefsStore } from "@/stores/fieldDefs";
import { useStatsDefaultsStore } from "@/stores/statsDefaults";
import { useLibraryDefaultsStore } from "@/stores/libraryDefaults";
import AppHeader from "@/components/AppHeader.vue";
import AppFooter from "@/components/AppFooter.vue";
import AppButton from "@/components/AppButton.vue";
import AppSegmented from "@/components/AppSegmented.vue";
import AppSelect from "@/components/AppSelect.vue";
import AppToast from "@/components/AppToast.vue";
import RatingStars from "@/components/RatingStars.vue";
import StatTile from "@/components/stats/StatTile.vue";
import StatBarRow from "@/components/stats/StatBarRow.vue";
import DecadeHistogram from "@/components/stats/DecadeHistogram.vue";
import LengthDistribution from "@/components/stats/LengthDistribution.vue";
import SeriesCompleteness from "@/components/stats/SeriesCompleteness.vue";
import CatalogueGaps from "@/components/stats/CatalogueGaps.vue";
import { useApi } from "@/composables/useApi";
import { useToast } from "@/composables/useToast";
import { useGroupDimensions } from "@/composables/useGroupDimensions";
import type { SeriesMemberships } from "@/composables/useShelfGroups";
import { summarizeSeries } from "@/utils/series-completeness";
import { languageDisplayFormatter } from "@/utils/language";
import {
  buildBreakdownRows,
  buildDecadeHistogram,
  buildLengthSegments,
  buildRatingHistogram,
  colorRamp,
  countOutsideScope,
  dimensionTotal,
  formatCount,
  getBreakdown,
  normalizeStats,
  pctOf,
  quoteToken,
  rampColor,
} from "@/utils/stats-view";
import { createFetchSequencer } from "@/utils/fetch-seq";
import { STATS_SCOPES, type CollectionStats } from "@/types/stats";
import type { GroupBy } from "@/types/library";

/** Rows shown before the breakdown's "show all" is used. */
const COLLAPSED_ROWS = 7;
/** Series rows shown before "all N series". */
const SERIES_ROWS = 6;

const { t } = useI18n();
const { mdAndDown } = useDisplay();
const localeStore = useLocaleStore();
const themeStore = useThemeStore();
const fieldDefsStore = useFieldDefsStore();
const { scope } = storeToRefs(useStatsDefaultsStore());
const libraryDefaults = useLibraryDefaultsStore();
const { apiFetch } = useApi();
const { dimensionOptions } = useGroupDimensions();
const { visible: errorToast, message: errorMessage, showToast } = useToast();

const stats = ref<CollectionStats | null>(null);
const memberships = ref<SeriesMemberships>({});
const loading = ref(false);
const loadError = ref(false);
/** `/api/series` answered with an error. Distinct from "no series tracked": one is a fact about
 *  the library, the other is the absence of one, and the tile must not state the first. */
const seriesFailed = ref(false);
const dimension = ref<GroupBy>("genre");
const expanded = ref(false);
const allSeries = ref(false);

const isMobile = computed(() => mdAndDown.value);
const ramp = computed(() => colorRamp(themeStore.isDark));
const langFmt = computed(() => languageDisplayFormatter(localeStore.locale));

const scopeOptions = computed(() =>
  STATS_SCOPES.map((value) => ({ value, label: t(`stats.scope_${value}`) })),
);

const unscopedCount = computed(() => countOutsideScope(stats.value));

// ── Header ────────────────────────────────────────────────────────────────────

// The band sits outside the loading/error region, so it renders before there is a payload. It
// says nothing about size until it has one — `?? 0` here asserted "0 books" through every load
// and permanently after a failed one.
const headline = computed(() =>
  stats.value
    ? t("stats.headline", { count: stats.value.total.toLocaleString() })
    : t("stats.headline_pending"),
);

// Includes `dnf`, which the other status summaries in the app also carry — leaving it out makes
// the parts fail to add up to the total for anyone who has ever abandoned a book.
const metaLine = computed(() => {
  const s = stats.value;
  if (!s) return "";
  return t("stats.meta", {
    total: s.total.toLocaleString(),
    read: s.byStatus.read.toLocaleString(),
    reading: s.byStatus.reading.toLocaleString(),
    unread: s.byStatus.unread.toLocaleString(),
    dnf: s.byStatus.dnf.toLocaleString(),
  });
});

// ── Tiles ─────────────────────────────────────────────────────────────────────

/**
 * The four headline figures.
 *
 * `coverage` is how much of the collection each figure could be computed from, not a share of
 * some invented maximum — "average length, across the 55% of books whose page count we know".
 * Average rating and series completeness are already true ratios, so theirs are the real thing.
 */
const tiles = computed(() => {
  const s = stats.value;
  if (!s) return [];
  return [
    {
      key: "rating",
      label: t("stats.tile_rating"),
      value: s.avgRating != null ? String(s.avgRating) : "—",
      unit: t("stats.tile_rating_unit", { count: s.ratedCount }),
      coverage: s.avgRating != null ? `${s.avgRating * 10}%` : "0%",
      color: "rgb(var(--v-theme-primary))",
    },
    {
      key: "year",
      label: t("stats.tile_year"),
      value: s.medianYear != null ? String(s.medianYear) : "—",
      unit: t("stats.tile_year_unit", { count: s.catalogueGaps.noYear }),
      coverage: `${pctOf(s.yearKnownCount, s.total)}%`,
      color: rampColor(ramp.value, 1),
    },
    {
      key: "pages",
      label: t("stats.tile_pages"),
      value: formatCount(s.avgPages),
      unit: t("stats.tile_pages_unit"),
      coverage: `${pctOf(s.pagesKnownCount, s.total)}%`,
      color: rampColor(ramp.value, 2),
    },
    // Series completeness is owned-only (see the series block), so under a wider scope this
    // slot would carry an owned-derived figure among all-scope ones. It shows how much of the
    // wider set is actually on the shelf instead — the question the scope switch raises, and a
    // ratio in the same shape, so the tile grid keeps its four cells either way.
    scope.value === "owned"
      ? {
          key: "series",
          label: t("stats.tile_series"),
          // An unreachable `/api/series` is an unknown, not a zero — the same rule `formatCount`
          // exists for. "0 of 0, 0% coverage" would state a measurement nobody took.
          value: seriesFailed.value ? "—" : String(series.value.complete),
          unit: seriesFailed.value
            ? ""
            : t("stats.tile_series_unit", { count: series.value.tracked }),
          coverage: seriesFailed.value
            ? "0%"
            : `${pctOf(series.value.complete, series.value.tracked)}%`,
          color: rampColor(ramp.value, 3),
        }
      : {
          key: "owned",
          label: t("stats.tile_owned"),
          value: `${pctOf(ownedInScope.value, s.total)}%`,
          unit: t("stats.tile_owned_unit", {
            count: ownedInScope.value.toLocaleString(),
            total: s.total.toLocaleString(),
          }),
          coverage: `${pctOf(ownedInScope.value, s.total)}%`,
          color: rampColor(ramp.value, 3),
        },
  ];
});

/** Books in the current scope the user actually holds — the `owned` gate, counted in JS off the
 *  owning-status block rather than re-asked of the server. */
const ownedInScope = computed(
  () =>
    (stats.value?.owningStatus.owned ?? 0) +
    (stats.value?.owningStatus.lent_out ?? 0),
);

// ── Blocks ────────────────────────────────────────────────────────────────────

const ratings = computed(() =>
  buildRatingHistogram(stats.value?.ratingDistribution ?? []),
);

// The stars carry the accent already; a per-row ramp would fight them for meaning.
const ratingColor = (rating: number) =>
  rating >= 7
    ? "rgb(var(--v-theme-primary))"
    : rating >= 4
      ? rampColor(ramp.value, 1)
      : rampColor(ramp.value, 3);

const decades = computed(() =>
  buildDecadeHistogram(stats.value?.decades ?? []),
);

const lengthSegments = computed(() =>
  buildLengthSegments(stats.value?.pageBuckets ?? [], ramp.value),
);

// Same shared preference the library shelves and home's gaps row read — see `summarizeSeries`.
const series = computed(() =>
  summarizeSeries(memberships.value, { mainOnly: libraryDefaults.mainOnly }),
);

const visibleSeries = computed(() =>
  allSeries.value ? series.value.rows : series.value.rows.slice(0, SERIES_ROWS),
);

// ── Collection breakdown ──────────────────────────────────────────────────────

// Which search key each dimension deep-links through. Absent = no equivalent facet, so those
// rows render as plain bars rather than as links that would land on an unfiltered library.
const DIMENSION_TOKENS: Partial<Record<string, string>> = {
  genre: "genre",
  author: "author",
  publisher: "publisher",
  series: "series",
  form: "form",
  country: "country",
  subject: "subject",
  status: "status",
  owning: "owning",
};

const breakdownAll = computed(() => {
  const s = stats.value;
  if (!s) return [];
  return getBreakdown(dimension.value, s, {
    language: langFmt.value,
    status: (key) =>
      dimension.value === "owning" ? t(`owning.${key}`) : t(`book.${key}`),
  });
});

const breakdownRows = computed(() => {
  const s = stats.value;
  if (!s) return [];
  return buildBreakdownRows(breakdownAll.value, {
    ramp: ramp.value,
    total: s.total,
    searchKey: DIMENSION_TOKENS[dimension.value],
    limit: expanded.value ? undefined : COLLAPSED_ROWS,
  }).map((row) => ({
    ...row,
    // Share of the collection, not of the dimension: "Science fiction, 17% of the shelf".
    tail: t("stats.breakdown_tail", {
      count: row.count.toLocaleString(),
      pct: row.pct,
    }),
    to: row.token
      ? { name: "library", query: { q: row.token } }
      : undefined,
  }));
});

/**
 * "7 of 15 shown", against the true distinct total where one is knowable.
 *
 * Every breakdown list is capped at 15 server-side, so `breakdownAll.length` is a page size and
 * not a total — a caption claiming "show all 15" when the user has 214 authors would be wrong.
 * `dimensionTotal` returns the real count for the four dimensions that ship one, and null
 * otherwise, in which case the caption falls back to what it can actually vouch for.
 */
const shownCaption = computed(() => {
  const shown = Math.min(breakdownRows.value.length, breakdownAll.value.length);
  const total = stats.value ? dimensionTotal(dimension.value, stats.value) : null;
  return total != null && total > breakdownAll.value.length
    ? t("stats.shown_of_total", { shown, total })
    : t("stats.shown_of", { shown, total: breakdownAll.value.length });
});

const languageRows = computed(() => {
  const s = stats.value;
  if (!s) return [];
  return buildBreakdownRows(
    // Linked by ISO code, not by the display name the bar is labelled with.
    s.languages.map((l) => ({
      label: langFmt.value(l.code),
      count: l.count,
      tokenValue: l.code,
    })),
    { ramp: ramp.value, total: s.total, searchKey: "language", limit: 6 },
  ).map((row) => ({
    ...row,
    tail: row.count.toLocaleString(),
    to: { name: "library", query: { q: row.token! } },
  }));
});

const topCountries = computed(() => stats.value?.countries.slice(0, 4) ?? []);

const moreCountries = computed(() =>
  Math.max(0, (stats.value?.countryCount ?? 0) - topCountries.value.length),
);

/**
 * The top-authors sentence.
 *
 * Deliberately states a book count and not a share of the shelf: `topAuthors` counts author
 * *credits*, incrementing every credited author of a co-authored book, so summing five of them
 * can exceed the number of distinct books they account for — and a "% of your shelf" derived
 * from that sum would be wrong in exactly the libraries that read most closely.
 */
const topAuthorsLine = computed(() => {
  const top = stats.value?.topAuthors.slice(0, 5) ?? [];
  if (top.length < 3) return "";
  return t("stats.top_authors_line", {
    names: top.map((a) => a.label).join(", "),
    count: top.reduce((sum, a) => sum + a.count, 0),
  });
});

// ── Data ──────────────────────────────────────────────────────────────────────

// Sequenced: a scope or locale switch can re-trigger load() while the previous request is
// still in flight, and the two scopes are not equally heavy — `scope=all` scans strictly more
// rows, so without the guard the stale request is systematically the one that lands last and
// overwrites the fresh one (all-scope numbers under an OWNED pill, or vice versa).
const nextLoad = createFetchSequencer();

const load = async () => {
  const isCurrent = nextLoad();
  const locale = localeStore.locale;
  // Owned by load() rather than by onMounted, so a watcher-triggered refetch also shows the
  // spinner instead of leaving the previous scope's numbers under the already-moved pill.
  loading.value = true;
  try {
    // Both are locale-joined server-side (series names), so they refetch together. `/api/series`
    // takes no scope — series completeness is owned-only, see the series block.
    const [statsRes, seriesRes] = await Promise.all([
      apiFetch(`/api/stats?locale=${locale}&scope=${scope.value}`),
      apiFetch(`/api/series?locale=${locale}`),
    ]);
    // Status before body: an upstream HTML error page (a Cloudflare 502 or 1101) makes `json()`
    // throw a parse error, which would otherwise mask the status it came with.
    if (!statsRes.ok) throw new Error(`GET /api/stats ${statsRes.status}`);
    const statsBody = await statsRes.json();
    // Series completeness is a secondary block: a failure there must not blank the page. It
    // degrades to "couldn't load" and not to "no series tracked" — the second is a claim about
    // the library, and the tile states it as a measured 0 of 0.
    const seriesBody = seriesRes.ok
      ? await seriesRes.json().catch(() => null)
      : null;
    if (!isCurrent()) return; // superseded — a newer load() owns the page now
    stats.value = normalizeStats(statsBody);
    loadError.value = false;
    seriesFailed.value = seriesBody == null;
    if (seriesBody) memberships.value = seriesBody;
  } catch (err) {
    if (!isCurrent()) return;
    // Raw `err.message` here was untranslated and often unreadable — offline gives "Failed to
    // fetch", an HTML error body gives a JSON parse error quoting the doctype.
    console.error("[stats] load failed", err);
    loadError.value = true;
    showToast(t("stats.load_failed"), "error");
  } finally {
    if (isCurrent()) loading.value = false;
  }
};

watch([() => localeStore.locale, scope], () => load());

// Collapse back when the dimension or the scope changes — "show all 12" for genres shouldn't
// leave a different, longer list pre-expanded.
watch([dimension, scope], () => {
  expanded.value = false;
});

onMounted(() => Promise.all([load(), fieldDefsStore.load()]));
</script>
