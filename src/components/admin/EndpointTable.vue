<template>
  <section>
    <div class="flex justify-between items-baseline mb-3">
      <SectionHeading :title="$t('admin.endpoints.title')" />
      <span
        class="font-mono text-[9px] md:text-[10px] tracking-[0.14em] uppercase text-text-secondary"
      >
        {{ rangeLabel }}
      </span>
    </div>

    <div class="border border-charcoal-border">
      <p
        v-if="!rows.length"
        class="px-4 py-8 text-center text-xs text-text-secondary"
      >
        {{ $t("admin.endpoints.empty") }}
      </p>

      <template v-else>
        <!-- Desktop: full grid with an in-cell share bar. -->
        <div class="hidden md:block">
          <TableHeader
            :columns="COLUMNS"
            :grid-class="GRID"
            key-prefix="admin.endpoints"
            :right-aligned="RIGHT_ALIGNED"
            :sort-key="sortKey"
            :sort-direction="sortDirection"
            @sort="toggle"
          />
          <div
            v-for="row in sorted"
            :key="row.key"
            class="px-4.5 border-b border-charcoal-border/60 items-center border-l-2"
            :class="[GRID, row.edgeClass]"
          >
            <span class="flex items-center gap-2 py-2.5">
              <span class="w-2 h-2 flex-none" :class="row.bg" />
              <span class="font-mono text-xs text-text-primary">{{
                row.provider
              }}</span>
            </span>
            <span class="font-mono text-xs text-text-secondary py-2.5">{{
              row.operation
            }}</span>
            <span class="py-2.5 pr-6">
              <ShareBar
                class="block h-2"
                :percent="row.share"
                :bar-class="row.bg"
              />
            </span>
            <span
              class="font-mono text-xs text-text-primary py-2.5 text-right"
              >{{ row.success }}</span
            >
            <span
              class="font-mono text-xs py-2.5 text-right"
              :class="row.errorClass"
              >{{ row.error || "—" }}</span
            >
            <span
              class="font-mono text-xs py-2.5 text-right"
              :class="row.rateClass"
              >{{ row.rateLimited || "—" }}</span
            >
          </div>
          <div class="px-4.5 bg-charcoal-light" :class="GRID">
            <span
              class="font-mono text-[10px] tracking-[0.16em] uppercase text-text-secondary py-2.75"
              >{{ $t("admin.endpoints.total") }}</span
            >
            <span
              class="col-start-4 font-mono text-xs text-text-primary py-2.75 text-right"
              >{{ grand.success }}</span
            >
            <span
              class="font-mono text-xs text-text-primary py-2.75 text-right"
              >{{ grand.error }}</span
            >
            <span
              class="font-mono text-xs py-2.75 text-right"
              :class="
                grand.rateLimited > 0 ? 'text-signal-warn' : 'text-text-primary'
              "
              >{{ grand.rateLimited }}</span
            >
          </div>
        </div>

        <!-- Mobile: two lines per endpoint, same numbers in ok / err / 429 order. -->
        <div class="md:hidden">
          <div
            v-for="row in sorted"
            :key="row.key"
            class="px-3 py-2.5 border-b border-charcoal-border/60 border-l-2"
            :class="row.edgeClass"
          >
            <div class="flex justify-between items-baseline gap-2.5">
              <span class="flex items-center gap-1.5 min-w-0">
                <span class="w-1.75 h-1.75 flex-none" :class="row.bg" />
                <span
                  class="font-mono text-[11px] text-text-primary truncate"
                  >{{ row.operation }}</span
                >
              </span>
              <span class="flex gap-2.5 flex-none font-mono text-[11px]">
                <span class="text-text-primary">{{ row.success }}</span>
                <span :class="row.errorClass">{{ row.error || "—" }}</span>
                <span :class="row.rateClass">{{ row.rateLimited || "—" }}</span>
              </span>
            </div>
            <div class="flex items-center gap-2.5 mt-1.5 pl-3.25">
              <span class="font-mono text-[10px] text-chart-muted flex-none">{{
                row.provider
              }}</span>
              <ShareBar
                class="flex-1 h-1.25"
                :percent="row.share"
                :bar-class="row.bg"
              />
            </div>
          </div>
        </div>
      </template>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import type { UsageTotal } from "@/types/admin";
import SectionHeading from "@/components/admin/SectionHeading.vue";
import ShareBar from "@/components/admin/ShareBar.vue";
import TableHeader from "@/components/admin/TableHeader.vue";
import { useAdminLabels } from "@/composables/useAdminLabels";
import { useTableSort } from "@/composables/useTableSort";
import { barPercent, totalCalls } from "@/utils/admin-usage";
import { providerBg } from "@/utils/admin-signal";

const props = defineProps<{
  rows: UsageTotal[];
  rangeLabel: string;
}>();

const { providerLabel, operationLabel } = useAdminLabels();

const GRID = "grid grid-cols-[170px_190px_1fr_96px_96px_120px]";
const COLUMNS = [
  "provider",
  "operation",
  "share",
  "success",
  "errors",
  "rate_limited",
] as const;
const RIGHT_ALIGNED = ["success", "errors", "rate_limited"] as const;

const grand = computed(() =>
  props.rows.reduce(
    (acc, r) => ({
      success: acc.success + r.success,
      error: acc.error + r.error,
      rateLimited: acc.rateLimited + r.rateLimited,
    }),
    { success: 0, error: 0, rateLimited: 0 },
  ),
);

// Derived once per data change and read by both the desktop grid and the mobile cards — the two
// layouts are both in the DOM at all times, so anything left in the template is computed twice.
// Scaled against the busiest endpoint rather than the total: with nine rows, shares of the whole
// are all short stubs and the bar stops distinguishing anything.
const viewRows = computed(() => {
  const busiest = props.rows.reduce((m, r) => Math.max(m, totalCalls(r)), 0);
  return props.rows.map((r) => ({
    key: `${r.provider}/${r.operation}`,
    provider: providerLabel(r.provider),
    operation: operationLabel(r.operation),
    bg: providerBg(r.provider),
    calls: totalCalls(r),
    share: barPercent(totalCalls(r), busiest),
    success: r.success,
    error: r.error,
    rateLimited: r.rateLimited,
    edgeClass:
      r.rateLimited > 0 ? "border-l-signal-warn" : "border-l-transparent",
    errorClass: r.error > 0 ? "text-text-primary" : "text-chart-muted",
    rateClass: r.rateLimited > 0 ? "text-signal-warn" : "text-chart-muted",
  }));
});

// Sorted after the mapping, so the two label columns order by what's on screen (the translated
// provider/operation names) rather than by the machine strings behind them.
const { sortKey, sortDirection, toggle, sorted } = useTableSort(
  () => viewRows.value,
  {
    provider: { value: (r) => r.provider },
    operation: { value: (r) => r.operation },
    // The bar is scaled against the busiest row, so its length and the call count agree on order.
    share: { value: (r) => r.calls, descFirst: true },
    success: { value: (r) => r.success, descFirst: true },
    errors: { value: (r) => r.error, descFirst: true },
    rate_limited: { value: (r) => r.rateLimited, descFirst: true },
  },
);
</script>
