<template>
  <component
    :is="to ? 'router-link' : 'div'"
    :to="to"
    class="block"
    :class="to ? 'cursor-pointer hover:opacity-70 transition-opacity' : ''"
  >
    <div class="flex justify-between items-baseline gap-4 mb-1.5">
      <span class="min-w-0 truncate" :class="labelClass">
        <slot name="label">{{ label }}</slot>
      </span>
      <span class="flex-none font-mono text-[11px] text-text-secondary">
        <slot name="tail">{{ tail }}</slot>
      </span>
    </div>
    <!-- `overflow-hidden` so a width over 100% clips at the track rather than escaping it and
         making the whole page scroll sideways. Callers are supposed to scale against their own
         maximum; this is the containment that keeps a mistake there local. -->
    <div class="h-[3px] bg-charcoal-border relative overflow-hidden">
      <div
        class="absolute left-0 top-0 bottom-0"
        :style="{ width, background: color }"
      />
    </div>
  </component>
</template>

<script lang="ts" setup>
// The single most repeated element in the stats layout: a label, a right-aligned figure, and a
// 3px progress track. Backs the rating histogram, the collection breakdown and the origins list.
// The track idiom (hairline background + absolutely positioned fill) is the app's established
// one — see the home dashboard's bars and UsageChart; there is no charting library.
import type { RouteLocationRaw } from "vue-router";

withDefaults(
  defineProps<{
    label?: string;
    tail?: string;
    /** CSS width of the filled portion, e.g. "72%". */
    width: string;
    color: string;
    /** Renders the row as a link when set. */
    to?: RouteLocationRaw;
    /** Serif for editorial rows (genres, authors), mono for numeric ones (rating stars). */
    labelClass?: string;
  }>(),
  {
    label: "",
    tail: "",
    to: undefined,
    labelClass: "font-heading font-bold text-sm text-text-primary",
  },
);
</script>
