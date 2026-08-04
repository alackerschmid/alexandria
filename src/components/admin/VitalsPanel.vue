<template>
  <!-- Counts left, health right. The four totals are plain numbers with nothing to judge, so they
       get no bar; enrichment and runs each have a state worth reading at a glance, so those two do. -->
  <section class="flex flex-col md:flex-row border-t border-charcoal-border">
    <div
      class="flex-none md:w-95 pt-5 pb-4 md:pr-9 border-b md:border-b-0 md:border-r border-charcoal-border"
    >
      <h2 :class="COL_HEAD">{{ $t("admin.vitals.counts") }}</h2>
      <div class="flex flex-col gap-4">
        <div
          v-for="c in counts"
          :key="c.key"
          class="flex items-baseline justify-between gap-4"
        >
          <span :class="ROW_LABEL">{{ c.label }}</span>
          <span class="flex items-baseline gap-2.5">
            <span
              class="font-mono text-[22px] md:text-[26px] text-text-primary"
              >{{ c.value }}</span
            >
            <span class="font-mono text-xs text-signal-ok w-11 text-right">{{
              c.delta
            }}</span>
          </span>
        </div>
      </div>
      <p class="font-mono text-[10px] text-chart-muted mt-5">
        {{ $t("admin.vitals.delta_note") }}
      </p>
    </div>

    <div class="flex-1 min-w-0 pt-5 pb-4 md:pl-9">
      <h2 :class="COL_HEAD">{{ $t("admin.vitals.health") }}</h2>

      <div class="mb-5.5">
        <div class="flex justify-between items-baseline gap-3 mb-2.25">
          <span class="font-mono text-xs text-text-primary">
            {{ $t("admin.vitals.enrichment") }}
            <span class="text-chart-muted"
              >·
              {{
                $t("admin.vitals.works_count", { count: fmt(totalWorks) })
              }}</span
            >
          </span>
          <span class="flex-none font-mono text-xs text-signal-ok">
            {{ $t("admin.vitals.percent_done", { percent: donePercent }) }}
          </span>
        </div>
        <div class="flex h-4 gap-0.5">
          <span
            v-for="seg in enrichmentSegments"
            :key="seg.key"
            :class="seg.class"
            :style="{ width: `${seg.percent}%` }"
          />
        </div>
        <div class="flex flex-wrap gap-x-6.5 gap-y-1.5 mt-2.5">
          <span
            v-for="seg in enrichmentSegments"
            :key="seg.key"
            :class="LEGEND_ITEM"
          >
            <span class="w-2 h-2 flex-none" :class="seg.class" />
            <span class="text-text-secondary">{{ seg.label }}</span>
            <span class="text-text-primary">{{ seg.count }}</span>
          </span>
        </div>
        <!-- Only when something is actually queued: with an empty queue the sweeper's last run is
             legitimately ancient, and saying so would read as a fault. -->
        <p
          v-if="sweeperLabel"
          class="font-mono text-[11px] mt-2.5"
          :class="signalText(sweeper.level)"
        >
          {{ sweeperLabel }}
        </p>
      </div>

      <div class="border-t border-charcoal-border/60 pt-4.5">
        <div class="flex justify-between items-baseline gap-3 mb-2.25">
          <span class="font-mono text-xs text-text-primary">
            {{ $t("admin.vitals.runs") }}
            <span class="text-chart-muted"
              >·
              {{
                $t("admin.vitals.runs_meta", { count: fmt(runs.total) })
              }}</span
            >
          </span>
          <span class="flex-none font-mono text-xs text-text-secondary">
            {{ $t("admin.vitals.avg_p95", { avg: avgLabel, p95: p95Label }) }}
          </span>
        </div>
        <div class="flex h-4 gap-0.5">
          <span
            v-for="seg in runSegments"
            :key="seg.key"
            :class="seg.class"
            :style="{ width: `${seg.percent}%` }"
          />
        </div>
        <!-- Outcomes left, the failure breakdown right: the reasons only explain the third
             segment, so they read as a footnote to it rather than as peers of the outcomes. -->
        <div
          class="flex flex-col md:flex-row md:justify-between md:items-baseline gap-2.5 mt-2.5"
        >
          <div class="flex flex-wrap gap-x-6.5 gap-y-1.5">
            <span
              v-for="seg in runSegments"
              :key="seg.key"
              :class="LEGEND_ITEM"
            >
              <span class="w-2 h-2 flex-none" :class="seg.class" />
              <span class="text-text-secondary">{{ seg.label }}</span>
              <span class="text-text-primary">{{ seg.count }}</span>
            </span>
          </div>
          <div class="flex flex-wrap gap-x-4 gap-y-1.5">
            <span
              v-if="!runs.failureReasons.length"
              class="font-mono text-[11px] text-chart-muted"
              >{{ $t("admin.vitals.no_failures") }}</span
            >
            <span
              v-for="r in runs.failureReasons"
              :key="r.reason"
              class="font-mono text-[11px] text-text-secondary"
            >
              {{ reasonLabel(r.reason) }}
              <span
                :class="r.transient ? 'text-signal-warn' : 'text-text-primary'"
                >{{ r.count }}</span
              >
            </span>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { AdminOverview } from "@/types/admin";
