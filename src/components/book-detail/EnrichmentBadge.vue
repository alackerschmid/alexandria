<template>
  <div
    v-if="!guest && !readonly && status && status !== 'done'"
    class="flex items-center gap-1.5"
    :class="status === 'failed' ? 'text-error/60' : 'text-text-secondary/30'"
  >
    <v-icon
      :icon="
        status === 'failed' ? 'mdi-alert-circle-outline' : 'mdi-progress-clock'
      "
      :size="iconSize"
    />
    <span class="text-[9px] tracking-[0.15em] uppercase">
      {{ $t(`detail.enrichment_${status}`) }}
    </span>
  </div>
</template>

<script setup lang="ts">
// Pending/failed enrichment indicator, shared by the card and full detail views.
// Positioning (margins) is supplied by the parent via fall-through class.
withDefaults(
  defineProps<{
    status?: string;
    guest?: boolean;
    readonly?: boolean;
    iconSize?: number | string;
  }>(),
  { iconSize: 10 },
);
</script>
