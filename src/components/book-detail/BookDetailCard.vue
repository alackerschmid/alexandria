<template>
  <div class="bg-charcoal-light border border-charcoal-border flex flex-col">
    <!-- header: cover + meta -->
    <div class="flex gap-5 p-7">
      <!-- cover -->
      <div class="w-24 h-36 shrink-0 relative overflow-hidden">
        <CoverImage
          :cover-url="book.cover_url"
          :title="book.title || book.isbn"
          :alt="book.title || book.isbn"
          text-class="text-2xl"
          :icon-size="18"
          class="w-full h-full object-cover"
        />
      </div>

      <!-- meta -->
      <div class="flex-1 min-w-0">
        <div class="flex items-start justify-between gap-3">
          <h2
            class="font-heading font-bold text-2xl text-text-primary leading-tight mb-1 flex items-center gap-1.5"
          >
            {{ book.title || book.isbn }}
            <OverrideDot
              v-if="book.title_overridden"
              class="w-1.5 h-1.5 shrink-0"
            />
          </h2>
          <button
            class="shrink-0 text-text-secondary/50 hover:text-text-secondary transition-colors pt-0.5"
            :aria-label="$t('detail.close')"
            @click="$emit('close')"
          >
            <v-icon icon="mdi-close" size="18" />
          </button>
        </div>

        <AuthorChips :book="book" @select="$emit('filter', 'author', $event)" />

        <!-- series label -->
        <button
          v-if="book.series_id"
          class="flex items-center gap-1.5 text-[10px] tracking-[0.14em] uppercase text-text-secondary/70 hover:text-orange-neon transition-colors mb-3"
          @click="$emit('go-series')"
        >
          <span class="text-orange-neon">♦</span>
          {{ book.series_name || $t("detail.series")
          }}{{
            book.series_ordinal != null
              ? ` · ${$t("detail.series_position", { n: book.series_ordinal })}`
              : ""
          }}
        </button>
        <span
          v-else-if="book.enrichment_status === 'done'"
          class="flex items-center text-[10px] tracking-[0.14em] uppercase text-text-secondary/40 mb-3"
        >
          {{ $t("detail.standalone") }}
        </span>

        <!-- status pill + owning status -->
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <button
            v-if="!readonly"
            class="flex items-center gap-1.5 text-[10px] tracking-[0.15em] uppercase font-medium transition-colors"
            :class="STATUS_CONFIG[book.status].textClass"
            @click="$emit('cycle-status')"
          >
            <span
              class="w-1.5 h-1.5 rounded-full shrink-0"
              :class="STATUS_CONFIG[book.status].dotClass"
            />
            {{ STATUS_CONFIG[book.status].label }}
          </button>
          <span
            v-else
            class="flex items-center gap-1.5 text-[10px] tracking-[0.15em] uppercase text-text-secondary/50"
          >
            <span
              class="w-1.5 h-1.5 rounded-full shrink-0 bg-charcoal-border"
            />
            {{ STATUS_CONFIG[book.status].label }}
          </span>

          <span
            class="flex items-center gap-1.5 text-[10px] tracking-[0.15em] uppercase"
            :style="{ color: OWNING_META[book.owning_status].color }"
          >
            <v-icon :icon="OWNING_META[book.owning_status].icon" size="12" />
            {{ owningLabels[book.owning_status] }}
          </span>

          <!-- rating (read only — rating a book you haven't finished doesn't make sense) -->
          <button
            v-if="!readonly && book.status === 'read'"
            class="flex items-center"
            :aria-label="$t('detail.rate_book')"
            @click="$emit('open-rating')"
          >
            <RatingStars :rating="book.rating" size="md" />
          </button>
          <span
            v-else-if="readonly && book.status === 'read'"
            class="flex items-center"
            :aria-label="`${$t('detail.rating')}: ${book.rating ?? 0}${$t('detail.of_ten')}`"
          >
            <RatingStars :rating="book.rating" size="md" />
          </span>
        </div>

        <!-- enrichment indicator -->
        <EnrichmentBadge
          class="mt-1.5"
          :status="book.enrichment_status"
          :timed-out="pollTimedOut"
          :guest="guest"
          :readonly="readonly"
        />
      </div>
    </div>

    <!-- synopsis snippet -->
    <div
      v-if="book.description"
      class="border-t border-charcoal-border px-7 py-5"
    >
      <p class="text-[13px] leading-relaxed text-text-secondary line-clamp-3">
        {{ book.description }}
      </p>
    </div>

    <!-- quick facts -->
    <div class="grid grid-cols-3 border-t border-charcoal-border">
      <div class="py-4 px-3 text-center border-r border-charcoal-border">
        <div
          class="font-heading font-bold text-xl text-text-primary leading-none"
        >
          {{ publishYear }}
        </div>
        <div
          class="text-[9px] tracking-[0.18em] uppercase text-text-secondary/60 mt-2"
        >
          {{ $t("detail.published") }}
        </div>
      </div>
      <div class="py-4 px-3 text-center border-r border-charcoal-border">
        <div
          v-if="book.number_of_pages_median"
          class="font-heading font-bold text-xl text-text-primary leading-none"
        >
          {{ book.number_of_pages_median }}
        </div>
        <v-tooltip
          v-else-if="book.reference_page_count"
          location="top"
          max-width="260"
          :text="$t('detail.reference_pages_tooltip')"
        >
          <template #activator="{ props: tooltipProps }">
            <div
              v-bind="tooltipProps"
              class="font-heading font-bold text-xl text-text-primary/70 leading-none cursor-help"
            >
              ≈{{ book.reference_page_count }}
            </div>
          </template>
        </v-tooltip>
        <div
          v-else
          class="font-heading font-bold text-xl text-text-primary leading-none"
        >
          —
        </div>
        <div
          class="text-[9px] tracking-[0.18em] uppercase text-text-secondary/60 mt-2"
        >
          {{ $t("detail.pages") }}
        </div>
      </div>
      <div class="py-4 px-3 text-center overflow-hidden min-w-0">
        <button
          v-if="book.genres?.length"
          class="block w-full font-heading font-bold text-xl text-text-primary leading-none truncate hover:text-orange-neon transition-colors"
          @click="$emit('filter', 'genre', book.genres[0])"
        >
          {{ firstGenre }}
        </button>
        <div
          v-else
          class="block w-full font-heading font-bold text-xl text-text-primary leading-none truncate"
        >
          {{ firstGenre }}
        </div>
        <div
          class="text-[9px] tracking-[0.18em] uppercase text-text-secondary/60 mt-2"
        >
          {{ $t("detail.genres") }}
        </div>
      </div>
    </div>

    <!-- footer -->
    <div
      class="border-t border-charcoal-border flex items-center justify-between px-5 py-4 bg-charcoal/30"
    >
      <AppButton variant="primary" size="md" @click="$emit('expand')">
        {{ $t("detail.expand") }}
        <v-icon icon="mdi-arrow-expand" size="14" />
      </AppButton>
      <AppButton variant="ghost" size="sm" @click="$emit('close')">
        {{ $t("detail.close") }}
      </AppButton>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useBookStatus } from "@/composables/useBookStatus";
