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
        <p
          class="text-[10px] text-text-secondary tracking-[0.3em] uppercase mb-3"
        >
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
          <!-- Only split when there is something to split. With no whole-numbered entries at
               all the list already shows every entry (see `sequenceEntries`), so "0 of 0 main"
               beside an inert show/hide toggle would describe a division the page isn't making. -->
          <template v-if="mainEntries.length > 0 && sideEntries.length > 0">
            {{
              $t("series.main_owned_count", {
                owned: mainOwnedCount,
                total: mainEntries.length,
              })
            }};
            {{
              $t("series.side_owned_count", {
                owned: sideOwnedCount,
                total: sideEntries.length,
              })
            }}
            <button
              class="text-orange-neon hover:underline cursor-pointer"
              @click="showSideEntries = !showSideEntries"
            >
              ({{
                showSideEntries
                  ? $t("series.hide_side")
                  : $t("series.show_side")
              }})
            </button>
          </template>
          <template v-else>
            {{
              $t("series.owned_count", {
                owned: sequenceOwnedCount,
                total: sequenceEntries.length,
              })
            }}
          </template>
        </p>
      </div>

      <!-- Loading -->
      <div v-if="loading" class="flex justify-center mt-20">
        <v-progress-circular
          indeterminate
          color="primary"
          size="24"
          width="2"
        />
      </div>

      <!-- Load error -->
      <div v-else-if="loadError" class="px-6 md:px-10 pt-16 pb-8">
        <p class="text-sm text-text-secondary mb-4">
          {{ $t("series.load_error") }}
        </p>
        <button
          class="text-xs font-bold tracking-[0.25em] uppercase border-b border-text-primary pb-0.5 text-text-primary hover:opacity-70 transition-opacity"
          @click="load"
        >
          {{ $t("series.retry") }}
        </button>
      </div>

      <!-- Not found -->
      <div v-else-if="!series" class="px-6 md:px-10 pt-16 pb-8">
        <p class="text-sm text-text-secondary">{{ $t("series.not_found") }}</p>
      </div>

      <!-- Entries -->
      <div v-else class="pb-28" role="list">
        <div
          v-for="entry in displayedEntries"
          :key="entry.work_id"
          class="flex items-center gap-4 px-6 md:px-10 py-3 border-b border-charcoal-border transition-colors"
          :class="[
            entry.owned ? '' : 'opacity-50',
            entry.scan_id || entry.isbn
              ? 'cursor-pointer hover:bg-white/[0.02]'
              : '',
          ]"
          :role="entry.isbn ? 'button' : undefined"
          :tabindex="entry.isbn ? 0 : undefined"
          @click="openEntry(entry)"
          @keydown.enter="openEntry(entry)"
          @keydown.space.prevent="openEntry(entry)"
        >
          <div
            class="w-6 shrink-0 text-center font-mono text-xs"
            :class="entry.owned ? 'text-orange-neon' : 'text-text-secondary/50'"
          >
            {{ entry.ordinal != null ? entry.ordinal : "—" }}
          </div>
          <div class="w-9 h-13 relative overflow-hidden shrink-0">
            <CoverImage
              :cover-url="entry.cover_url"
              :title="entry.title"
              :alt="entry.title || $t('series.untitled')"
              :ghost="!entry.owned"
              :show-missing-indicator="!entry.owned"
              text-class="text-xs"
              :icon-size="14"
              class="w-full h-full object-cover"
            />
          </div>
          <div class="min-w-0 flex-1">
            <div class="text-sm text-text-primary truncate">
              {{ entry.title || $t("series.untitled") }}
            </div>
            <div
              class="text-[10px] tracking-[0.15em] uppercase mt-0.5"
              :class="
                entry.owned ? 'text-orange-neon' : 'text-text-secondary/50'
              "
            >
              {{
                entry.owned
                  ? $t("detail.edition_in_library")
                  : $t("series.missing")
              }}
            </div>
          </div>
        </div>
      </div>

      <AppFooter class="mt-auto" />
    </div>
  </div>

  <BookDetail
    v-if="detailBook"
    :model-value="!!detailEditionIsbn && !!detailBook"
    :book="detailBook"
    :readonly="detailReadonly"
    @update:model-value="
      (v) => {
        if (!v) closeDetail();
      }
    "
    @cycle-status="cycleDetailStatus"
    @set-status="(s) => setDetailStatus(s)"
    @set-owning-status="(s) => setDetailOwningStatus(s)"
    @set-rating="(r) => setDetailRating(r)"
    @open-rating="ratingPromptOpen = true"
    @delete="openDeleteDialog(detailBook!)"
    @refreshed="onDetailRefreshed"
    @switch-edition="onSwitchEdition"
  />

  <!-- Rating & review prompt. Unlike the library page there are no cards to change status from
       here, so it always targets the open detail and needs no separate book slot. -->
  <RatingDialog
    v-if="detailBook && !detailReadonly"
    v-model="ratingPromptOpen"
    with-review
    :rating="detailBook.rating"
    :review="detailBook.review"
    @set-rating="(r) => setDetailRating(r)"
    @set-review="(v) => setDetailReview(v)"
  />

  <!-- Delete confirmation -->
  <ConfirmDialog
    v-model="deleteDialog"
    :title="$t('library.remove_heading')"
    :confirm-label="$t('library.remove')"
    :cancel-label="$t('library.cancel')"
    :loading="deleting"
    @confirm="confirmDelete"
  >
    {{
      $t("library.remove_body", {
        title: bookToDelete?.title || bookToDelete?.isbn,
      })
    }}
    <p v-if="deleteFailed" class="text-error mt-2">
      {{ $t("library.error_delete") }}
    </p>
  </ConfirmDialog>
