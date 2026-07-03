<template>
  <div class="pt-8 border-t border-charcoal-border mb-10">
    <div
      class="text-[10px] tracking-[0.24em] uppercase text-text-secondary/60 mb-4"
    >
      {{ $t("detail.edition") }}
    </div>
    <div
      v-if="book.publisher"
      class="flex items-baseline justify-between gap-4 py-3 border-b border-charcoal-border/50"
    >
      <span
        class="text-[11px] tracking-[0.1em] uppercase text-text-secondary/60 flex items-center gap-1 shrink-0"
      >
        {{ $t("detail.publisher") }}
        <OverrideDot v-if="book.publisher_overridden" class="w-1 h-1" />
      </span>
      <button
        class="font-mono text-xs text-text-primary hover:text-orange-neon transition-colors text-right truncate"
        :aria-label="$t('detail.filter_by', { field: $t('detail.publisher'), value: book.publisher })"
        @click="filterBy('publisher', book.publisher!)"
      >
        {{ book.publisher }}
      </button>
    </div>
    <div
      v-if="book.language"
      class="flex items-baseline justify-between gap-4 py-3 border-b border-charcoal-border/50"
    >
      <span
        class="text-[11px] tracking-[0.1em] uppercase text-text-secondary/60 flex items-center gap-1 shrink-0"
      >
        {{ $t("detail.language") }}
        <OverrideDot v-if="book.language_overridden" class="w-1 h-1" />
      </span>
      <button
        class="font-mono text-xs text-text-primary hover:text-orange-neon transition-colors"
        :aria-label="$t('detail.filter_by', { field: $t('detail.language'), value: langDisplay(book.language) })"
        @click="filterBy('language', book.language!)"
      >
        {{ langDisplay(book.language) }}
      </button>
    </div>
    <div
      v-if="book.publish_date"
      class="flex items-baseline justify-between gap-4 py-3 border-b border-charcoal-border/50"
    >
      <span
        class="text-[11px] tracking-[0.1em] uppercase text-text-secondary/60 flex items-center gap-1 shrink-0"
      >
        {{ $t("detail.published") }}
        <OverrideDot v-if="book.publish_date_overridden" class="w-1 h-1" />
      </span>
      <span class="font-mono text-xs text-text-primary text-right">{{
        formatPublishDate(book.publish_date)
      }}</span>
    </div>
    <div
      v-if="book.number_of_pages_median || book.reference_page_count"
      class="flex items-baseline justify-between gap-4 py-3 border-b border-charcoal-border/50"
    >
      <span
        class="text-[11px] tracking-[0.1em] uppercase text-text-secondary/60 flex items-center gap-1 shrink-0"
      >
        {{ $t("detail.pages") }}
        <OverrideDot v-if="book.pages_overridden" class="w-1 h-1" />
      </span>
      <span v-if="book.number_of_pages_median" class="font-mono text-xs text-text-primary">{{
        book.number_of_pages_median
      }}</span>
      <v-tooltip
        v-else
        location="top"
        max-width="260"
        :text="$t('detail.reference_pages_tooltip')"
      >
        <template #activator="{ props: tooltipProps }">
          <span
            v-bind="tooltipProps"
            class="font-mono text-xs text-text-primary/70 cursor-help"
          >
            ≈{{ book.reference_page_count }}
          </span>
        </template>
      </v-tooltip>
    </div>
    <div
      class="flex items-baseline justify-between gap-4 py-3 border-b border-charcoal-border/50"
    >
      <span
        class="text-[11px] tracking-[0.1em] uppercase text-text-secondary/60 shrink-0"
        >{{ $t("detail.isbn") }}</span
      >
      <span class="flex items-center gap-2">
        <span class="font-mono text-xs text-text-primary text-right">{{
          book.isbn
        }}</span>
        <button
          class="shrink-0 transition-colors"
          :class="
            isbnCopied
              ? 'text-success'
              : 'text-text-secondary/40 hover:text-text-secondary'
          "
          :title="$t('detail.copy_isbn')"
          :aria-label="$t('detail.copy_isbn')"
          @click="copyIsbn"
        >
          <v-icon
            :icon="isbnCopied ? 'mdi-check' : 'mdi-content-copy'"
            size="13"
          />
        </button>
      </span>
    </div>
    <div
      v-if="book.original_pub_date"
      class="flex items-baseline justify-between gap-4 py-3 border-b border-charcoal-border/50"
    >
      <span
        class="text-[11px] tracking-[0.1em] uppercase text-text-secondary/60 shrink-0"
        >{{ $t("detail.original_pub_date") }}</span
      >
      <span class="font-mono text-xs text-text-primary">{{
        book.original_pub_date
      }}</span>
    </div>
    <div
      v-if="book.edition_name"
      class="flex items-baseline justify-between gap-4 py-3 border-b border-charcoal-border/50"
    >
      <span
        class="text-[11px] tracking-[0.1em] uppercase text-text-secondary/60 shrink-0"
        >{{ $t("detail.edition_name") }}</span
      >
      <span class="font-mono text-xs text-text-primary text-right">{{
        book.edition_name
      }}</span>
    </div>
    <div
      v-if="book.physical_dimensions"
      class="flex items-baseline justify-between gap-4 py-3 border-b border-charcoal-border/50"
    >
      <span
        class="text-[11px] tracking-[0.1em] uppercase text-text-secondary/60 shrink-0"
        >{{ $t("detail.physical_dimensions") }}</span
      >
      <span class="font-mono text-xs text-text-primary text-right">{{
        book.physical_dimensions
      }}</span>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { useRouter } from "vue-router";
import { useLocaleStore } from "@/stores/locale";
import { languageDisplayFormatter } from "@/utils/language";
import { formatPublishDate as formatDate } from "@/utils/book-display";
import type { BookWithOverrides } from "@/components/BookDetail.vue";
import OverrideDot from "@/components/OverrideDot.vue";

const props = defineProps<{
  book: BookWithOverrides;
}>();

const router = useRouter();
const localeStore = useLocaleStore();
const langDisplay = computed(() =>
  languageDisplayFormatter(localeStore.locale),
);

const formatPublishDate = (date: string | null | undefined) =>
  formatDate(date, localeStore.locale);

function filterBy(field: "publisher" | "language", value: string) {
  router.push(`/library?q=${encodeURIComponent(`${field}:"${value}"`)}`);
}

const isbnCopied = ref(false);

async function copyIsbn() {
  try {
    await navigator.clipboard.writeText(props.book.isbn);
    isbnCopied.value = true;
    setTimeout(() => (isbnCopied.value = false), 1500);
  } catch {
    // Clipboard access denied/unavailable — nothing to recover, just don't show the checkmark.
  }
}
</script>
