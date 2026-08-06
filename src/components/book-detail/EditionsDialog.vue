<template>
  <v-dialog
    :model-value="modelValue"
    max-width="880"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <div
      class="bg-charcoal-light border border-charcoal-border flex flex-col max-h-[80dvh]"
    >
      <div
        class="shrink-0 flex items-center justify-between px-6 py-4 border-b border-charcoal-border"
      >
        <div class="flex items-baseline gap-2.5">
          <div
            class="text-[10px] tracking-[0.24em] uppercase text-text-secondary/60"
          >
            {{ $t("detail.editions_heading") }}
          </div>
          <div
            v-if="editions.length"
            class="font-mono text-[11px] text-primary/80"
          >
            {{
              $t(
                "detail.editions_total",
                { n: editions.length },
                editions.length,
              )
            }}
          </div>
        </div>
        <button
          class="text-text-secondary/50 hover:text-text-secondary transition-colors"
          :aria-label="$t('detail.close')"
          @click="$emit('update:modelValue', false)"
        >
          <v-icon icon="mdi-close" size="18" />
        </button>
      </div>

      <!-- language filter chips -->
      <div
        v-if="languageGroups.length > 1"
        class="shrink-0 flex flex-wrap gap-2 px-6 pt-4"
      >
        <button
          type="button"
          class="px-3.5 py-1.5 text-[10px] tracking-[0.1em] uppercase font-semibold transition-colors"
          :class="
            activeLanguage === 'all'
              ? 'bg-orange-neon text-[#1a1410]'
              : 'border border-charcoal-border text-text-secondary/70 hover:text-text-secondary'
          "
          @click="activeLanguage = 'all'"
        >
          {{ $t("detail.editions_filter_all") }} · {{ editions.length }}
        </button>
        <button
          v-for="group in languageGroups"
          :key="group.code"
          type="button"
          class="px-3.5 py-1.5 text-[10px] tracking-[0.1em] uppercase font-semibold transition-colors"
          :class="
            activeLanguage === group.code
              ? 'bg-orange-neon text-[#1a1410]'
              : 'border border-charcoal-border text-text-secondary/70 hover:text-text-secondary'
          "
          @click="activeLanguage = group.code"
        >
          {{ group.label }} · {{ group.count }}
        </button>
      </div>

      <div class="flex-1 overflow-y-auto px-6 py-5">
        <div
          v-if="loading"
          class="text-xs text-text-secondary/60 py-4 text-center"
        >
          {{ $t("detail.loading") }}
        </div>
        <template v-else>
          <div
            v-for="group in visibleGroups"
            :key="group.code"
            class="mb-7 last:mb-0"
          >
            <div
              class="flex items-baseline gap-2 pb-2 mb-4 border-b border-charcoal-border/60"
            >
              <span
                class="text-[10px] tracking-[0.2em] uppercase text-text-secondary/70"
              >
                {{ group.label }}
              </span>
              <span class="font-mono text-[10px] text-text-secondary/40">{{
                group.count
              }}</span>
            </div>
            <div class="grid grid-cols-3 sm:grid-cols-5 gap-3">
              <button
                v-for="ed in group.items"
                :key="ed.isbn"
                type="button"
                :disabled="switchingIsbn !== null || !isClickable(ed)"
                class="flex flex-col gap-2 text-left transition-transform duration-150"
                :class="
                  isClickable(ed)
                    ? 'hover:-translate-y-1 cursor-pointer'
                    : 'cursor-default'
                "
                @click="onCardClick(ed)"
                @blur="pendingSwitchIsbn = null"
              >
                <div
                  class="relative w-full aspect-[2/3] overflow-hidden"
                  :class="cardBorderClass(ed)"
                >
                  <CoverImage
                    :cover-url="ed.cover_url"
                    :title="ed.title || ed.isbn"
                    :alt="ed.title || ed.isbn"
                    text-class="text-[28px]"
                    :icon-size="26"
                    show-missing-indicator
                    class="w-full h-full object-cover"
                  />
                  <div
                    v-if="switchingIsbn === ed.isbn"
                    class="absolute inset-0 bg-black/50 flex items-center justify-center"
                  >
                    <v-progress-circular size="20" width="2" indeterminate />
                  </div>
                  <div
                    v-else-if="pendingSwitchIsbn === ed.isbn"
                    class="absolute inset-0 bg-black/70 flex items-center justify-center p-2 text-center"
                  >
                    <span
                      class="text-[10px] tracking-[0.1em] uppercase text-orange-neon font-semibold"
                    >
                      {{ $t("detail.confirm_switch_edition") }}
                    </span>
                  </div>
                </div>
                <div
                  class="text-xs text-text-primary font-medium leading-snug line-clamp-2"
                >
                  {{ ed.title || ed.isbn }}
                </div>
                <div
                  v-if="ed.publisher || ed.publish_date"
                  class="text-[10px] text-text-secondary/60 truncate"
                >
                  {{
                    [ed.publisher, editionYear(ed)].filter(Boolean).join(" · ")
                  }}
                </div>
                <div
                  v-else-if="!ed.materialized"
                  class="text-[10px] text-text-secondary/40 italic truncate"
                >
                  {{ $t("detail.edition_not_added") }}
                </div>
                <div
                  v-if="ed.isbn === book.isbn"
                  class="text-[9px] tracking-[0.12em] uppercase text-orange-neon font-semibold"
                >
                  {{ $t("detail.current_edition") }}
                </div>
                <div
                  v-else-if="ed.scan_id"
                  class="text-[9px] tracking-[0.12em] uppercase text-orange-neon font-semibold"
                >
                  {{ $t("detail.edition_in_library") }}
                </div>
              </button>
            </div>
          </div>

          <div
            v-if="!editions.length"
            class="text-xs text-text-secondary/60 py-2 text-center"
          >
            {{ $t("detail.no_more_editions") }}
          </div>
        </template>

        <p
          v-if="error"
          class="text-[10px] text-error tracking-widest uppercase mt-3 text-center"
        >
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
          {{
            discovering
              ? $t("detail.finding_editions")
              : $t("detail.find_more_editions")
          }}
        </button>
      </div>
      <div
        v-else-if="searched && discoverFoundCount !== null"
        class="shrink-0 border-t border-charcoal-border px-6 py-3 text-[10px] tracking-[0.12em] uppercase text-text-secondary/60 text-center"
      >
        {{
          discoverFoundCount > 0
            ? $t(
                "detail.editions_found",
                { n: discoverFoundCount },
                discoverFoundCount,
              )
            : $t("detail.editions_found_none")
        }}
      </div>
    </div>
  </v-dialog>
