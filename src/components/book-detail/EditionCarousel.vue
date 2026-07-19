<template>
  <div v-if="editions.length > 1" class="border border-charcoal-border">
    <v-carousel
      v-model="activeIndex"
      height="88"
      hide-delimiter-background
      show-arrows="hover"
    >
      <v-carousel-item v-for="e in editions" :key="e.isbn">
        <div class="flex items-center gap-3 h-full px-4 bg-charcoal-light">
          <div
            class="w-10 h-14 shrink-0 overflow-hidden bg-charcoal border border-charcoal-border"
          >
            <CoverImage
              :cover-url="e.cover_url"
              :title="e.title ?? e.isbn"
              :alt="e.title ?? e.isbn"
              text-class="text-[10px]"
              :icon-size="12"
              class="w-full h-full object-cover"
            />
          </div>
          <div class="min-w-0 flex-1">
            <div class="text-xs text-text-primary truncate">
              {{ e.publisher || e.title || e.isbn }}
            </div>
            <div
              class="text-[10px] text-text-secondary/60 uppercase tracking-wide"
            >
              {{ e.language ? langFmt(e.language) : "" }}
            </div>
          </div>
          <span
            v-if="e.status"
            class="w-1.5 h-1.5 rounded-full shrink-0"
            :class="STATUS_META[e.status].dotClass"
          />
        </div>
      </v-carousel-item>
    </v-carousel>
    <div
      class="text-center font-mono text-[9px] text-text-secondary/50 mt-1.5 tracking-[0.1em]"
    >
      {{
        $t("detail.edition_position", {
          n: activeIndex + 1,
          total: editions.length,
        })
      }}
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref, computed, watch } from "vue";
import { useApi } from "@/composables/useApi";
import { useLocaleStore } from "@/stores/locale";
import { STATUS_META } from "@/composables/useBookStatus";
import { languageDisplayFormatter } from "@/utils/language";
import CoverImage from "@/components/CoverImage.vue";
import type { ReadStatus } from "@/types/book";

interface EditionRow {
  isbn: string;
  title: string | null;
  language: string | null;
  cover_url: string | null;
  publish_date: string | null;
  publisher: string | null;
  scan_id: number | null;
  status: ReadStatus | null;
}

const props = defineProps<{
  workId: number;
  activeIsbn: string;
  /** Owned-edition count, when the caller already has it (e.g. from useEditionGrouping, which
   *  sets this to 1 for a single-edition work) — lets us skip the editions fetch outright for
   *  the common single-edition case. Undefined when unknown, in which case we fetch to find out. */
  editionCount?: number;
}>();
const emit = defineEmits<{ select: [isbn: string, scanId: number] }>();

const { apiFetch } = useApi();
const localeStore = useLocaleStore();
const langFmt = computed(() => languageDisplayFormatter(localeStore.locale));

const editions = ref<EditionRow[]>([]);
const activeIndex = ref(0);
// The work whose editions `editions.value` currently holds — lets the activeIsbn watcher below
// tell "activeIsbn changed within the same work" (safe to re-sync) apart from "workId changed
// too" (editions.value is stale/for the wrong work; only load()'s own sync, once it resolves,
// is safe). Without this, a simultaneous workId+activeIsbn change (e.g. Back/Forward between
// two different multi-edition books while BookDetail stays mounted) could sync against stale
// data and spuriously emit `select` for a leftover edition of the previous work.
const loadedWorkId = ref<number | null>(null);

function syncActiveIndex() {
  const idx = editions.value.findIndex((e) => e.isbn === props.activeIsbn);
  activeIndex.value = Math.max(idx, 0);
}

async function load() {
  const workId = props.workId;
  if (props.editionCount != null && props.editionCount <= 1) {
    editions.value = [];
    loadedWorkId.value = workId;
    return;
  }
  const res = await apiFetch(`/api/works/${workId}/editions`);
  // A newer load() (for a different workId) may have superseded this one while it was in
  // flight — discard this now-stale response rather than overwriting fresher data.
  if (workId !== props.workId) return;
  if (!res.ok) return;
  const data = (await res.json()) as { editions: EditionRow[] };
  editions.value = data.editions.filter((e) => e.scan_id != null);
  loadedWorkId.value = workId;
  syncActiveIndex();
}

watch(() => props.workId, load, { immediate: true });
watch(() => props.activeIsbn, () => {
  if (loadedWorkId.value === props.workId) syncActiveIndex();
});

// Comparing against activeIsbn (rather than a "programmatic sync" flag) tells a user-driven
// swipe/arrow-nav apart from syncActiveIndex's own writes without needing mutable state.
watch(activeIndex, (i) => {
  const e = editions.value[i];
  if (e && e.isbn !== props.activeIsbn && e.scan_id != null) {
    emit("select", e.isbn, e.scan_id);
  }
});
</script>
