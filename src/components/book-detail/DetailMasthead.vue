<template>
  <!-- Two grid rows: cover + identity, then the record cluster indented under the identity column
       so it reads as belonging to the title rather than to the cover. The mockup sat the cluster
       beside the title, which only fits at its 1360px card width — on the app's ⅔ measure it would
       leave the title barely 90px. -->
  <div class="grid grid-cols-[auto_1fr] gap-x-4 md:gap-x-8 gap-y-7 items-start">
    <!-- The cover spans both rows and stretches to their combined height, so its top edge lines up
         with the eyebrow and its bottom with the record controls. It falls back to a fixed
         book-proportioned height wherever there is no second row to match: below `md` (the controls
         live in the Record pane there) and in readonly mode (there are none at all). -->
    <div
      class="w-21 h-32 md:w-28 shadow-2xl"
      :class="readonly ? 'md:h-42' : 'md:h-auto md:row-span-2 md:self-stretch'"
    >
      <CoverImage
        :cover-url="book.cover_url"
        :title="book.title || book.isbn"
        :alt="book.title || book.isbn"
        text-class="text-2xl"
        :icon-size="20"
        class="w-full h-full object-cover"
      />
    </div>

    <div class="min-w-0">
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

    <!-- Row 2, second column only — on mobile these same controls are the Record pane's stacked
         rows, rendered from this one component so the two layouts can't drift apart. -->
    <RecordControls
      v-if="!readonly"
      inline
      class="hidden md:flex col-start-2"
      :book="book"
      :guest="guest"
      @set-status="$emit('set-status', $event)"
      @set-owning-status="$emit('set-owning-status', $event)"
      @set-rating="$emit('set-rating', $event)"
      @edit="$emit('edit')"
    />
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