import {
  enrichmentBreakdown,
  formatDurationMs,
  percent,
  sweeperStatus,
} from "@/utils/admin-usage";
import { outcomeBg, signalText, statusBg } from "@/utils/admin-signal";
import { useAdminLabels } from "@/composables/useAdminLabels";
import { useAdminFormat } from "@/composables/useAdminFormat";

const props = defineProps<{ overview: AdminOverview }>();

const { t } = useI18n();
const { reasonLabel } = useAdminLabels();
const { formatCount: fmt, formatRelative } = useAdminFormat();

const COL_HEAD =
  "font-mono text-[9px] tracking-[0.24em] uppercase text-text-secondary mb-4.5";
const ROW_LABEL =
  "font-mono text-[11px] tracking-[0.16em] uppercase text-text-secondary";
const LEGEND_ITEM = "flex items-center gap-1.75 font-mono text-[11px]";

const runs = computed(() => props.overview.enrichmentRuns24h);
const totalWorks = computed(() => props.overview.totalWorks);

const avgLabel = computed(() => formatDurationMs(runs.value.avgDurationMs));
const p95Label = computed(() => formatDurationMs(runs.value.p95DurationMs));

// A zero delta stays blank rather than reading "+0" — the column is there to show movement.
const delta = (n: number) => (n > 0 ? `+${fmt(n)}` : "");

const counts = computed(() => {
  const o = props.overview;
  return [
    {
      key: "users",
      label: t("admin.vitals.users"),
      value: fmt(o.totalUsers),
      delta: delta(o.newUsers7d),
    },
    {
      key: "scans",
      label: t("admin.vitals.scans"),
      value: fmt(o.totalScans),
      delta: delta(o.scans7d),
    },
    {
      key: "books",
      label: t("admin.vitals.books"),
      value: fmt(o.totalBooks),
      delta: "",
    },
    {
      key: "works",
      label: t("admin.vitals.works"),
      value: fmt(o.totalWorks),
      delta: "",
    },
  ];
});

const enrichment = computed(() =>
  enrichmentBreakdown(props.overview.enrichment),
);

const enrichmentSegments = computed(() =>
  enrichment.value.segments.map((s) => ({
    ...s,
    class: statusBg(s.key),
    label: t(`admin.vitals.status.${s.key}`),
  })),
);

const donePercent = computed(() => Math.round(enrichment.value.donePercent));

// Same judgement as the top-strip pip, from the same helper — the two are read together, so they
// cannot be allowed to disagree about whether the cron is keeping up.
const sweeper = computed(() => sweeperStatus(props.overview.sweeper, Date.now()));

const sweeperLabel = computed(() => {
  const { dueCount } = sweeper.value;
  if (dueCount <= 0) return null;
  const ago = formatRelative(props.overview.sweeper.lastRunAt, Date.now());
  return ago
    ? t("admin.vitals.sweeper", { due: fmt(dueCount), ago })
    : t("admin.vitals.sweeper_never", { due: fmt(dueCount) });
});

const runSegments = computed(() => {
  const r = runs.value;
  return [
    { key: "done", count: r.byOutcome.done },
    { key: "not_found", count: r.byOutcome.not_found },
    { key: "failed", count: r.byOutcome.failed },
  ].map((s) => ({
    ...s,
    class: outcomeBg(s.key),
    label: t(`admin.vitals.outcome.${s.key}`),
    percent: percent(s.count, r.total),
  }));
});
</script>
