<template>
  <!-- No reading cap of its own: a pane narrower than the section rule above it leaves the rule
       overhanging to the right and the whole page reading left-heavy. The measure is the measure. -->
  <div>
    <!-- The publisher blurb may be clamped; the user's own review never is. It is the one long
         block here that isn't theirs, so it must not push everything else off screen. -->
    <div class="mb-8">
      <div class="micro-label mb-3 flex items-center gap-1.5">
        {{ $t("detail.description") }}
        <OverrideDot
          v-if="book.description_overridden"
          class="w-1.5 h-1.5"
        />
      </div>
      <template v-if="book.description">
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
      </template>
      <p
        v-else
        class="text-[15px] md:text-base leading-[1.8] text-text-secondary/70 italic"
      >
        {{ $t("detail.description_empty") }}
      </p>
    </div>

    <div v-if="book.first_line" class="mb-8">
      <div class="micro-label mb-3">{{ $t("detail.first_line") }}</div>
      <p
        class="text-sm md:text-[15px] leading-[1.8] text-text-secondary italic border-l-2 border-charcoal-border pl-4"
      >
        {{ book.first_line }}
      </p>
    </div>

    <!-- `whitespace-pre-line` because an epigraph is usually verse and arrives with its line
         breaks encoded as `<br>` — see unescapeLineBreaks. -->
    <div v-if="book.epigraph" class="mb-8">
      <div class="micro-label mb-3">{{ $t("detail.epigraph") }}</div>
      <p
        class="text-sm md:text-[15px] leading-[1.8] text-text-secondary italic border-l-2 border-charcoal-border pl-4 whitespace-pre-line"
      >
        {{ unescapeLineBreaks(book.epigraph) }}
      </p>
    </div>

    <!-- Genres are identity, not trivia — squared hairline chips rather than a plain list. -->
    <div v-if="book.genres?.length">
      <div class="micro-label mb-3">{{ $t("detail.genres") }}</div>
      <div class="flex flex-wrap gap-2">
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
  </div>
</template>

<script lang="ts" setup>
import { nextTick, onUnmounted, ref, useTemplateRef, watch } from "vue";
import OverrideDot from "@/components/OverrideDot.vue";
import { unescapeLineBreaks } from "@/utils/book-display";
import type { BookWithOverrides } from "@/types/book";

// What the book is about, in the publisher's words and the author's first. The tab is offered for
// every book (see utils/detail-tabs.ts), so the pane owns its own empty state: a labelled
// "no description available" rather than a section that silently isn't there.
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

// The <p> is `v-if`'d on there being a description at all, so the element to watch can arrive long
// after mount — a description filled in by enrichment while the pane is open is exactly that. An
// observer bound once in `onMounted` would have attached to nothing and stayed that way, leaving
// the clamp measured once and never re-measured on resize or rotation: the stale-`clampable` bug
// this observer exists to prevent. Re-target on every change of the ref instead.
const observer = new ResizeObserver(() => measureClamp());
watch(
  blurbEl,
  (el) => {
    observer.disconnect();
    if (el) observer.observe(el);
    measureClamp();
  },
  // `post`, so the measurement reads an element the DOM update has already committed.
  { immediate: true, flush: "post" },
);
onUnmounted(() => observer.disconnect());

// A new book re-renders the same <p>, so the observer may not fire — re-measure explicitly.
watch(
  () => props.book.description,
  () => nextTick(measureClamp),
);
</script>
