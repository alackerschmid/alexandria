<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from "vue";
import { useI18n } from "vue-i18n";
import CyclePill from "@/components/CyclePill.vue";
import RatingStars from "@/components/RatingStars.vue";
import CoverImage from "@/components/CoverImage.vue";
import { STATUS_ORDER, STATUS_META } from "@/composables/useBookStatus";
import { OWNING_ORDER, OWNING_META } from "@/composables/useOwningStatus";
import { languageDisplayFormatter } from "@/utils/language";
import { editionYear } from "@/utils/book-display";
import { MATCHED_GRID, MATCHED_ROW_PADDING } from "./matched-grid";
import { useImportStore } from "@/stores/import";
import type { ImportedItem } from "@/stores/import";
import type { ReadStatus, OwningStatus } from "@/types/book";

const props = defineProps<{ item: ImportedItem }>();
const emit = defineEmits<{
  "set-status": [status: ReadStatus];
  "set-owning": [owning: OwningStatus];
  "open-rating": [];
  "toggle-edition": [];
  "close-edition": [];
  "retry-candidates": [];
  "change-edition": [isbn: string];
  remove: [];
  undo: [];
}>();

const { t, locale } = useI18n();
// The one piece of state this row can't read off its own item: whether the sibling edition the
// server named is a copy that predates the import, or one this very run added a row or a batch
// earlier (see isSessionCreatedEdition).
const importStore = useImportStore();
const langName = computed(() => languageDisplayFormatter(locale.value));

const statusOptions = computed(() =>
  STATUS_ORDER.map((s) => ({
    value: s,
    label: t(`book.${s}`),
    color: STATUS_META[s].color,
  })),
);
const owningOptions = computed(() =>
  OWNING_ORDER.map((o) => ({
    value: o,
    label: t(`owning.${o}`),
    color: OWNING_META[o].color,
  })),
);

// Dismiss the edition popover on an outside click or Escape. Listeners are only attached while
// it's open, and `pointerdown` (not `click`) so a click that lands on another row's toggle
// closes this one before that row opens its own.
const editionEl = ref<HTMLElement | null>(null);

function onPointerDown(e: PointerEvent) {
  if (!editionEl.value?.contains(e.target as Node)) emit("close-edition");
}
function onKeydown(e: KeyboardEvent) {
  if (e.key === "Escape") emit("close-edition");
}
function unbind() {
  document.removeEventListener("pointerdown", onPointerDown);
  document.removeEventListener("keydown", onKeydown);
}

watch(
  () => props.item.editingEdition,
  (open) => {
    if (open) {
      document.addEventListener("pointerdown", onPointerDown);
      document.addEventListener("keydown", onKeydown);
    } else {
      unbind();
    }
  },
);

onBeforeUnmount(unbind);

// Separate handler (rather than a ternary inline in the template) because TS can't unify the
// distinct per-event tuple overloads of `emit` across a conditional event name.
function onRemoveOrUndo() {
  if (props.item.preexisting) emit("undo");
  else emit("remove");
}

// This row added a second edition of a work already on the shelf — a real new scan (the import
// dedupes per ISBN), but one carrying no ownership claim next to a copy that may well be marked
// owned. Name the edition it landed beside so the user can reconcile the two.
const otherEditionNote = computed(() => {
  const other = props.item.otherEdition;
  // "Already on the shelf" is the whole point of the note, so stay silent when the copy it names
  // is another row of this same import rather than something the user had before it.
  if (!other || importStore.isSessionCreatedEdition(other.isbn)) return null;
  // Publisher and year together, because one publisher's reissue and original share everything
  // else — "Farrar, Straus and Giroux" alone reads as though the import flagged the same book.
  // The ISBN only stands in when neither is known; it identifies the copy but doesn't describe it.
  const named = [other.publisher, editionYear(other)].filter(Boolean).join(" · ");
  return t("import.summary.card.other_edition", {
    details: `${named || other.isbn} · ${t(`owning.${other.owning_status}`)}`,
  });
});

// A preexisting row updated a scan that already had a reading status; the pill shows the value
// the import just wrote, so name the one it replaced. Ownership needs no equivalent — the import
// never touches it, so the pill is already the scan's unchanged current value.
const previousStatusLabel = computed(() => {
  const prev = props.item.previous?.status;
  return prev && prev !== props.item.status ? t(`book.${prev}`) : null;
});

