<template>
  <!-- No reading cap of its own: a pane narrower than the section rule above it leaves the rule
       overhanging to the right and the whole page reading left-heavy. The measure is the measure. -->
  <div>
    <!-- The publisher blurb may be clamped; the user's own review never is. It is the one long
         block here that isn't theirs, so it must not push everything else off screen. -->
    <div v-if="book.description" class="mb-8">
      <p
        ref="blurbEl"
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
      <div class="micro-label mb-3">{{ $t("detail.first_line") }}</div>
      <p
        class="text-sm md:text-[15px] leading-[1.8] text-text-secondary italic border-l-2 border-charcoal-border pl-4"
      >
        {{ book.first_line }}
      </p>
    </div>

    <div v-if="book.epigraph" class="mb-8">
      <div class="micro-label mb-3">{{ $t("detail.epigraph") }}</div>
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
import {
  nextTick,
  onMounted,
  onUnmounted,
  ref,
  useTemplateRef,
  watch,
} from "vue";
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

// Whether the blurb is actually being cut off, measured rather than guessed from its length: how
// many characters fit in seven lines depends on the column width, and a character budget tuned for
// the desktop measure silently withholds "Show more" on mobile, where the same text wraps to far
// more lines — leaving the tail unreachable. Comparing scrollHeight to clientHeight asks the
// question the clamp actually answers, at whatever width the pane happens to be.
const blurbEl = useTemplateRef<HTMLElement>("blurbEl");
const clampable = ref(false);

function measureClamp() {
  const el = blurbEl.value;
  // Only meaningful while the clamp is applied; once expanded the element is its full height and
  // would measure as not-overflowing, which would pull the "Show less" button out from under it.
  if (!el || props.expanded) return;
  clampable.value = el.scrollHeight - el.clientHeight > 1;
}

let observer: ResizeObserver | null = null;
onMounted(() => {
  observer = new ResizeObserver(measureClamp);
  if (blurbEl.value) observer.observe(blurbEl.value);
  measureClamp();
});
onUnmounted(() => observer?.disconnect());

// A new book re-renders the same <p>, so the observer may not fire — re-measure explicitly.
watch(
  () => props.book.description,
  () => nextTick(measureClamp),
);
</script>