import { useOwningStatus, OWNING_META } from "@/composables/useOwningStatus";
import { bookYear } from "@/utils/book-display";
import AppButton from "@/components/AppButton.vue";
import RatingStars from "@/components/RatingStars.vue";
import AuthorChips from "@/components/book-detail/AuthorChips.vue";
import EnrichmentBadge from "@/components/book-detail/EnrichmentBadge.vue";
import CoverImage from "@/components/CoverImage.vue";
import OverrideDot from "@/components/OverrideDot.vue";
import type { BookWithOverrides } from "@/components/BookDetail.vue";

// The structured-filter fields the card can trigger (author chip, genre fact).
type FilterField = "author" | "genre";

const props = defineProps<{
  book: BookWithOverrides;
  pollTimedOut?: boolean;
  guest?: boolean;
  readonly?: boolean;
}>();

defineEmits<{
  close: [];
  expand: [];
  "cycle-status": [];
  "open-rating": [];
  "go-series": [];
  filter: [field: FilterField, value: string];
}>();

const { statusConfig: STATUS_CONFIG } = useBookStatus();
const { owningLabels } = useOwningStatus();

const publishYear = computed(() => bookYear(props.book) || "—");
const firstGenre = computed(() => props.book.genres?.[0] ?? "—");
</script>
