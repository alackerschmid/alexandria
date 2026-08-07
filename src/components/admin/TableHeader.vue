<template>
  <!-- The header row for the board's desktop tables and for the drill-down dialogs. The grid
       template and the horizontal padding belong to the caller — the grid has to match the body
       rows exactly, and the dialogs inset further than the board does — but the type scale is the
       board's, not each table's, so it lives here rather than being restated per table.
       Sortable by default, with the caller owning the ordering and reporting it back through
       `sortKey`/`sortDirection`; the dialogs' fixed-order lists opt out. -->
  <div
    class="bg-charcoal-light border-b border-charcoal-border"
    :class="[padClass, gridClass]"
  >
    <component
      :is="sortable ? 'button' : 'span'"
      v-for="col in columns"
      :key="col"
      :type="sortable ? 'button' : undefined"
      :title="
        sortable
          ? $t(sortKey === col ? 'admin.table.reverse' : 'admin.table.sort')
          : undefined
      "
      class="font-mono text-[9px] tracking-[0.16em] uppercase py-2.75 flex items-center gap-1"
      :class="[
        rightAligned.includes(col) ? 'justify-end' : '',
        sortKey === col
          ? 'text-orange-neon'
          : 'text-text-secondary',
        sortable && sortKey !== col
          ? 'hover:text-text-primary cursor-pointer transition-colors'
          : '',
      ]"
      @click="sortable && emit('sort', col)"
    >
      {{ $t(`${keyPrefix}.${col}`) }}
      <span
        v-if="sortKey === col"
        class="text-[7px] leading-none"
        aria-hidden="true"
        >{{ sortDirection === "asc" ? "▲" : "▼" }}</span
      >
    </component>
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
    /** Horizontal inset — must match the body rows below it. */
    padClass?: string;
    /** False for a list with a fixed order: renders labels rather than sort buttons. */
    sortable?: boolean;
    sortKey?: string | null;
    sortDirection?: SortDirection;
  }>(),
  {
    rightAligned: () => [],
    padClass: "px-4.5",
    sortable: true,
    sortKey: null,
    sortDirection: "asc",
  },
);

const emit = defineEmits<{ sort: [key: string] }>();
</script>
