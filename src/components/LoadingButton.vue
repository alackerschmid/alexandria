<template>
  <button
    :type="type"
    :disabled="disabled || loading"
    :aria-busy="loading"
    class="w-full flex items-center justify-center gap-2 py-4 text-xs font-bold tracking-[0.25em] uppercase transition-opacity disabled:opacity-40"
  >
    <v-progress-circular v-if="loading" indeterminate size="14" width="2" />
    <slot />
  </button>
</template>

<script setup lang="ts">
withDefaults(
  defineProps<{
    loading: boolean;
    disabled?: boolean;
    type?: "button" | "submit";
  }>(),
  { disabled: false, type: "button" },
);
</script>
