<template>
  <div
    class="border-r border-b border-charcoal-border p-4 md:p-4.5 md:px-5.5 flex flex-col"
  >
    <div class="flex items-center gap-2 mb-3">
      <span
        class="w-[7px] h-[7px] rounded-full flex-none"
        :style="{ background: color }"
      />
      <span class="micro-label !text-[9px] !tracking-[0.2em] !opacity-100">{{
        label
      }}</span>
    </div>
    <div class="flex items-baseline gap-1.5 md:gap-2 mb-3">
      <span
        class="font-heading font-bold text-3xl md:text-[2.4rem] leading-none text-text-primary"
        >{{ value }}</span
      >
      <span class="font-mono text-[9px] text-text-secondary min-w-0 truncate">{{
        unit
      }}</span>
    </div>
    <!-- The bar is data coverage — what share of the collection this figure could be computed
         from — not a share of some invented maximum. "Average length, over the 55% of books
         whose page count we know" is a real and useful qualification; a 412-out-of-what bar
         would not be. `coverage` is omitted where the figure is already a true ratio. -->
    <div class="h-[3px] bg-charcoal-border relative mt-auto">
      <div
        class="absolute left-0 top-0 bottom-0"
        :style="{ width: coverage, background: color }"
      />
    </div>
  </div>
</template>

<script lang="ts" setup>
defineProps<{
  label: string;
  value: string;
  unit: string;
  /** CSS width, e.g. "74%". */
  coverage: string;
  color: string;
}>();
</script>