</template>

<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { useApi } from "@/composables/useApi";
import { useLocaleStore } from "@/stores/locale";
import { languageDisplayFormatter } from "@/utils/language";
import { editionBorderClass, editionYear } from "@/utils/book-display";
import type { Book, WorkEdition } from "@/types/book";
import CoverImage from "@/components/CoverImage.vue";

interface LanguageGroup {
  code: string;
  label: string;
  count: number;
  items: WorkEdition[];
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
  /** Open a *different owned scan* of this work — navigation, not an edition switch. */
  select: [isbn: string, scanId: number];
}>();

const { apiFetch } = useApi();
const localeStore = useLocaleStore();
const langDisplay = computed(() =>
  languageDisplayFormatter(localeStore.locale),
);

const canSwitch = computed(() => !props.guest && !props.readonly);

const editions = ref<WorkEdition[]>([]);
const searched = ref(false);
const loading = ref(false);
const discovering = ref(false);
const discoverFoundCount = ref<number | null>(null);
const switchingIsbn = ref<string | null>(null);
const pendingSwitchIsbn = ref<string | null>(null);
const error = ref<string | null>(null);
const activeLanguage = ref("all");

const languageGroups = computed<LanguageGroup[]>(() => {
  const buckets = new Map<string, WorkEdition[]>();
  for (const ed of editions.value) {
    const code = ed.language ?? "unknown";
    if (!buckets.has(code)) buckets.set(code, []);
    buckets.get(code)!.push(ed);
  }
  return [...buckets.entries()]
    .map(([code, items]) => ({
      code,
      label: code === "unknown" ? "—" : langDisplay.value(code),
      count: items.length,
      items,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
});

const visibleGroups = computed(() =>
  activeLanguage.value === "all"
    ? languageGroups.value
    : languageGroups.value.filter((g) => g.code === activeLanguage.value),
);

/** An edition the user already owns is a *different scan*, reachable on its own — opening it is
 *  navigation, not a mutation, so it needs no confirm step and works in readonly/guest mode too. */
function isOwnedSibling(ed: WorkEdition) {
  return ed.scan_id != null && ed.isbn !== props.book.isbn;
}

function isClickable(ed: WorkEdition) {
  if (ed.isbn === props.book.isbn) return false;
  return isOwnedSibling(ed) || canSwitch.value;
}

function onCardClick(ed: WorkEdition) {
  if (!isClickable(ed)) return;
  // Switching *to an edition you already own* is what `PATCH /api/scans/:id/edition` rejects with
  // a 409 — you'd end up with two scans of the same book. Go to that scan's own detail instead,
  // which is what the user meant by clicking it.
  if (isOwnedSibling(ed)) {
    emit("select", ed.isbn, ed.scan_id!);
    emit("update:modelValue", false);
    return;
  }
  if (pendingSwitchIsbn.value !== ed.isbn) {
    pendingSwitchIsbn.value = ed.isbn;
    return;
  }
  pendingSwitchIsbn.value = null;
  switchTo(ed.isbn);
}

function cardBorderClass(ed: WorkEdition) {
  return editionBorderClass(ed, props.book.isbn);
}

async function load() {
  if (!props.book.work_id) return;
  loading.value = true;
  error.value = null;
  discoverFoundCount.value = null;
  activeLanguage.value = "all";
  pendingSwitchIsbn.value = null;
  try {
    const res = await apiFetch(`/api/works/${props.book.work_id}/editions`);
    if (!res.ok) throw new Error();
    const data = (await res.json()) as {
      searched: boolean;
      editions: WorkEdition[];
    };
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
  activeLanguage.value = "all";
  pendingSwitchIsbn.value = null;
  const previousCount = editions.value.length;
  try {
    const res = await apiFetch(
      `/api/works/${props.book.work_id}/editions/discover`,
      {
        method: "POST",
      },
    );
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
      discoverFoundCount.value = Math.max(
        data.editions.length - previousCount,
        0,
      );
    }
  } catch {
    error.value = "detail.discover_error";
  } finally {
    discovering.value = false;
  }
}

async function switchTo(isbn: string) {
  switchingIsbn.value = isbn;
  pendingSwitchIsbn.value = null;
  error.value = null;
  try {
    // `?locale=` for the same reason the two override PATCHes carry it: the reply is a full
    // locale-joined `buildScanSelect` row, spread straight over the displayed book via
    // `refreshed`. Omitted, the worker defaults to `en` and a German reader's `series_name`
    // flips to English until the next full refetch.
    const res = await apiFetch(
      `/api/scans/${props.book.id}/edition?locale=${localeStore.locale}`,
      {
        method: "PATCH",
        body: JSON.stringify({ isbn }),
      },
    );
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
