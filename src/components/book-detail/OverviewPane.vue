<template>
  <!-- No reading cap of its own: a pane narrower than the section rule above it leaves the rule
       overhanging to the right and the whole page reading left-heavy. The measure is the measure. -->
  <div>
    <!-- The publisher blurb may be clamped; the user's own review never is. It is the one long
         block here that isn't theirs, so it must not push everything else off screen. -->
    <div v-if="book.description" class="mb-8">
      <p
        class="text-[15px] md:text-base leading-[1.8] text-text-secondary text-pretty"
        :class="expanded ? '' : 'line-clamp-7'"
      >
        {{ book.description }}
      </p>
      <button
        v-if="clampable"
        class="mt-2 text-[10px] tracking-[0.18em] uppercase text-text-secondary hover:text-orange-neon transition-colors"
        @click="$emit('update:expanded', !expanded)"
      >
        {{ expanded ? $t("detail.show_less") : $t("detail.show_more") }}
      </button>
      <OverrideDot
        v-if="book.description_overridden"
        class="w-1.5 h-1.5 inline-block ml-2 align-middle"
      />
    </div>

    <div v-if="book.first_line" class="mb-8">
      <div class="pane-label mb-3">{{ $t("detail.first_line") }}</div>
      <p
        class="text-sm md:text-[15px] leading-[1.8] text-text-secondary italic border-l-2 border-charcoal-border pl-4"
      >
        {{ book.first_line }}
      </p>
    </div>

    <div v-if="book.epigraph" class="mb-8">
      <div class="pane-label mb-3">{{ $t("detail.epigraph") }}</div>
      <p
        class="text-sm md:text-[15px] leading-[1.8] text-text-secondary italic border-l-2 border-charcoal-border pl-4"
      >
        {{ book.epigraph }}
      </p>
    </div>

    <!-- Genres are identity, not trivia — squared hairline chips sitting with the text rather
         than a labelled list of their own. -->
    <div v-if="book.genres?.length" class="flex flex-wrap gap-2">
      <button
        v-for="genre in book.genres"
        :key="genre"
        class="border border-control-border px-3 py-1.5 text-[11px] text-text-primary hover:border-orange-neon hover:text-orange-neon transition-colors"
        @click="$emit('filter', 'genre', genre)"
      >
        {{ genre }}
      </button>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed } from "vue";
import OverrideDot from "@/components/OverrideDot.vue";
import type { BookWithOverrides } from "@/types/book";

// What the book is about, in the publisher's words and the author's first. Whether it renders at
// all is decided upstream by `hasOverview` in utils/detail-tabs.ts — a pane that would be empty
// never becomes a tab.
const props = defineProps<{
  book: BookWithOverrides;
  expanded: boolean;
}>();

defineEmits<{
  "update:expanded": [value: boolean];
  filter: [field: "genre", value: string];
}>();

// Rough character budget for seven lines at this measure — cheap enough to compute per render and
// avoids the layout thrash of measuring scrollHeight just to decide whether to offer "More".
const CLAMP_CHARS = 520;

const clampable = computed(
  () => (props.book.description?.length ?? 0) > CLAMP_CHARS,
);
</script>

<style scoped>
.pane-label {
  font-size: 10px;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: var(--color-text-secondary);
  opacity: 0.75;
}
</style>
