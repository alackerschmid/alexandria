<template>
  <div v-if="totalPages > 1" class="flex flex-col items-center gap-2 py-10">
    <span
      class="font-mono text-[10px] text-text-secondary/40 tracking-[0.06em]"
    >
      {{ $t("library.page_of", { start: rangeStart, end: rangeEnd, total }) }}
    </span>
    <div class="flex items-center gap-0.5">
      <button
        class="w-8 h-8 flex items-center justify-center text-text-secondary transition-colors"
        :class="
          currentPage === 1
            ? 'opacity-25 pointer-events-none'
            : 'hover:text-text-primary'
        "
        @click="$emit('change', currentPage - 1)"
      >
        <v-icon icon="mdi-chevron-left" size="16" />
      </button>

      <template v-for="(item, i) in pageItems" :key="i">
        <span
          v-if="item === null"
          class="w-7 h-8 flex items-center justify-center font-mono text-[10px] text-text-secondary/30"
          >…</span
        >
        <button
          v-else
          class="w-7 h-8 flex items-center justify-center font-mono text-[11px] tracking-[0.08em] transition-colors"
          :class="
            item === currentPage
              ? 'text-text-primary border-b border-orange-neon'
              : 'text-text-secondary/50 hover:text-text-primary'
          "
          @click="$emit('change', item)"
        >
          {{ item }}
        </button>
      </template>

      <button
        class="w-8 h-8 flex items-center justify-center text-text-secondary transition-colors"
        :class="
          currentPage === totalPages
            ? 'opacity-25 pointer-events-none'
            : 'hover:text-text-primary'
        "
        @click="$emit('change', currentPage + 1)"
      >
        <v-icon icon="mdi-chevron-right" size="16" />
      </button>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed } from "vue";

const props = defineProps<{
  currentPage: number;
  totalPages: number;
  rangeStart: number;
  rangeEnd: number;
  total: number;
}>();

defineEmits<{ change: [page: number] }>();

const pageItems = computed<(number | null)[]>(() => {
  const { totalPages: total, currentPage: cur } = props;
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: (number | null)[] = [1];
  if (cur > 3) pages.push(null);
  for (let i = Math.max(2, cur - 1); i <= Math.min(total - 1, cur + 1); i++)
    pages.push(i);
  if (cur < total - 2) pages.push(null);
  pages.push(total);
  return pages;
});
</script>
