<template>
  <div>
    <component
      :is="gap.to ? 'router-link' : 'div'"
      v-for="(gap, i) in gaps"
      :key="gap.key"
      :to="gap.to"
      class="flex items-center justify-between gap-4 py-3 md:py-3"
      :class="[
        i < gaps.length - 1 ? 'border-b border-charcoal-border' : '',
        gap.to
          ? 'cursor-pointer hover:opacity-70 transition-opacity'
          : '',
      ]"
    >
      <span
        class="text-sm min-w-0 truncate"
        :class="gap.to ? 'text-text-primary' : 'text-text-secondary'"
        >{{ gap.label }}</span
      >
      <span class="flex-none font-mono text-[11px] text-text-secondary">
        {{ gap.count.toLocaleString() }}<template v-if="gap.to"> →</template>
      </span>
    </component>
  </div>
</template>

<script lang="ts" setup>
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { RouteLocationRaw } from "vue-router";
import type { CatalogueGaps } from "@/types/stats";

const props = defineProps<{ gaps: CatalogueGaps }>();

const { t } = useI18n();

const libraryQuery = (q: string): RouteLocationRaw => ({
  name: "library",
  query: { q },
});

/**
 * Four of the six rows deep-link into the library through the `missing:` search key; two don't,
 * and deliberately render as plain text rather than as dead links.
 *
 * `enrichmentPending` is a property of the work's Wikidata state, not of the book, and the
 * library has no facet for it. `readUnrated` would need an absent-rating filter, which the
 * rating facet doesn't express. Both are still worth reporting — they're the two gaps that
 * resolve themselves over time rather than by editing a book.
 *
 * **The linked view can list more books than the count says — under the owned scope.** With
 * `/stats` on its default `scope=owned` the gap figures are gated on
 * `owning_status IN ('owned','lent_out')`, while the library lists everything recorded — so a
 * `want` or `unowned` book with no cover is outside the count but inside the link. The superset
 * is the friendlier miss of the two (you see everything that needs fixing rather than a
 * filtered subset), and no single `owning:` value expresses "owned or lent out" to close the
 * gap. Under `scope=all` the figures are ungated and count and link agree (modulo the user
 * having narrowed the library's own ownership scope). Worth revisiting if the search grammar
 * ever grows an owned-or-lent-out facet.
 */
const gaps = computed(() => [
  {
    key: "noGenre",
    label: t("stats.gap_no_genre"),
    count: props.gaps.noGenre,
    to: libraryQuery("missing:genre"),
  },
  {
    key: "noYear",
    label: t("stats.gap_no_year"),
    count: props.gaps.noYear,
    to: libraryQuery("missing:year"),
  },
  {
    key: "noCover",
    label: t("stats.gap_no_cover"),
    count: props.gaps.noCover,
    to: libraryQuery("missing:cover"),
  },
  {
    key: "noPageCount",
    label: t("stats.gap_no_pages"),
    count: props.gaps.noPageCount,
    to: libraryQuery("missing:pages"),
  },
  {
    key: "enrichmentPending",
    label: t("stats.gap_enrichment_pending"),
    count: props.gaps.enrichmentPending,
    to: undefined,
  },
  {
    key: "readUnrated",
    label: t("stats.gap_read_unrated"),
    count: props.gaps.readUnrated,
    to: undefined,
  },
]);
</script>
