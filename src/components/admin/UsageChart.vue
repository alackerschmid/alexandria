<template>
  <section>
    <div
      class="flex flex-col md:flex-row md:justify-between md:items-center gap-3 mb-3.5"
    >
      <div class="flex items-baseline gap-4">
        <SectionHeading :title="$t('admin.chart.title')" />
        <span
          class="hidden md:inline font-mono text-[11px] text-text-secondary"
        >
          {{ summary }}
        </span>
      </div>
      <div class="flex items-center justify-between md:justify-end gap-6">
        <div class="hidden md:flex items-center gap-4">
          <span
            v-for="p in legend"
            :key="p.provider"
            class="flex items-center gap-1.5"
          >
            <span class="w-2.5 h-2.5" :class="p.class" />
            <span class="font-mono text-[10px] text-text-secondary">{{
              p.label
            }}</span>
            <span class="font-mono text-[10px] text-text-primary">{{
              p.total
            }}</span>
          </span>
        </div>
        <!-- highlight, not fill: this is toolbar chrome above a chart, where an accent-filled
             option would shout louder than the data. -->
        <AppSegmented
          :options="rangeOptions"
          :model-value="String(hours)"
          variant="highlight"
          size="sm"
          :aria-label="$t('admin.chart.range')"
          @update:model-value="emit('update:hours', Number($event))"
        />
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
            v-for="bar in bars"
            :key="bar.hourStart"
            class="flex-1 min-w-0 max-w-3.5 md:max-w-6.5 h-full bg-search-bg flex flex-col justify-end"
            :title="bar.title"
          >
            <div
              v-for="seg in bar.segments"
              :key="seg.provider"
              :class="seg.class"
              :style="{ height: `${seg.height}%` }"
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
            v-for="p in legend"
            :key="p.provider"
            class="flex items-center gap-1.5"
          >
            <span class="w-2 h-2" :class="p.class" />
            <span class="font-mono text-[9px] text-text-secondary">{{
              p.label
            }}</span>
            <span class="font-mono text-[9px] text-text-primary">{{
              p.total
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
  USAGE_RANGES,
  barPercent,
  providerTotals,
} from "@/utils/admin-usage";
import { providerBg } from "@/utils/admin-signal";
import AppSegmented from "@/components/AppSegmented.vue";
import SectionHeading from "@/components/admin/SectionHeading.vue";
import { useAdminLabels } from "@/composables/useAdminLabels";
import { useAdminFormat } from "@/composables/useAdminFormat";

const props = defineProps<{
  columns: HourColumn[];
  hours: number;
}>();

const emit = defineEmits<{ "update:hours": [hours: number] }>();

const { t } = useI18n();
const { providerLabel } = useAdminLabels();
const { formatCount, formatHour } = useAdminFormat();

const TICK_COUNT = 4;

// AppSegmented binds a string v-model; the hour count is the value, so it round-trips through
// String()/Number() rather than the picker keeping its own parallel list.
const rangeOptions = USAGE_RANGES.map((r) => ({
  value: String(r.hours),
  label: r.label,
}));

const max = computed(() =>
  props.columns.reduce((m, c) => Math.max(m, c.total), 0),
);
const totals = computed(() => providerTotals(props.columns));

// Swatch and translated name per provider — three values that are the same for every column, so
// they are resolved once here rather than re-resolved inside the 168-column `bars` mapping.
const providerMeta = computed(() =>
  USAGE_PROVIDERS.map((p) => ({
    provider: p,
    class: providerBg(p),
    label: providerLabel(p),
  })),
);

const legend = computed(() =>
  providerMeta.value.map((m) => ({
    ...m,
    total: formatCount(totals.value[m.provider]),
  })),
);

const summary = computed(() => {
  const all = Object.values(totals.value).reduce((a, b) => a + b, 0);
  return t("admin.chart.summary", {
    calls: formatCount(all),
    peak: max.value,
  });
});

// Segment heights and tooltips are derived once per data change rather than per render: at the
// 7d range that is 168 tooltips, each one an Intl format plus three label lookups. Empty segments
// are dropped rather than rendered at 0% — most hours use one provider, and a zero-height element
// still costs a vnode and a style patch on every re-render without painting anything.
const bars = computed(() =>
  props.columns.map((col) => ({
    hourStart: col.hourStart,
    title:
      `${formatHour(col.hourStart)} · ${col.total} — ` +
      providerMeta.value
        .map((m) => `${m.label} ${col[m.provider]}`)
        .join(", "),
    segments: providerMeta.value
      .map((m) => ({
        provider: m.provider,
        class: m.class,
        height: barPercent(col[m.provider], max.value),
      }))
      .filter((s) => s.height > 0),
  })),
);

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
            : formatHour(cols[idx].hourStart),
    };
  });
});
</script>
