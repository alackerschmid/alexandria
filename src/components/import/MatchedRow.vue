<script setup lang="ts">
import { computed, ref, watch, onBeforeUnmount } from "vue";
import { useI18n } from "vue-i18n";
import CyclePill from "@/components/CyclePill.vue";
import RatingStars from "@/components/RatingStars.vue";
import CoverImage from "@/components/CoverImage.vue";
import { STATUS_ORDER, STATUS_META } from "@/composables/useBookStatus";
import { OWNING_ORDER, OWNING_META } from "@/composables/useOwningStatus";
import { languageDisplayFormatter } from "@/utils/language";
import { MATCHED_GRID, MATCHED_ROW_PADDING } from "./matched-grid";
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

// The server drops a rating on any scan that isn't "read" (worker/src/import-validation.ts),
// so the rating control is replaced by an explanation until the book is marked read.
const canRate = computed(() => props.item.status === "read");

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
      </div>

      <!-- edition picker -->
      <div ref="editionEl" class="relative col-span-2 lg:col-span-1">
        <p
          class="lg:hidden text-[10px] tracking-[0.1em] uppercase text-text-secondary/60 mb-1.5"
        >
          {{ t("import.table.edition") }}
        </p>
        <button
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
          v-if="canRate"
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
        <p v-else class="text-[10.5px] text-text-secondary/60 leading-snug">
          {{ t("import.row.rating_needs_read") }}
        </p>
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
