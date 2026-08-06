<script lang="ts" setup>
import { ref, computed, watch } from "vue";
import { storeToRefs } from "pinia";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import AppHeader from "@/components/AppHeader.vue";
import AppButton from "@/components/AppButton.vue";
import AppSegmented from "@/components/AppSegmented.vue";
import AppToggle from "@/components/AppToggle.vue";
import ImportHeaderBar from "@/components/import/ImportHeaderBar.vue";
import MatchedRow from "@/components/import/MatchedRow.vue";
import AttentionRow from "@/components/import/AttentionRow.vue";
import ResolveDrawer from "@/components/import/ResolveDrawer.vue";
import ShelfMappingPanel from "@/components/import/ShelfMappingPanel.vue";
import RatingDialog from "@/components/book-detail/RatingDialog.vue";
import ConfirmDialog from "@/components/ConfirmDialog.vue";
import {
  MATCHED_GRID,
  MATCHED_ROW_PADDING,
} from "@/components/import/matched-grid";
import { useBookStatus } from "@/composables/useBookStatus";
import { useImportStore } from "@/stores/import";
import type { ImportLogEntry, ImportedItem, ReviewItem } from "@/stores/import";
import { DEFAULT_SHELF_MAPPING } from "@/utils/goodreads";
import type { ReadStatus, OwningStatus } from "@/types/book";

const { t } = useI18n();
const router = useRouter();
const importStore = useImportStore();

const {
  step,
  error,
  fileName,
  rows,
  shelfCounts,
  mapping,
  updateExisting,
  importShelvesAsTags,
  counts,
  reviewQueue,
  log,
  notImported,
  importedItems,
  reviewRemaining,
  sessionPaused,
  cancelRequested,
  retryableReviewItems,
  retryingSearch,
} = storeToRefs(importStore);
const {
  loadFile,
  setMapping,
  startImport,
  cancelImporting,
  discardSession,
  ensureCandidatesLoaded,
  retryCandidates,
  searchReviewCandidates,
  confirmReviewItem,
  skipReviewItem,
  undoSkipReviewItem,
  skipAllReviewItems,
  undoAllSkippedReviewItems,
  retrySearchUnavailable,
  toggleImportedEdition,
  closeImportedEdition,
  retryImportedCandidates,
  changeImportedEdition,
  setImportedStatus,
  setImportedOwning,
  setImportedRating,
  removeImportedItem,
  undoImportedUpdate,
  cancelImport,
  finalizeImport,
} = importStore;

// The import now runs in the background (see stores/import.ts) and survives leaving this page —
// there is deliberately no leave guard here anymore. A resumable session is offered via
// sessionPaused below, and the global ImportProgressChip (App.vue) tracks an active run from
// anywhere else in the app.

// ── Upload ─────────────────────────────────────────────────────────────────────

const fileInputEl = ref<HTMLInputElement | null>(null);
const uploading = ref(false);

async function onFileChange(e: Event) {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  uploading.value = true;
  try {
    await loadFile(file);
  } finally {
    uploading.value = false;
    // Clears the picked file so re-selecting the *same* file after an error fires `change`
    // again — the browser otherwise treats an unchanged selection as a no-op event.
    input.value = "";
  }
}

// ── Confirm ────────────────────────────────────────────────────────────────────

const { statusLabels } = useBookStatus();

// Auto-expanded only when the export has a shelf the default mapping doesn't know (where
// "unread" is a guess the user should see), so a standard three-shelf export stays a one-click
// path. Re-evaluated each time a file is (re)loaded, not just once on mount.
const mappingExpanded = ref(false);
watch(step, (s) => {
  if (s === "confirm") {
    mappingExpanded.value = [...shelfCounts.value.keys()].some(
      (shelf) => !(shelf in DEFAULT_SHELF_MAPPING),
    );
  }
});

function chooseAnotherFile() {
  importStore.reset();
}

// Safe to cancel outright, unlike the review-screen cancel — nothing has been written to the
// server yet at this point, so there's nothing to revert/delete, just the local session to drop.
function onCancelConfirm() {
  importStore.reset();
  router.push({ name: "library" });
}

// ── Importing progress ────────────────────────────────────────────────────────

