<template>
  <!-- A share of the busiest row, as a track with a fill. Both board tables draw one in each of
       their two layouts; the track height and the flex behaviour differ per site and come in as
       fallthrough classes, the construct itself doesn't. -->
  <span class="bg-search-bg">
    <span class="block h-full" :class="barClass" :style="{ width: `${percent}%` }" />
  </span>
</template>

<script setup lang="ts">
defineProps<{
  /** Already scaled by `barPercent` — non-zero values carry its visible floor. */
  percent: number;
  barClass: string;
}>();
</script>
