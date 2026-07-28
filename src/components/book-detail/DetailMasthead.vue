<template>
  <div
    class="bg-charcoal-light border-b border-charcoal-border px-6 md:px-11 py-6 md:py-9"
  >
    <div class="flex items-end gap-4 md:gap-8">
      <div class="shrink-0 w-21 h-32 md:w-28 md:h-42 shadow-2xl">
        <CoverImage
          :cover-url="book.cover_url"
          :title="book.title || book.isbn"
          :alt="book.title || book.isbn"
          text-class="text-2xl"
          :icon-size="20"
          class="w-full h-full object-cover"
        />
      </div>

      <div class="flex-1 min-w-0">
        <!-- eyebrow: series / standalone · form · year -->
        <div
          class="flex flex-wrap items-baseline gap-x-1.5 text-[9px] md:text-[10px] tracking-[0.18em] md:tracking-[0.2em] uppercase text-text-secondary/70 mb-2 md:mb-3"
        >
          <button
            v-if="book.series_id"
            class="hover:text-orange-neon transition-colors"
            @click="$emit('go-series')"
          >
            {{ book.series_name || $t("detail.series")
            }}{{
              book.series_ordinal != null
                ? ` · ${$t("detail.series_position", { n: book.series_ordinal })}`
                : ""
            }}
          </button>
          <span v-else-if="showStandalone">{{ $t("detail.standalone") }}</span>
          <template v-for="(fact, i) in eyebrowFacts" :key="fact">
            <span
              v-if="i > 0 || book.series_id || showStandalone"
              class="text-text-secondary/40"
              >·</span
            >
            <span>{{ fact }}</span>
          </template>
        </div>

        <h1
          class="font-heading font-bold text-2xl md:text-5xl text-text-primary leading-[1.05] md:leading-[0.98] tracking-tight mb-2 flex items-start gap-2"
        >
          {{ book.title || book.isbn }}
          <OverrideDot
            v-if="book.title_overridden"
            class="w-2 h-2 shrink-0 mt-1.5 md:mt-3"
          />
        </h1>

        <AuthorChips
          :book="book"
          size="expanded"
          @select="$emit('filter', 'author', $event)"
        />

        <EnrichmentBadge
          class="mt-2"
          :status="book.enrichment_status"
          :timed-out="pollTimedOut"
          :guest="guest"
          :readonly="readonly"
          :icon-size="11"
        />
      </div>

      <!-- The record cluster only fits beside the title on desktop; on mobile it becomes the
           Record pane's stacked rows, from the same component. -->
      <RecordControls
        v-if="!readonly"
        inline
        class="hidden md:flex shrink-0 pb-1"
        :book="book"
        :guest="guest"
        @set-status="$emit('set-status', $event)"
        @set-owning-status="$emit('set-owning-status', $event)"
        @set-rating="$emit('set-rating', $event)"
        @edit="$emit('edit')"
      />
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed } from "vue";
import { bookYear } from "@/utils/book-display";
import CoverImage from "@/components/CoverImage.vue";
import OverrideDot from "@/components/OverrideDot.vue";
import AuthorChips from "@/components/book-detail/AuthorChips.vue";
import EnrichmentBadge from "@/components/book-detail/EnrichmentBadge.vue";
import RecordControls from "@/components/book-detail/RecordControls.vue";
import type { BookWithOverrides, OwningStatus, ReadStatus } from "@/types/book";

// Identity and the whole record decided at a glance: cover, series/form/year eyebrow, title,
// authors, and — on desktop — the four controls the user sets. Replaces the old title block plus
// right-hand "Your record" rail, which mixed those four editable things with six read-only
// Wikidata facts (those now live in the Details pane's "The work" ledger).
const props = defineProps<{
  book: BookWithOverrides;
  pollTimedOut?: boolean;
  guest?: boolean;
  readonly?: boolean;
}>();

defineEmits<{
  "set-status": [status: ReadStatus];
  "set-owning-status": [status: OwningStatus];
  "set-rating": [rating: number | null];
  edit: [];
  "go-series": [];
  filter: [field: "author", value: string];
}>();

// "Standalone" is only honest once enrichment has actually looked: a pending or failed work has no
// series *yet*, which is not the same as having none.
const showStandalone = computed(() => props.book.enrichment_status === "done");

// Form of work then year, both optional — the eyebrow wraps rather than truncates at 390px, so a
// long form label costs a second line instead of being cut.
const eyebrowFacts = computed(() =>
  [props.book.form_of_work, bookYear(props.book)].filter(
    (v): v is string => !!v,
  ),
);
</script>
