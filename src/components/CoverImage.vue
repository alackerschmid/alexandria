<template>
  <img
    v-if="src && !failed"
    :src="src"
    :alt="alt"
    referrerpolicy="no-referrer"
    @error="onError"
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

// A stored object that fails to load falls back to the upstream URL the row still carries, before
// the placeholder. D1 and the bucket can diverge — a production D1 snapshot restored into local
// dev against an empty local R2, a bucket recreated, an object lifecycle-deleted — and the serve
// route answers a miss with a 404 rather than redirecting upstream (deliberately). Without this
// step every row has a key, every request 404s, and the whole library renders as placeholder tiles
// with perfectly good `cover_url`s sitting unused in these very props.
const storedFailed = ref(false);
const src = computed(() =>
  storedFailed.value
    ? (props.coverUrl ?? null)
    : coverSrc(props.coverUrl, props.objectKey),
);

// Swaps to PlaceholderCover when there is nothing left to try, rather than leaving the browser's
// native broken-image glyph on screen.
const failed = ref(false);

function onError() {
  // Only the stored object gets a second chance, and only when the upstream URL is a different
  // thing to try — otherwise this is already the fallback and there is nowhere left to go.
  if (!storedFailed.value && props.coverUrl && src.value !== props.coverUrl) {
    storedFailed.value = true;
    return;
  }
  failed.value = true;
}

// Reset per book — not per resolved src, which would clear `storedFailed` the moment it flipped and
// loop between the two sources. An edition switch, a refetch, *or* a book whose cover has just been
// stored in R2 gets a fresh attempt at both instead of being stuck on the placeholder.
watch(
  [() => props.coverUrl, () => props.objectKey],
  () => {
    storedFailed.value = false;
    failed.value = false;
  },
);
</script>
