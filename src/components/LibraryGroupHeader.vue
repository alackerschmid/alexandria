<template>
  <h2 class="contents">
    <button
      v-if="seriesId != null"
      type="button"
      class="font-heading font-bold hover:text-orange-neon transition-colors text-left min-w-0 truncate"
      :class="[
        sizeClasses.title,
        linkHighlightsComplete && complete ? 'text-orange-neon' : 'text-text-primary',
      ]"
      @click="$emit('select')"
    >
      {{ text }}
    </button>
    <span
      v-else
      class="font-heading font-bold min-w-0 truncate"
      :class="[sizeClasses.title, complete ? 'text-orange-neon' : 'text-text-primary']"
    >
      {{ text }}
    </span>
  </h2>
  <span
    class="font-mono text-text-secondary/50 shrink-0"
    :class="sizeClasses.count"
    >{{ countLabel }}</span
  >
  <span
    v-if="complete"
    class="shrink-0 font-mono uppercase text-orange-neon border border-orange-neon/40 bg-orange-neon/10"
    :class="sizeClasses.badge"
  >
    {{ $t("library.complete") }}
  </span>
  <span
    v-if="showDivider"
    class="flex-1 h-px"
    :class="complete ? 'bg-orange-neon/25' : 'bg-charcoal-border'"
  />
  <slot />
</template>

<script lang="ts" setup>
import { computed } from "vue";

const props = withDefaults(
  defineProps<{
    text: string;
    seriesId: number | null;
    complete: boolean;
    countLabel: string;
    // "compact" = packed desktop tile/list shelf headers; "full" = mobile classic layout.
    size?: "compact" | "full";
    showDivider?: boolean;
    // Mobile's classic layout historically left its clickable (series) title always
    // text-text-primary regardless of `complete`, unlike its own non-clickable span and
    // the packed layouts' title of either kind — preserved here rather than unified,
    // since that's a pre-existing inconsistency out of this component's scope to fix.
    linkHighlightsComplete?: boolean;
  }>(),
  { size: "compact", showDivider: true, linkHighlightsComplete: true },
);

defineEmits<{ select: [] }>();

const SIZE_CLASSES = {
  compact: {
    title: "text-lg",
    count: "text-[9px]",
    badge: "text-[7px] tracking-[0.14em] px-1 py-0.5",
  },
  full: {
    title: "text-2xl",
    count: "text-[10px]",
    badge: "text-[8px] tracking-[0.16em] px-1.5 py-0.5",
  },
} as const;

const sizeClasses = computed(() => SIZE_CLASSES[props.size]);
</script>
