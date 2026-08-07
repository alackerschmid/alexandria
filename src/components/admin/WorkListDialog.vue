<template>
  <BoardDialog
    :model-value="modelValue"
    :title="$t('admin.works.title')"
    :meta="metaLabel"
    :chip-label="status ? workStatusLabel(status) : null"
    :clear-filter-label="$t('admin.works.clear_filter')"
    :section="section"
    :is-empty="!rows.length"
    :empty-label="$t('admin.works.empty')"
    :footer="truncatedLabel"
    @update:model-value="emit('update:modelValue', $event)"
    @clear-filter="emit('filter', null)"
    @retry="emit('retry')"
  >
    <!-- Desktop: one row per work. The left edge carries the status colour, so a mixed list (the
         unfiltered one) groups visually without a colour-coded column of its own. -->
    <div class="hidden md:block">
      <TableHeader
        class="sticky top-0 z-1"
        :columns="COLUMNS"
        :grid-class="GRID"
        key-prefix="admin.works.col"
        :right-aligned="RIGHT_ALIGNED"
        pad-class="px-5.5"
        :sortable="false"
      />
      <div
        v-for="work in rows"
        :key="work.id"
        class="px-5.5 border-b border-charcoal-border/60 border-l-2 items-baseline"
        :class="[GRID, work.edgeClass]"
      >
        <span class="font-mono text-[11px] text-text-secondary py-2.5">{{
          work.lastAttempt
        }}</span>
        <span class="min-w-0 py-2.5">
          <span class="block font-mono text-xs text-text-primary truncate">
            {{ work.title }}
          </span>
          <span class="block font-mono text-[10px] text-chart-muted mt-1">
            {{ work.identity }}
          </span>
        </span>
        <span class="flex items-center gap-1.75 py-2.5">
          <span class="w-2 h-2 flex-none" :class="work.statusClass" />
          <span class="font-mono text-[11px] text-text-secondary">{{
            work.status
          }}</span>
        </span>
        <span
          class="font-mono text-[11px] text-text-secondary py-2.5 text-right"
          >{{ work.attempts }}</span
        >
        <span class="font-mono text-[11px] py-2.5" :class="work.reasonClass">{{
          work.reason
        }}</span>
        <span class="font-mono text-[11px] text-text-secondary py-2.5">{{
          work.nextRetry
        }}</span>
      </div>
    </div>

    <!-- Mobile: title first, then the same values on two meta lines. -->
    <div class="md:hidden">
      <div
        v-for="work in rows"
        :key="work.id"
        class="px-3.5 py-2.5 border-b border-charcoal-border/60 border-l-2"
        :class="work.edgeClass"
      >
        <div class="flex justify-between items-baseline gap-2.5">
          <span class="font-mono text-[11px] text-text-primary truncate">{{
            work.title
          }}</span>
          <span class="flex-none font-mono text-[10px] text-text-secondary">{{
            work.lastAttempt
          }}</span>
        </div>
        <div class="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 mt-1.5">
          <span class="flex items-center gap-1.5">
            <span class="w-1.75 h-1.75 flex-none" :class="work.statusClass" />
            <span class="font-mono text-[10px] text-text-secondary">{{
              work.status
            }}</span>
          </span>
          <span class="font-mono text-[10px]" :class="work.reasonClass">{{
            work.reason
          }}</span>
          <span class="font-mono text-[10px] text-chart-muted">{{
            work.nextRetry
          }}</span>
        </div>
        <div class="font-mono text-[10px] text-chart-muted mt-1">
          {{ work.identity }}
        </div>
      </div>
    </div>
  </BoardDialog>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { AdminWorks, Section } from "@/types/admin";
import BoardDialog from "@/components/admin/BoardDialog.vue";
import TableHeader from "@/components/admin/TableHeader.vue";
import { useAdminFormat } from "@/composables/useAdminFormat";
import { useAdminLabels } from "@/composables/useAdminLabels";
import { statusBg, statusBorderL, transientText } from "@/utils/admin-signal";

