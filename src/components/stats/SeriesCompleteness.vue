<template>
  <div>
    <router-link
      v-for="row in rows"
      :key="row.seriesId"
      :to="{ name: 'series', params: { id: row.seriesId } }"
      class="flex items-center gap-3.5 md:gap-4 py-3.5 border-b border-charcoal-border hover:bg-text-primary/[0.02] transition-colors"
    >
      <div
        class="w-6 flex-none text-center font-mono text-xs text-orange-neon"
      >
        {{ row.owned }}
      </div>

      <!-- Desktop puts the track between name and status; mobile stacks it under the name,
           where a 180px track next to a long series title would leave nothing for either. -->
      <div class="flex-1 min-w-0">
        <div class="text-sm text-text-primary truncate">
          {{ row.name ?? $t("stats.series_unnamed") }}
        </div>
        <div class="md:hidden h-[3px] bg-charcoal-border relative mt-1.5">
          <div
            class="absolute left-0 top-0 bottom-0"
            :style="{ width: row.width, background: colorFor(row) }"
          />
        </div>
      </div>

      <div
        class="hidden md:block w-45 flex-none h-[3px] bg-charcoal-border relative"
      >
        <div
          class="absolute left-0 top-0 bottom-0"
          :style="{ width: row.width, background: colorFor(row) }"
        />
      </div>

      <div
        class="w-22 flex-none text-right font-mono text-[10px] tracking-[0.14em] md:tracking-[0.15em] uppercase"
        :class="row.complete ? 'text-orange-neon' : 'text-text-secondary'"
      >
        {{
          row.complete
            ? $t("stats.series_complete")
            : $t("stats.series_missing", { count: row.missing }, row.missing)
        }}
      </div>
    </router-link>
  </div>
</template>

<script lang="ts" setup>
import type { SeriesProgress } from "@/utils/series-completeness";

const props = defineProps<{
  rows: SeriesProgress[];
  ramp: string[];
}>();

// Completion tiers, not ramp stops: these rows are one measure compared across series, so the
// colour should track how close each is to done rather than mark it as a distinct category.
function colorFor(row: SeriesProgress): string {
  if (row.complete) return "rgb(var(--v-theme-primary))";
  const pct = row.owned / row.total;
  return pct >= 0.75 ? props.ramp[1] : pct >= 0.5 ? props.ramp[2] : props.ramp[3];
}
</script>
