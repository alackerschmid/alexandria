<template>
  <label class="flex flex-col gap-2">
    <span
      class="font-mono text-[10px] tracking-[0.16em] uppercase text-text-secondary"
    >
      {{ label }}
    </span>
    <slot />
  </label>
</template>

<script setup lang="ts">
defineProps<{ label?: string }>();
</script>
