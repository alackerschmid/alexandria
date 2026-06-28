<template>
  <div class="bg-charcoal min-h-screen flex flex-col">
    <AppHeader />

    <!-- Guest banner -->
    <div
      v-if="isGuest"
      class="px-6 md:px-10 py-3 border-b border-charcoal-border flex flex-wrap items-center justify-between gap-3 shrink-0"
    >
      <div class="text-xs text-text-secondary leading-relaxed">
        <span>{{ $t('guest.banner', { used: guestStore.scans.length, max: 3 }) }}</span>
        <span class="block text-text-secondary/60 mt-0.5">{{ $t('guest.create_account') }}</span>
      </div>
      <div class="flex gap-2 shrink-0">
        <v-btn variant="text" size="small" color="primary" class="text-[10px] tracking-[0.15em] uppercase px-4" @click="$router.push('/login')">
          {{ $t('guest.sign_in') }}
        </v-btn>
        <v-btn variant="flat" size="small" color="primary" rounded="0" elevation="0" class="text-[10px] tracking-[0.15em] uppercase px-4" @click="$router.push('/login?mode=register')">
          {{ $t('guest.register') }}
        </v-btn>
      </div>
    </div>

    <!-- Scrim (sits above page content, below search dropdown) -->
    <v-fade-transition>
      <div
        v-if="searchFocused"
        class="fixed inset-0 z-[50] bg-black/30 backdrop-blur-[2px] cursor-default"
        @click="searchFocused = false"
      />
    </v-fade-transition>

    <!-- ── Search hero ──────────────────────────────────────────────────────── -->
    <div class="border-b border-charcoal-border px-6 md:px-10 pt-10 md:pt-14 pb-8 md:pb-10 flex flex-col items-center shrink-0">
      <!-- Heading + count -->
      <div class="flex items-baseline gap-4 mb-7 self-start md:self-center">
        <h1 class="font-heading text-4xl md:text-5xl font-bold text-text-primary leading-none">
          {{ $t('library.heading') }}
        </h1>
        <span class="font-mono text-[11px] text-text-secondary/60 tracking-[0.08em]">
          {{ $t('library.total_count', { n: allBooks.length }) }}
        </span>
      </div>

      <!-- Search wrapper (lifts above scrim when focused) -->
      <div
        class="w-full max-w-2xl relative"
        :class="searchFocused ? 'z-[60]' : 'z-[2]'"
      >
        <!-- Bar -->
        <div
          class="flex items-center gap-3 border bg-charcoal-light px-5 py-4 cursor-text transition-all duration-200"
          :class="searchFocused
            ? 'border-orange-neon -translate-y-[3px] scale-[1.012] shadow-[0_22px_55px_-14px_rgba(0,0,0,0.6)] ring-4 ring-orange-neon/10'
            : 'border-charcoal-border'"
          @click="onSearchBarClick"
        >
          <span class="text-orange-neon text-lg leading-none shrink-0">⌕</span>
          <!-- Input + highlight overlay wrapper -->
          <div class="flex-1 min-w-0 relative">
            <!-- Highlight overlay (behind the input, synced via translateX on scroll) -->
            <div aria-hidden="true" class="absolute inset-0 flex items-center pointer-events-none overflow-hidden">
              <div
                class="whitespace-pre text-sm md:text-base"
                :style="{ transform: `translateX(-${searchScrollLeft}px)` }"
              >
                <template v-for="(seg, i) in searchSegments" :key="i">
                  <span v-if="seg.role === 'key'" class="text-orange-neon">{{ seg.text }}</span>
                  <span v-else class="text-text-primary">{{ seg.text }}</span>
                </template>
              </div>
            </div>
            <!-- Actual input — text is transparent so overlay shows through -->
            <input
              ref="searchRef"
              v-model="search"
              type="text"
              :placeholder="$t('library.search_placeholder_smart')"
              class="relative w-full bg-transparent text-transparent caret-text-primary text-sm md:text-base outline-none placeholder:text-text-secondary/40"
              :class="{ 'token-selecting': tokenSelecting }"
              @focus="searchFocused = true"
              @blur="onSearchBlur"
              @keydown="onSearchKeydown"
              @mousedown="tokenSelecting = false"
              @scroll="searchScrollLeft = ($event.target as HTMLInputElement).scrollLeft"
            />
          </div>
          <button
            v-if="search"
            class="text-text-secondary hover:text-text-primary transition-colors shrink-0"
            @mousedown.prevent
            @click.stop="search = ''; searchRef?.focus()"
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
            class="absolute top-full left-0 right-0 mt-3 bg-charcoal-light border border-charcoal-border shadow-[0_28px_64px_-18px_rgba(0,0,0,0.85)] overflow-hidden"
            @mousedown.prevent
          >
            <!-- Header -->
            <div class="flex items-center justify-between px-[18px] py-[13px] border-b border-charcoal-border/60">
              <span class="font-mono text-[10px] tracking-[0.2em] uppercase text-text-secondary">{{ dropdownHeading }}</span>
              <span class="font-mono text-[10px] text-text-secondary/50">{{ $t('library.filtered_count', { n: baseFiltered.length }) }}</span>
            </div>

            <!-- Prefix chips (empty state) -->
            <div v-if="suggestions[0]?.kind === 'prefix'" class="flex flex-wrap gap-2.5 px-[18px] py-4 border-b border-charcoal-border/40">
              <button
                v-for="(s, i) in suggestions"
                :key="s.token"
                class="flex items-center gap-2 px-3 py-2 border bg-charcoal-light transition-colors"
                :class="i === activeIndex ? 'border-orange-neon text-orange-neon' : 'border-charcoal-border hover:border-orange-neon'"
                @mousedown.prevent="applySuggestion(s)"
              >
                <v-icon :icon="s.icon" size="12" color="primary" />
                <span class="font-mono text-[13px] text-orange-neon tracking-[0.02em]">{{ s.token }}</span>
              </button>
            </div>

            <!-- Stacked suggestion rows -->
            <template v-else>
              <div
                v-for="(s, i) in suggestions"
                :key="i"
                class="flex items-center gap-3.5 px-[18px] py-[13px] cursor-pointer border-b border-charcoal-border/30 transition-colors"
                :class="i === activeIndex ? 'bg-white/[0.04]' : 'hover:bg-white/[0.03]'"
                @mousedown.prevent="applySuggestion(s)"
              >
                <v-icon :icon="s.icon" size="13" :color="s.kind === 'book' ? undefined : 'primary'" class="shrink-0 w-[22px]" :class="s.kind === 'book' ? 'text-text-secondary/50' : ''" />
                <!-- <span v-if="s.kind !== 'book'" class="font-mono text-[13px] text-orange-neon tracking-[0.02em] shrink-0 whitespace-nowrap">{{ s.token }}:</span> -->
                <span class="text-[14px] text-text-primary min-w-0 overflow-hidden text-ellipsis whitespace-nowrap">{{ s.label }}</span>
                <span class="ml-auto text-[11px] text-text-secondary/70 shrink-0 whitespace-nowrap">{{ s.typeLabel }}</span>
              </div>
            </template>

            <!-- Footer -->
            <div class="flex items-center gap-4 px-[18px] py-[11px] bg-charcoal/80">
              <span class="font-mono text-[10px] text-text-secondary/60"><span class="text-text-secondary">↑↓ ⇥</span> {{ $t('library.kbd_navigate') }}</span>
              <span class="font-mono text-[10px] text-text-secondary/60"><span class="text-text-secondary">↵</span> {{ $t('library.kbd_select') }}</span>
              <span class="font-mono text-[10px] text-text-secondary/60"><span class="text-text-secondary">esc</span> {{ $t('library.kbd_dismiss') }}</span>
            </div>
          </div>
        </v-slide-y-transition>
      </div>

      <!-- Active parsed-token pills -->
      <div v-if="parsedSearch.tokens.length" class="flex items-center gap-2 mt-3 w-full max-w-2xl flex-wrap">
        <span class="text-[10px] text-text-secondary/50 tracking-[0.18em] uppercase">{{ $t('library.search_active') }}</span>
        <span
          v-for="tok in parsedSearch.tokens"
          :key="tok"
          class="inline-flex items-center gap-1.5 text-[10px] tracking-[0.1em] uppercase text-text-primary border border-charcoal-border/60 bg-charcoal-light px-2.5 py-1"
        >
          {{ tok }}
          <button class="text-text-secondary/60 hover:text-text-primary ml-1" @click="removeToken(tok)">×</button>
        </span>
      </div>
    </div>

    <!-- ── Toolbar: Group by + Sort by ─────────────────────────────────────── -->
    <div class="flex items-center justify-between px-6 md:px-10 py-4 border-b border-charcoal-border shrink-0 gap-4 flex-wrap">
      <!-- Group by -->
      <div class="flex items-center gap-3">
        <span class="text-[10px] text-text-secondary tracking-[0.22em] uppercase">{{ $t('library.group_by') }}</span>
        <AppSelect v-model="groupBy" :options="groupOptions" />
      </div>

      <!-- Sort by + View toggle -->
      <div class="flex items-center gap-4">
        <div class="flex items-center gap-3">
          <span class="text-[10px] text-text-secondary tracking-[0.22em] uppercase">{{ $t('library.sort_by') }}</span>
          <AppSelect v-model="sortBy" :options="SORT_OPTIONS" :min-width="180" />
        </div>

        <!-- Per page -->
        <div class="flex items-center gap-3 border-l border-charcoal-border pl-4">
          <span class="text-[10px] text-text-secondary tracking-[0.22em] uppercase">{{ $t('library.per_page') }}</span>
          <AppSelect v-model="perPage" :options="PAGE_SIZE_OPTIONS" :min-width="70" />
        </div>

        <!-- View toggle -->
        <div class="flex items-center gap-2 border-l border-charcoal-border pl-4">
          <button
            class="transition-colors"
            :class="viewMode === 'list' ? 'text-text-primary' : 'text-text-secondary/40 hover:text-text-secondary'"
            @click="viewMode = 'list'"
          >
            <v-icon icon="mdi-view-list" size="18" />
          </button>
          <button
            class="transition-colors"
            :class="viewMode === 'tile' ? 'text-text-primary' : 'text-text-secondary/40 hover:text-text-secondary'"
            @click="viewMode = 'tile'"
          >
            <v-icon icon="mdi-view-grid" size="18" />
          </button>
        </div>

        <!-- Scan button (desktop) -->
        <!-- <v-btn
          variant="outlined"
          size="small"
          color="primary"
          rounded="0"
          class="hidden md:flex text-[10px] tracking-[0.15em] uppercase"
          prepend-icon="mdi-barcode-scan"
          @click="$router.push('/scanner')"
        >
          {{ $t('library.scan') }}
        </v-btn> -->
      </div>
    </div>

    <!-- ── Loading ──────────────────────────────────────────────────────────── -->
    <div v-if="loading" class="flex justify-center mt-20">
      <v-progress-circular indeterminate color="primary" size="24" width="2" />
    </div>

    <!-- ── Error ────────────────────────────────────────────────────────────── -->
    <div
      v-if="error"
      class="mx-6 md:mx-10 mt-6 pl-4 py-2 border-l-2 text-sm"
      style="border-color: rgb(var(--v-theme-error)); color: rgb(var(--v-theme-error));"
    >
      {{ error }}
    </div>

    <!-- ── Empty library ────────────────────────────────────────────────────── -->
    <div v-if="!loading && allBooks.length === 0" class="px-6 md:px-10 pt-16 pb-8">
      <p class="font-heading text-3xl font-bold text-text-primary mb-3">{{ $t('library.empty_heading') }}</p>
      <v-btn variant="text" color="primary" rounded="0" class="text-[10px] tracking-[0.15em] uppercase px-0 mt-1" append-icon="mdi-arrow-right" @click="$router.push('/scanner')">
        {{ $t('library.empty_scan_cta') }}
      </v-btn>
    </div>

    <!-- ── No results ────────────────────────────────────────────────────────── -->
    <div v-else-if="!loading && allBooks.length > 0 && filteredBooks.length === 0" class="px-6 md:px-10 pt-16 pb-8">
      <p class="text-sm text-text-secondary">{{ $t('library.no_results') }}</p>
    </div>

    <!-- ── List view ─────────────────────────────────────────────────────────── -->
    <div v-else-if="!loading && viewMode === 'list'" class="flex-1 pb-28">
      <div v-for="group in groupedBooks" :key="group.key">
        <!-- Group header -->
        <div
          v-if="groupBy !== 'none'"
          class="flex items-baseline gap-3 px-6 md:px-10 py-5"
        >
          <button
            v-if="group.seriesId != null"
            class="font-heading text-2xl font-bold text-text-primary hover:text-orange-neon transition-colors text-left min-w-0"
            @click="$router.push(`/series/${group.seriesId}`)"
          >
            {{ group.label }}
          </button>
          <span v-else class="font-heading text-2xl font-bold text-text-primary min-w-0">
            {{ group.label }}
          </span>
          <span class="font-mono text-[10px] text-text-secondary/50 shrink-0">
            {{ group.books.length }}{{ group.seriesTotal != null ? ` / ${group.seriesTotal}` : '' }}
          </span>
          <span class="flex-1 h-px bg-charcoal-border" />
        </div>

        <!-- 3-column grid -->
        <div class="grid md:grid-cols-2 xl:grid-cols-4 gap-3.5 px-6 md:px-10 pb-2">
          <LibraryRowCard
            v-for="book in group.books"
            :key="book.id"
            :book="book"
            @cycle-status="cycleStatus(book)"
            @delete="openDeleteDialog(book)"
            @select="openDetail(book)"
          />
        </div>
      </div>

      <!-- Pagination -->
      <AppPagination
        :current-page="currentPage"
        :total-pages="totalPages"
        :range-start="(currentPage - 1) * pageSize + 1"
        :range-end="Math.min(currentPage * pageSize, filteredBooks.length)"
        :total="filteredBooks.length"
        @change="changePage"
      />
    </div>

    <!-- ── Tile view ──────────────────────────────────────────────────────────── -->
    <div v-else-if="!loading && viewMode === 'tile'" class="flex-1 px-6 md:px-10 pt-6 pb-28">
      <div class="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-9 xl:grid-cols-13 gap-3 md:gap-4">
        <div
          v-for="book in pagedBooks"
          :key="book.id"
          class="cursor-pointer group"
          @click="openDetail(book)"
        >
          <div class="relative aspect-2/3 bg-charcoal-light border border-charcoal-border overflow-hidden mb-1.5">
            <img
              v-if="book.cover_url"
              :src="book.cover_url"
              :alt="book.title || book.isbn"
              class="w-full h-full object-cover group-hover:opacity-80 transition-opacity"
            />
            <div v-else class="absolute inset-0 flex items-center justify-center">
              <v-icon icon="mdi-book-outline" size="20" color="primary" />
            </div>
            <div
              class="absolute top-1.5 right-1.5 w-1.5 h-1.5 rounded-full"
              :style="{ background: statusDotColor(book.status) }"
            />
          </div>
          <p class="text-[10px] font-heading font-bold text-text-primary leading-snug line-clamp-2">
            {{ book.title || book.isbn }}
          </p>
        </div>
      </div>

      <!-- Pagination -->
      <AppPagination
        :current-page="currentPage"
        :total-pages="totalPages"
        :range-start="(currentPage - 1) * pageSize + 1"
        :range-end="Math.min(currentPage * pageSize, filteredBooks.length)"
        :total="filteredBooks.length"
        @change="changePage"
      />
    </div>

    <AppFooter class="mt-auto" />

    <!-- Mobile scan FAB -->
    <button
      class="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 md:hidden flex items-center justify-center gap-2 rounded-full py-4 text-[10px] font-bold tracking-[0.25em] uppercase text-white"
      style="background: rgb(var(--v-theme-primary)); min-width: 58vw; box-shadow: 0 4px 28px rgba(255,102,0,0.3);"
      @click="$router.push('/scanner')"
    >
      <v-icon icon="mdi-camera" size="15" color="white" />
      {{ $t('home.start_scanning') }}
    </button>

    <!-- Book detail dialog -->
    <BookDetail
      v-if="selectedBook"
      :model-value="!!detailIsbn && !!selectedBook"
      :book="selectedBook"
      :guest="isGuest"
      @update:model-value="(v) => { if (!v) closeDetail() }"
      @cycle-status="cycleStatus(selectedBook!)"
      @set-status="(s) => setStatus(selectedBook!, s)"
      @delete="closeDetail(); openDeleteDialog(selectedBook!)"
      @refreshed="handleRefreshed"
    />

    <!-- Delete confirmation -->
    <v-dialog v-model="deleteDialog" max-width="360">
      <v-card rounded="0" :color="themeStore.isDark ? '#1c1b19' : '#ffffff'">
        <v-card-title class="font-heading text-xl pt-6 px-6 font-bold text-text-primary">
          {{ $t('library.remove_heading') }}
        </v-card-title>
        <v-card-text class="px-6 text-sm text-text-secondary">
          {{ $t('library.remove_body', { title: bookToDelete?.title || bookToDelete?.isbn }) }}
        </v-card-text>
        <v-card-actions class="px-4 pb-4 gap-2">
          <v-spacer />
          <v-btn variant="text" size="small" class="text-[10px] tracking-[0.2em] uppercase text-text-secondary" @click="deleteDialog = false">
            {{ $t('library.cancel') }}
          </v-btn>
          <v-btn variant="flat" size="small" color="error" rounded="0" class="text-[10px] tracking-[0.2em] uppercase" :loading="deleting" @click="confirmDelete">
            {{ $t('library.remove') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <AppToast v-model="errorToast" :message="errorMessage" type="error" :timeout="4000" />
  </div>
</template>

<script lang="ts" setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRoute, useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'
import { useGuestStore } from '@/stores/guest'
import { useLocaleStore } from '@/stores/locale'
import { useApi } from '@/composables/useApi'
import { useFieldDefsStore } from '@/stores/fieldDefs'
import { useDetailRoute } from '@/composables/useDetailRoute'
import { useGroupDimensions } from '@/composables/useGroupDimensions'
import { parseTagList } from '@/utils/tags'
import { languageDisplayFormatter } from '@/utils/language'
import type { Book, ReadStatus } from '@/types/book'
import type { GroupBy, SortOption } from '@/types/library'
import AppHeader from '@/components/AppHeader.vue'
import AppToast from '@/components/AppToast.vue'
import AppFooter from '@/components/AppFooter.vue'
import LibraryRowCard from '@/components/LibraryRowCard.vue'
import AppSelect from '@/components/AppSelect.vue'
import BookDetail from '@/components/BookDetail.vue'
import AppPagination from '@/components/AppPagination.vue'
import { useLibraryDefaultsStore } from '@/stores/libraryDefaults'

const { t } = useI18n()
const route = useRoute()
const router = useRouter()
const authStore = useAuthStore()
const themeStore = useThemeStore()
const guestStore = useGuestStore()
const localeStore = useLocaleStore()
const { apiFetch } = useApi()
const fieldDefsStore = useFieldDefsStore()
const libraryDefaultsStore = useLibraryDefaultsStore()
const { detailIsbn, openDetail: openDetailRoute, closeDetail } = useDetailRoute()
const { groupOptions, customFieldMetas } = useGroupDimensions()

const isGuest = computed(() => !authStore.isAuthenticated)

// ── State ─────────────────────────────────────────────────────────────────────

const serverBooks = ref<Book[]>([])
const loading = ref(false)
const error = ref('')

const search = ref('')
const groupBy = ref<GroupBy>('none')
const sortBy = ref<SortOption>('date_desc')
const viewMode = ref<'list' | 'tile'>(libraryDefaultsStore.defaultView)
const searchRef = ref<HTMLInputElement | null>(null)

const deleteDialog = ref(false)
const bookToDelete = ref<Book | null>(null)
const deleting = ref(false)

const selectedBook = ref<Book | null>(null)

const errorToast = ref(false)
const errorMessage = ref('')

const FETCH_LIMIT = 5000
let fetchSeq = 0

const perPage = ref<string>(String(libraryDefaultsStore.defaultPageSize))

const PAGE_SIZE_OPTIONS = [
  { value: '12', label: '12' },
  { value: '24', label: '24' },
  { value: '48', label: '48' },
  { value: '96', label: '96' },
  { value: '10000', label: t('library.per_page_all') },
]

// ── Autocomplete ──────────────────────────────────────────────────────────────

const searchFocused = ref(false)
const activeIndex = ref(-1)
const tokenSelecting = ref(false)

type SuggestionPrefix = { kind: 'prefix'; token: string; icon: string; label: string; typeLabel: string }
type SuggestionFacet  = { kind: 'facet';  token: string; icon: string; label: string; typeLabel: string }
type SuggestionBook   = { kind: 'book';   book: Book;    icon: string; label: string; typeLabel: string; token: '' }
type Suggestion = SuggestionPrefix | SuggestionFacet | SuggestionBook

// ── Custom-field search/group helpers ──────────────────────────────────────────

const BUILTIN_KEYS = ['status', 'author', 'genre', 'series', 'publisher', 'language', 'award', 'form', 'country', 'year', 'subject', 'location']

const customSlugMap = computed(() => new Map(customFieldMetas.value.map(m => [m.slug, m.def])))

function cfIcon(type: string) {
  switch (type) {
    case 'tag':     return 'mdi-tag-multiple-outline'
    case 'date':    return 'mdi-calendar-outline'
    case 'integer': return 'mdi-numeric'
    default:        return 'mdi-form-textbox'
  }
}

function bookCustomValue(b: Book, defId: number): string | null {
  return b.custom_field_values?.find(v => v.field_def_id === defId)?.value ?? null
}

const PREFIXES = computed(() => [
  { key: 'status',    icon: 'mdi-progress-check',       label: t('library.filter_status')    },
  { key: 'author',    icon: 'mdi-account-outline',      label: t('library.group_author')      },
  { key: 'genre',     icon: 'mdi-tag-outline',          label: t('library.group_genre')       },
  { key: 'series',    icon: 'mdi-bookshelf',            label: t('library.group_series')      },
  { key: 'publisher', icon: 'mdi-domain',               label: t('library.group_publisher')   },
  { key: 'language',  icon: 'mdi-translate',            label: t('library.group_language')    },
  { key: 'award',     icon: 'mdi-trophy-outline',       label: t('library.filter_awards')     },
{ key: 'form',      icon: 'mdi-text-box-outline',     label: t('library.group_form')        },
  { key: 'country',   icon: 'mdi-earth',                label: t('library.group_country')     },
  { key: 'year',      icon: 'mdi-calendar-range',       label: t('library.group_year')        },
  { key: 'subject',   icon: 'mdi-lightbulb-outline',    label: t('library.group_subject')     },
  { key: 'location',  icon: 'mdi-map-marker-outline',   label: t('library.group_location')    },
  ...customFieldMetas.value
    .filter(m => m.def.type !== 'date' && m.def.type !== 'integer')
    .map(m => ({ key: m.slug, icon: cfIcon(m.def.type), label: m.def.name })),
])

function quote(v: string) { return /\s/.test(v) ? `"${v}"` : v }

// ── Search highlight overlay ───────────────────────────────────────────────────

const knownKeys = computed(() => new Set<string>([...BUILTIN_KEYS, ...customFieldMetas.value.map(m => m.slug)]))
const HIGHLIGHT_PATTERN = computed(() => `((?:${[...knownKeys.value].join('|')}):)("(?:[^"]*)"?|\\S*)`)

interface SearchSegment { text: string; role: 'key' | 'plain' }

// Keys whose handling doesn't affect the current text selection
const PRESERVES_SELECTION = new Set(['ArrowUp', 'ArrowDown', 'Tab', 'Escape', 'Shift', 'Control', 'Alt', 'Meta'])

const searchSegments = computed<SearchSegment[]>(() => {
  const s = search.value
  if (!s) return []
  const re = new RegExp(HIGHLIGHT_PATTERN.value, 'gi')
  const segments: SearchSegment[] = []
  let last = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(s)) !== null) {
    const [, key, val] = m
    if (m.index > last) segments.push({ text: s.slice(last, m.index), role: 'plain' })
    segments.push({ text: key, role: 'key' })
    if (val) segments.push({ text: val, role: 'plain' })
    last = re.lastIndex
  }
  if (last < s.length) segments.push({ text: s.slice(last), role: 'plain' })
  return segments
})

