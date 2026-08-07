<template>
  <BoardDialog
    :model-value="modelValue"
    :title="$t('admin.runs.title')"
    :meta="metaLabel"
    :chip-label="reason ? reasonLabel(reason) : null"
    :clear-filter-label="$t('admin.runs.clear_filter')"
    :section="section"
    :is-empty="!rows.length"
    :empty-label="$t('admin.runs.empty')"
    :footer="truncatedLabel"
    @update:model-value="emit('update:modelValue', $event)"
    @clear-filter="emit('filter', null)"
    @retry="emit('retry')"
  >
    <!-- Desktop: one row per run. The left edge groups by transience, which is the split that
         decides whether a failure is worth acting on. -->
    <div class="hidden md:block">
      <TableHeader
        class="sticky top-0 z-1"
        :columns="COLUMNS"
        :grid-class="GRID"
        key-prefix="admin.runs.col"
        :right-aligned="RIGHT_ALIGNED"
        pad-class="px-5.5"
        :sortable="false"
      />
      <div
        v-for="run in rows"
        :key="run.id"
        class="px-5.5 border-b border-charcoal-border/60 border-l-2 items-baseline"
        :class="[GRID, run.edgeClass]"
      >
        <span
          class="font-mono text-[11px] text-text-secondary py-2.5"
          :title="run.ago"
          >{{ run.time }}</span
        >
        <span class="min-w-0 py-2.5">
          <span class="block font-mono text-xs text-text-primary truncate">
            {{ run.title }}
          </span>
          <span class="block font-mono text-[10px] text-chart-muted mt-1">
            {{ run.workMeta }}
          </span>
        </span>
        <span
          class="font-mono text-[11px] text-text-secondary py-2.5 text-right"
          >{{ run.duration }}</span
        >
        <span class="font-mono text-[11px] py-2.5" :class="run.reasonClass">{{
          run.reason
        }}</span>
        <span class="font-mono text-[11px] text-text-secondary py-2.5">{{
          run.source
        }}</span>
      </div>
    </div>

    <!-- Mobile: title first, then the same five values on two meta lines. -->
    <div class="md:hidden">
      <div
        v-for="run in rows"
        :key="run.id"
        class="px-3.5 py-2.5 border-b border-charcoal-border/60 border-l-2"
        :class="run.edgeClass"
      >
        <div class="flex justify-between items-baseline gap-2.5">
          <span class="font-mono text-[11px] text-text-primary truncate">{{
            run.title
          }}</span>
          <span class="flex-none font-mono text-[10px] text-text-secondary">{{
            run.time
          }}</span>
        </div>
        <div class="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 mt-1.5">
          <span class="font-mono text-[10px]" :class="run.reasonClass">{{
            run.reason
          }}</span>
          <span class="font-mono text-[10px] text-chart-muted"
            >{{ run.duration }} · {{ run.source }}</span
          >
        </div>
        <div class="font-mono text-[10px] text-chart-muted mt-1">
          {{ run.workMeta }}
        </div>
      </div>
    </div>
  </BoardDialog>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { AdminRuns, Section } from "@/types/admin";
import BoardDialog from "@/components/admin/BoardDialog.vue";
import TableHeader from "@/components/admin/TableHeader.vue";
import { useAdminFormat } from "@/composables/useAdminFormat";
import { useAdminLabels } from "@/composables/useAdminLabels";
import { formatDurationMs } from "@/utils/admin-usage";
import { signalBorderL, transientText } from "@/utils/admin-signal";

const props = defineProps<{
  modelValue: boolean;
  /** The failure reason being inspected; null means every failed run in the window. */
  reason: string | null;
  /** Same load/fail/retry shape the board's sections use. */
  section: Section<AdminRuns>;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  /** Narrow to a reason, or `null` to widen back to every failed run. */
  filter: [reason: string | null];
  retry: [];
}>();

const { t } = useI18n();
const { reasonLabel, sourceLabel, workStatusLabel } = useAdminLabels();
const { formatHour, formatRelative } = useAdminFormat();

const GRID = "grid grid-cols-[58px_1fr_78px_132px_104px] gap-x-4";
const COLUMNS = ["time", "work", "duration", "reason", "source"] as const;
const RIGHT_ALIGNED = ["duration"];

const metaLabel = computed(() => {
  const data = props.section.data;
  // Blank rather than "Loading" once a request has failed: the body below is already showing the
  // error and a Retry button, and a header still claiming to be loading contradicts it.
  if (!data) return props.section.error ? "" : t("admin.loading");
  // Pluralized on the count, which really can be 1 here — a single reason chip often stands for
  // one run, and that is the number the operator clicked.
  return t(
    "admin.runs.meta",
    { hours: data.hours, count: data.total },
    data.total,
  );
});

// Relative times are stamped when the response changes rather than on a timer, same as the panel:
// a clock ticking under a static list would only imply the data behind it is live.
const rows = computed(() => {
  const now = Date.now();
  return (props.section.data?.runs ?? []).map((r) => ({
    id: r.id,
    time: formatHour(r.startedAt),
    ago: formatRelative(r.startedAt, now) ?? "",
    title: r.workTitle ?? t("admin.untitled_work"),
    duration: formatDurationMs(r.durationMs),
    // A failed row with no stored reason is what the summary counts under "other", so it reads as
    // that here too rather than as a blank cell.
    reason: reasonLabel(r.failureReason ?? "other"),
    reasonClass: transientText(r.transient),
    edgeClass: signalBorderL(r.transient ? "warning" : "critical"),
    source: sourceLabel(r.source),
    workMeta: workMeta(r, now),
  }));
});

/**
 * The work's current state, as one muted line: what a failed run raises is "will this fix itself",
 * and only the work row answers it. The retry clause is dropped once the work is `done` — a later
 * success makes this run history, and `next_retry_at` is left stale behind it.
 */
function workMeta(r: AdminRuns["runs"][number], now: number): string {
  const parts = [`#${r.workId}`];
  // `== null`, not `=== null`: the type says null but the value is a blind `as` cast of whatever the
  // worker sent, and an *absent* field would otherwise fall through to `workStatusLabel(undefined)`,
  // which throws inside a computed and blanks the page rather than degrading one cell.
  if (r.workStatus == null) {
    parts.push(t("admin.runs.work_gone"));
    return parts.join(" · ");
  }

  parts.push(workStatusLabel(r.workStatus));
  if (r.workAttempts) {
    parts.push(
      t("admin.runs.attempts", { count: r.workAttempts }, r.workAttempts),
    );
  }
  if (r.workStatus !== "done") {
    // Same `== null` reasoning: `formatRelative(undefined)` computes `now - undefined` → NaN, and
    // Intl.RelativeTimeFormat throws a RangeError on a non-finite value.
    parts.push(
      r.workNextRetryAt == null
        ? t("admin.runs.retry_due")
        : t("admin.runs.retry_at", {
            when: formatRelative(r.workNextRetryAt, now) ?? "",
          }),
    );
  }
  return parts.join(" · ");
}

const truncatedLabel = computed(() => {
  const data = props.section.data;
  // Reads `rows` rather than `data.runs` so it degrades the same way the list does: `load` casts the
  // payload blind, so a shape without `runs` renders the empty state instead of throwing here.
  if (!data || data.total <= rows.value.length) return null;
  return t("admin.runs.truncated", {
    shown: rows.value.length,
    total: data.total,
  });
});
</script>
