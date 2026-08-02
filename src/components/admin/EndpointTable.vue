<template>
  <section>
    <div class="flex justify-between items-baseline mb-3">
      <h2
        class="font-mono text-[10px] md:text-[11px] tracking-[0.24em] md:tracking-[0.28em] uppercase text-orange-neon"
      >
        {{ $t("admin.endpoints.title") }}
      </h2>
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
          <div
            class="grid grid-cols-[170px_190px_1fr_96px_96px_120px] px-4.5 bg-charcoal-light border-b border-charcoal-border"
          >
            <span v-for="h in HEADERS" :key="h.key" :class="headerClass(h)">
              {{ $t(`admin.endpoints.${h.key}`) }}
            </span>
          </div>
          <div
            v-for="row in rows"
            :key="`${row.provider}/${row.operation}`"
            class="grid grid-cols-[170px_190px_1fr_96px_96px_120px] px-4.5 border-b border-charcoal-border/60 items-center border-l-2"
            :class="row.rateLimited > 0 ? 'border-l-signal-warn' : 'border-l-transparent'"
          >
            <span class="flex items-center gap-2 py-2.5">
              <span class="w-2 h-2 flex-none" :class="providerBg(row.provider)" />
              <span class="font-mono text-xs text-text-primary">{{
                row.provider
              }}</span>
            </span>
            <span class="font-mono text-xs text-text-secondary py-2.5">{{
              row.operation
            }}</span>
            <span class="py-2.5 pr-6">
              <span class="block h-2 bg-search-bg">
                <span
                  class="block h-full"
                  :class="providerBg(row.provider)"
                  :style="{ width: `${sharePercent(row)}%` }"
                />
              </span>
            </span>
            <span class="font-mono text-xs text-text-primary py-2.5 text-right">{{
              row.success
            }}</span>
            <span
              class="font-mono text-xs py-2.5 text-right"
              :class="row.error > 0 ? 'text-text-primary' : 'text-chart-muted'"
              >{{ row.error || "—" }}</span
            >
            <span
              class="font-mono text-xs py-2.5 text-right"
              :class="row.rateLimited > 0 ? 'text-signal-warn' : 'text-chart-muted'"
              >{{ row.rateLimited || "—" }}</span
            >
          </div>
          <div
            class="grid grid-cols-[170px_190px_1fr_96px_96px_120px] px-4.5 bg-charcoal-light"
          >
            <span
              class="font-mono text-[10px] tracking-[0.16em] uppercase text-text-secondary py-2.75"
              >{{ $t("admin.endpoints.total") }}</span
            >
            <span /><span />
            <span class="font-mono text-xs text-text-primary py-2.75 text-right">{{
              grand.success
            }}</span>
            <span class="font-mono text-xs text-text-primary py-2.75 text-right">{{
              grand.error
            }}</span>
            <span
              class="font-mono text-xs py-2.75 text-right"
              :class="grand.rateLimited > 0 ? 'text-signal-warn' : 'text-text-primary'"
              >{{ grand.rateLimited }}</span
            >
          </div>
        </div>

        <!-- Mobile: two lines per endpoint, same numbers in ok / err / 429 order. -->
        <div class="md:hidden">
          <div
            v-for="row in rows"
            :key="`${row.provider}/${row.operation}`"
            class="px-3 py-2.5 border-b border-charcoal-border/60 border-l-2"
            :class="row.rateLimited > 0 ? 'border-l-signal-warn' : 'border-l-transparent'"
          >
            <div class="flex justify-between items-baseline gap-2.5">
              <span class="flex items-center gap-1.5 min-w-0">
                <span
                  class="w-1.75 h-1.75 flex-none"
                  :class="providerBg(row.provider)"
                />
                <span class="font-mono text-[11px] text-text-primary truncate">{{
                  row.operation
                }}</span>
              </span>
              <span class="flex gap-2.5 flex-none font-mono text-[11px]">
                <span class="text-text-primary">{{ row.success }}</span>
                <span
                  :class="row.error > 0 ? 'text-text-primary' : 'text-chart-muted'"
                  >{{ row.error || "—" }}</span
                >
                <span
                  :class="row.rateLimited > 0 ? 'text-signal-warn' : 'text-chart-muted'"
                  >{{ row.rateLimited || "—" }}</span
                >
              </span>
            </div>
            <div class="flex items-center gap-2.5 mt-1.5 pl-3.25">
              <span class="font-mono text-[10px] text-chart-muted flex-none">{{
                row.provider
              }}</span>
              <span class="flex-1 h-1.25 bg-search-bg">
                <span
                  class="block h-full"
                  :class="providerBg(row.provider)"
                  :style="{ width: `${sharePercent(row)}%` }"
                />
              </span>
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

const props = defineProps<{
  rows: UsageTotal[];
  rangeLabel: string;
}>();

const HEADERS = [
  { key: "provider", align: "left" },
  { key: "operation", align: "left" },
  { key: "share", align: "left" },
  { key: "success", align: "right" },
  { key: "errors", align: "right" },
  { key: "rate_limited", align: "right" },
] as const;

const headerClass = (h: (typeof HEADERS)[number]) => [
  "font-mono text-[9px] tracking-[0.16em] uppercase text-text-secondary py-2.75",
  h.align === "right" ? "text-right" : "",
];

const PROVIDER_BG: Record<string, string> = {
  google_books: "bg-orange-neon",
  openlibrary: "bg-chart-total",
  wikidata: "bg-chart-muted",
};
// An operation from a provider this build doesn't know about still gets a bar, just a neutral
// one — the counters are written by the worker and can outrun the frontend across a deploy.
const providerBg = (provider: string) =>
  PROVIDER_BG[provider] ?? "bg-chart-muted";

const calls = (r: UsageTotal) => r.success + r.error + r.rateLimited;

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

// Scaled against the busiest endpoint rather than the total: with nine rows, shares of the whole
// are all short stubs and the bar stops distinguishing anything.
const busiest = computed(() =>
  props.rows.reduce((m, r) => Math.max(m, calls(r)), 0),
);
const sharePercent = (r: UsageTotal) =>
  busiest.value > 0 ? (calls(r) / busiest.value) * 100 : 0;
</script>