const searchScrollLeft = ref(0)

const langFmt = computed(() => languageDisplayFormatter(localeStore.locale))

const facetEntries = computed<SuggestionFacet[]>(() => {
  const pool = baseFiltered.value
  const statusLabel = t('library.filter_status')
  const authorLabel = t('library.group_author')
  const genreLabel  = t('library.group_genre')
  const seriesLabel = t('library.group_series')

  const publisherLabel = t('library.group_publisher')
  const languageLabel  = t('library.group_language')
  const awardLabel     = t('library.filter_awards')
const formLabel      = t('library.group_form')
  const countryLabel   = t('library.group_country')
  const subjectLabel   = t('library.group_subject')
  const locationLabel  = t('library.group_location')

  const entries: SuggestionFacet[] = []

  // Only suggest statuses that actually exist in the current filtered pool
  const presentStatuses = new Set(pool.map(b => b.status))
  for (const [val, label] of [['read', t('book.read')], ['reading', t('book.reading')], ['unread', t('book.unread')]] as [string, string][]) {
    if (presentStatuses.has(val as 'read' | 'reading' | 'unread'))
      entries.push({ kind: 'facet', token: `status:${val}`, icon: 'mdi-progress-check', label, typeLabel: statusLabel })
  }

  // Resolve a book's custom-field value entries to their meta in one lookup,
  // avoiding a per-field scan of custom_field_values for every book.
  const metaByDefId = new Map(customFieldMetas.value.map(m => [m.def.id, m]))

  const seen = new Set<string>()
  for (const b of pool) {
    if (b.author) {
      const k = b.author.toLowerCase()
      if (!seen.has(`author:${k}`)) { seen.add(`author:${k}`); entries.push({ kind: 'facet', token: `author:${quote(b.author)}`, icon: 'mdi-account-outline', label: b.author, typeLabel: authorLabel }) }
    }
    for (const g of b.genres ?? []) {
      const k = g.toLowerCase()
      if (!seen.has(`genre:${k}`)) { seen.add(`genre:${k}`); entries.push({ kind: 'facet', token: `genre:${quote(g)}`, icon: 'mdi-tag-outline', label: g, typeLabel: genreLabel }) }
    }
    if (b.series_name) {
      const k = b.series_name.toLowerCase()
      if (!seen.has(`series:${k}`)) { seen.add(`series:${k}`); entries.push({ kind: 'facet', token: `series:${quote(b.series_name)}`, icon: 'mdi-bookshelf', label: b.series_name, typeLabel: seriesLabel }) }
    }
    if (b.publisher) {
      const k = b.publisher.toLowerCase()
      if (!seen.has(`publisher:${k}`)) { seen.add(`publisher:${k}`); entries.push({ kind: 'facet', token: `publisher:${quote(b.publisher)}`, icon: 'mdi-domain', label: b.publisher, typeLabel: publisherLabel }) }
    }
    if (b.language) {
      const k = b.language.toLowerCase()
      if (!seen.has(`language:${k}`)) { seen.add(`language:${k}`); entries.push({ kind: 'facet', token: `language:${quote(b.language)}`, icon: 'mdi-translate', label: langFmt.value(b.language), typeLabel: languageLabel }) }
    }
    for (const a of b.awards ?? []) {
      const k = a.toLowerCase()
      if (!seen.has(`award:${k}`)) { seen.add(`award:${k}`); entries.push({ kind: 'facet', token: `award:${quote(a)}`, icon: 'mdi-trophy-outline', label: a, typeLabel: awardLabel }) }
    }
    for (const a of b.nominations ?? []) {
      const k = a.toLowerCase()
      if (!seen.has(`award:${k}`)) { seen.add(`award:${k}`); entries.push({ kind: 'facet', token: `award:${quote(a)}`, icon: 'mdi-trophy-outline', label: a, typeLabel: awardLabel }) }
    }
if (b.form_of_work) {
      const k = b.form_of_work.toLowerCase()
      if (!seen.has(`form:${k}`)) { seen.add(`form:${k}`); entries.push({ kind: 'facet', token: `form:${quote(b.form_of_work)}`, icon: 'mdi-text-box-outline', label: b.form_of_work, typeLabel: formLabel }) }
    }
    for (const c of b.countries_of_origin ?? []) {
      const k = c.toLowerCase()
      if (!seen.has(`country:${k}`)) { seen.add(`country:${k}`); entries.push({ kind: 'facet', token: `country:${quote(c)}`, icon: 'mdi-earth', label: c, typeLabel: countryLabel }) }
    }
    if (b.main_subject) {
      const k = b.main_subject.toLowerCase()
      if (!seen.has(`subject:${k}`)) { seen.add(`subject:${k}`); entries.push({ kind: 'facet', token: `subject:${quote(b.main_subject)}`, icon: 'mdi-lightbulb-outline', label: b.main_subject, typeLabel: subjectLabel }) }
    }
    for (const loc of b.narrative_locations ?? []) {
      const k = loc.toLowerCase()
      if (!seen.has(`location:${k}`)) { seen.add(`location:${k}`); entries.push({ kind: 'facet', token: `location:${quote(loc)}`, icon: 'mdi-map-marker-outline', label: loc, typeLabel: locationLabel }) }
    }
    for (const cf of b.custom_field_values ?? []) {
      if (cf.value == null) continue
      const meta = metaByDefId.get(cf.field_def_id)
      if (!meta || meta.def.type === 'date' || meta.def.type === 'integer') continue
      const vals = meta.def.type === 'tag' ? parseTagList(cf.value) : [cf.value]
      for (const v of vals) {
        const k = `${meta.slug}:${v.toLowerCase()}`
        if (!seen.has(k)) { seen.add(k); entries.push({ kind: 'facet', token: `${meta.slug}:${quote(v)}`, icon: cfIcon(meta.def.type), label: v, typeLabel: meta.def.name }) }
      }
    }
  }
  return entries
})

