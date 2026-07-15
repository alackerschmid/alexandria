<template>
  <!-- Scrim (sits above page content, below search dropdown) -->
  <v-fade-transition>
    <div
      v-if="searchFocused"
      class="fixed inset-0 z-[50] bg-black/30 backdrop-blur-[2px] cursor-default"
      @click="searchFocused = false"
    />
  </v-fade-transition>

  <!-- ── Search hero ──────────────────────────────────────────────────────── -->
  <div
    class="border-b border-charcoal-border px-6 md:px-10 pt-10 md:pt-14 pb-8 md:pb-10 flex flex-col items-center shrink-0"
  >
    <!-- Heading + count -->
    <div class="flex items-baseline gap-4 mb-7 self-start md:self-center">
      <h1
        class="font-heading text-4xl md:text-5xl font-bold text-text-primary leading-none"
      >
        {{ $t("library.heading") }}
      </h1>
      <span
        class="font-mono text-[11px] text-text-secondary/60 tracking-[0.08em]"
      >
        {{ $t("library.total_count", { n: totalCount }) }}
      </span>
    </div>

    <!-- Search wrapper (lifts above scrim when focused) -->
    <div
      class="w-full max-w-2xl relative"
      :class="searchFocused ? 'z-[60]' : 'z-[2]'"
    >
      <!-- Bar -->
      <div
        class="flex items-center gap-3 border bg-search-bg px-5 py-4 cursor-text transition-all duration-200"
        :class="
          searchFocused
            ? 'border-orange-neon -translate-y-[3px] scale-[1.012] shadow-[0_22px_55px_-14px_rgba(0,0,0,0.6)] ring-4 ring-orange-neon/10'
            : 'border-search-border'
        "
        @click="onSearchBarClick"
      >
        <span class="text-orange-neon text-lg leading-none shrink-0">⌕</span>
        <!-- Input + highlight overlay wrapper -->
        <div class="flex-1 min-w-0 relative">
          <!-- Highlight overlay (behind the input, synced via translateX on scroll) -->
          <div
            aria-hidden="true"
            class="absolute inset-0 flex items-center pointer-events-none overflow-hidden"
          >
            <div
              class="whitespace-pre text-base"
              :style="{ transform: `translateX(-${searchScrollLeft}px)` }"
            >
              <template v-for="(seg, i) in searchSegments" :key="i">
                <span v-if="seg.role === 'key'" class="text-orange-neon">{{
                  seg.text
                }}</span>
                <span v-else class="text-text-primary">{{ seg.text }}</span>
              </template>
            </div>
          </div>
          <!-- Actual input — text is transparent so overlay shows through -->
          <input
            ref="searchRef"
            v-model="search"
            type="text"
            role="combobox"
            :aria-label="$t('library.search_field_label')"
            :aria-expanded="searchFocused"
            aria-autocomplete="list"
            aria-controls="library-search-listbox"
            :aria-activedescendant="
              searchFocused && activeIndex >= 0
                ? `library-search-option-${activeIndex}`
                : undefined
            "
            :placeholder="$t('library.search_placeholder_smart')"
            class="relative w-full bg-transparent text-transparent caret-text-primary text-base outline-none focus-ring-none placeholder:text-text-secondary/40"
            :class="{ 'token-selecting': tokenSelecting }"
            @focus="searchFocused = true"
            @blur="onSearchBlur"
            @keydown="onSearchKeydown"
            @mousedown="tokenSelecting = false"
            @scroll="
              searchScrollLeft = ($event.target as HTMLInputElement).scrollLeft
            "
          />
        </div>
        <button
          v-if="search"
          class="text-text-secondary hover:text-text-primary transition-colors shrink-0"
          :aria-label="$t('library.clear_search')"
          @mousedown.prevent
          @click.stop="
            search = '';
            searchRef?.focus();
          "
        >
          <v-icon icon="mdi-close" size="15" />
        </button>
        <kbd
          v-else
          class="hidden md:flex shrink-0 font-mono text-[10px] text-text-secondary/40 tracking-[0.1em] border border-charcoal-border px-1.5 py-0.5 leading-none"
        >
          ⌘K
        </kbd>
      </div>

      <!-- Autocomplete dropdown -->
      <v-slide-y-transition>
        <div
          v-if="searchFocused"
          id="library-search-listbox"
          role="listbox"
          class="absolute top-full left-0 right-0 mt-3 bg-charcoal-light border border-charcoal-border shadow-[0_28px_64px_-18px_rgba(0,0,0,0.85)] overflow-hidden"
          @mousedown.prevent
        >
          <!-- Header -->
          <div
            class="flex items-center justify-between px-[18px] py-[13px] border-b border-charcoal-border/60"
          >
            <span
              class="font-mono text-[10px] tracking-[0.2em] uppercase text-text-secondary"
              >{{ dropdownHeading }}</span
            >
            <span class="font-mono text-[10px] text-text-secondary/50">{{
              $t("library.filtered_count", { n: filteredCount })
            }}</span>
          </div>

          <!-- Prefix chips (empty state) -->
          <div
            v-if="suggestions[0]?.kind === 'prefix'"
            class="flex flex-wrap gap-2.5 px-[18px] py-4 border-b border-charcoal-border/40"
          >
            <button
              v-for="(s, i) in suggestions"
              :id="`library-search-option-${i}`"
              :key="s.token"
              role="option"
              :aria-selected="i === activeIndex"
              class="flex items-center gap-2 px-3 py-2 border bg-charcoal-light transition-colors"
              :class="
                i === activeIndex
                  ? 'border-orange-neon text-orange-neon'
                  : 'border-charcoal-border hover:border-orange-neon'
              "
              @mousedown.prevent="applySuggestion(s)"
            >
              <v-icon :icon="s.icon" size="12" color="primary" />
              <span
                class="font-mono text-[13px] text-orange-neon tracking-[0.02em]"
                >{{ s.token }}</span
              >
            </button>
          </div>

          <!-- Stacked suggestion rows -->
          <template v-else>
            <div
              v-for="(s, i) in suggestions"
              :id="`library-search-option-${i}`"
              :key="i"
              role="option"
              :aria-selected="i === activeIndex"
              class="flex items-center gap-3.5 px-[18px] py-[13px] cursor-pointer border-b border-charcoal-border/30 transition-colors"
              :class="
                i === activeIndex ? 'bg-white/[0.04]' : 'hover:bg-white/[0.03]'
              "
              @mousedown.prevent="applySuggestion(s)"
            >
              <v-icon
                :icon="s.icon"
                size="13"
                :color="s.kind === 'book' ? undefined : 'primary'"
                class="shrink-0 w-[22px]"
                :class="s.kind === 'book' ? 'text-text-secondary/50' : ''"
              />
              <span
                class="text-[14px] text-text-primary min-w-0 overflow-hidden text-ellipsis whitespace-nowrap"
                >{{ s.label }}</span
              >
              <span
                class="ml-auto text-[11px] text-text-secondary/70 shrink-0 whitespace-nowrap"
                >{{ s.typeLabel }}</span
              >
            </div>
          </template>

          <!-- Footer -->
          <div class="flex items-center gap-4 px-[18px] py-[11px] bg-charcoal/80">
            <span class="font-mono text-[10px] text-text-secondary/60"
              ><span class="text-text-secondary">↑↓</span>
              {{ $t("library.kbd_navigate") }}</span
            >
            <span class="font-mono text-[10px] text-text-secondary/60"
              ><span class="text-text-secondary">↵</span>
              {{ $t("library.kbd_select") }}</span
            >
            <span class="font-mono text-[10px] text-text-secondary/60"
              ><span class="text-text-secondary">esc</span>
              {{ $t("library.kbd_dismiss") }}</span
            >
          </div>
        </div>
      </v-slide-y-transition>
    </div>

    <!-- Active parsed-token pills -->
    <div
      v-if="parsedSearch.tokens.length"
      class="flex items-center gap-2 mt-3 w-full max-w-2xl flex-wrap"
    >
      <span
        class="text-[10px] text-text-secondary/50 tracking-[0.18em] uppercase"
        >{{ $t("library.search_active") }}</span
      >
      <span
        v-for="tok in parsedSearch.tokens"
        :key="tok"
        class="inline-flex items-center gap-1.5 text-[10px] tracking-[0.1em] uppercase text-text-primary border border-charcoal-border/60 bg-charcoal-light px-2.5 py-1"
      >
        {{ tok }}
        <button
          class="text-text-secondary/60 hover:text-text-primary ml-1"
          :aria-label="$t('library.remove_filter', { token: tok })"
          @click="removeToken(tok)"
        >
          ×
        </button>
      </span>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed, ref, toRef, watch, onMounted, onUnmounted } from "vue";
