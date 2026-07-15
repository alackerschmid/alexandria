<template>
  <div
    class="flex items-center justify-between gap-6 py-4"
    :class="!first ? 'border-t border-charcoal-border/60' : ''"
  >
    <span class="text-[14px] text-text-primary">{{ label }}</span>
    <slot />
  </div>
</template>

<script setup lang="ts">
defineProps<{ label?: string; first?: boolean }>();
</script>
