<template>
  <span
    class="inline-block shrink-0 w-9 h-5 rounded-full relative transition-colors"
    :class="modelValue ? (onColor ? '' : 'bg-orange-neon') : 'bg-charcoal-border'"
    :style="modelValue && onColor ? { background: onColor } : undefined"
  >
    <span
      class="absolute top-0.5 w-4 h-4 rounded-full bg-charcoal transition-all"
      :class="modelValue ? 'left-[18px]' : 'left-0.5'"
    />
  </span>
</template>

<script lang="ts" setup>
defineProps<{
  modelValue: boolean;
  /** Accent-driven on-state color (e.g. the user's chosen accent), overriding the default orange-neon token. */
  onColor?: string;
}>();
</script>