// The trailing chunk the user is currently typing (after the last complete token)
const searchFragment = computed(() => {
  const s = search.value
  // Find where the last *committed* structured token ends (key:value with a non-empty value).
  // Everything after that is the trailing fragment the user is still building (may contain spaces).
  const re = /\S+:"[^"]*"|"[^"]*"|\S+/g
  let lastStructuredEnd = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(s)) !== null) {
    const part = m[0]
    const colonIdx = part.indexOf(':')
    if (colonIdx > 0) {
      const key = part.slice(0, colonIdx).toLowerCase()
      const val = part.slice(colonIdx + 1).replace(/^"|"$/g, '').toLowerCase()
      if (knownKeys.value.has(key) && val) lastStructuredEnd = m.index + part.length
    }
  }
  return s.slice(lastStructuredEnd).replace(/^\s+/, '')
})

const suggestions = computed<Suggestion[]>(() => {
  const frag = searchFragment.value.trim().toLowerCase()
  const titleLabel = t('library.facet_title')

  if (!frag) {
    // Empty/idle → show prefix chips
    return PREFIXES.value.map(p => ({
      kind: 'prefix' as const,
      token: `${p.key}:`,
      icon: p.icon,
      label: p.label,
      typeLabel: p.label,
    }))
  }

  const results: Suggestion[] = []
  const MAX = 8

  // Typing inside a known key: eg "author:pyn"
  const matchedPrefix = PREFIXES.value.find(p => frag.startsWith(`${p.key}:`))
  if (matchedPrefix) {
    const val = frag.slice(matchedPrefix.key.length + 1)
    const filtered = facetEntries.value
      .filter(e => e.token.startsWith(`${matchedPrefix.key}:`) && e.label.toLowerCase().includes(val))
      .slice(0, MAX)
    return filtered.length
      ? filtered
      : [{ kind: 'facet', token: `${matchedPrefix.key}:`, icon: matchedPrefix.icon, label: t('library.search_no_matches'), typeLabel: matchedPrefix.label }]
  }

  // Free typing: match prefix words, facet values, and titles
  for (const p of PREFIXES.value) {
    if (p.key.startsWith(frag) || p.label.toLowerCase().startsWith(frag)) {
      results.push({ kind: 'prefix', token: `${p.key}:`, icon: p.icon, label: p.label, typeLabel: p.label })
    }
  }
  for (const e of facetEntries.value) {
    if (e.label.toLowerCase().includes(frag)) {
      results.push(e)
      if (results.length >= MAX) break
    }
  }
  if (results.length < MAX) {
    for (const b of baseFiltered.value) {
      if (b.title?.toLowerCase().includes(frag)) {
        results.push({ kind: 'book', book: b, icon: 'mdi-book-outline', label: b.title!, typeLabel: titleLabel, token: '' })
        if (results.length >= MAX) break
      }
    }
  }
  return results
})

