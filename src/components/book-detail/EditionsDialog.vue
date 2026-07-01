<template>
  <v-dialog
    :model-value="modelValue"
    max-width="480"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <div class="bg-charcoal-light border border-charcoal-border flex flex-col max-h-[80vh]">
      <div class="shrink-0 flex items-center justify-between px-6 py-4 border-b border-charcoal-border">
        <div class="text-[10px] tracking-[0.24em] uppercase text-text-secondary/60">
          {{ $t("detail.editions_heading") }}
        </div>
        <button
          class="text-text-secondary/50 hover:text-text-secondary transition-colors"
          @click="$emit('update:modelValue', false)"
        >
          <v-icon icon="mdi-close" size="18" />
        </button>
      </div>

      <div class="flex-1 overflow-y-auto px-6 py-4">
        <div v-if="loading" class="text-xs text-text-secondary/60 py-4 text-center">
          {{ $t("detail.loading") }}
        </div>
        <div v-else class="flex flex-col gap-3">
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
              <div class="text-[10px] text-text-secondary/60 flex items-center gap-2">
                <span v-if="ed.language">{{ langDisplay(ed.language) }}</span>
                <span
                  v-if="ed.isbn === book.isbn"
                  class="text-text-secondary/60 tracking-[0.15em] uppercase"
                >
                  {{ $t("detail.current_edition") }}
                </span>
                <span
                  v-else-if="ed.scan_id"
                  class="text-orange-neon tracking-[0.15em] uppercase"
                >
                  {{ $t("detail.edition_in_library") }}
                </span>
              </div>
            </div>
            <button
              v-if="canSwitch && ed.isbn !== book.isbn"
              class="shrink-0 text-[10px] tracking-[0.14em] uppercase text-orange-neon hover:opacity-80 transition-opacity disabled:opacity-40"
              :disabled="switchingIsbn !== null"
              @click="switchTo(ed.isbn)"
            >
              <v-progress-circular
                v-if="switchingIsbn === ed.isbn"
                size="12"
                width="2"
                indeterminate
              />
              <span v-else>{{ $t("detail.switch_edition") }}</span>
            </button>
          </div>

          <div v-if="!editions.length" class="text-xs text-text-secondary/60 py-2 text-center">
            {{ $t("detail.no_more_editions") }}
          </div>
        </div>

        <p v-if="error" class="text-[10px] text-error tracking-widest uppercase mt-3 text-center">
          {{ $t(error) }}
        </p>
      </div>

      <div
        v-if="canSwitch && (!searched || discovering)"
        class="shrink-0 border-t border-charcoal-border px-6 py-3"
      >
        <button
          class="w-full flex items-center justify-center gap-2 text-[11px] tracking-[0.16em] uppercase text-text-secondary hover:text-text-primary transition-colors disabled:opacity-40"
          :disabled="discovering"
          @click="discover"
        >
          <v-progress-circular
            v-if="discovering"
            size="12"
            width="2"
            indeterminate
          />
          {{ discovering ? $t("detail.finding_editions") : $t("detail.find_more_editions") }}
        </button>
      </div>
      <div
        v-else-if="searched && discoverFoundCount !== null"
        class="shrink-0 border-t border-charcoal-border px-6 py-3 text-[10px] tracking-[0.12em] uppercase text-text-secondary/60 text-center"
      >
        {{ discoverFoundCount > 0
          ? $t("detail.editions_found", { n: discoverFoundCount }, discoverFoundCount)
          : $t("detail.editions_found_none") }}
      </div>
    </div>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useApi } from "@/composables/useApi";
import { useLocaleStore } from "@/stores/locale";
import { languageDisplayFormatter } from "@/utils/language";
import type { Book } from "@/types/book";

interface WorkEdition {
  isbn: string;
  title: string | null;
  language: string | null;
  cover_url: string | null;
  scan_id: number | null;
  materialized: boolean;
}

const props = defineProps<{
  modelValue: boolean;
  book: Book;
  guest?: boolean;
  readonly?: boolean;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  refreshed: [updated: Partial<Book>];
}>();

const { apiFetch } = useApi();
const localeStore = useLocaleStore();
const langDisplay = computed(() => languageDisplayFormatter(localeStore.locale));

const canSwitch = computed(() => !props.guest && !props.readonly);

const editions = ref<WorkEdition[]>([]);
const searched = ref(false);
const loading = ref(false);
const discovering = ref(false);
const discoverFoundCount = ref<number | null>(null);
const switchingIsbn = ref<string | null>(null);
const error = ref<string | null>(null);

async function load() {
  if (!props.book.work_id) return;
  loading.value = true;
  error.value = null;
  discoverFoundCount.value = null;
  try {
    const res = await apiFetch(`/api/works/${props.book.work_id}/editions`);
    if (!res.ok) throw new Error();
    const data = (await res.json()) as { searched: boolean; editions: WorkEdition[] };
    editions.value = data.editions;
    searched.value = data.searched;
  } catch {
    editions.value = [];
  } finally {
    loading.value = false;
  }
}

watch(
  () => props.modelValue,
  (open) => {
    if (open) load();
  },
);

async function discover() {
  if (!props.book.work_id) return;
  discovering.value = true;
  error.value = null;
  const previousCount = editions.value.length;
  try {
    const res = await apiFetch(`/api/works/${props.book.work_id}/editions/discover`, {
      method: "POST",
    });
    if (!res.ok) throw new Error();
    const data = (await res.json()) as {
      searched: boolean;
      editions: WorkEdition[];
      discoveryFailed: boolean;
    };
    editions.value = data.editions;
    searched.value = data.searched;
    if (data.discoveryFailed) {
      error.value = "detail.discover_error";
    } else {
      discoverFoundCount.value = Math.max(data.editions.length - previousCount, 0);
    }
  } catch {
    error.value = "detail.discover_error";
  } finally {
    discovering.value = false;
  }
}

async function switchTo(isbn: string) {
  switchingIsbn.value = isbn;
  error.value = null;
  try {
    const res = await apiFetch(`/api/scans/${props.book.id}/edition`, {
      method: "PATCH",
      body: JSON.stringify({ isbn }),
    });
    if (res.status === 409) {
      error.value = "detail.switch_already_owned";
      return;
    }
    if (!res.ok) throw new Error();
    const updated = (await res.json()) as Partial<Book>;
    emit("refreshed", updated);
    emit("update:modelValue", false);
  } catch {
    error.value = "detail.switch_error";
  } finally {
    switchingIsbn.value = null;
  }
}
</script>
