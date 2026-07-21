<script setup lang="ts">
import { ref, computed } from "vue";
import { useI18n } from "vue-i18n";
import { useFocusTrap } from "@/composables/useFocusTrap";
import CoverImage from "@/components/CoverImage.vue";
import type { ReviewItem } from "@/stores/import";

// Nullable and always-mounted (the parent no longer v-if's this component) so useFocusTrap's
// isOpen transitions are real open/close events within one instance's lifetime, not a fresh
// instance every time — otherwise its document keydown listener would never get cleaned up.
const props = defineProps<{ item: ReviewItem | null }>();
const emit = defineEmits<{
  close: [];
  "update:query": [query: string];
  search: [];
  pick: [isbn: string];
  skip: [];
  retry: [];
}>();

const { t } = useI18n();

const panelEl = ref<HTMLElement>();
const isOpen = computed(() => !!props.item);
useFocusTrap(panelEl, isOpen, () => emit("close"));
</script>

<template>
  <div v-if="item" class="fixed inset-0 z-[60] flex justify-end">
    <div class="absolute inset-0 bg-black/60" @click="emit('close')" />

    <!-- full-screen sheet below md, side panel above -->
    <div
      ref="panelEl"
      role="dialog"
      aria-modal="true"
      :aria-label="t('import.review.resolve_heading')"
      tabindex="-1"
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
          <div class="w-[34px] h-[50px] flex-none relative overflow-hidden bg-charcoal">
            <CoverImage
              :cover-url="candidate.cover_url"
              :title="candidate.title"
              :alt="candidate.title"
              text-class="text-xs"
              :icon-size="12"
              class="w-full h-full object-cover"
            />
          </div>
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