const dropdownHeading = computed(() => {
  const frag = searchFragment.value.trim().toLowerCase()
  if (!frag) return t('library.search_refine')
  const pm = PREFIXES.value.find(p => frag.startsWith(`${p.key}:`))
  if (pm) return t('library.search_values', { facet: pm.label })
  return t('library.search_matches')
})

function applySuggestion(s: Suggestion) {
  if (s.kind === 'book') {
    openDetail(s.book)
    searchFocused.value = false
    return
  }
  const head = search.value.slice(0, search.value.length - searchFragment.value.length)
  if (s.kind === 'prefix') {
    search.value = head + s.token
  } else {
    search.value = head + s.token + ' '
  }
  activeIndex.value = -1
  searchRef.value?.focus()
}

function onSearchBarClick() {
  searchRef.value?.focus()
  searchFocused.value = true
}

function onSearchBlur() {
  searchFocused.value = false
}

function onSearchKeydown(e: KeyboardEvent) {
  if (!PRESERVES_SELECTION.has(e.key)) tokenSelecting.value = false
  if (e.key === 'Backspace') {
    const el = searchRef.value
    if (!el) return
    const { selectionStart, selectionEnd } = el
    // If there's already a selection, let the browser delete it
    if (selectionStart !== selectionEnd) return
    const cursor = selectionStart ?? 0
    // Only intercept when cursor is at the very end
    if (cursor !== search.value.length) return
    const s = search.value
    // Skip trailing spaces to figure out what to select
    let contentEnd = cursor
    while (contentEnd > 0 && s[contentEnd - 1] === ' ') contentEnd--
    if (contentEnd === 0) return
    const char = s[contentEnd - 1]
    let selectStart: number
    if (char === '"') {
      // Closing quote → select the quoted value ("…")
      const openQuote = s.lastIndexOf('"', contentEnd - 2)
      selectStart = openQuote !== -1 ? openQuote : contentEnd - 1
    } else if (char === ':') {
      // Bare key: → select the entire key:
      let i = contentEnd - 1
      while (i > 0 && s[i - 1] !== ' ') i--
      selectStart = i
    } else {
      // Plain text or unquoted value — find the chunk since the last space
      const lastSpace = s.lastIndexOf(' ', contentEnd - 1)
      const chunkStart = lastSpace === -1 ? 0 : lastSpace + 1
      const chunk = s.slice(chunkStart, contentEnd)
      const colonIdx = chunk.indexOf(':')
      if (colonIdx > 0 && knownKeys.value.has(chunk.slice(0, colonIdx).toLowerCase())) {
        // Known key:value → select only the value, leaving key: intact
        selectStart = chunkStart + colonIdx + 1
      } else {
        // Plain word or unknown token → select the whole chunk
        selectStart = chunkStart
      }
    }
    e.preventDefault()
    el.setSelectionRange(selectStart, cursor)
    tokenSelecting.value = true
    return
  }
  if (e.key === 'Escape') {
    if (searchFocused.value) { searchFocused.value = false; e.preventDefault() }
    else { search.value = '' }
    return
  }
  if (e.key === 'Tab') {
    if (!suggestions.value.length) return
    e.preventDefault()
    const len = suggestions.value.length
    activeIndex.value = e.shiftKey
      ? (activeIndex.value <= 0 ? len - 1 : activeIndex.value - 1)
      : (activeIndex.value >= len - 1 ? 0 : activeIndex.value + 1)
    return
  }
  if (e.key === 'ArrowDown') {
    e.preventDefault()
    const len = suggestions.value.length
    activeIndex.value = activeIndex.value >= len - 1 ? 0 : activeIndex.value + 1
    return
  }
  if (e.key === 'ArrowUp') {
    e.preventDefault()
    const len = suggestions.value.length
    activeIndex.value = activeIndex.value <= 0 ? len - 1 : activeIndex.value - 1
    return
  }
  if (e.key === 'Enter') {
    if (activeIndex.value >= 0 && suggestions.value[activeIndex.value]) {
      e.preventDefault()
      applySuggestion(suggestions.value[activeIndex.value])
    } else {
      searchFocused.value = false
    }
    return
  }
  // Reset keyboard nav on any other key
  activeIndex.value = -1
}