// Only counts outcomes the send loop itself produced this run — NOT the in-file duplicates or
// unreadable rows loadFile already logged before startImport began (those would otherwise start
// the bar above 0%, since counts.duplicate/failed also include them for the "Not imported" tab's
// filters). A row that lands in the review queue counts too: startImport is done deciding its
// fate for this run even though a human still has to resolve it, so leaving it uncounted would
// keep the bar short of 100% whenever any row needs review.
const processed = computed(
  () =>
    counts.value.imported +
    counts.value.updated +
    log.value.filter((e) => e.reason === "in_library").length +
    log.value.filter((e) => e.reason === "request_failed").length +
    reviewQueue.value.length,
);
const progressPct = computed(() =>
  counts.value.total > 0
    ? Math.round((processed.value / counts.value.total) * 100)
    : 0,
);

// ── Review screen: enrichment estimate ─────────────────────────────────────────

// Only newly created scans mint new `works` rows for the sweeper to enrich (an updated scan's
// book/work already existed) — the estimate scales off that, not the total imported+updated
// count. Thresholds are rough (the sweeper's real throughput also depends on series-membership
// amplification and how busy the shared queue already is), but a scaling estimate beats a fixed
// "next few hours" that's wrong by orders of magnitude for a large import.
const enrichmentNoteKey = computed(() => {
  const n = counts.value.imported;
  if (n <= 50) return "import.summary.enrichment_note_small";
  if (n <= 300) return "import.summary.enrichment_note_medium";
  return "import.summary.enrichment_note_large";
});

// ── Review screen: tabs ────────────────────────────────────────────────────────

type ReviewTab = "matched" | "attention" | "not_imported";

const activeTab = ref<ReviewTab>("matched");

function goToLibrary() {
  finalizeImport();
  router.push({ name: "library" });
}

function onDiscardSession() {
  if (window.confirm(t("import.paused.discard_confirm"))) discardSession();
}

const cancelDialogOpen = ref(false);
const cancelling = ref(false);

function onCancelImport() {
  cancelDialogOpen.value = true;
}

async function confirmCancelImport() {
  cancelling.value = true;
  try {
    // cancelImport() already resets the session (nothing left to review once every row is
    // reverted or removed) — no separate finalize call needed.
    await cancelImport();
    cancelDialogOpen.value = false;
    router.push({ name: "library" });
  } finally {
    cancelling.value = false;
  }
}

// ── Review screen: rating ──────────────────────────────────────────────────────

const ratingDialogOpen = ref(false);
const ratingItem = ref<ImportedItem | null>(null);

function openRating(item: ImportedItem) {
  ratingItem.value = item;
  ratingDialogOpen.value = true;
}
function onSetRating(rating: number | null) {
  if (ratingItem.value) setImportedRating(ratingItem.value, rating);
}

// ── Review screen: resolve drawer ──────────────────────────────────────────────

const resolveItemId = ref<number | null>(null);
const resolveItem = computed<ReviewItem | null>(
  () =>
    reviewQueue.value.find((item) => item.id === resolveItemId.value) ?? null,
);

function openResolve(item: ReviewItem) {
  resolveItemId.value = item.id;
  ensureCandidatesLoaded(item);
}
function closeResolve() {
  resolveItemId.value = null;
}
async function onPickCandidate(item: ReviewItem, isbn: string) {
  closeResolve();
  await confirmReviewItem(item, isbn);
}
function onSkip(item: ReviewItem) {
  closeResolve();
  skipReviewItem(item);
}

// ── Review screen: not-imported list ───────────────────────────────────────────

type LogFilter = "all" | "duplicate" | "failed" | "skipped";

const logFilter = ref<LogFilter>("all");
const logFilterOptions = computed(() =>
  (["all", "duplicate", "failed", "skipped"] as LogFilter[]).map((f) => ({
    value: f,
    label: t(`import.summary.list.filter_${f}`),
  })),
);
function updateLogFilter(v: string) {
  logFilter.value = v as LogFilter;
}
const filteredLog = computed(() =>
  logFilter.value === "all"
    ? notImported.value
    : notImported.value.filter((entry) => entry.outcome === logFilter.value),
);
const OUTCOME_COLOR_CLASS: Record<ImportLogEntry["outcome"], string> = {
  imported: "text-success",
  duplicate: "text-text-secondary",
  failed: "text-error",
  skipped: "text-warning",
};

