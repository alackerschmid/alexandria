<template>
  <div>
    <div class="flex items-end gap-1.5 md:gap-2.5 h-[150px] md:h-[180px]">
      <router-link
        v-for="bar in bars"
        :key="bar.label"
        :to="linkFor(bar)"
        class="flex-1 flex flex-col justify-end h-full hover:opacity-70 transition-opacity"
        :aria-label="ariaFor(bar)"
      >
        <div
          class="font-mono text-[9px] md:text-[10px] mb-1.5 text-center"
          :class="bar.peak ? 'text-text-primary' : 'text-text-secondary'"
        >
          {{ bar.count.toLocaleString() }}
        </div>
        <div
          :style="{ height: bar.height, background: colorFor(bar) }"
          class="min-h-px"
        />
      </router-link>
    </div>
    <div
      class="flex gap-1.5 md:gap-2.5 mt-2 pt-2 border-t border-charcoal-border"
    >
      <div
        v-for="bar in bars"
        :key="bar.label"
        class="flex-1 font-mono text-[9px] text-center truncate"
        :class="bar.peak ? 'text-text-primary' : 'text-text-secondary'"
      >
        {{ axisLabel(bar) }}
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { useI18n } from "vue-i18n";
import type { RouteLocationRaw } from "vue-router";
import type { DecadeBar } from "@/utils/stats-view";

const props = defineProps<{
  bars: DecadeBar[];
  /** Accent for the tallest bar; every other bar steps down from it. */
  ramp: string[];
  /** Compact axis labels ("90s" rather than "1990s") for the mobile layout. */
  compact?: boolean;
}>();

const { t } = useI18n();

// Three tiers rather than a per-bar ramp stop: the ramp is categorical (one colour per named
// thing) and these bars are one series measured against itself, so height already carries the
// magnitude. Tinting by height only reinforces it.
function colorFor(bar: DecadeBar): string {
  if (bar.peak) return "rgb(var(--v-theme-primary))";
  const pct = parseFloat(bar.height);
  return pct >= 50 ? props.ramp[1] : props.ramp[3];
}

function axisLabel(bar: DecadeBar): string {
  if (bar.rollup) return props.compact ? "<60" : bar.label;
  return props.compact ? `${bar.label.slice(2)}` : bar.label;
}

function ariaFor(bar: DecadeBar): string {
  return t("stats.decade_aria", { decade: bar.label, count: bar.count });
}

// `year:` is a substring match on `original_pub_date`, so a decade is its 3-digit prefix —
// `year:199` is "the 1990s". A rolled-up bucket spans many decades and has no such prefix, so
// it goes to the unfiltered library rather than to a token that would match nothing.
//
// Caveat: that filter reads `original_pub_date` only, while the histogram's own bucketing falls
// back to the edition's `publish_date` when the work has no original year. A book placed by
// that fallback is counted in the bar but won't come back from the link.
function linkFor(bar: DecadeBar): RouteLocationRaw {
  if (bar.rollup) return { name: "library" };
  return { name: "library", query: { q: `year:${bar.label.slice(0, 3)}` } };
}
</script>