// Reset activeIndex when suggestions change
watch(suggestions, () => { activeIndex.value = -1 })

// ── Parsed search ─────────────────────────────────────────────────────────────
// Supports structured tokens: status:X  series:X  award:X  author:"X"  genre:"X"  publisher:"X"  language:X
// Remaining words are free-text matched against title/author/isbn.

function tokenize(s: string): string[] {
  return s.match(/\S+:"[^"]*"|"[^"]*"|\S+/g) ?? []
}

interface ParsedSearch {
  status: ReadStatus | null
  series: string
  award: string
  author: string
  genre: string
  publisher: string
  language: string
form: string
  country: string
  year: string
  subject: string
  location: string
  custom: Record<string, string>   // custom-field slug → search value
  text: string
  tokens: string[]   // the structured parts only, for the active-token pills
}

const parsedSearch = computed<ParsedSearch>(() => {
  const parts = tokenize(search.value.trim())
  let status: ReadStatus | null = null
  let series = ''
  let award = ''
  let author = ''
  let genre = ''
  let publisher = ''
  let language = ''
  let form = ''
  let country = ''
  let year = ''
  let subject = ''
  let location = ''
  const custom: Record<string, string> = {}
  const remaining: string[] = []
  const tokens: string[] = []

  for (const part of parts) {
    const colon = part.indexOf(':')
    if (colon === -1) { remaining.push(part); continue }
    const key = part.slice(0, colon).toLowerCase()
    const rawVal = part.slice(colon + 1)
    const val = rawVal.replace(/^"|"$/g, '').toLowerCase()
    if (key === 'status' && (val === 'unread' || val === 'reading' || val === 'read')) {
      status = val as ReadStatus
      tokens.push(part.toLowerCase())
    } else if (key === 'series' && val) {
      series = val
      tokens.push(part.toLowerCase())
    } else if (key === 'award' && val) {
      award = val
      tokens.push(part.toLowerCase())
    } else if (key === 'author' && val) {
      author = val
      tokens.push(part)
    } else if (key === 'genre' && val) {
      genre = val
      tokens.push(part)
    } else if (key === 'publisher' && val) {
      publisher = val
      tokens.push(part)
    } else if (key === 'language' && val) {
      language = val
      tokens.push(part)
    } else if (key === 'form' && val) {
      form = val
      tokens.push(part)
    } else if (key === 'country' && val) {
      country = val
      tokens.push(part)
    } else if (key === 'year' && val) {
      year = val
      tokens.push(part)
    } else if (key === 'subject' && val) {
      subject = val
      tokens.push(part)
    } else if (key === 'location' && val) {
      location = val
      tokens.push(part)
    } else if (customSlugMap.value.has(key) && val) {
      custom[key] = val
      tokens.push(part)
    } else if (!knownKeys.value.has(key)) {
      remaining.push(part)
    }
    // Known key with no/invalid value (in-progress token like "status:") — silently ignored
  }

  return { status, series, award, author, genre, publisher, language, form, country, year, subject, location, custom, text: remaining.join(' ').toLowerCase(), tokens }
})

