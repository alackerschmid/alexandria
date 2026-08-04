<template>
  <!-- The header row for the board's desktop tables. The grid template belongs to the caller —
       it has to match the body rows exactly — but the type scale is the board's, not each
       table's, so it lives here rather than being restated per table. Every column sorts; the
       caller owns the ordering itself and reports it back through `sortKey`/`sortDirection`. -->
  <div
    class="px-4.5 bg-charcoal-light border-b border-charcoal-border"
    :class="gridClass"
  >
    <button
      v-for="col in columns"
      :key="col"
      type="button"
      :title="$t(sortKey === col ? 'admin.table.reverse' : 'admin.table.sort')"
      class="font-mono text-[9px] tracking-[0.16em] uppercase py-2.75 flex items-center gap-1"
      :class="[
        rightAligned.includes(col) ? 'justify-end' : '',
        sortKey === col
          ? 'text-orange-neon'
          : 'text-text-secondary hover:text-text-primary cursor-pointer transition-colors',
      ]"
      @click="emit('sort', col)"
    >
      {{ $t(`${keyPrefix}.${col}`) }}
      <span
        v-if="sortKey === col"
        class="text-[7px] leading-none"
        aria-hidden="true"
        >{{ sortDirection === "asc" ? "▲" : "▼" }}</span
      >
    </button>
  </div>
</template>

<script setup lang="ts">
import type { SortDirection } from "@/utils/admin-sort";

withDefaults(
  defineProps<{
    /** Column keys, in order; each is looked up as `${keyPrefix}.${col}`. */
    columns: readonly string[];
    /** Tailwind `grid grid-cols-[…]` matching the body rows. */
    gridClass: string;
    keyPrefix: string;
    rightAligned?: readonly string[];
    sortKey?: string | null;
    sortDirection?: SortDirection;
  }>(),
  {
    rightAligned: () => [],
    sortKey: null,
    sortDirection: "asc",
  },
);

const emit = defineEmits<{ sort: [key: string] }>();
</script>