const props = defineProps<{
  modelValue: boolean;
  /** The `enrichment_status` being inspected; null means every work. */
  status: string | null;
  section: Section<AdminWorks>;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  /** Narrow to a status, or `null` to widen back to every work. */
  filter: [status: string | null];
  retry: [];
}>();

const { t } = useI18n();
const { reasonLabel, workStatusLabel } = useAdminLabels();
const { formatCount, formatRelative } = useAdminFormat();

const GRID = "grid grid-cols-[104px_1fr_116px_64px_120px_116px] gap-x-4";
const COLUMNS = [
  "last_attempt",
  "work",
  "status",
  "attempts",
  "reason",
  "next_retry",
] as const;
const RIGHT_ALIGNED = ["attempts"];

const NONE = "—";

const metaLabel = computed(() => {
  const data = props.section.data;
  // Blank rather than "Loading" once a request has failed — see RunDetailDialog.
  if (!data) return props.section.error ? "" : t("admin.loading");
  return t("admin.works.meta", { count: formatCount(data.total) }, data.total);
});

// Stamped when the response changes rather than on a timer, same as the panel and the run list.
const rows = computed(() => {
  const now = Date.now();
  return (props.section.data?.works ?? []).map((w) => ({
    id: w.id,
    title: w.title ?? t("admin.untitled_work"),
    // The Wikidata id is the thing enrichment exists to find, so its absence is stated outright
    // rather than left as a blank — for a failed work it is often the whole diagnosis.
    identity: `#${w.id} · ${qidLabel(w)}`,
    status: workStatusLabel(w.status),
    statusClass: statusBg(w.status),
    edgeClass: statusBorderL(w.status),
    // `?? NONE`, not `|| NONE`: 0 is a reading, not a missing value. `enrichment_attempts` resets to
    // 0 on success (and starts there), so every `done` row would otherwise show the same em dash the
    // "not applicable" cells use, and "never tried" would be indistinguishable from "no data".
    attempts: w.attempts ?? NONE,
    reason: w.failureReason ? reasonLabel(w.failureReason) : NONE,
    reasonClass: w.failureReason
      ? transientText(w.transient)
      : "text-chart-muted",
    lastAttempt: formatRelative(w.lastAttemptAt, now) ?? t("admin.works.never"),
    nextRetry: nextRetryLabel(w, now),
  }));
});

/**
 * What a missing `wikidata_qid` means, which depends entirely on the status beside it.
 *
 * On a `done` work it is a real answer: enrichment ran, Wikidata had no match, and the pipeline
 * stores that as done-with-no-qid rather than as a failure. On a `failed`/`exhausted` one it means
 * only that no answer was ever collected — and calling that "no Wikidata match" is how a whole
 * cohort of works came to look unmatchable when they were being abandoned mid-query. That reading
 * cost real time to undo, so the two states say different things here.
 */
function qidLabel(w: AdminWorks["works"][number]): string {
  if (w.wikidataQid) return w.wikidataQid;
  return w.status === "done"
    ? t("admin.works.no_qid")
    : t("admin.works.qid_unknown");
}

/**
 * When the sweeper will pick this work up again. Only meaningful while it still would: a `done`
 * work is finished, and `next_retry_at` is simply left stale behind it.
 *
 * A time already past reads as "due now", not as "5 days ago" — the sweeper's predicate is
 * `next_retry_at <= now`, so an overdue work is an eligible one, and a past tense under a column
 * headed "Next try" reads as a bug rather than as a backlog that hasn't drained.
 */
function nextRetryLabel(w: AdminWorks["works"][number], now: number): string {
  if (w.status === "done") return NONE;
  // `== null` covers an absent field too: `formatRelative(undefined)` yields NaN, which makes
  // Intl.RelativeTimeFormat throw a RangeError inside a computed and blank the page.
  if (w.nextRetryAt == null || w.nextRetryAt <= now)
    return t("admin.works.due_now");
  return formatRelative(w.nextRetryAt, now) ?? NONE;
}

const truncatedLabel = computed(() => {
  const data = props.section.data;
  if (!data || data.total <= data.works.length) return null;
  return t("admin.works.truncated", {
    shown: data.works.length,
    total: formatCount(data.total),
  });
});
</script>