function removeToken(token: string) {
  const lower = token.toLowerCase()
  search.value = tokenize(search.value.trim()).filter(p => p.toLowerCase() !== lower).join(' ')
}

// ── Computed ──────────────────────────────────────────────────────────────────

const allBooks = computed<Book[]>(() =>
  isGuest.value ? guestStore.scans : serverBooks.value,
)

// Pure filter — no sort. Used by groupedBooks series branch (sorted within groups by ordinal).
const baseFiltered = computed<Book[]>(() => {
  const { status, series, award, author, genre, publisher, language, form, country, year, subject, location, custom, text } = parsedSearch.value
  let list = allBooks.value

  if (status) {
    list = list.filter(b => b.status === status)
  }
  if (series) {
    list = list.filter(b => b.series_name?.toLowerCase().includes(series))
  }
  if (award) {
    list = list.filter(b =>
      b.awards?.some(a => a.toLowerCase().includes(award)) ||
      b.nominations?.some(n => n.toLowerCase().includes(award)),
    )
  }
  if (author) {
    list = list.filter(b => b.author?.toLowerCase().includes(author))
  }
  if (genre) {
    list = list.filter(b => b.genres?.some(g => g.toLowerCase().includes(genre)))
  }
  if (publisher) {
    list = list.filter(b => b.publisher?.toLowerCase().includes(publisher))
  }
  if (language) {
    list = list.filter(b => b.language?.toLowerCase().includes(language))
  }
if (form) {
    list = list.filter(b => b.form_of_work?.toLowerCase().includes(form))
  }
  if (country) {
    list = list.filter(b => b.countries_of_origin?.some(c => c.toLowerCase().includes(country)))
  }
  if (year) {
    list = list.filter(b => b.original_pub_date?.toLowerCase().includes(year))
  }
  if (subject) {
    list = list.filter(b => b.main_subject?.toLowerCase().includes(subject))
  }
  if (location) {
    list = list.filter(b => b.narrative_locations?.some(l => l.toLowerCase().includes(location)))
  }
  for (const [slug, val] of Object.entries(custom)) {
    const def = customSlugMap.value.get(slug)
    if (!def) continue
    list = list.filter(b => {
      const raw = bookCustomValue(b, def.id)
      if (!raw) return false
      return def.type === 'tag'
        ? parseTagList(raw).some(tg => tg.toLowerCase().includes(val))
        : raw.toLowerCase().includes(val)
    })
  }
  if (text) {
    list = list.filter(b =>
      b.title?.toLowerCase().includes(text) ||
      b.author?.toLowerCase().includes(text) ||
      b.isbn.includes(text),
    )
  }

  return list
})

// Filtered and sorted — used by tile view and all non-series groupings.
const filteredBooks = computed<Book[]>(() => sortBooks(baseFiltered.value))

