<template>
  <div>
    <div class="flex h-3 gap-0.5">
      <div
        v-for="seg in segments"
        :key="seg.key"
        :style="{ width: seg.width, background: seg.color }"
        :title="`${bandLabel(seg.key)} — ${seg.count.toLocaleString()}`"
      />
    </div>
    <div
      class="grid grid-cols-2 md:grid-cols-5 gap-x-5 gap-y-2.5 md:gap-y-2 mt-4"
    >
      <div
        v-for="seg in segments"
        :key="seg.key"
        class="flex items-center gap-2"
      >
        <span
          class="w-2 h-2 flex-none"
          :style="{ background: seg.color }"
        />
        <span class="flex-1 min-w-0 truncate text-xs text-text-primary">{{
          bandLabel(seg.key)
        }}</span>
        <span class="font-mono text-[10px] text-text-secondary">{{
          seg.count.toLocaleString()
        }}</span>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { useI18n } from "vue-i18n";
import type { LengthSegment } from "@/utils/stats-view";

defineProps<{ segments: LengthSegment[] }>();

const { t } = useI18n();

// The worker ships stable band ids ("<200", "200-350"), not display text, so the labels stay
// translatable and the boundaries can move server-side without a locale change. An id with no
// key falls back to itself rather than rendering an empty cell.
const BAND_KEYS: Record<string, string> = {
  "<200": "stats.pages_band_xs",
  "200-350": "stats.pages_band_sm",
  "350-500": "stats.pages_band_md",
  "500-750": "stats.pages_band_lg",
  "750+": "stats.pages_band_xl",
};

const bandLabel = (key: string) =>
  BAND_KEYS[key] ? t(BAND_KEYS[key]) : key;
</script>
