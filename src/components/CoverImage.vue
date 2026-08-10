<template>
  <img
    v-if="src && !failed"
    :src="src"
    :alt="alt"
    referrerpolicy="no-referrer"
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
import { computed, ref, watch } from "vue";
import PlaceholderCover from "@/components/PlaceholderCover.vue";
import { coverSrc } from "@/utils/cover";

const props = withDefaults(
  defineProps<{
    coverUrl: string | null;
    /** R2 key of the cover stored on our own origin (`Book.cover_object_key`), when the row has
     *  one. Pass it wherever the book came from `GET /api/scans` — without it the `<img>` points
     *  at Google and the reader's browser tells them which books this shelf holds. Absent for
     *  covers that have no `books` row to store: search results, import candidates. */
    objectKey?: string | null;
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

const src = computed(() => coverSrc(props.coverUrl, props.objectKey));

// Swaps to PlaceholderCover when the <img> fails to load (dead/expired cover URL) rather than
// leaving the browser's native broken-image glyph on screen. Resets per resolved src — not per
// `coverUrl` — so an edition switch, a refetch, *or* a book whose cover has just been stored in R2
// gets a fresh attempt instead of being stuck on the placeholder.
const failed = ref(false);
watch(src, () => {
  failed.value = false;
});
</script>