function sortBooks(list: Book[]): Book[] {
  return [...list].sort((a, b) => {
    switch (sortBy.value) {
      case 'title_asc':  return (a.title ?? a.isbn).localeCompare(b.title ?? b.isbn, localeStore.locale)
      case 'title_desc': return (b.title ?? b.isbn).localeCompare(a.title ?? a.isbn, localeStore.locale)
      case 'author_asc': return (a.author ?? '').localeCompare(b.author ?? '', localeStore.locale)
      case 'date_asc':   return a.created_at.localeCompare(b.created_at)
      default:           return b.created_at.localeCompare(a.created_at)
    }
  })
}

// ── Pagination ────────────────────────────────────────────────────────────────

const currentPage = ref(1)

const pageSize = computed(() => parseInt(perPage.value, 10))

watch(perPage, (val) => { libraryDefaultsStore.setPageSize(parseInt(val, 10)) })
const totalPages = computed(() => Math.max(1, Math.ceil(filteredBooks.value.length / pageSize.value)))

// Flat series-ordered list for the series groupBy pagination source.
const seriesOrderedBooks = computed<Book[]>(() => {
  const seriesMap = new Map<number, Book[]>()
  const standalones: Book[] = []
  for (const b of baseFiltered.value) {
    if (b.series_id != null) {
      if (!seriesMap.has(b.series_id)) seriesMap.set(b.series_id, [])
      seriesMap.get(b.series_id)!.push(b)
    } else {
      standalones.push(b)
    }
  }
  const sortedGroups = [...seriesMap.entries()].sort(([, a], [, b]) =>
    (a[0].series_name ?? '').localeCompare(b[0].series_name ?? '', localeStore.locale),
  )
  const flat: Book[] = []
  for (const [, books] of sortedGroups) {
    books.sort((a, b) => (a.series_ordinal ?? Infinity) - (b.series_ordinal ?? Infinity))
    flat.push(...books)
  }
  flat.push(...sortBooks(standalones))
  return flat
})

const pagedBooks = computed<Book[]>(() => {
  const source = groupBy.value === 'series' ? seriesOrderedBooks.value : filteredBooks.value
  const start = (currentPage.value - 1) * pageSize.value
  return source.slice(start, start + pageSize.value)
})

// Reset to page 1 whenever the visible set or view changes.
watch([filteredBooks, viewMode, sortBy, groupBy, perPage], () => { currentPage.value = 1 })

function changePage(p: number) {
  currentPage.value = p
  window.scrollTo({ top: 0, behavior: 'smooth' })
}

// ── Grouped books ─────────────────────────────────────────────────────────────

interface BookGroup {
  key: string
  label: string
  books: Book[]
  seriesId?: number | null
  seriesTotal?: number | null
}

const groupedBooks = computed<BookGroup[]>(() => {
  const books = pagedBooks.value

  if (groupBy.value === 'none') {
    return [{ key: '__all__', label: '', books }]
  }

  if (groupBy.value === 'status') {
    const order: ReadStatus[] = ['reading', 'unread', 'read']
    return order
      .map(s => ({ key: s, label: t(`book.${s}`), books: books.filter(b => b.status === s) }))
      .filter(g => g.books.length)
  }

  if (groupBy.value === 'series') {
    // pagedBooks for series comes from seriesOrderedBooks (already ordinal-sorted).
    const map = new Map<number, BookGroup>()
    const standalones: Book[] = []
    for (const b of books) {
      if (b.series_id != null) {
        let g = map.get(b.series_id)
        if (!g) {
          g = { key: String(b.series_id), label: b.series_name || t('detail.series'), books: [], seriesId: b.series_id, seriesTotal: b.series_total ?? null }
          map.set(b.series_id, g)
        }
        g.books.push(b)
      } else {
        standalones.push(b)
      }
    }
    const groups = [...map.values()]
    groups.sort((a, b) => a.label.localeCompare(b.label, localeStore.locale))
    if (standalones.length) {
      groups.push({ key: '__standalone__', label: t('library.standalone'), books: standalones })
    }
    return groups
  }

  if (groupBy.value === 'author') {
    const map = new Map<string, Book[]>()
    for (const b of books) {
      const key = b.author || '__unknown__'
      if (!map.has(key)) map.set(key, [])
      map.get(key)!.push(b)
    }
    return [...map.entries()]
      .map(([key, bks]) => ({ key, label: key === '__unknown__' ? t('book.unknown_author') : key, books: bks }))
      .sort((a, b) => {
        if (a.key === '__unknown__') return 1
        if (b.key === '__unknown__') return -1
        return a.label.localeCompare(b.label, localeStore.locale)
      })
  }

  if (groupBy.value === 'genre') {
    const map = new Map<string, Book[]>()
    const unclassified: Book[] = []
    for (const b of books) {
      const g = b.genres?.[0]
      if (g) {
        if (!map.has(g)) map.set(g, [])
        map.get(g)!.push(b)
      } else {
        unclassified.push(b)
      }
    }
    const groups = [...map.entries()]
      .map(([genre, bks]) => ({ key: genre, label: genre, books: bks }))
      .sort((a, b) => a.label.localeCompare(b.label, localeStore.locale))
    if (unclassified.length) {
      groups.push({ key: '__unclassified__', label: t('library.unclassified'), books: unclassified })
    }
    return groups
  }

  if (groupBy.value === 'publisher' || groupBy.value === 'language' || groupBy.value === 'form' || groupBy.value === 'subject') {
    const fieldMap: Record<string, keyof Book> = {
      publisher: 'publisher', language: 'language', form: 'form_of_work', subject: 'main_subject',
    }
    const field = fieldMap[groupBy.value]
    const labelFor = groupBy.value === 'language'
      ? langFmt.value
      : (v: string) => v
    const map = new Map<string, Book[]>()
    const unclassified: Book[] = []
    for (const b of books) {
      const val = b[field] as string | null | undefined
      if (val) {
        if (!map.has(val)) map.set(val, [])
        map.get(val)!.push(b)
      } else {
        unclassified.push(b)
      }
    }
    const groups = [...map.entries()]
      .map(([val, bks]) => ({ key: val, label: labelFor(val), books: bks }))
      .sort((a, b) => a.label.localeCompare(b.label, localeStore.locale))
    if (unclassified.length) groups.push({ key: '__unclassified__', label: t('library.unclassified'), books: unclassified })
    return groups
  }

  if (groupBy.value === 'country') {
    const map = new Map<string, Book[]>()
    const unclassified: Book[] = []
    for (const b of books) {
      const vals = b.countries_of_origin
      if (!vals?.length) { unclassified.push(b); continue }
      for (const c of vals) {
        if (!map.has(c)) map.set(c, [])
        map.get(c)!.push(b)
      }
    }
    const groups = [...map.entries()]
      .map(([c, bks]) => ({ key: c, label: c, books: bks }))
      .sort((a, b) => a.label.localeCompare(b.label, localeStore.locale))
    if (unclassified.length) groups.push({ key: '__unclassified__', label: t('library.unclassified'), books: unclassified })
    return groups
  }

  if (groupBy.value === 'decade') {
    const map = new Map<string, Book[]>()
    const unclassified: Book[] = []
    for (const b of books) {
      const year = parseInt(b.original_pub_date ?? '')
      if (!isNaN(year)) {
        const label = `${Math.floor(year / 10) * 10}s`
        if (!map.has(label)) map.set(label, [])
        map.get(label)!.push(b)
      } else {
        unclassified.push(b)
      }
    }
    const groups = [...map.entries()]
      .map(([label, bks]) => ({ key: label, label, books: bks }))
      .sort((a, b) => parseInt(a.key) - parseInt(b.key))
    if (unclassified.length) groups.push({ key: '__unclassified__', label: t('library.unclassified'), books: unclassified })
    return groups
  }

  if (groupBy.value.startsWith('cf:')) {
    const defId = Number(groupBy.value.slice(3))
    const def = fieldDefsStore.defs.find(d => d.id === defId)
    const map = new Map<string, Book[]>()
    const none: Book[] = []
    for (const b of books) {
      const raw = bookCustomValue(b, defId)
      const vals = def?.type === 'tag' ? parseTagList(raw) : (raw ? [raw] : [])
      if (!vals.length) { none.push(b); continue }
      for (const v of vals) {
        if (!map.has(v)) map.set(v, [])
        map.get(v)!.push(b)
      }
    }
    const groups = [...map.entries()]
      .map(([val, bks]) => ({ key: val, label: val, books: bks }))
      .sort((a, b) => a.label.localeCompare(b.label, localeStore.locale))
    if (none.length) {
      groups.push({ key: '__cfnone__', label: t('library.unclassified'), books: none })
    }
    return groups
  }

  return [{ key: '__all__', label: '', books }]
})

