<template>
  <div class="bg-charcoal min-h-screen flex flex-col">
    <AppHeader />
    <div class="w-full max-w-300 mx-auto flex-1 flex flex-col w-full">
      <!-- Header -->
      <div class="px-6 md:px-10 pt-10 pb-6 border-b border-charcoal-border">
        <button
          class="flex items-center gap-1 text-[10px] text-text-secondary tracking-[0.2em] uppercase hover:text-text-primary transition-colors mb-4"
          @click="$router.back()"
        >
          <v-icon icon="mdi-arrow-left" size="14" />
          {{ $t("series.back") }}
        </button>
        <p class="text-[10px] text-text-secondary tracking-[0.3em] uppercase mb-3">
          {{ $t("series.section") }}
        </p>
        <h1
          class="font-heading text-4xl md:text-5xl font-bold text-text-primary leading-[1.05]"
        >
          {{ series?.name || $t("detail.series") }}
        </h1>
        <p
          v-if="series"
          class="text-xs text-text-secondary tracking-[0.15em] uppercase mt-3 font-mono"
        >
          <template v-if="sideEntries.length > 0">
            {{ $t("series.main_owned_count", { owned: mainOwnedCount, total: mainEntries.length }) }};
            {{ $t("series.side_owned_count", { owned: sideOwnedCount, total: sideEntries.length }) }}
            <button
              class="text-orange-neon hover:underline cursor-pointer"
              @click="showSideEntries = !showSideEntries"
            >({{ showSideEntries ? $t("series.hide_side") : $t("series.show_side") }})</button>
          </template>
          <template v-else>
            {{ $t("series.owned_count", { owned: mainOwnedCount, total: mainEntries.length }) }}
          </template>
        </p>
      </div>

      <!-- Loading -->
      <div v-if="loading" class="flex justify-center mt-20">
        <v-progress-circular indeterminate color="primary" size="24" width="2" />
      </div>

      <!-- Not found -->
      <div v-else-if="!series" class="px-6 md:px-10 pt-16 pb-8">
        <p class="text-sm text-text-secondary">{{ $t("series.not_found") }}</p>
      </div>

      <!-- Entries -->
      <div v-else class="pb-28">
        <div
          v-for="entry in displayedEntries"
          :key="entry.work_id"
          class="flex items-center gap-4 px-6 md:px-10 py-3 border-b border-charcoal-border transition-colors"
          :class="[
            entry.owned ? '' : 'opacity-50',
            entry.scan_id || entry.isbn ? 'cursor-pointer hover:bg-white/[0.02]' : '',
          ]"
          @click="openEntry(entry)"
        >
          <div
            class="w-6 shrink-0 text-center font-mono text-xs"
            :class="entry.owned ? 'text-orange-neon' : 'text-text-secondary/50'"
          >
            {{ entry.ordinal != null ? entry.ordinal : "—" }}
          </div>
          <img
            v-if="entry.cover_url"
            :src="entry.cover_url"
            class="w-9 h-13 object-cover shrink-0"
          />
          <div
            v-else
            class="w-9 h-13 bg-charcoal-light border border-charcoal-border flex items-center justify-center shrink-0"
          >
            <v-icon icon="mdi-book-outline" size="16" color="primary" />
          </div>
          <div class="min-w-0 flex-1">
            <div class="text-sm text-text-primary truncate">
              {{ entry.title || $t("series.untitled") }}
            </div>
            <div
              class="text-[10px] tracking-[0.15em] uppercase mt-0.5"
              :class="entry.owned ? 'text-orange-neon' : 'text-text-secondary/50'"
            >
              {{ entry.owned ? $t("detail.edition_in_library") : $t("series.missing") }}
            </div>
          </div>
        </div>
      </div>

      <AppFooter class="mt-auto" />
    </div>
  </div>

  <BookDetail
    v-if="detailBook"
    :model-value="!!detailIsbn && !!detailBook"
    :book="detailBook"
    :readonly="detailReadonly"
    @update:model-value="(v) => { if (!v) closeDetail() }"
    @cycle-status="cycleDetailStatus"
    @set-status="(s) => setDetailStatus(s)"
    @refreshed="onDetailRefreshed"
  />
</template>

