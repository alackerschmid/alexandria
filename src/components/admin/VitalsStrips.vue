<template>
  <!-- Full-width strips rather than cards: five metrics that each want a number, a delta and a
       bar read better stacked on a shared grid than boxed side by side. -->
  <section class="border-t border-charcoal-border">
    <div v-for="s in simpleStrips" :key="s.key" :class="STRIP">
      <span :class="LABEL">{{ s.label }}</span>
      <span :class="VALUE">{{ s.value }}</span>
      <span class="flex-none w-32 md:w-37.5 font-mono text-[11px] text-right md:text-left"
        :class="s.deltaClass"
        >{{ s.delta }}</span
      >
      <span class="hidden md:block flex-1 h-1.5 bg-search-bg">
        <span
          class="block h-full"
          :class="s.barClass"
          :style="{ width: `${s.barPercent}%` }"
        />
      </span>
      <span :class="TRAILING">{{ s.trailing }}</span>
    </div>

    <div :class="STRIP">
      <span :class="LABEL">{{ $t("admin.vitals.enrichment") }}</span>
      <span :class="VALUE">{{ fmt(enrichment.done) }}</span>
      <span
        class="flex-none w-32 md:w-37.5 font-mono text-[11px] text-text-secondary text-right md:text-left"
      >
        {{ $t("admin.vitals.done_of", { total: fmt(totalWorks) }) }}
      </span>
      <span class="hidden md:flex flex-1 h-3.5 gap-0.5">
        <span
          v-for="seg in enrichmentSegments"
          :key="seg.key"
          :class="seg.class"
          :style="{ width: `${seg.percent}%` }"
        />
      </span>
      <span :class="TRAILING">
        {{ enrichment.pending }} / {{ enrichment.failed }} /
        {{ enrichment.exhausted }}
      </span>
    </div>
    <div :class="SUB_STRIP">
      <span class="hidden md:block flex-none w-37.5" />
      <!-- Mobile keeps the bar (the desktop strip's is hidden there) and puts the legend
           underneath, so the counts stay readable instead of living only in a tooltip-less bar. -->
      <span class="flex md:hidden flex-col gap-2 flex-1">
        <span class="flex h-3 gap-0.5">
          <span
            v-for="seg in enrichmentSegments"
            :key="seg.key"
            :class="seg.class"
            :style="{ width: `${seg.percent}%` }"
          />
        </span>
        <span class="flex flex-wrap gap-x-3.5 gap-y-1.5">
          <span
            v-for="seg in enrichmentSegments"
            :key="seg.key"
            class="font-mono text-[10px] text-text-secondary"
            >{{ seg.label }}
            <span class="text-text-primary">{{ seg.count }}</span></span
          >
        </span>
      </span>
      <span class="hidden md:flex flex-1 gap-5.5">
        <span
          v-for="seg in enrichmentSegments"
          :key="seg.key"
          class="flex items-center gap-1.75"
        >
          <span class="w-2 h-2" :class="seg.class" />
          <span class="font-mono text-[10px] text-text-secondary"
            >{{ seg.label }} {{ seg.count }}</span
          >
        </span>
      </span>
    </div>

    <div :class="STRIP">
      <span :class="LABEL">{{ $t("admin.vitals.runs_24h") }}</span>
      <span :class="VALUE">{{ fmt(runs.total) }}</span>
      <span
        class="flex-none w-32 md:w-37.5 font-mono text-[11px] text-text-secondary text-right md:text-left"
      >
        {{ $t("admin.vitals.avg_p95", { avg: avgLabel, p95: p95Label }) }}
      </span>
      <span class="hidden md:flex flex-1 h-3.5 gap-0.5">
        <span
          v-for="seg in runSegments"
          :key="seg.key"
          :class="seg.class"
          :style="{ width: `${seg.percent}%` }"
        />
      </span>
      <span :class="TRAILING">
        {{ runs.byOutcome.done }} / {{ runs.byOutcome.not_found }} /
        {{ runs.byOutcome.failed }}
      </span>
    </div>
    <div :class="SUB_STRIP">
      <span class="hidden md:block flex-none w-37.5" />
      <span class="flex flex-wrap gap-x-3.5 md:gap-x-5.5 gap-y-1.5 flex-1">
        <span
          v-for="seg in runSegments"
          :key="seg.key"
          class="md:hidden font-mono text-[10px] text-text-secondary"
          >{{ $t(`admin.vitals.outcome.${seg.key}`) }}
          <span class="text-text-primary">{{ seg.count }}</span></span
        >
        <span
          v-if="!runs.failureReasons.length"
          class="font-mono text-[10px] text-chart-muted"
          >{{ $t("admin.vitals.no_failures") }}</span
        >
        <span
          v-for="r in runs.failureReasons"
          :key="r.reason"
          class="font-mono text-[10px] text-text-secondary"
        >
          {{ r.reason }}
          <span
            :class="
              TRANSIENT_REASONS.has(r.reason)
                ? 'text-signal-warn'
                : 'text-text-primary'
            "
            >{{ r.count }}</span
          >
        </span>
      </span>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { AdminOverview } from "@/types/admin";
import { formatDurationMs, percent } from "@/utils/admin-usage";

const props = defineProps<{ overview: AdminOverview }>();

const { t, locale } = useI18n();

const STRIP =
  "flex items-center gap-3 md:gap-5 py-2.5 md:py-3.25 border-b border-charcoal-border/60";
const SUB_STRIP =
  "flex items-center gap-3 md:gap-5 pt-2 pb-2.5 md:pt-2.25 md:pb-3.25 border-b border-charcoal-border/60";
const LABEL =
  "flex-none w-24 md:w-37.5 font-mono text-[9px] md:text-[10px] tracking-[0.18em] uppercase text-text-secondary";
const VALUE =
  "flex-none md:w-27.5 font-mono text-lg md:text-[22px] text-text-primary";
const TRAILING =
  "hidden md:block flex-none w-32.5 text-right font-mono text-[10px] text-text-secondary";

/** Failure reasons worth flagging amber — these mean upstream pressure, not a broken query. */
const TRANSIENT_REASONS = new Set(["timeout", "rate_limited", "http_5xx"]);

const fmt = (n: number) => n.toLocaleString(locale.value);

const enrichment = computed(() => props.overview.enrichment);
const runs = computed(() => props.overview.enrichmentRuns24h);
const totalWorks = computed(() => props.overview.totalWorks);

const avgLabel = computed(() => formatDurationMs(runs.value.avgDurationMs));
const p95Label = computed(() => formatDurationMs(runs.value.p95DurationMs));

const simpleStrips = computed(() => {
  const o = props.overview;
  // Growth is measured against the base the week started from, so "+6 on 41" reads 15%, not 13%.
  const growth = (delta: number, total: number) =>
    total - delta > 0 ? (delta / (total - delta)) * 100 : 0;

  return [
    {
      key: "users",
      label: t("admin.vitals.users"),
      value: fmt(o.totalUsers),
      delta: `+${fmt(o.newUsers7d)}`,
      deltaClass: o.newUsers7d > 0 ? "text-signal-ok" : "text-text-secondary",
      barClass: "bg-signal-ok",
      barPercent: Math.min(100, growth(o.newUsers7d, o.totalUsers)),
      trailing: t("admin.vitals.growth_7d", {
        percent: Math.round(growth(o.newUsers7d, o.totalUsers)),
      }),
    },
    {
      key: "scans",
      label: t("admin.vitals.scans"),
      value: fmt(o.totalScans),
      delta: `+${fmt(o.scans7d)}`,
      deltaClass: o.scans7d > 0 ? "text-signal-ok" : "text-text-secondary",
      barClass: "bg-signal-ok",
      barPercent: Math.min(100, growth(o.scans7d, o.totalScans)),
      trailing: t("admin.vitals.growth_7d", {
        percent: Math.round(growth(o.scans7d, o.totalScans)),
      }),
    },
    {
      key: "catalogue",
      label: t("admin.vitals.catalogue"),
      value: fmt(o.totalBooks),
      delta: t("admin.vitals.works", { count: fmt(o.totalWorks) }),
      deltaClass: "text-text-secondary",
      barClass: "bg-chart-total",
      // Clamped because works can genuinely outnumber books: enrichment mints a placeholder
      // work for every series member, and most of those have no edition behind them. Unclamped,
      // the bar overruns its track and lands on the label next to it.
      barPercent: Math.min(100, percent(o.totalWorks, o.totalBooks)),
      trailing: t("admin.vitals.editions_per_work", {
        ratio: (o.totalWorks > 0 ? o.totalBooks / o.totalWorks : 0).toFixed(2),
      }),
    },
  ];
});

const enrichmentSegments = computed(() => {
  const e = enrichment.value;
  const total = e.done + e.pending + e.failed + e.exhausted;
  return [
    { key: "done", count: e.done, class: "bg-signal-ok" },
    { key: "pending", count: e.pending, class: "bg-chart-total" },
    { key: "failed", count: e.failed, class: "bg-signal-critical" },
    { key: "exhausted", count: e.exhausted, class: "bg-chart-muted" },
  ].map((s) => ({
    ...s,
    label: t(`admin.vitals.status.${s.key}`),
    percent: percent(s.count, total),
  }));
});

const runSegments = computed(() => {
  const r = runs.value;
  return [
    { key: "done", count: r.byOutcome.done, class: "bg-signal-ok" },
    { key: "not_found", count: r.byOutcome.not_found, class: "bg-chart-total" },
    { key: "failed", count: r.byOutcome.failed, class: "bg-signal-critical" },
  ].map((s) => ({ ...s, percent: percent(s.count, r.total) }));
});
</script>
