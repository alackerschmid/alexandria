<template>
  <!-- The board's top strip: four at-a-glance signals plus the instance cell. Each pip carries a
       colored edge so its state reads before the number does. -->
  <div class="grid grid-cols-2 md:grid-cols-5 border-b border-charcoal-border">
    <div
      v-for="(pip, i) in pips"
      :key="pip.key"
      class="flex items-stretch border-charcoal-border border-b md:border-b-0 md:border-r"
      :class="i % 2 === 0 ? 'border-r' : ''"
    >
      <span class="w-1.5 flex-none" :class="signalBg(pip.level)" />
      <div class="px-4 py-3 md:px-5 md:py-3.5">
        <p
          class="font-mono text-[8px] md:text-[9px] tracking-[0.2em] uppercase text-text-secondary mb-1.5"
        >
          {{ pip.label }}
        </p>
        <p
          class="font-mono text-[17px] md:text-xl leading-none"
          :class="signalText(pip.level)"
        >
          {{ pip.value }}
        </p>
      </div>
    </div>

    <div class="col-span-2 md:col-span-1 flex items-stretch justify-between">
      <div class="px-4 py-3 md:px-5 md:py-3.5">
        <p
          class="font-mono text-[8px] md:text-[9px] tracking-[0.2em] uppercase text-text-secondary mb-1.5"
        >
          {{ $t("admin.pips.instance") }}
        </p>
        <p class="font-mono text-[11px] text-text-secondary">bookscan-worker</p>
      </div>
      <button
        type="button"
        class="self-center mr-4 md:mr-5 border border-charcoal-border px-3.5 py-2 font-mono text-[10px] tracking-[0.16em] uppercase text-text-secondary hover:text-text-primary hover:border-control-border transition-colors disabled:opacity-50"
        :disabled="loading"
        @click="emit('refresh')"
      >
        {{ loading ? $t("admin.refreshing") : $t("admin.refresh") }}
      </button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { SignalLevel } from "@/utils/admin-signal";
import { signalBg, signalText } from "@/utils/admin-signal";

const props = defineProps<{
  /** null means "no reading" — the section is still loading, or its fetch failed. */
  quotaPercent: number | null;
  quotaLevel: SignalLevel;
  enrichmentPercent: number | null;
  runFailurePercent: number | null;
  runFailureLevel: SignalLevel;
  rateLimited: number | null;
  rangeLabel: string;
  loading: boolean;
}>();

const emit = defineEmits<{ refresh: [] }>();

const { t } = useI18n();

const NO_READING = "—";
const asPercent = (v: number | null) =>
  v === null ? NO_READING : `${Math.round(v)}%`;
const level = (v: number | null, actual: SignalLevel): SignalLevel =>
  v === null ? "neutral" : actual;

const pips = computed(() => [
  {
    key: "quota",
    label: t("admin.pips.quota"),
    value: asPercent(props.quotaPercent),
    level: level(props.quotaPercent, props.quotaLevel),
  },
  {
    key: "enrichment",
    label: t("admin.pips.enrichment"),
    value: asPercent(props.enrichmentPercent),
    level: level(props.enrichmentPercent, "ok"),
  },
  {
    key: "failures",
    label: t("admin.pips.run_failures"),
    value: asPercent(props.runFailurePercent),
    level: level(props.runFailurePercent, props.runFailureLevel),
  },
  {
    key: "rate_limited",
    label: t("admin.pips.rate_limited", { range: props.rangeLabel }),
    value: props.rateLimited === null ? NO_READING : String(props.rateLimited),
    level: level(
      props.rateLimited,
      (props.rateLimited ?? 0) > 0 ? "warning" : "ok",
    ),
  },
]);
</script>
