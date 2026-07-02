<template>
  <div
    class="w-full h-full flex items-center justify-center relative"
    :style="{
      background: showMissingIndicator ? '#2a2825' : tint,
      filter: !showMissingIndicator && ghost ? 'grayscale(1)' : undefined,
      opacity: !showMissingIndicator && ghost ? 0.6 : 1,
    }"
  >
    <v-icon
      v-if="showMissingIndicator"
      icon="mdi-image-off-outline"
      :size="iconSize"
      style="color: rgba(236, 233, 227, 0.35)"
    />
    <span
      v-else
      class="font-heading font-bold leading-none"
      :class="textClass"
      style="color: rgba(236, 233, 227, 0.3)"
    >
      {{ glyph }}
    </span>
  </div>
</template>

<script lang="ts" setup>
import { computed } from "vue";
import { tintFor, initials } from "@/utils/cover";

const props = withDefaults(
  defineProps<{
    title: string | null;
    /** Grayed + translucent variant for unowned/missing books. */
    ghost?: boolean;
    /** Tailwind classes controlling the initials' font size. */
    textClass?: string;
    /** Size (px) of the icon (used for the "no image" indicator). */
    iconSize?: number;
    /** Render a flat gray "no image found" icon instead of tint + initials. */
    showMissingIndicator?: boolean;
  }>(),
  {
    ghost: false,
    textClass: "text-2xl",
    iconSize: 14,
    showMissingIndicator: false,
  },
);

const tint = computed(() => tintFor(props.title || "?"));
const glyph = computed(() => initials(props.title || "?"));
</script>