</template>

<script lang="ts" setup>
import {
  ref,
  computed,
  nextTick,
  onMounted,
  onScopeDispose,
  watch,
} from "vue";
import { useRoute } from "vue-router";
import { useApi } from "@/composables/useApi";
import { useDeleteScan } from "@/composables/useDeleteScan";
import { useDetailRoute } from "@/composables/useDetailRoute";
import { useScanStatus } from "@/composables/useScanStatus";
import { useLocaleStore } from "@/stores/locale";
import AppHeader from "@/components/AppHeader.vue";
import AppFooter from "@/components/AppFooter.vue";
import BookDetail from "@/components/BookDetail.vue";
import RatingDialog from "@/components/book-detail/RatingDialog.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import type {
  Book,
  BookWithOverrides,
  OwningStatus,
  ReadStatus,
} from "@/types/book";
import { NEXT_STATUS } from "@/composables/useBookStatus";
import {
  countableSeriesEntries,
  isMainSeriesEntry,
} from "@/utils/series-completeness";
import CoverImage from "@/components/CoverImage.vue";

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
const { detailEditionIsbn, detailScanId, openDetail, closeDetail } =
  useDetailRoute();
const {
  setOwningStatus: applyOwningStatus,
  setRating: applyRating,
  setReview: applyReview,
} = useScanStatus();

const loading = ref(true);
const series = ref<SeriesResponse | null>(null);
const loadError = ref(false);
const showSideEntries = ref(false);