import { useSearchSuggestions, type Suggestion } from "@/composables/useSearchSuggestions";
import type { ParsedSearch, SuggestionFacet } from "@/composables/useLibrarySearch";
import type { CustomFieldMeta } from "@/composables/useGroupDimensions";
import type { Book } from "@/types/book";

const props = defineProps<{
  modelValue: string;
  knownKeys: Set<string>;
  parsedSearch: ParsedSearch;
  facetEntries: SuggestionFacet[];
  baseFiltered: Book[];
  customFieldMetas: CustomFieldMeta[];
  totalCount: number;
  filteredCount: number;
  /** From useLibrarySearch — removes a structured token from the query string. */
  removeToken: (token: string) => void;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: string];
  "select-book": [book: Book];
}>();

const search = computed({
  get: () => props.modelValue,
  set: (v) => emit("update:modelValue", v),
});

const searchRef = ref<HTMLInputElement | null>(null);
const searchFocused = ref(false);
const activeIndex = ref(-1);
const tokenSelecting = ref(false);
const searchScrollLeft = ref(0);

const { searchFragment, searchSegments, suggestions, dropdownHeading, showAllPrefixes } =
  useSearchSuggestions({
    search,
    knownKeys: toRef(props, "knownKeys"),
    facetEntries: toRef(props, "facetEntries"),
    baseFiltered: toRef(props, "baseFiltered"),
    customFieldMetas: toRef(props, "customFieldMetas"),
  });

