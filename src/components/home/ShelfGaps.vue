<template>
  <div>
    <router-link
      v-for="row in rows"
      :key="row.seriesId"
      :to="{ name: 'series', params: { id: row.seriesId } }"
      class="flex items-baseline justify-between gap-4 py-3 border-b border-charcoal-border hover:opacity-70 transition-opacity"
    >
      <span class="text-sm text-text-primary min-w-0 truncate">
        {{ row.name ?? $t("stats.series_unnamed") }}
      </span>
      <span class="flex-none font-mono text-[11px] text-text-secondary">
        {{ $t("home.gaps_missing", { count: row.missing }) }} &rarr;
      </span>
    </router-link>
  </div>
</template>

<script lang="ts" setup>
import type { SeriesProgress } from "@/utils/series-completeness";

// Already filtered to the incomplete ones and ordered most-nearly-complete first by
// `summarizeSeries` — the series you are closest to finishing is the one worth naming.
defineProps<{ rows: SeriesProgress[] }>();
</script>
