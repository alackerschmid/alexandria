<template>
  <section>
    <div
      class="flex flex-col md:flex-row md:justify-between md:items-center gap-3 mb-3.5"
    >
      <div class="flex items-baseline gap-4">
        <h2
          class="font-mono text-[10px] md:text-[11px] tracking-[0.24em] md:tracking-[0.28em] uppercase text-orange-neon"
        >
          {{ $t("admin.chart.title") }}
        </h2>
        <span class="hidden md:inline font-mono text-[11px] text-text-secondary">
          {{ summary }}
        </span>
      </div>
      <div class="flex items-center justify-between md:justify-end gap-6">
        <div class="hidden md:flex items-center gap-4">
          <span
            v-for="p in USAGE_PROVIDERS"
            :key="p"
            class="flex items-center gap-1.5"
          >
            <span class="w-2.5 h-2.5" :class="PROVIDER_BG[p]" />
            <span class="font-mono text-[10px] text-text-secondary">{{ p }}</span>
            <span class="font-mono text-[10px] text-text-primary">{{
              totals[p].toLocaleString($i18n.locale)
            }}</span>
          </span>
        </div>
        <div class="flex border border-charcoal-border">
          <button
            v-for="(opt, i) in RANGE_OPTIONS"
            :key="opt.hours"
            type="button"
            class="px-3 py-1.5 md:px-4 md:py-1.75 font-mono text-[10px] tracking-[0.14em] uppercase transition-colors"
            :class="[
              i > 0 ? 'border-l border-charcoal-border' : '',
              opt.hours === hours
                ? 'bg-charcoal-light text-text-primary'
                : 'text-text-secondary hover:text-text-primary',
            ]"
            @click="emit('update:hours', opt.hours)"
          >
            {{ opt.label }}
          </button>
        </div>
      </div>
    </div>

    <div class="border border-charcoal-border px-3 py-3.5 md:px-5 md:py-4.5">
      <div
        v-if="max === 0"
        class="py-8 md:py-12 text-center"
        data-testid="usage-empty"
      >
        <p class="font-mono text-[13px] md:text-sm text-text-primary mb-2">
          {{ $t("admin.chart.empty_title") }}
        </p>
        <p class="text-xs text-text-secondary">
          {{ $t("admin.chart.empty_body") }}
        </p>
      </div>

      <template v-else>
        <!-- Hand-rolled stacked bars, same approach as the home dashboard's breakdown bars —
             the app ships no charting library and one chart doesn't justify adding one. Empty
             hours keep their slot so a gap in activity stays visible. -->
        <div
          class="flex items-end gap-px md:gap-0.5 h-24 md:h-[150px] justify-between"
        >
          <div
            v-for="col in columns"
            :key="col.hourStart"
            class="flex-1 min-w-0 max-w-3.5 md:max-w-6.5 h-full bg-search-bg flex flex-col justify-end"
            :title="tooltip(col)"
          >
            <div
              v-for="p in USAGE_PROVIDERS"
              :key="p"
              :class="PROVIDER_BG[p]"
              :style="{ height: `${barPercent(col[p], max)}%` }"
            />
          </div>
        </div>
        <div class="flex justify-between mt-2">
          <span
            v-for="tick in ticks"
            :key="tick.key"
            class="font-mono text-[9px] text-chart-muted"
            >{{ tick.label }}</span
          >
        </div>
        <div
          class="flex md:hidden flex-wrap gap-x-3.5 gap-y-2 mt-2.5 pt-2.5 border-t border-charcoal-border"
        >
          <span
            v-for="p in USAGE_PROVIDERS"
            :key="p"
            class="flex items-center gap-1.5"
          >
            <span class="w-2 h-2" :class="PROVIDER_BG[p]" />
            <span class="font-mono text-[9px] text-text-secondary">{{ p }}</span>
            <span class="font-mono text-[9px] text-text-primary">{{
              totals[p].toLocaleString($i18n.locale)
            }}</span>
          </span>
        </div>
      </template>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { HourColumn } from "@/utils/admin-usage";
import {
  USAGE_PROVIDERS,
  barPercent,
  providerTotals,
} from "@/utils/admin-usage";

const props = defineProps<{
  columns: HourColumn[];
  hours: number;
}>();

const emit = defineEmits<{ "update:hours": [hours: number] }>();

const { t, locale } = useI18n();

/** google_books leads on the accent because it's the one with a cap to watch. */
const PROVIDER_BG: Record<(typeof USAGE_PROVIDERS)[number], string> = {
  google_books: "bg-orange-neon",
  openlibrary: "bg-chart-total",
  wikidata: "bg-chart-muted",
};

const RANGE_OPTIONS = [
  { hours: 24, label: "24h" },
  { hours: 48, label: "48h" },
  { hours: 168, label: "7d" },
];

const TICK_COUNT = 4;

const max = computed(() =>
  props.columns.reduce((m, c) => Math.max(m, c.total), 0),
);
const totals = computed(() => providerTotals(props.columns));

const summary = computed(() => {
  const all = Object.values(totals.value).reduce((a, b) => a + b, 0);
  return t("admin.chart.summary", {
    calls: all.toLocaleString(locale.value),
    peak: max.value,
  });
});

const hourLabel = (ms: number) =>
  new Date(ms).toLocaleTimeString(locale.value, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

/** Evenly spaced labels under the bars; the right-most one is always "now". */
const ticks = computed(() => {
  const cols = props.columns;
  if (!cols.length) return [];
  return Array.from({ length: TICK_COUNT }, (_, i) => {
    const idx = Math.round((i * (cols.length - 1)) / (TICK_COUNT - 1));
    return {
      key: i,
      label:
        i === TICK_COUNT - 1
          ? t("admin.chart.now")
          : props.hours > 48
            ? t("admin.chart.days_ago", {
                days: Math.round((cols.length - 1 - idx) / 24),
              })
            : hourLabel(cols[idx].hourStart),
    };
  });
});

const tooltip = (col: HourColumn) =>
  `${hourLabel(col.hourStart)} · ${col.total} — ` +
  USAGE_PROVIDERS.map((p) => `${p} ${col[p]}`).join(", ");
</script>
