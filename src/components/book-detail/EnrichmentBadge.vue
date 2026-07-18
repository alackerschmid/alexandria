<template>
  <div v-if="state" class="flex items-center gap-1.5" :class="state.class">
    <v-icon :icon="state.icon" :size="iconSize" />
    <span class="text-[9px] tracking-[0.15em] uppercase">
      {{ $t(state.label) }}
    </span>
  </div>
</template>

<script setup lang="ts">
// Pending/queued/failed enrichment indicator, shared by the card and full detail views.
// Positioning (margins) is supplied by the parent via fall-through class.
import { computed } from "vue";

const props = withDefaults(
  defineProps<{
    status?: string;
    // The detail view's poll gave up while the row was still pending. Not an error — after a bulk
    // import the sweeper backlog can be hours deep — so this reads as "queued", not "failed".
    timedOut?: boolean;
    guest?: boolean;
    readonly?: boolean;
    iconSize?: number | string;
  }>(),
  { iconSize: 10 },
);

const state = computed(() => {
  if (props.guest || props.readonly || !props.status || props.status === "done")
    return null;
  if (props.status === "failed")
    return {
      icon: "mdi-alert-circle-outline",
      class: "text-error/60",
      label: "detail.enrichment_failed",
    };
  return {
    icon: props.timedOut ? "mdi-tray-full" : "mdi-progress-clock",
    class: "text-text-secondary/30",
    label: props.timedOut
      ? "detail.enrichment_queued"
      : "detail.enrichment_pending",
  };
});
</script>
