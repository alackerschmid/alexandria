<script setup lang="ts">
import { useI18n } from "vue-i18n";
import type { ReviewItem } from "@/stores/import";

defineProps<{ item: ReviewItem }>();
const emit = defineEmits<{
  close: [];
  "update:query": [query: string];
  search: [];
  pick: [isbn: string];
  skip: [];
  retry: [];
}>();

const { t } = useI18n();
</script>

<template>
  <div class="fixed inset-0 z-[60] flex justify-end">
    <div class="absolute inset-0 bg-black/60" @click="emit('close')" />

    <!-- full-screen sheet below md, side panel above -->
    <div
      class="relative w-full md:w-[440px] h-full bg-charcoal-light border-l border-charcoal-border flex flex-col"
    >
      <div
        class="flex-none flex items-center justify-between px-6 py-5 border-b border-charcoal-border"
      >
        <p
          class="font-mono text-[10px] tracking-[0.2em] uppercase text-text-secondary"
        >
          {{ t("import.review.resolve_heading") }}
        </p>
        <button
          type="button"
          class="text-[18px] leading-none text-text-secondary hover:text-text-primary transition-colors"
          :aria-label="t('detail.close')"
          @click="emit('close')"
        >
          ×
        </button>
      </div>

      <div class="flex-none px-6 py-5 border-b border-charcoal-border">
        <p class="font-heading font-bold text-[19px] text-text-primary leading-tight">
          {{ item.row.title }}
        </p>
        <p class="text-[12px] text-text-secondary mt-1">
          {{ item.row.author || t("book.unknown_author") }}
        </p>
        <p class="font-mono text-[10px] text-text-secondary/70 mt-2">
          {{ t("import.review.as_imported", { isbn: item.row.isbn || "—" }) }}
        </p>
        <p
          v-if="item.reason === 'invalid_isbn'"
          class="text-[11px] text-text-secondary mt-3"
        >
          {{ t("import.review.invalid_isbn_note") }}
        </p>
      </div>

      <form class="flex-none px-6 py-4" @submit.prevent="emit('search')">
        <input
          type="text"
          :value="item.searchQuery"
          :placeholder="t('import.review.search_placeholder')"
          class="w-full bg-charcoal border border-charcoal-border text-text-primary text-[13px] px-3 py-2.5 focus:outline-none focus:border-primary transition-colors"
          @input="
            emit(
              'update:query',
              ($event.target as HTMLInputElement).value,
            )
          "
        />
      </form>

      <div class="flex-1 min-h-0 overflow-y-auto px-6 pb-5">
        <p
          v-if="item.loadingCandidates || item.searching"
          class="py-6 text-[12.5px] text-text-secondary"
        >
          {{ t("import.review.loading") }}
        </p>
        <div v-else-if="item.candidates.length === 0" class="py-6">
          <p
            class="text-[12.5px] leading-relaxed"
            :class="item.searchUnavailable ? 'text-warning' : 'text-text-secondary'"
          >
            {{
              item.searchUnavailable
                ? t("import.review.search_unavailable")
                : t("import.review.no_search_results")
            }}
          </p>
          <button
            type="button"
            class="mt-3 font-mono text-[10px] tracking-[0.14em] uppercase text-primary"
            @click="emit('retry')"
          >
            {{ t("import.review.retry") }}
          </button>
        </div>
        <div
          v-for="candidate in item.candidates"
          v-else
          :key="candidate.isbn"
          class="flex items-center gap-3 py-3 border-b border-charcoal-border"
        >
          <img
            v-if="candidate.cover_url"
            :src="candidate.cover_url"
            alt=""
            class="w-[34px] h-[50px] object-cover flex-none"
          />
          <div v-else class="w-[34px] h-[50px] bg-charcoal flex-none" />
          <div class="min-w-0 flex-1">
            <p class="text-[12.5px] text-text-primary truncate">
              {{ candidate.title }}
            </p>
            <p class="text-[10.5px] text-text-secondary truncate mt-0.5">
              {{ candidate.author
              }}<span v-if="candidate.publisher"> · {{ candidate.publisher }}</span>
            </p>
          </div>
          <button
            type="button"
            class="flex-none border border-primary text-primary font-mono text-[9.5px] tracking-[0.08em] uppercase px-3 py-2 whitespace-nowrap hover:bg-primary/10 transition-colors"
            @click="emit('pick', candidate.isbn)"
          >
            {{ t("import.review.use_this") }}
          </button>
        </div>
      </div>

      <div class="flex-none px-6 py-4 border-t border-charcoal-border">
        <button
          type="button"
          class="w-full border border-dashed border-charcoal-border text-text-secondary font-mono text-[10px] tracking-[0.1em] uppercase py-3 hover:text-text-primary transition-colors"
          @click="emit('skip')"
        >
          {{ t("import.review.skip") }}
        </button>
      </div>
    </div>
  </div>
</template>
