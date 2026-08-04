<template>
  <!-- The one number the page exists for: how much of today's Google Books quota is gone. -->
  <section>
    <div
      class="flex flex-col md:flex-row md:justify-between md:items-end gap-3 mb-3.5"
    >
      <div class="flex items-center gap-3">
        <SectionHeading :title="$t('admin.quota.title')" />
        <span
          class="font-mono text-[8px] md:text-[11px] tracking-[0.14em] uppercase px-2 py-0.5 md:px-2.5 md:py-1 border"
          :class="[signalText(level), signalBorder(level)]"
        >
          {{ stateLabel }}
        </span>
      </div>
      <div class="flex flex-wrap gap-x-6 gap-y-1 md:gap-7.5">
        <span class="font-mono text-[10px] md:text-[11px] text-text-secondary">
          {{ $t("admin.quota.remaining") }}
          <span class="text-text-primary">{{ fmt(remaining) }}</span>
        </span>
        <span class="font-mono text-[10px] md:text-[11px] text-text-secondary">
          {{ $t("admin.quota.projected") }}
          <span :class="projectedClass">{{
            projected === null ? "—" : fmt(projected)
          }}</span>
        </span>
        <span
          v-if="peak"
          class="font-mono text-[10px] md:text-[11px] text-text-secondary"
        >
          {{ $t("admin.quota.peak") }}
          <span class="text-text-primary">{{ peak }}</span>
        </span>
      </div>
    </div>

    <div class="flex flex-col md:flex-row md:items-stretch gap-3.5 md:gap-6">
      <div class="flex items-baseline gap-2 md:w-72 md:flex-none">
        <span
          class="font-mono text-[44px] md:text-[64px] leading-[0.9] tracking-tight"
          :class="signalText(level)"
          >{{ fmt(used) }}</span
        >
        <span class="font-mono text-base md:text-[22px] text-chart-muted"
          >/{{ limit }}</span
        >
      </div>

      <div class="flex-1 min-w-0">
        <div
          class="relative h-9 md:h-14 bg-search-bg border border-charcoal-border"
        >
          <div
            class="absolute left-0 top-0 bottom-0"
            :class="signalBg(level)"
            :style="{ width: `${fillPercent}%` }"
          />
          <!-- Tick grid drawn over the fill so the bar reads as a gauge, not a progress bar. -->
          <div class="absolute inset-0 flex">
            <span
              v-for="i in TICKS"
              :key="i"
              class="flex-1 border-r border-charcoal/50 last:border-r-0"
            />
          </div>
          <div
            class="absolute -top-1.5 -bottom-1.5 w-0.5 bg-text-primary"
            :style="{ left: `${QUOTA_WARN_PERCENT}%` }"
          />
        </div>
        <div class="flex justify-between mt-2">
          <span class="font-mono text-[9px] text-chart-muted">0</span>
          <span class="font-mono text-[9px] tracking-[0.1em] text-text-secondary">
            {{ $t("admin.quota.warn_marker", { percent: QUOTA_WARN_PERCENT }) }}
          </span>
          <span class="font-mono text-[9px] text-chart-muted">
            {{ $t("admin.quota.cap", { limit: fmt(limit) }) }}
          </span>
        </div>
      </div>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { signalBg, signalBorder, signalText } from "@/utils/admin-signal";
import type { SignalLevel } from "@/utils/admin-signal";
import { QUOTA_WARN_PERCENT, percent } from "@/utils/admin-usage";
import SectionHeading from "@/components/admin/SectionHeading.vue";
import { useAdminFormat } from "@/composables/useAdminFormat";

const props = defineProps<{
  used: number;
  limit: number;
  /** The gauge only renders with data loaded, so there is no `neutral` reading to show. */
  level: Exclude<SignalLevel, "neutral">;
  /** null until enough of the UTC day has elapsed to extrapolate from. */
  projected: number | null;
  /** Pre-formatted "14:00 · 96", or null when nothing was recorded in the window. */
  peak: string | null;
}>();

const { t } = useI18n();
const { formatCount: fmt } = useAdminFormat();

const TICKS = 20;

const fillPercent = computed(() =>
  Math.min(100, percent(props.used, props.limit)),
);
const remaining = computed(() => Math.max(0, props.limit - props.used));

const stateLabel = computed(() => t(`admin.quota.state.${props.level}`));

// The projection is the early warning — it goes amber/red on its own once the day is on track
// to blow the cap, even while `used` is still comfortably inside it.
const projectedClass = computed(() => {
  if (props.projected === null) return "text-text-secondary";
  if (props.projected > props.limit) return signalText("critical");
  return props.projected > props.limit * (QUOTA_WARN_PERCENT / 100)
    ? signalText("warning")
    : "text-text-primary";
});
</script>