const entries = computed(() => series.value?.entries ?? []);
// This page splits the two halves for display rather than measuring completeness, so it wants
// `isMainSeriesEntry` itself rather than `countableSeriesEntries` — but it must be the *same*
// predicate the shelves and the stats page use, or "side story" means one thing here and another
// in the counts. It was a third inline spelling of the rule (`% 1 === 0`) until this shared it.
const mainEntries = computed(() => entries.value.filter(isMainSeriesEntry));
const sideEntries = computed(() =>
  entries.value.filter((e) => !isMainSeriesEntry(e)),
);
const mainOwnedCount = computed(
  () => mainEntries.value.filter((e) => e.owned).length,
);
const sideOwnedCount = computed(
  () => sideEntries.value.filter((e) => e.owned).length,
);
/**
 * The sequence this page presents by default: the main entries, or every entry when Wikidata
 * numbered none of them (Hitchhiker's has no whole ordinals at all).
 *
 * `countableSeriesEntries` rather than a local `mainEntries.length ? … : …`, so the fallback has
 * exactly one spelling — without it the collapsed default rendered an *empty list* for a series
 * the shelves and `/stats` had just offered as "4 of 6". `mainOnly: true` because the split is
 * this page's display idiom, not a completeness count; the preference governs the counts, which
 * this page doesn't make.
 */
const sequenceEntries = computed(() =>
  countableSeriesEntries(entries.value, true),
);
const sequenceOwnedCount = computed(
  () => sequenceEntries.value.filter((e) => e.owned).length,
);
const displayedEntries = computed(() =>
  showSideEntries.value ? entries.value : sequenceEntries.value,
);

const detailBook = ref<BookWithOverrides | null>(null);
const detailReadonly = ref(false);
const ratingPromptOpen = ref(false);

const {
  deleteDialog,
  bookToDelete,
  deleting,
  deleteFailed,
  openDeleteDialog,
  confirmDelete,
} = useDeleteScan({
  onDeleted: () => {
    closeDetail();
    load();
  },
});

function openEntry(entry: SeriesEntry) {
  if (!entry.isbn) return;
  openDetail(entry.work_id, entry.isbn, entry.scan_id);
}

function onSwitchEdition(payload: { isbn: string; scanId: number }) {
  openDetail(detailBook.value?.work_id ?? null, payload.isbn, payload.scanId);
}

// Supersede token for detail loads, same pattern as `useWorkEditions`: rapid edition switches
// (or a Back that reopens a different entry) leave several of these in flight, and without it a
// slower earlier response clobbers `detailBook` with the book the user has already navigated away
// from. Incremented on every call; a response whose token is stale is dropped.
let detailSeq = 0;

// Unmount counts as a supersede. A detail load in flight when the user navigates away is not
// cancelled, so if it then fails, `failed()` would call `closeDetail()` — and `useDetailRoute`
// builds that from the *live* route, so it would strip `work`/`edition`/`scan`/`view` from
// whatever page the user is on now (closing a detail they since opened on /library) and push a
// spurious history entry. Bumping the token here makes every in-flight load stale instead.
onScopeDispose(() => {
  detailSeq++;
});

async function loadDetailByIsbn(
  isbn: string,
  scanId: number | null,
  fallback: { title: string | null; cover_url: string | null } | null,
) {
  const seq = ++detailSeq;
  // A failed load used to return silently, leaving `edition=` in the URL with no dialog and no
  // error — a state nothing could clear but editing the address bar. Stripping the params puts
  // the page back where it was and makes clicking the entry again a retry.
  const failed = () => {
    if (seq === detailSeq) closeDetail();
  };

  if (scanId != null) {
    const res = await apiFetch(
      `/api/scans/${scanId}?locale=${localeStore.locale}`,
    ).catch(() => null);
    if (!res?.ok) return failed();
    const book = (await res.json()) as Book;
    if (seq !== detailSeq) return;
    detailBook.value = book;
    detailReadonly.value = false;
    return;
  }
  const res = await apiFetch(`/api/books/lookup?isbn=${isbn}`).catch(() => null);
  if (!res?.ok) return failed();
  const raw = (await res.json()) as any;
  if (seq !== detailSeq) return;
  detailBook.value = {
    id: raw.id,
    isbn: raw.isbn,
    title: fallback?.title ?? raw.title,
    author: raw.author,
    cover_url: fallback?.cover_url ?? raw.cover_url,
    status: "unread",
    // This is a reference edition the user hasn't scanned — "unowned" reflects that
    // honestly (the picker itself never renders here since detailReadonly is true).
    owning_status: "unowned",
    // Not in the library, so there's no scan to carry a rating or review of it.
    rating: null,
    review: null,
    created_at: raw.fetched_at ?? "",
    language: raw.language,
    publish_date: raw.publish_date,
    number_of_pages_median: raw.number_of_pages_median,
    description: raw.description,
    publisher: raw.publisher,
    work_id: raw.work_id,
  };
  detailReadonly.value = true;
}