<script lang="ts" setup>
import { ref, computed, onMounted, watch } from "vue";
import { useRoute } from "vue-router";
import { useApi } from "@/composables/useApi";
import { useDetailRoute } from "@/composables/useDetailRoute";
import { useLocaleStore } from "@/stores/locale";
import AppHeader from "@/components/AppHeader.vue";
import AppFooter from "@/components/AppFooter.vue";
import BookDetail from "@/components/BookDetail.vue";
import type { BookWithOverrides } from "@/components/BookDetail.vue";
import type { Book, ReadStatus } from "@/types/book";

interface SeriesEntry {
  work_id: number;
  ordinal: number | null;
  title: string | null;
  owned: number;
  isbn: string | null;
  cover_url: string | null;
  scan_id: number | null;
}

interface SeriesResponse {
  id: number;
  name: string | null;
  entries: SeriesEntry[];
}

const route = useRoute();
const { apiFetch } = useApi();
const localeStore = useLocaleStore();
const { detailIsbn, openDetail, closeDetail } = useDetailRoute();

const loading = ref(true);
const series = ref<SeriesResponse | null>(null);
const showSideEntries = ref(false);

const entries = computed(() => series.value?.entries ?? []);
const mainEntries = computed(() => entries.value.filter((e) => e.ordinal != null && e.ordinal % 1 === 0));
const sideEntries = computed(() => entries.value.filter((e) => e.ordinal == null || e.ordinal % 1 !== 0));
const mainOwnedCount = computed(() => mainEntries.value.filter((e) => e.owned).length);
const sideOwnedCount = computed(() => sideEntries.value.filter((e) => e.owned).length);
const displayedEntries = computed(() =>
  showSideEntries.value ? entries.value : mainEntries.value
);

const detailBook = ref<BookWithOverrides | null>(null);
const detailReadonly = ref(false);

function openEntry(entry: SeriesEntry) {
  if (entry.isbn) openDetail(entry.isbn)
}

async function loadDetail(entry: SeriesEntry) {
  if (entry.scan_id) {
    const res = await apiFetch(`/api/scans/${entry.scan_id}?locale=${localeStore.locale}`);
    if (!res.ok) return;
    detailBook.value = await res.json() as Book;
    detailReadonly.value = false;
  } else if (entry.isbn) {
    const res = await apiFetch(`/api/books/lookup?isbn=${entry.isbn}`);
    if (!res.ok) return;
    const raw = await res.json() as any;
    detailBook.value = {
      id: raw.id,
      isbn: raw.isbn,
      title: entry.title ?? raw.title,
      author: raw.author,
      cover_url: entry.cover_url ?? raw.cover_url,
      status: 'unread',
      created_at: raw.fetched_at ?? '',
      language: raw.language,
      publish_date: raw.publish_date,
      number_of_pages_median: raw.number_of_pages_median,
      description: raw.description,
      publisher: raw.publisher,
      work_id: raw.work_id,
    };
    detailReadonly.value = true;
  }
}

// Drive detail open/close from the URL — handles click, Back/Forward, and deep links
watch([detailIsbn, entries], ([isbn]) => {
  if (!isbn) { detailBook.value = null; return }
  const entry = entries.value.find(e => e.isbn === isbn)
  if (entry && detailBook.value?.isbn !== isbn) loadDetail(entry)
}, { immediate: true })

function onDetailRefreshed(updated: Partial<BookWithOverrides>) {
  if (detailBook.value) detailBook.value = { ...detailBook.value, ...updated }
}

const NEXT_STATUS: Record<ReadStatus, ReadStatus> = { unread: 'reading', reading: 'read', read: 'unread' }

async function updateDetailStatus(newStatus: ReadStatus) {
  if (!detailBook.value || detailReadonly.value) return
  const prev = detailBook.value.status
  detailBook.value = { ...detailBook.value, status: newStatus }
  try {
    const res = await apiFetch(`/api/scans/${detailBook.value.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: newStatus }),
    })
    if (!res.ok) throw new Error()
  } catch {
    if (detailBook.value) detailBook.value = { ...detailBook.value, status: prev }
  }
}

function cycleDetailStatus() {
  if (!detailBook.value) return
  updateDetailStatus(NEXT_STATUS[detailBook.value.status])
}

function setDetailStatus(s: ReadStatus) {
  updateDetailStatus(s)
}

async function load() {
  loading.value = true;
  try {
    const res = await apiFetch(
      `/api/series/${route.params.id}?locale=${localeStore.locale}`,
    );
    series.value = res.ok ? await res.json() : null;
  } catch {
    series.value = null;
  } finally {
    loading.value = false;
  }
}

onMounted(load);
watch(() => [route.params.id, localeStore.locale], load);
</script>
