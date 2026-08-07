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
        <!-- Every segment opens the works behind it — all four, rather than only the two that name
             something actionable: a uniform bar needs no explanation of why two counts are inert. -->
        <div class="flex h-4 gap-0.5">
          <component
            :is="seg.inspectable ? 'button' : 'span'"
            v-for="seg in enrichmentSegments"
            :key="seg.key"
            :type="seg.inspectable ? 'button' : undefined"
            :class="[seg.class, seg.inspectable ? SEGMENT_HIT : '']"
            :style="{ width: `${seg.percent}%` }"
            :aria-label="seg.hint"
            @click="seg.inspectable && emit('inspect-works', seg.key)"
          />
        </div>
        <div class="flex flex-wrap gap-x-6.5 gap-y-1.5 mt-2.5">
          <component
            :is="seg.inspectable ? 'button' : 'span'"
            v-for="seg in enrichmentSegments"
            :key="seg.key"
            :type="seg.inspectable ? 'button' : undefined"
            :class="[LEGEND_ITEM, seg.inspectable ? 'cursor-pointer' : '']"
            :title="seg.hint"
            @click="seg.inspectable && emit('inspect-works', seg.key)"
          >
            <span class="w-2 h-2 flex-none" :class="seg.class" />
            <span class="text-text-secondary">{{ seg.label }}</span>
            <span
              class="text-text-primary"
              :class="seg.inspectable ? INSPECT_TEXT : ''"
              >{{ seg.count }}</span
            >
          </component>
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
        <!-- The failed segment and its legend entry are both buttons into the run list — the bar is
             what someone points at, the legend is where the number is legible, and either is a
             reasonable thing to click. Redundant by design; the rest of the bar stays inert. -->
        <div class="flex h-4 gap-0.5">
          <component
            :is="seg.inspectable ? 'button' : 'span'"
            v-for="seg in runSegments"
            :key="seg.key"
            :type="seg.inspectable ? 'button' : undefined"
            :class="[seg.class, seg.inspectable ? SEGMENT_HIT : '']"
            :style="{ width: `${seg.percent}%` }"
            :aria-label="seg.hint"
            @click="seg.inspectable && emit('inspect', null)"
          />
        </div>
        <!-- Outcomes left, the failure breakdown right: the reasons only explain the third
             segment, so they read as a footnote to it rather than as peers of the outcomes. -->
        <div
          class="flex flex-col md:flex-row md:justify-between md:items-baseline gap-2.5 mt-2.5"
        >
          <div class="flex flex-wrap gap-x-6.5 gap-y-1.5">
            <component
              :is="seg.inspectable ? 'button' : 'span'"
              v-for="seg in runSegments"
              :key="seg.key"
              :type="seg.inspectable ? 'button' : undefined"
              :class="[LEGEND_ITEM, seg.inspectable ? 'cursor-pointer' : '']"
              :title="seg.hint"
              @click="seg.inspectable && emit('inspect', null)"
            >
              <span class="w-2 h-2 flex-none" :class="seg.class" />
              <span class="text-text-secondary">{{ seg.label }}</span>
              <!-- The rule is drawn on the count alone, not on the whole entry: text-decoration
                   propagates into the swatch, which would strike a line through a 8px square. -->
              <span
                class="text-text-primary"
                :class="seg.inspectable ? INSPECT_TEXT : ''"
                >{{ seg.count }}</span
              >
            </component>
          </div>
          <div class="flex flex-wrap gap-x-4 gap-y-1.5">
            <span
              v-if="!runs.failureReasons.length"
              class="font-mono text-[11px] text-chart-muted"
              >{{ $t("admin.vitals.no_failures") }}</span
            >
            <button
              v-for="r in runs.failureReasons"
              :key="r.reason"
              type="button"
              class="font-mono text-[11px] text-text-secondary hover:text-text-primary transition-colors"
              :class="INSPECT_TEXT"
              :title="$t('admin.vitals.inspect_reason')"
              @click="emit('inspect', r.reason)"
            >
              {{ reasonLabel(r.reason) }}
              <span :class="transientText(r.transient)">{{ r.count }}</span>
            </button>
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
import {
  outcomeBg,
  signalText,
  statusBg,
  transientText,
} from "@/utils/admin-signal";
import { useAdminLabels } from "@/composables/useAdminLabels";
import { useAdminFormat } from "@/composables/useAdminFormat";

const props = defineProps<{ overview: AdminOverview }>();

const emit = defineEmits<{
  /** Open the run list: a `failure_reason` to narrow to, or null for every failed run. */
  inspect: [reason: string | null];
  /** Open the works list, narrowed to one `enrichment_status`. */
  "inspect-works": [status: string];
}>();

const { t } = useI18n();
const { reasonLabel } = useAdminLabels();
const { formatCount: fmt, formatRelative } = useAdminFormat();

const COL_HEAD =
  "font-mono text-[9px] tracking-[0.24em] uppercase text-text-secondary mb-4.5";
const ROW_LABEL =
  "font-mono text-[11px] tracking-[0.16em] uppercase text-text-secondary";
const LEGEND_ITEM = "flex items-center gap-1.75 font-mono text-[11px]";
// The bar segment carries no text, so hover has to be visible on the fill itself. Focus is left to
// the global `:focus-visible` ring in `tailwind.css`, deliberately: that ring is 2px in
// `--color-text-primary` *because* it has to clear 3:1 against any surface in either theme, and a
// 1px accent-coloured one would both halve it and re-pin it to a user-chosen token — one of the
// shipped accent presets is within three points of this bar's own `signal-critical` fill.
const SEGMENT_HIT = "cursor-pointer hover:brightness-125";
/**
 * The "this figure opens something" cue, on every drill-down target.
 *
 * A dotted underline rather than a colour, because colour cannot carry it here: the accent is
 * user-chosen and a red preset (`#d9534f`) lands within three points of `signal-critical` — so an
 * accent-tinted failure count reads as "coloured like its own swatch", i.e. as nothing at all. The
 * underline works under every preset and in both themes, and solidifies on hover.
 */
const INSPECT_TEXT =
  "cursor-pointer underline decoration-dotted underline-offset-2 hover:decoration-solid";

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

// `hint` is the drill-down affordance's label — undefined on an inert segment, which is what both
// the bar's `aria-label` and the legend's `title` want, so neither has to restate the condition.
const enrichmentSegments = computed(() =>
  enrichment.value.segments.map((s) => {
    const label = t(`admin.vitals.status.${s.key}`);
    // Same rule as the run bar: an empty bucket is a zero-width segment to aim at and a list with
    // nothing in it, so it stays inert.
    const inspectable = s.count > 0;
    return {
      ...s,
      class: statusBg(s.key),
      label,
      inspectable,
      hint: inspectable
        ? t("admin.vitals.inspect_works", { status: label })
        : undefined,
    };
  }),
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
  ].map((s) => {
    // Only failures have a drill-down worth opening, and only when there are some: a zero-width
    // segment is nothing to aim at, and an empty list answers a question nobody asked.
    const inspectable = s.key === "failed" && s.count > 0;
    return {
      ...s,
      class: outcomeBg(s.key),
      label: t(`admin.vitals.outcome.${s.key}`),
      percent: percent(s.count, r.total),
      inspectable,
      hint: inspectable ? t("admin.vitals.inspect_failed") : undefined,
    };
  });
});
</script>