// Drive detail open/close from the URL — handles click, Back/Forward, and deep links.
// The scan id round-trips through the `scan` query param (see useDetailRoute), so a
// non-representative edition reached via the carousel resolves correctly even on a cold
// reload/deep link, not just an in-session switch.
watch(
  [detailEditionIsbn, entries],
  async ([isbn]) => {
    if (!isbn) {
      // Close the rating prompt *before* dropping the book, and let the close actually reach the
      // dialog before it goes away. RatingDialog flushes its review draft on the modelValue
      // true→false transition, but the prop only changes when this component re-renders — so
      // clearing both refs in one tick would batch into a single render in which `v-if="detailBook"`
      // is already false, unmounting the dialog with the draft still in it. Awaiting a tick lets
      // the dialog observe the close and flush first. Leaving the flag set would also spring the
      // dialog open again over whichever book is opened next.
      ratingPromptOpen.value = false;
      await nextTick();
      detailBook.value = null;
      return;
    }
    if (detailBook.value?.isbn === isbn) return;
    const entry = entries.value.find((e) => e.isbn === isbn);
    const scanId = entry?.scan_id ?? detailScanId.value;
    loadDetailByIsbn(
      isbn,
      scanId,
      entry ? { title: entry.title, cover_url: entry.cover_url } : null,
    );
  },
  { immediate: true },
);

function onDetailRefreshed(updated: Partial<BookWithOverrides>) {
  if (detailBook.value) detailBook.value = { ...detailBook.value, ...updated };
}

async function updateDetailStatus(newStatus: ReadStatus) {
  if (!detailBook.value || detailReadonly.value) return;
  const prev = detailBook.value.status;
  detailBook.value = { ...detailBook.value, status: newStatus };
  try {
    const res = await apiFetch(`/api/scans/${detailBook.value.id}`, {
      method: "PATCH",
      body: JSON.stringify({ status: newStatus }),
    });
    if (!res.ok) throw new Error();
    // Marking a book read is the moment to capture a rating and a review.
    if (newStatus === "read" && prev !== "read") ratingPromptOpen.value = true;
  } catch {
    if (detailBook.value)
      detailBook.value = { ...detailBook.value, status: prev };
  }
}

function cycleDetailStatus() {
  if (!detailBook.value) return;
  updateDetailStatus(NEXT_STATUS[detailBook.value.status]);
}

function setDetailStatus(s: ReadStatus) {
  updateDetailStatus(s);
}

function setDetailOwningStatus(newStatus: OwningStatus) {
  if (!detailBook.value || detailReadonly.value) return;
  return applyOwningStatus(detailBook.value, newStatus).catch(() => {});
}

function setDetailRating(rating: number | null) {
  if (!detailBook.value || detailReadonly.value) return;
  return applyRating(detailBook.value, rating).catch(() => {});
}

function setDetailReview(review: string | null) {
  if (!detailBook.value || detailReadonly.value) return;
  return applyReview(detailBook.value, review).catch(() => {});
}

async function load() {
  loading.value = true;
  loadError.value = false;
  try {
    const res = await apiFetch(
      `/api/series/${route.params.id}?locale=${localeStore.locale}`,
    );
    if (res.ok) {
      series.value = await res.json();
    } else {
      series.value = null;
      if (res.status !== 404) loadError.value = true;
    }
  } catch {
    series.value = null;
    loadError.value = true;
  } finally {
    loading.value = false;
  }
}

onMounted(load);
watch(() => [route.params.id, localeStore.locale], load);
</script>
