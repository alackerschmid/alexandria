<template>
  <div>
    <!-- The tab is offered for every book now, so this pane has to hold its own when there is
         nothing to browse: say *which* nothing it is. An answer that hasn't arrived yet is not
         "none found", and a book with no work link is a third case again — see `emptyMessage`. -->
    <p
      v-if="loading"
      class="text-[15px] md:text-base leading-[1.8] text-text-secondary/70 italic mb-4"
    >
      {{ $t("detail.loading") }}
    </p>
    <p
      v-else-if="!editions.length"
      class="text-[15px] md:text-base leading-[1.8] text-text-secondary/70 italic mb-4"
    >
      {{ emptyMessage }}
    </p>

    <!-- Fixed columns rather than `auto-fill`, which counts tracks from the track's *max* and so
         collapses to one column on a narrow screen. 2-up at 390px, 4-up across the measure. -->
    <div v-else class="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-5">
      <button
        v-for="ed in visible"
        :key="ed.isbn"
        class="text-left group"
        @click="onPick(ed)"
      >
        <div
          class="aspect-[2/3] overflow-hidden transition-colors"
          :class="borderClass(ed)"
        >
          <CoverImage
            :cover-url="ed.cover_url"
            :title="ed.title ?? ed.isbn"
            :alt="ed.title ?? ed.isbn"
            text-class="text-lg"
            :icon-size="18"
            class="w-full h-full object-cover"
          />
        </div>
        <div
          class="font-mono text-[10.5px] md:text-[11px] mt-2.5"
          :class="ed.scan_id ? 'text-orange-neon' : 'text-text-secondary'"
        >
          {{ caption(ed) }}
        </div>
      </button>
    </div>

    <!-- Offered whenever the grid can be truncated *or* discovery can run — not only when the grid
         is truncated, since the dialog is also where the language filter lives. Withheld without a
         work link, because everything in the dialog keys off `work_id`: both `load()` and
         `discover()` early-return on a falsy one, so the button would open an empty dialog whose
         own "find more editions" does nothing. -->
    <div v-if="workLinked && !loading" class="text-center mt-6">
      <button
        class="text-[10px] tracking-[0.18em] uppercase text-text-secondary hover:text-orange-neon transition-colors"
        @click="emit('show-all')"
      >
        {{ showAllLabel }}
      </button>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useLocaleStore } from "@/stores/locale";
import { languageDisplayFormatter } from "@/utils/language";
import { editionBorderClass, editionYear } from "@/utils/book-display";
import CoverImage from "@/components/CoverImage.vue";
import type { WorkEdition } from "@/types/book";

// Editions get a real home instead of a link under the cover. This is the browsing surface: a
// cover grid with the user's own copy marked. The heavier work — filtering by language, running
// OpenLibrary discovery, and the click-twice-to-confirm edition switch — stays in EditionsDialog,
// reached from here, so a mis-tap in a grid can never move a scan to a different edition.
const props = withDefaults(
  defineProps<{
    editions: WorkEdition[];
    /** The edition currently open in the detail. */
    activeIsbn: string;
    /** True while the work's edition list is still being fetched. */
    loading?: boolean;
    /** Whether the book has a `work_id`. Without one there is nothing to look editions up by, and
     *  `EditionsDialog` — the only affordance this pane offers — can do neither of its two jobs. */
    workLinked?: boolean;
    /** Tiles to show before falling back to "Show all N editions". */
    limit?: number;
  }>(),
  { limit: 8 },
);

const emit = defineEmits<{
  "show-all": [];
  /** Open a different owned scan of this work. */
  select: [isbn: string, scanId: number];
}>();

const { t } = useI18n();
const localeStore = useLocaleStore();
const langDisplay = computed(() => languageDisplayFormatter(localeStore.locale));

// Owned editions first, then the rest — the user's own copies are the reason to open this pane.
const ordered = computed(() =>
  [...props.editions].sort(
    (a, b) => Number(!!b.scan_id) - Number(!!a.scan_id),
  ),
);

const visible = computed(() => ordered.value.slice(0, props.limit));

// Three ways to have nothing to show, and they are not the same sentence. A book whose enrichment
// hasn't linked it to a work yet can't be looked up at all, and saying "none found yet" there
// promises a search that never ran.
const emptyMessage = computed(() =>
  props.workLinked
    ? t("detail.no_more_editions")
    : t("detail.editions_no_work"),
);

// With nothing to browse the same button is the only thing on the pane, so it stops being "show
// all" and becomes the invitation to go and find some.
const showAllLabel = computed(() => {
  const n = props.editions.length;
  return n
    ? t("detail.show_all_editions", { n }, n)
    : t("detail.find_more_editions");
});

// A tile for an edition you already own goes straight to that scan's detail — it's another copy in
// your library, and opening it is navigation. Everything else opens the dialog, because moving a
// scan *to* a different edition is a real mutation that keeps its click-twice confirm step there.
function onPick(ed: WorkEdition) {
  if (ed.scan_id != null && ed.isbn !== props.activeIsbn) {
    emit("select", ed.isbn, ed.scan_id);
    return;
  }
  emit("show-all");
}

function borderClass(ed: WorkEdition) {
  return editionBorderClass(ed, props.activeIsbn);
}

function caption(ed: WorkEdition) {
  const year = editionYear(ed);
  if (ed.isbn === props.activeIsbn) {
    return [t("detail.your_copy"), year].filter(Boolean).join(" · ");
  }
  const lang = ed.language ? langDisplay.value(ed.language) : "";
  return [year, lang].filter(Boolean).join(" · ") || ed.isbn;
}
</script>