// ── Dropdown options ──────────────────────────────────────────────────────────


const SORT_OPTIONS = computed(() => [
  { value: 'date_desc' as SortOption,  label: t('library.sort_date_desc') },
  { value: 'date_asc' as SortOption,   label: t('library.sort_date_asc') },
  { value: 'title_asc' as SortOption,  label: t('library.sort_title_asc') },
  { value: 'title_desc' as SortOption, label: t('library.sort_title_desc') },
  { value: 'author_asc' as SortOption, label: t('library.sort_author_asc') },
])

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusDotColor(s: ReadStatus): string {
  if (s === 'reading') return 'rgb(var(--v-theme-primary))'
  if (s === 'read') return 'rgb(var(--v-theme-success))'
  return 'rgba(138,128,120,0.45)'
}

// ── ⌘K keyboard shortcut ─────────────────────────────────────────────────────

function onKeydown(e: KeyboardEvent) {
  if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
    e.preventDefault()
    searchRef.value?.focus()
    searchRef.value?.select()
  }
}
onMounted(() => document.addEventListener('keydown', onKeydown))
onUnmounted(() => document.removeEventListener('keydown', onKeydown))

// ── Data fetching ─────────────────────────────────────────────────────────────

const fetchBooks = async () => {
  const seq = ++fetchSeq
  try {
    const res = await apiFetch(`/api/scans?limit=${FETCH_LIMIT}&offset=0&locale=${localeStore.locale}`)
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Failed to fetch books')
    if (seq !== fetchSeq) return
    serverBooks.value = data
  } catch (err: any) {
    if (seq !== fetchSeq) return
    error.value = err.message
  }
}

// ── Status cycling ────────────────────────────────────────────────────────────

const NEXT_STATUS: Record<ReadStatus, ReadStatus> = { unread: 'reading', reading: 'read', read: 'unread' }

const cycleStatus = async (book: Book) => {
  if (isGuest.value) { guestStore.cycleStatus(book.isbn); return }
  const newStatus = NEXT_STATUS[book.status]
  const prev = book.status
  book.status = newStatus
  try {
    const res = await apiFetch(`/api/scans/${book.id}`, { method: 'PATCH', body: JSON.stringify({ status: newStatus }) })
    if (!res.ok) throw new Error()
  } catch {
    book.status = prev
    errorMessage.value = t('library.error_update_status')
    errorToast.value = true
  }
}

const setStatus = async (book: Book, newStatus: ReadStatus) => {
  if (book.status === newStatus) return
  if (isGuest.value) { guestStore.setStatus(book.isbn, newStatus); return }
  const prev = book.status
  book.status = newStatus
  try {
    const res = await apiFetch(`/api/scans/${book.id}`, { method: 'PATCH', body: JSON.stringify({ status: newStatus }) })
    if (!res.ok) throw new Error()
  } catch {
    book.status = prev
    errorMessage.value = t('library.error_update_status')
    errorToast.value = true
  }
}

// ── Detail & delete ───────────────────────────────────────────────────────────

const openDetail = (book: Book) => { selectedBook.value = book; openDetailRoute(book.isbn) }

// Resolve selectedBook from the URL (handles Back/Forward and deep links)
watch([detailIsbn, allBooks], ([isbn]) => {
  if (!isbn) { selectedBook.value = null; return }
  if (selectedBook.value?.isbn !== isbn)
    selectedBook.value = allBooks.value.find(b => b.isbn === isbn) ?? selectedBook.value
}, { immediate: true })

function handleRefreshed(updated: Partial<Book>) {
  if (!selectedBook.value) return
  const merged = { ...selectedBook.value, ...updated } as Book
  selectedBook.value = merged
  const idx = serverBooks.value.findIndex(b => b.id === merged.id)
  if (idx !== -1) serverBooks.value[idx] = merged
}

const openDeleteDialog = (book: Book) => { bookToDelete.value = book; deleteDialog.value = true }

const confirmDelete = async () => {
  const book = bookToDelete.value
  if (!book) return
  if (isGuest.value) { guestStore.removeScan(book.isbn); deleteDialog.value = false; bookToDelete.value = null; return }
  deleting.value = true
  try {
    const res = await apiFetch(`/api/scans/${book.id}`, { method: 'DELETE' })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || t('library.error_delete'))
    serverBooks.value = serverBooks.value.filter(b => b.id !== book.id)
    deleteDialog.value = false
  } catch (err: any) {
    errorMessage.value = err.message
    errorToast.value = true
  } finally {
    deleting.value = false
    bookToDelete.value = null
  }
}

// ── URL ↔ search sync ─────────────────────────────────────────────────────────

// Sync search from URL query param — runs on mount and whenever the route changes
// (handles clicking a filter while already on the library page)
watch(() => route.query.q, (q) => {
  const val = typeof q === 'string' ? q : ''
  if (val !== search.value) search.value = val
}, { immediate: true })

// Keep URL in sync as search changes — preserve the book param if a detail is open
watch(search, (val) => {
  const current = typeof route.query.q === 'string' ? route.query.q : ''
  if (val === current) return
  const next: Record<string, string> = {}
  if (val) next.q = val
  if (route.query.book) next.book = String(route.query.book)
  router.replace({ query: next })
})

// ── Init ──────────────────────────────────────────────────────────────────────

onMounted(async () => {
  if (authStore.isAuthenticated) {
    loading.value = true
    await Promise.all([fetchBooks(), fieldDefsStore.load()])
    loading.value = false
  }
})

watch(() => localeStore.locale, async () => {
  if (!authStore.isAuthenticated) return
  loading.value = true
  await fetchBooks()
  loading.value = false
})
</script>

<style scoped>
/* Orange selection highlight when a whole token was selected via backspace */
input.token-selecting::selection {
  background-color: rgba(255, 102, 0, 0.35);
}
</style>
