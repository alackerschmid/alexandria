<script setup lang="ts">
import { computed } from "vue";
import { ratingDots } from "@/composables/useRating";

// The 10-dot rating row, shared by every surface that shows or edits a rating: the book detail
// card + row, the rating dialog, the scanner picker and the Goodreads import table.
//
// Interactive rows render buttons and toggle: clicking the dot that already represents the
// current value clears the rating. Display-only rows render spans, because they are usually
// nested inside a button (which can't contain another button).

const props = withDefaults(
  defineProps<{
    rating: number | null;
    size?: "sm" | "md" | "lg";
    interactive?: boolean;
  }>(),
  { size: "sm", interactive: false },
);

const emit = defineEmits<{ "update:rating": [rating: number | null] }>();

// Dot spacing scales with dot size — these are the gaps each call site used before extraction.
const GAP_CLASS = { sm: "gap-0.5", md: "gap-1", lg: "gap-2" } as const;

const dots = computed(() => ratingDots(props.rating, props.size));

function pick(n: number) {
  emit("update:rating", props.rating === n ? null : n);
}
</script>

<template>
  <span class="inline-flex items-center" :class="GAP_CLASS[size]">
    <template v-if="interactive">
      <button
        v-for="d in dots"
        :key="d.n"
        type="button"
        :aria-label="String(d.n)"
        class="p-0 border-0 bg-transparent leading-none cursor-pointer"
        @click="pick(d.n)"
      >
        <span :style="d.style" />
      </button>
    </template>
    <template v-else>
      <span v-for="d in dots" :key="d.n" :style="d.style" />
    </template>
  </span>
</template>
