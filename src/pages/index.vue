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

      <!-- Search input -->
      <div
        class="w-full max-w-2xl flex items-center gap-3 border border-charcoal-border bg-charcoal-light px-5 py-4 cursor-text"
        @click="searchRef?.focus()"
      >
        <span class="text-orange-neon text-lg leading-none shrink-0">⌕</span>
        <input
          ref="searchRef"
          v-model="search"
          type="search"
          :placeholder="$t('library.search_placeholder_e')"
          class="flex-1 bg-transparent text-text-primary text-sm md:text-base outline-none placeholder:text-text-secondary/40 min-w-0"
          @keydown.escape="search = ''"
        />
        <button
          v-if="search"
          class="text-text-secondary hover:text-text-primary transition-colors shrink-0"
          @click.stop="search = ''"
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

      <!-- Hint chips -->
      <div class="flex items-center gap-2 mt-3 w-full max-w-2xl flex-wrap">
        <span class="font-mono text-[10px] text-text-secondary/50 tracking-[0.04em]">{{ $t('library.search_try') }}</span>
        <button
          v-for="hint in SEARCH_HINTS"
          :key="hint"
          class="font-mono text-[10px] text-text-secondary border border-charcoal-border px-2 py-1 hover:text-text-primary hover:border-charcoal-border/70 transition-colors"
          @click="search = hint"
        >
          {{ hint }}
        </button>
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
        <AppSelect v-model="groupBy" :options="GROUP_OPTIONS" />
      </div>

      <!-- Sort by + View toggle -->
      <div class="flex items-center gap-4">
        <div class="flex items-center gap-3">
          <span class="text-[10px] text-text-secondary tracking-[0.22em] uppercase">{{ $t('library.sort_by') }}</span>
          <AppSelect v-model="sortBy" :options="SORT_OPTIONS" :min-width="180" />
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
        <v-btn
          variant="outlined"
          size="small"
          color="primary"
          rounded="0"
          class="hidden md:flex text-[10px] tracking-[0.15em] uppercase"
          prepend-icon="mdi-barcode-scan"
          @click="$router.push('/scanner')"
        >
          {{ $t('library.scan') }}
        </v-btn>
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
        <div class="grid md:grid-cols-2 xl:grid-cols-3 gap-3.5 px-6 md:px-10 pb-2">
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

      <!-- Load more -->
      <div v-if="hasMore" class="flex justify-center py-10">
        <button
          class="text-[10px] text-text-secondary tracking-[0.25em] uppercase border-b border-charcoal-border pb-0.5 hover:text-text-primary transition-colors"
          :class="{ 'opacity-50 pointer-events-none': loadingMore }"
          @click="loadMore"
        >
          {{ loadingMore ? '—' : $t('library.load_more') }}
        </button>
      </div>
    </div>

    <!-- ── Tile view ──────────────────────────────────────────────────────────── -->
    <div v-else-if="!loading && viewMode === 'tile'" class="flex-1 px-6 md:px-10 pt-6 pb-28">
      <div class="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-7 xl:grid-cols-9 gap-3 md:gap-4">
        <div
          v-for="book in filteredBooks"
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

      <div v-if="hasMore" class="flex justify-center py-10">
        <button
          class="text-[10px] text-text-secondary tracking-[0.25em] uppercase border-b border-charcoal-border pb-0.5 hover:text-text-primary transition-colors"
          :class="{ 'opacity-50 pointer-events-none': loadingMore }"
          @click="loadMore"
        >
          {{ loadingMore ? '—' : $t('library.load_more') }}
        </button>
      </div>
    </div>

    <AppFooter class="mt-auto" />

    <!-- Mobile scan FAB -->
    <button
      class="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 md:hidden flex items-center justify-center gap-2 rounded-full py-4 text-[10px] font-bold tracking-[0.25em] uppercase text-white"
      style="background: rgb(var(--v-theme-primary)); min-width: 58vw; box-shadow: 0 4px 28px rgba(255,102,0,0.3);"
      @click="$router.push('/scanner')"
    >
      <v-icon icon="mdi-camera" size="15" color="white" />
      {{ $t('landing.start_scanning') }}
    </button>

    <!-- Book detail dialog -->
    <BookDetail
      v-if="selectedBook"
      v-model="detailDialog"
      :book="selectedBook"
      :guest="isGuest"
      @cycle-status="cycleStatus(selectedBook!)"
      @delete="detailDialog = false; openDeleteDialog(selectedBook!)"
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
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'
import { useGuestStore } from '@/stores/guest'
import { useLocaleStore } from '@/stores/locale'
import { useApi } from '@/composables/useApi'
import { useFieldDefsStore } from '@/stores/fieldDefs'
import type { Book, ReadStatus } from '@/types/book'
import type { GroupBy, SortOption } from '@/types/library'
import AppHeader from '@/components/AppHeader.vue'
import AppToast from '@/components/AppToast.vue'
import AppFooter from '@/components/AppFooter.vue'
import LibraryRowCard from '@/components/LibraryRowCard.vue'
import AppSelect from '@/components/AppSelect.vue'
import BookDetail from '@/components/BookDetail.vue'

const { t } = useI18n()
const authStore = useAuthStore()
const themeStore = useThemeStore()
const guestStore = useGuestStore()
const localeStore = useLocaleStore()
const { apiFetch } = useApi()
const fieldDefsStore = useFieldDefsStore()

const isGuest = computed(() => !authStore.isAuthenticated)

// ── State ─────────────────────────────────────────────────────────────────────

const serverBooks = ref<Book[]>([])
const loading = ref(false)
const loadingMore = ref(false)
const hasMore = ref(false)
const error = ref('')

