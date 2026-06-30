<template>
  <div v-if="editions.length" class="mb-8">
    <div
      class="text-[10px] tracking-[0.24em] uppercase text-text-secondary/60 mb-3"
    >
      {{ $t("detail.other_editions") }}
    </div>
    <div class="flex flex-col gap-2">
      <div
        v-for="ed in editions"
        :key="ed.isbn"
        class="flex items-center gap-3"
      >
        <img
          v-if="ed.cover_url"
          :src="ed.cover_url"
          class="w-8 h-12 object-cover shrink-0"
        />
        <div
          v-else
          class="w-8 h-12 bg-charcoal border border-charcoal-border flex items-center justify-center shrink-0"
        >
          <v-icon icon="mdi-book-outline" size="14" color="primary" />
        </div>
        <div class="min-w-0 flex-1">
          <div class="text-xs text-text-primary truncate">
            {{ ed.title || ed.isbn }}
          </div>
          <div
            class="text-[10px] text-text-secondary/60 flex items-center gap-2"
          >
            <span v-if="ed.language">{{ langDisplay(ed.language) }}</span>
            <span
              v-if="ed.scan_id"
              class="text-orange-neon tracking-[0.15em] uppercase"
            >
              {{ $t("detail.edition_in_library") }}
            </span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useApi } from "@/composables/useApi";
import { useLocaleStore } from "@/stores/locale";
import { languageDisplayFormatter } from "@/utils/language";
import type { Book } from "@/types/book";

export interface WorkEdition {
  isbn: string;
  title: string | null;
  language: string | null;
  cover_url: string | null;
  scan_id: number | null;
}

const props = defineProps<{ book: Book }>();

const { apiFetch } = useApi();
const localeStore = useLocaleStore();
const langDisplay = computed(() => languageDisplayFormatter(localeStore.locale));

const editions = ref<WorkEdition[]>([]);

// Fetch the work's other editions, excluding the one currently displayed.
async function load() {
  editions.value = [];
  if (!props.book.work_id) return;
  try {
    const res = await apiFetch(`/api/works/${props.book.work_id}/editions`);
    if (!res.ok) return;
    const list = (await res.json()) as WorkEdition[];
    editions.value = list.filter((e) => e.isbn !== props.book.isbn);
  } catch {
    editions.value = [];
  }
}

watch(() => props.book.isbn, load, { immediate: true });
</script>