// Owning status, then reading status, then rating descending — owned/read/10-of-10 first. The rank
// is frozen per card at creation (see ImportedItem.sortRank), so editing a card in place doesn't move
// it; rows still slot into the right spot as each batch resolves. Ties keep arrival order (sort is
// stable), and the store's own array stays in arrival order, which its absorb/remove paths rely on.
const sortedImportedItems = computed(() =>
  [...importedItems.value].sort((a, b) => a.sortRank - b.sortRank),
);

const tabs = computed(() => [
  {
    value: "matched" as const,
    label: t("import.tabs.matched", { n: importedItems.value.length }),
  },
  {
    value: "attention" as const,
    label:
      reviewRemaining.value > 0
        ? t("import.tabs.attention", {
            n: reviewQueue.value.length,
            open: reviewRemaining.value,
          })
        : t("import.tabs.attention_all_resolved", {
            n: reviewQueue.value.length,
          }),
  },
  {
    value: "not_imported" as const,
    label: t("import.tabs.not_imported", { n: notImported.value.length }),
  },
]);
</script>

<template>
  <div class="bg-charcoal min-h-screen flex flex-col">
    <AppHeader />

    <main class="flex-1 px-6 md:px-12 pt-8 md:pt-10 pb-28 md:pb-10">
      <!-- ── Paused: rehydrated after a reload mid-run ─────────────────────── -->
      <div
        v-if="sessionPaused"
        class="max-w-[640px] mx-auto flex flex-col gap-6"
      >
        <div>
          <h1
            class="font-heading text-[30px] md:text-[34px] font-bold text-text-primary leading-none mb-2"
          >
            {{ t("import.paused.heading") }}
          </h1>
          <p class="text-[13px] text-text-secondary">
            {{
              t("import.paused.description", {
                fileName,
                imported: counts.imported + counts.updated,
                total: counts.total,
              })
            }}
          </p>
        </div>
        <div class="flex gap-3">
          <AppButton variant="primary" size="sm" @click="startImport">
            {{ t("import.paused.resume") }}
          </AppButton>
          <AppButton variant="secondary" size="sm" @click="onDiscardSession">
            {{ t("import.paused.discard") }}
          </AppButton>
        </div>
      </div>

      <div
        v-else-if="step !== 'review'"
        class="max-w-[640px] mx-auto flex flex-col gap-8"
      >
        <div>
          <h1
            class="font-heading text-[30px] md:text-[34px] font-bold text-text-primary leading-none mb-2"
          >
            {{ t("import.heading") }}
          </h1>
          <p class="text-[13px] text-text-secondary">
            {{ t("import.subheading") }}
          </p>
        </div>

        <!-- ── Upload ─────────────────────────────────────────────────────── -->
        <section v-if="step === 'upload'" class="flex flex-col gap-4">
          <div
            class="border border-dashed border-charcoal-border p-10 flex flex-col items-center gap-4 text-center"
          >
            <p class="text-[13px] text-text-secondary max-w-sm">
              {{ t("import.upload.instructions") }}
            </p>
            <AppButton
              variant="primary"
              size="sm"
              :loading="uploading"
              @click="fileInputEl?.click()"
            >
              {{ t("import.upload.choose_file") }}
            </AppButton>
            <input
              ref="fileInputEl"
              type="file"
              accept=".csv"
              class="hidden"
              @change="onFileChange"
            />
          </div>
          <p
            v-if="error"
            class="text-[12px]"
            style="color: rgb(var(--v-theme-error))"
          >
            {{ t(`import.upload.${error}`) }}
          </p>
        </section>

        <!-- ── Confirm ────────────────────────────────────────────────────── -->
        <section v-else-if="step === 'confirm'" class="flex flex-col gap-5">
          <div class="flex items-center justify-between gap-4">
            <p class="text-[13px] text-text-secondary">
              {{
                t("import.confirm.summary", {
                  books: rows.length,
                  shelves: shelfCounts.size,
                })
              }}
            </p>
            <button
              type="button"
              class="flex-none font-mono text-[10px] tracking-[0.1em] uppercase text-text-secondary hover:text-text-primary transition-colors"
              @click="chooseAnotherFile"
            >
              {{ t("import.confirm.choose_another_file") }}
            </button>
          </div>

          <!-- Shelf mapping: collapsed summary, replaced in place by the editable panel -->
          <div class="flex flex-col gap-3">
            <div class="flex items-center justify-between gap-4">
              <p
                class="font-mono text-[10px] tracking-[0.14em] uppercase text-text-secondary/70"
              >
                {{ t("import.confirm.mapping_heading") }}
              </p>
              <button
                type="button"
                :aria-expanded="mappingExpanded"
                class="flex-none font-mono text-[10px] tracking-[0.1em] uppercase text-text-primary border border-control-border px-3 py-1.5 hover:border-primary hover:text-primary transition-colors"
                @click="mappingExpanded = !mappingExpanded"
              >
                {{
                  mappingExpanded
                    ? t("import.confirm.hide_mapping")
                    : t("import.confirm.adjust_mapping")
                }}
              </button>
            </div>

            <div
              v-if="!mappingExpanded"
              class="border border-charcoal-border divide-y divide-charcoal-border"
            >
              <p
                v-for="[shelf, count] in shelfCounts"
                :key="shelf"
                class="text-[13px] text-text-primary px-4 py-3"
              >
                {{
                  t("import.confirm.shelf_line", {
                    shelf,
                    count,
                    status: statusLabels[mapping[shelf]?.status],
                  })
                }}
              </p>
            </div>
            <ShelfMappingPanel
              v-else
              :shelf-counts="shelfCounts"
              :mapping="mapping"
              @update-mapping="setMapping"
            />
          </div>

          <button
            role="switch"
            :aria-checked="updateExisting"
            class="flex items-center justify-between gap-5 w-full text-left border border-charcoal-border px-4 py-3.5"
            @click="updateExisting = !updateExisting"
          >
            <span class="min-w-0">
              <span class="block text-xs text-text-primary">{{
                t("import.confirm.update_existing")
              }}</span>
              <span class="block text-[10px] text-text-secondary mt-0.5 leading-snug">{{
                t("import.confirm.update_existing_sub")
              }}</span>
            </span>
            <AppToggle :model-value="updateExisting" />
          </button>

          <button
            role="switch"
            :aria-checked="importShelvesAsTags"
            class="flex items-center justify-between gap-5 w-full text-left border border-charcoal-border px-4 py-3.5"
            @click="importShelvesAsTags = !importShelvesAsTags"
          >
            <span class="min-w-0">
              <span class="block text-xs text-text-primary">{{
                t("import.confirm.shelves_as_tags")
              }}</span>
              <span class="block text-[10px] text-text-secondary mt-0.5 leading-snug">{{
                t("import.confirm.shelves_as_tags_sub")
              }}</span>
            </span>
            <AppToggle :model-value="importShelvesAsTags" />
          </button>

          <div class="flex gap-3">
            <AppButton
              variant="primary"
              size="sm"
              @click="startImport"
            >
              {{ t("import.confirm.start") }}
            </AppButton>
            <AppButton
              variant="secondary"
              size="sm"
              @click="onCancelConfirm"
            >
              {{ t("import.confirm.cancel") }}
            </AppButton>
          </div>
        </section>

        <!-- ── Importing ──────────────────────────────────────────────────── -->
        <section v-else-if="step === 'importing'" class="flex flex-col gap-4">
          <v-progress-linear
            :model-value="progressPct"
            color="primary"
            height="6"
            rounded="0"
          />
          <p class="text-[12px] text-text-secondary">
            {{ t("import.importing.progress", { done: processed, total: counts.total }) }}
          </p>
          <div class="grid grid-cols-2 sm:grid-cols-5 gap-3 font-mono text-[11px] text-text-secondary">
            <span>{{ t("import.importing.imported", { n: counts.imported }) }}</span>
            <span>{{ t("import.importing.updated", { n: counts.updated }) }}</span>
            <span>{{ t("import.importing.duplicate", { n: counts.duplicate }) }}</span>
            <span>{{ t("import.importing.failed", { n: counts.failed }) }}</span>
            <span>{{ t("import.importing.needs_review", { n: reviewQueue.length }) }}</span>
          </div>
          <AppButton
            variant="secondary"
            size="sm"
            class="self-start"
            :disabled="cancelRequested"
            @click="cancelImporting"
          >
            {{
              cancelRequested
                ? t("import.importing.cancelling")
                : t("import.importing.cancel")
            }}
          </AppButton>
        </section>

      </div>

      <!-- ── Review: matched + needs-attention + not-imported ─────────────── -->
      <section
        v-else
        class="max-w-[1320px] mx-auto border border-charcoal-border flex flex-col"
      >
        <ImportHeaderBar
          :file-name="fileName"
          :matched-count="importedItems.length"
          :attention-count="reviewRemaining"
          :remaining="reviewRemaining"
          @cancel="onCancelImport"
          @finalize="goToLibrary"
        />

        <p
          class="px-6 md:px-8 py-3 text-[11px] text-text-secondary leading-relaxed border-b border-charcoal-border"
        >
          {{ t(enrichmentNoteKey) }}
        </p>

        <div
          class="flex px-6 md:px-8 border-b border-charcoal-border overflow-x-auto overflow-y-hidden"
        >
          <button
            v-for="tab in tabs"
            :key="tab.value"
            type="button"
            class="flex-none py-3 mr-7 -mb-px font-mono text-[11px] tracking-[0.14em] uppercase whitespace-nowrap border-b-2 transition-colors"
            :class="
              activeTab === tab.value
                ? 'text-text-primary border-primary'
                : 'text-text-secondary border-transparent'
            "
            @click="activeTab = tab.value"
          >
            {{ tab.label }}
          </button>
        </div>

        <!-- Matched -->
        <div v-if="activeTab === 'matched'">
          <p
            v-if="importedItems.length === 0"
            class="p-6 md:p-8 text-[12px] text-text-secondary"
          >
            {{ t("import.summary.imported_empty") }}
          </p>
          <template v-else>
            <!-- column headers; below md each row carries its own labels instead -->
            <div
              class="hidden lg:grid border-b border-charcoal-border py-2.5 font-mono text-[9px] tracking-[0.12em] uppercase text-text-secondary/60"
              :class="[MATCHED_GRID, MATCHED_ROW_PADDING]"
            >
              <span />
              <span>{{ t("import.table.book") }}</span>
              <span>{{ t("import.table.edition") }}</span>
              <span>{{ t("import.table.rating_source") }}</span>
              <span>{{ t("import.table.status") }}</span>
              <span>{{ t("import.table.owning") }}</span>
              <span />
            </div>
            <div class="divide-y divide-charcoal-border">
              <MatchedRow
                v-for="item in sortedImportedItems"
                :key="item.scanId"
                :item="item"
                @toggle-edition="toggleImportedEdition(item)"
                @close-edition="closeImportedEdition(item)"
                @retry-candidates="retryImportedCandidates(item)"
                @change-edition="(isbn) => changeImportedEdition(item, isbn)"
                @set-status="async (s: ReadStatus) => await setImportedStatus(item, s)"
                @set-owning="async (o: OwningStatus) => await setImportedOwning(item, o)"
                @open-rating="openRating(item)"
                @remove="removeImportedItem(item)"
                @undo="undoImportedUpdate(item)"
              />
            </div>
          </template>
        </div>

        <!-- Needs attention -->
        <div v-else-if="activeTab === 'attention'">
          <!-- These rows were never judged — the title search behind the auto-assign pass failed
               upstream — so asking again is likelier to clear them than resolving them by hand. -->
          <div
            v-if="retryableReviewItems.length > 0"
            class="flex items-center justify-between gap-3 flex-wrap px-6 md:px-8 py-4 border-b border-charcoal-border"
          >
            <p class="text-[11px] text-text-secondary">
              {{
                t("import.review.search_unavailable_note", {
                  n: retryableReviewItems.length,
                })
              }}
            </p>
            <AppButton
              variant="secondary"
              size="sm"
              :loading="retryingSearch"
              class="flex-none"
              @click="retrySearchUnavailable()"
            >
              {{ t("import.review.retry_search") }}
            </AppButton>
          </div>
          <!-- Bulk skip/undo: the counterpart to AttentionRow's per-row actions, for a queue the
               user has decided not to work through book by book. Nothing is written server-side,
               so neither needs a confirm — Undo all reverses a mis-click in one click.
               Both are disabled while the retry above is in flight: that pass writes `pending`
               back onto every row it fails to resolve, so a bulk skip issued mid-pass is silently
               reverted for exactly the rows it touches. The store refuses it too. -->
          <div
            v-if="reviewQueue.length > 0"
            class="flex items-center justify-end gap-2 px-6 md:px-8 py-4 border-b border-charcoal-border"
          >
            <AppButton
              v-if="counts.skipped > 0"
              variant="ghost"
              size="sm"
              :disabled="retryingSearch"
              class="flex-none"
              @click="undoAllSkippedReviewItems()"
            >
              {{ t("import.review.undo_all", { n: counts.skipped }) }}
            </AppButton>
            <AppButton
              v-if="reviewRemaining > 0"
              variant="secondary"
              size="sm"
              :disabled="retryingSearch"
              class="flex-none"
              @click="skipAllReviewItems()"
            >
              {{ t("import.review.skip_all", { n: reviewRemaining }) }}
            </AppButton>
          </div>
          <p
            v-if="reviewQueue.length === 0"
            class="p-6 md:p-8 text-[12px] text-text-secondary"
          >
            {{ t("import.review.none") }}
          </p>
          <div v-else class="divide-y divide-charcoal-border">
            <AttentionRow
              v-for="item in reviewQueue"
              :key="item.id"
              :item="item"
              @resolve="openResolve(item)"
              @undo="undoSkipReviewItem(item)"
            />
          </div>
        </div>

        <!-- Not imported -->
        <div v-else>
          <div
            class="flex items-center justify-between gap-3 flex-wrap p-6 md:p-8 pb-4"
          >
            <p
              class="text-[10px] tracking-[0.1em] uppercase text-text-secondary/60"
            >
              {{ t("import.summary.list.heading") }}
            </p>
            <AppSegmented
              :options="logFilterOptions"
              :model-value="logFilter"
              size="sm"
              @update:model-value="updateLogFilter"
            />
          </div>
          <div class="divide-y divide-charcoal-border border-t border-charcoal-border">
            <p
              v-if="filteredLog.length === 0"
              class="p-6 md:p-8 text-[12px] text-text-secondary"
            >
              {{ t("import.summary.list.empty") }}
            </p>
            <div
              v-for="(entry, i) in filteredLog"
              :key="i"
              class="flex items-center justify-between gap-3 px-6 md:px-8 py-3"
            >
              <div class="min-w-0">
                <p class="text-[13px] text-text-primary truncate">
                  {{ entry.title || entry.isbn || "—" }}
                </p>
                <p class="text-[11px] text-text-secondary truncate">
                  {{ entry.author || t("book.unknown_author") }}
                </p>
              </div>
              <p
                class="text-[11px] text-right flex-none"
                :class="OUTCOME_COLOR_CLASS[entry.outcome]"
              >
                {{ t(`import.summary.list.reason.${entry.reason}`) }}
              </p>
            </div>
          </div>
        </div>
      </section>
    </main>

    <RatingDialog
      v-model="ratingDialogOpen"
      :rating="ratingItem?.rating ?? null"
      @set-rating="onSetRating"
    />

    <ConfirmDialog
      v-model="cancelDialogOpen"
      danger
      :title="t('import.summary.cancel_dialog_title')"
      :confirm-label="t('import.summary.cancel_dialog_confirm')"
      :cancel-label="t('import.summary.cancel_dialog_dismiss')"
      :loading="cancelling"
      @confirm="confirmCancelImport"
    >
      {{ t("import.summary.cancel_confirm", { n: importedItems.length }) }}
    </ConfirmDialog>

    <ResolveDrawer
      :item="resolveItem"
      @close="closeResolve"
      @update:query="(q) => (resolveItem!.searchQuery = q)"
      @search="searchReviewCandidates(resolveItem!)"
      @retry="retryCandidates(resolveItem!)"
      @pick="(isbn) => onPickCandidate(resolveItem!, isbn)"
      @skip="onSkip(resolveItem!)"
    />
  </div>
</template>
