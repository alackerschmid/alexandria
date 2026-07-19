<template>
  <img
    v-if="coverUrl && !failed"
    :src="coverUrl"
    :alt="alt"
    @error="failed = true"
  />
  <PlaceholderCover
    v-else
    :title="title"
    :ghost="ghost"
    :text-class="textClass"
    :icon-size="iconSize"
    :show-missing-indicator="showMissingIndicator || failed"
  />
</template>

<script lang="ts" setup>
import { ref, watch } from "vue";
import PlaceholderCover from "@/components/PlaceholderCover.vue";

const props = withDefaults(
  defineProps<{
    coverUrl: string | null;
    title: string | null;
    alt?: string;
    ghost?: boolean;
    textClass?: string;
    iconSize?: number;
    /** Force the "no image" icon even while a cover URL is still untried (e.g. series.vue's
     *  unowned placeholder rows). Combined with `failed` so a load failure always shows it too. */
    showMissingIndicator?: boolean;
  }>(),
  {
    alt: "",
    ghost: false,
    showMissingIndicator: false,
  },
);

// Swaps to PlaceholderCover when the <img> fails to load (dead/expired cover URL) rather than
// leaving the browser's native broken-image glyph on screen. Resets per coverUrl so a later
// edition switch or refetch gets a fresh attempt instead of being stuck on the placeholder.
const failed = ref(false);
watch(
  () => props.coverUrl,
  () => {
    failed.value = false;
  },
);
</script>
