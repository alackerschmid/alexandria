<template>
  <div>
    <!-- Fixed columns inside a capped container rather than `auto-fill`: auto-fill counts tracks
         from the track's *max*, so a definite max collapses to one column on a narrow screen.
         2-up at 390px and 4-up capped at ~170px tiles on desktop, as the mockup draws it. -->
    <div class="grid grid-cols-2 md:grid-cols-4 gap-4 md:gap-5 max-w-[46rem]">
      <button
        v-for="ed in visible"
        :key="ed.isbn"
        class="text-left group"
        @click="onPick()"
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

    <!-- Always offered, not only when the grid is truncated: the dialog is also where the language
         filter and "find more editions" discovery live. -->
    <div class="text-center mt-6">
      <button
        class="text-[10px] tracking-[0.18em] uppercase text-text-secondary hover:text-orange-neon transition-colors"
        @click="emit('show-all')"
      >
        {{
          $t("detail.show_all_editions", { n: editions.length }, editions.length)
        }}
      </button>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useLocaleStore } from "@/stores/locale";
import { languageDisplayFormatter } from "@/utils/language";
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
    /** Tiles to show before falling back to "Show all N editions". */
    limit?: number;
  }>(),
  { limit: 8 },
);

const emit = defineEmits<{ "show-all": [] }>();

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

// Every tile opens the dialog rather than switching in place: moving a scan to a different edition
// is a real mutation, and it keeps its click-twice confirm step there.
function onPick() {
  emit("show-all");
}

function borderClass(ed: WorkEdition) {
  if (ed.isbn === props.activeIsbn) return "border-2 border-orange-neon";
  if (ed.scan_id) return "border border-orange-neon/50";
  return "border border-charcoal-border group-hover:border-control-border";
}

function caption(ed: WorkEdition) {
  const year = ed.publish_date?.slice(0, 4) ?? "";
  if (ed.isbn === props.activeIsbn) {
    return [t("detail.your_copy"), year].filter(Boolean).join(" · ");
  }
  const lang = ed.language ? langDisplay.value(ed.language) : "";
  return [year, lang].filter(Boolean).join(" · ") || ed.isbn;
}
</script>