// Keys whose handling doesn't affect the current text selection
const PRESERVES_SELECTION = new Set([
  "ArrowUp",
  "ArrowDown",
  "Tab",
  "Escape",
  "Shift",
  "Control",
  "Alt",
  "Meta",
]);

function applySuggestion(s: Suggestion) {
  if (s.kind === "book") {
    emit("select-book", s.book);
    searchFocused.value = false;
    return;
  }
  if (s.kind === "expand") {
    showAllPrefixes.value = true;
    return;
  }
  const head = search.value.slice(
    0,
    search.value.length - searchFragment.value.length,
  );
  if (s.kind === "prefix") {
    search.value = head + s.token;
  } else {
    search.value = head + s.token + " ";
  }
  activeIndex.value = -1;
  searchRef.value?.focus();
}

function onSearchBarClick() {
  searchRef.value?.focus();
  searchFocused.value = true;
}

function onSearchBlur() {
  searchFocused.value = false;
}

function onSearchKeydown(e: KeyboardEvent) {
  if (!PRESERVES_SELECTION.has(e.key)) tokenSelecting.value = false;
  if (e.key === "Backspace") {
    const el = searchRef.value;
    if (!el) return;
    const { selectionStart, selectionEnd } = el;
    // If there's already a selection, let the browser delete it
    if (selectionStart !== selectionEnd) return;
    const cursor = selectionStart ?? 0;
    // Only intercept when cursor is at the very end
    if (cursor !== search.value.length) return;
    const s = search.value;
    // Skip trailing spaces to figure out what to select
    let contentEnd = cursor;
    while (contentEnd > 0 && s[contentEnd - 1] === " ") contentEnd--;
    if (contentEnd === 0) return;
    const char = s[contentEnd - 1];
    let selectStart: number;
    if (char === '"') {
      // Closing quote → select the quoted value ("…")
      const openQuote = s.lastIndexOf('"', contentEnd - 2);
      selectStart = openQuote !== -1 ? openQuote : contentEnd - 1;
    } else if (char === ":") {
      // Bare key: → select the entire key:
      let i = contentEnd - 1;
      while (i > 0 && s[i - 1] !== " ") i--;
      selectStart = i;
    } else {
      // Plain text or unquoted value — find the chunk since the last space
      const lastSpace = s.lastIndexOf(" ", contentEnd - 1);
      const chunkStart = lastSpace === -1 ? 0 : lastSpace + 1;
      const chunk = s.slice(chunkStart, contentEnd);
      const colonIdx = chunk.indexOf(":");
      if (
        colonIdx > 0 &&
        props.knownKeys.has(chunk.slice(0, colonIdx).toLowerCase())
      ) {
        // Known key:value → select only the value, leaving key: intact
        selectStart = chunkStart + colonIdx + 1;
      } else {
        // Plain word or unknown token → select the whole chunk
        selectStart = chunkStart;
      }
    }
    e.preventDefault();
    el.setSelectionRange(selectStart, cursor);
    tokenSelecting.value = true;
    return;
  }
  if (e.key === "Escape") {
    if (searchFocused.value) {
      searchFocused.value = false;
      e.preventDefault();
    } else {
      search.value = "";
    }
    return;
  }
  if (e.key === "ArrowDown") {
    e.preventDefault();
    const len = suggestions.value.length;
    activeIndex.value = activeIndex.value >= len - 1 ? 0 : activeIndex.value + 1;
    return;
  }
  if (e.key === "ArrowUp") {
    e.preventDefault();
    const len = suggestions.value.length;
    activeIndex.value = activeIndex.value <= 0 ? len - 1 : activeIndex.value - 1;
    return;
  }
  if (e.key === "Enter") {
    if (activeIndex.value >= 0 && suggestions.value[activeIndex.value]) {
      e.preventDefault();
      applySuggestion(suggestions.value[activeIndex.value]);
    } else {
      searchFocused.value = false;
    }
    return;
  }
  // Reset keyboard nav on any other key
  activeIndex.value = -1;
}

// Reset activeIndex when suggestions change
watch(suggestions, () => {
  activeIndex.value = -1;
});

// ── ⌘K keyboard shortcut ─────────────────────────────────────────────────────
function onKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === "k") {
    e.preventDefault();
    searchRef.value?.focus();
    searchRef.value?.select();
  }
}
onMounted(() => document.addEventListener("keydown", onKeydown));
onUnmounted(() => document.removeEventListener("keydown", onKeydown));

// Exposed so the page's mobile quick-search can focus the same field if needed.
defineExpose({ focus: () => searchRef.value?.focus() });
</script>

<style scoped>
/* Orange selection highlight when a whole token was selected via backspace */
input.token-selecting::selection {
  background-color: rgba(255, 102, 0, 0.35);
}
</style>