const editionLabel = computed(() => {
  const publisher =
    props.item.publisher || t("import.summary.card.unknown_publisher");
  return props.item.language
    ? `${publisher} · ${langName.value(props.item.language)}`
    : publisher;
});
</script>

<template>
  <div class="py-3" :class="MATCHED_ROW_PADDING">
    <div class="grid" :class="MATCHED_GRID">
      <!-- cover -->
      <div class="w-10 h-[60px] flex-none relative overflow-hidden bg-charcoal-light">
        <CoverImage
          :cover-url="item.coverUrl"
          :title="item.title"
          text-class="text-sm"
          :icon-size="14"
          class="w-full h-full object-cover"
        />
      </div>

      <!-- title / author -->
      <div class="min-w-0">
        <p
          class="font-heading font-bold text-[13px] text-text-primary truncate"
        >
          {{ item.title || "—" }}
        </p>
        <p class="text-[10.5px] text-text-secondary truncate mt-0.5">
          {{ item.author || t("book.unknown_author") }}
        </p>
        <p
          v-if="item.matchedByTitle"
          class="text-[9.5px] text-text-secondary/70 italic truncate mt-0.5"
        >
          {{
            t("import.summary.card.matched_by_title", {
              pct: Math.round((item.matchConfidence ?? 0) * 100),
            })
          }}
        </p>
        <p
          v-else-if="item.preexisting"
          class="text-[9.5px] text-text-secondary/70 italic truncate mt-0.5"
        >
          {{ t("import.summary.card.already_in_library") }}
        </p>
        <p
          v-else-if="otherEditionNote"
          class="text-[9.5px] text-warning truncate mt-0.5"
          :title="otherEditionNote"
        >
          {{ otherEditionNote }}
        </p>
      </div>

      <!-- edition picker -->
      <div ref="editionEl" class="relative col-span-2 lg:col-span-1">
        <p
          class="lg:hidden text-[10px] tracking-[0.1em] uppercase text-text-secondary/60 mb-1.5"
        >
          {{ t("import.table.edition") }}
        </p>
        <!-- A preexisting/title-matched row updates a scan that predates the import, so an
             edition swap (create-new + delete-old) would destroy the user's original entry.
             Show the edition read-only for these rows instead of the picker. -->
        <p
          v-if="item.preexisting"
          class="border border-transparent px-2.5 py-2 font-mono text-[9.5px] text-text-secondary/70 truncate"
        >
          {{ editionLabel }}
        </p>
        <button
          v-else
          type="button"
          class="flex items-center gap-1.5 w-full border border-charcoal-border px-2.5 py-2 font-mono text-[9.5px] text-text-secondary text-left hover:border-primary transition-colors"
          @click="emit('toggle-edition')"
        >
          <span class="flex-1 truncate">{{ editionLabel }}</span>
          <span class="flex-none text-[7px] opacity-60" aria-hidden="true">▼</span>
        </button>

        <div
          v-if="item.editingEdition"
          class="absolute left-0 top-[calc(100%+4px)] z-50 w-[280px] max-w-[90vw] bg-charcoal-light border border-charcoal-border shadow-xl p-1.5 max-h-[300px] overflow-y-auto"
        >
          <p
            v-if="item.loadingCandidates && !item.candidatesLoaded"
            class="p-3 text-[12px] text-text-secondary"
          >
            {{ t("import.review.loading") }}
          </p>
          <template v-else>
            <div
              v-if="item.candidates.length === 0"
              class="flex items-center gap-2 p-3"
            >
              <p class="text-[12px] text-text-secondary">
                {{
                  item.searchUnavailable
                    ? t("import.review.search_unavailable")
                    : t("import.review.no_matches")
                }}
              </p>
            </div>
            <button
              v-for="candidate in item.candidates"
              :key="candidate.isbn"
              type="button"
              :disabled="item.busy"
              class="flex items-center gap-2.5 w-full text-left p-2 hover:bg-charcoal transition-colors disabled:opacity-40"
              :class="
                candidate.isbn === item.isbn
                  ? 'border-l-2 border-primary'
                  : 'border-l-2 border-transparent'
              "
              @click="emit('change-edition', candidate.isbn)"
            >
              <div class="w-5 h-7 flex-none relative overflow-hidden bg-charcoal">
                <CoverImage
                  :cover-url="candidate.cover_url"
                  :title="candidate.title"
                  text-class="text-[9px]"
                  :icon-size="8"
                  class="w-full h-full object-cover"
                />
              </div>
              <div class="min-w-0">
                <p class="text-[11px] text-text-primary truncate">
                  {{ candidate.title }}
                </p>
                <p class="text-[9.5px] text-text-secondary truncate mt-0.5">
                  {{ candidate.publisher || candidate.author }}
                </p>
              </div>
            </button>

            <!-- Live Google Books search is opt-in: the list above is already-stored editions
                 (loaded for free), so this is the only place a search actually spends quota. -->
            <div
              class="flex items-center justify-between gap-2 px-2 pt-2 mt-1 border-t border-charcoal-border/60"
            >
              <p
                v-if="item.searchUnavailable"
                class="text-[10px] text-text-secondary/70 leading-snug"
              >
                {{ t("import.review.search_unavailable") }}
              </p>
              <span v-else />
              <button
                type="button"
                :disabled="item.loadingCandidates"
                class="flex-none font-mono text-[10px] tracking-[0.1em] uppercase text-primary disabled:opacity-40"
                @click="emit('retry-candidates')"
              >
                {{
                  item.loadingCandidates
                    ? t("import.review.loading")
                    : t("import.review.search_online")
                }}
              </button>
            </div>
          </template>
        </div>
      </div>

      <!-- rating: same display + dialog picker as the book detail screen -->
      <div class="col-span-2 lg:col-span-1">
        <p
          class="lg:hidden text-[10px] tracking-[0.1em] uppercase text-text-secondary/60 mb-1.5"
        >
          {{ t("import.table.rating") }}
        </p>
        <button
          type="button"
          class="flex items-center gap-2 hover:opacity-80 transition-opacity"
          @click="emit('open-rating')"
        >
          <RatingStars :rating="item.rating" size="sm" />
          <span class="font-mono text-[11px] text-text-primary">
            {{ item.rating ?? "–" }}{{ t("detail.of_ten") }}
          </span>
          <span class="text-[9px] text-text-secondary/50">▾</span>
        </button>
      </div>

      <!-- status / owning -->
      <div class="col-span-2 lg:col-span-1">
        <p
          class="lg:hidden text-[10px] tracking-[0.1em] uppercase text-text-secondary/60 mb-1.5"
        >
          {{ t("import.table.status") }}
        </p>
        <CyclePill
          :options="statusOptions"
          :model-value="item.status"
          :title="t('library.filter_status')"
          :disabled="item.busy"
          @update:model-value="(v) => emit('set-status', v as ReadStatus)"
        />
        <p
          v-if="previousStatusLabel"
          class="text-[9.5px] text-text-secondary/70 italic truncate mt-1"
        >
          {{ t("import.summary.card.was_status", { status: previousStatusLabel }) }}
        </p>
      </div>
      <div class="col-span-2 lg:col-span-1">
        <p
          class="lg:hidden text-[10px] tracking-[0.1em] uppercase text-text-secondary/60 mb-1.5"
        >
          {{ t("import.table.owning") }}
        </p>
        <CyclePill
          :options="owningOptions"
          :model-value="item.owningStatus"
          :title="t('owning.label')"
          :disabled="item.busy"
          @update:model-value="(v) => emit('set-owning', v as OwningStatus)"
        />
      </div>

      <!-- remove / undo: a preexisting row predates the import, so its destructive action
           restores the scan's prior status/rating instead of deleting it -->
      <button
        type="button"
        :disabled="item.busy"
        :title="t(item.preexisting ? 'import.summary.card.undo' : 'import.summary.card.remove')"
        :aria-label="t(item.preexisting ? 'import.summary.card.undo' : 'import.summary.card.remove')"
        class="col-span-2 lg:col-span-1 justify-self-start lg:justify-self-center text-text-secondary/60 hover:text-error transition-colors disabled:opacity-40"
        @click="onRemoveOrUndo"
      >
        <span
          class="lg:hidden font-mono text-[10px] tracking-[0.16em] uppercase"
        >
          {{ t(item.preexisting ? "import.summary.card.undo" : "import.summary.card.remove") }}
        </span>
        <span class="hidden lg:inline text-[16px] leading-none">{{
          item.preexisting ? "↺" : "×"
        }}</span>
      </button>
    </div>

    <p
      v-if="item.error"
      class="text-[11px] mt-2"
      style="color: rgb(var(--v-theme-error))"
    >
      {{ t(`import.summary.card.error_${item.error}`) }}
    </p>
  </div>
</template>