const search = ref('')
const groupBy = ref<GroupBy>('none')
const sortBy = ref<SortOption>('date_desc')
const viewMode = ref<'list' | 'tile'>('list')
const searchRef = ref<HTMLInputElement | null>(null)

const deleteDialog = ref(false)
const bookToDelete = ref<Book | null>(null)
const deleting = ref(false)

const detailDialog = ref(false)
const selectedBook = ref<Book | null>(null)

const errorToast = ref(false)
const errorMessage = ref('')

const PAGE_SIZE = 200
let fetchSeq = 0

// ── Search hint chips ─────────────────────────────────────────────────────────

const SEARCH_HINTS = computed(() => [
  t('library.search_hint_status_reading'),
  t('library.search_hint_status_unread'),
  t('library.search_hint_award'),
  t('library.search_hint_series'),
])

// ── Parsed search ─────────────────────────────────────────────────────────────
// Supports structured tokens: status:X  series:X  award:X
// Remaining words are free-text matched against title/author/isbn.

interface ParsedSearch {
  status: ReadStatus | null
  series: string
  award: string
  text: string
  tokens: string[]   // the structured parts only, for the active-token pills
}

const parsedSearch = computed<ParsedSearch>(() => {
  const parts = search.value.trim().split(/\s+/).filter(Boolean)
  let status: ReadStatus | null = null
  let series = ''
  let award = ''
  const remaining: string[] = []
  const tokens: string[] = []

  for (const part of parts) {
    const colon = part.indexOf(':')
    if (colon === -1) { remaining.push(part); continue }
    const key = part.slice(0, colon).toLowerCase()
    const val = part.slice(colon + 1).toLowerCase()
    if (key === 'status' && (val === 'unread' || val === 'reading' || val === 'read')) {
      status = val as ReadStatus
      tokens.push(part.toLowerCase())
    } else if (key === 'series' && val) {
      series = val
      tokens.push(part.toLowerCase())
    } else if (key === 'award' && val) {
      award = val
      tokens.push(part.toLowerCase())
    } else {
      remaining.push(part)
    }
  }

  return { status, series, award, text: remaining.join(' ').toLowerCase(), tokens }
})

function removeToken(token: string) {
  const lower = token.toLowerCase()
  search.value = search.value.trim().split(/\s+/).filter(p => p.toLowerCase() !== lower).join(' ')
}

// ── Computed ──────────────────────────────────────────────────────────────────

const allBooks = computed<Book[]>(() =>
  isGuest.value ? guestStore.scans : serverBooks.value,
)

// Pure filter — no sort. Used by groupedBooks series branch (sorted within groups by ordinal).
const baseFiltered = computed<Book[]>(() => {
  const { status, series, award, text } = parsedSearch.value
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

// ── Grouped books ─────────────────────────────────────────────────────────────

interface BookGroup {
  key: string
  label: string
  books: Book[]
  seriesId?: number | null
  seriesTotal?: number | null
}

const groupedBooks = computed<BookGroup[]>(() => {
  const books = filteredBooks.value

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
    // Use baseFiltered (not pre-sorted) — within groups we sort by ordinal, so the
    // user's sort choice would be discarded anyway. Standalone books use the sorted list.
    const unsorted = baseFiltered.value
    const map = new Map<number, BookGroup>()
    const standaloneUnsorted: Book[] = []
    for (const b of unsorted) {
      if (b.series_id != null) {
        let g = map.get(b.series_id)
        if (!g) {
          g = { key: String(b.series_id), label: b.series_name || t('detail.series'), books: [], seriesId: b.series_id, seriesTotal: b.series_total ?? null }
          map.set(b.series_id, g)
        }
        g.books.push(b)
      } else {
        standaloneUnsorted.push(b)
      }
    }
    const groups = [...map.values()]
    for (const g of groups) {
      g.books.sort((a, b) => (a.series_ordinal ?? Infinity) - (b.series_ordinal ?? Infinity))
    }
    groups.sort((a, b) => a.label.localeCompare(b.label, localeStore.locale))
    if (standaloneUnsorted.length) {
      groups.push({ key: '__standalone__', label: t('library.standalone'), books: sortBooks(standaloneUnsorted) })
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

  return [{ key: '__all__', label: '', books }]
})

// ── Dropdown options ──────────────────────────────────────────────────────────

const GROUP_OPTIONS = computed(() => [
  { value: 'none' as GroupBy,   label: t('library.group_none') },
  { value: 'author' as GroupBy, label: t('library.group_author') },
  { value: 'series' as GroupBy, label: t('library.group_series') },
  { value: 'genre' as GroupBy,  label: t('library.group_genre') },
  { value: 'status' as GroupBy, label: t('library.group_status') },
])

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

const fetchBooks = async (offset = 0) => {
  const seq = ++fetchSeq
  try {
    // Fetch one extra item to detect whether another page exists, avoiding a false
    // positive when the library size is an exact multiple of PAGE_SIZE.
    const res = await apiFetch(`/api/scans?limit=${PAGE_SIZE + 1}&offset=${offset}&locale=${localeStore.locale}`)
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Failed to fetch books')
    if (seq !== fetchSeq) return  // superseded by a later fetch (e.g. rapid locale switch)
    const page = data.slice(0, PAGE_SIZE)
    if (offset === 0) {
      serverBooks.value = page
    } else {
      serverBooks.value = [...serverBooks.value, ...page]
    }
    hasMore.value = data.length > PAGE_SIZE
  } catch (err: any) {
    if (seq !== fetchSeq) return
    error.value = err.message
  }
}

const loadMore = async () => {
  loadingMore.value = true
  await fetchBooks(serverBooks.value.length)
  loadingMore.value = false
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

// ── Detail & delete ───────────────────────────────────────────────────────────

const openDetail = (book: Book) => { selectedBook.value = book; detailDialog.value = true }

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
