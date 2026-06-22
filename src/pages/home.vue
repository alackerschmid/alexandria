<template>
  <div class="bg-charcoal min-h-screen md:h-screen flex flex-col transition-[filter] duration-300" :class="{ 'blur-sm': firstnameDialog }">

    <!-- ── App bar ────────────────────────────────────────────────────────────── -->
    <AppHeader />

    <!-- ── Top band: greeting + scan CTA (full width on desktop) ─────────────── -->
    <div class="shrink-0 px-6 md:px-14 pt-5 pb-3 md:py-12">
      <div class="flex flex-col md:flex-row md:items-end md:justify-between gap-8 md:gap-16">

        <!-- Greeting -->
        <div>
          <p class="font-mono text-[9px] tracking-[0.3em] uppercase text-orange-neon mb-4">
            {{ $t('home.welcome') }}
          </p>
          <h1 class="font-heading font-black text-[2.2rem] md:text-[2.75rem] leading-[1.02] text-text-primary mb-3">
            {{ greeting }}
          </h1>
          <p class="font-mono text-[10px] md:text-[11px] tracking-[0.05em] text-text-secondary">
            {{ metaLine }}
          </p>
        </div>

        <!-- Scan CTA -->
        <div
          class="flex justify-between items-center px-6 py-3.5 md:py-5 md:w-72 shrink-0 cursor-pointer hover:opacity-90 transition-opacity"
          style="background: rgb(var(--v-theme-primary));"
          @click="$router.push('/scanner')"
        >
          <p class="font-heading font-black text-2xl leading-none" style="color: #111110;">{{ $t('home.scan_cta') }}</p>
          <v-icon icon="mdi-barcode" size="28" style="color: #111110;" />
        </div>

      </div>
    </div>

    <!-- ── Bottom: stats | recently added ────────────────────────────────────── -->
    <div class="flex-1 md:min-h-0 md:overflow-hidden flex flex-col md:flex-row">

      <!-- Stats -->
      <div class="md:flex-none md:w-80 md:border-r border-charcoal-border md:min-h-0">

        <!-- Desktop: vertical list -->
        <div class="hidden md:flex md:flex-col md:h-full md:min-h-0">
          <div class="shrink-0 px-10 pt-10 pb-4">
            <span class="font-mono text-[10px] tracking-[0.3em] uppercase text-text-secondary">
              {{ $t('home.stat_overview') }}
            </span>
          </div>
          <div class="flex-1 flex flex-col min-h-0 mx-10 border-t border-charcoal-border">
            <div
              v-for="stat in stats"
              :key="stat.key"
              class="flex-1 flex justify-between items-center"
            >
              <span class="text-[11px] tracking-[0.18em] uppercase text-text-secondary">{{ stat.label }}</span>
              <span class="font-heading font-black text-[1.7rem] text-text-primary leading-none">{{ stat.value }}</span>
            </div>
          </div>
        </div>

        <!-- Mobile: condensed bar -->
        <div class="md:hidden flex mx-6 mt-3 mb-2">
          <div
            v-for="stat in stats"
            :key="stat.key"
            class="flex-1 flex flex-col items-center py-3"
          >
            <span class="font-heading font-black text-[1.9rem] text-text-primary leading-none">{{ stat.value }}</span>
            <span class="font-mono text-[8px] tracking-[0.15em] uppercase text-text-secondary mt-1.5">{{ stat.label }}</span>
          </div>
        </div>

      </div>

      <!-- Recently added -->
      <div class="flex-1 min-w-0 md:min-h-0 px-6 md:px-14 pt-8 md:pt-10 pb-8 md:pb-0 md:overflow-y-auto md:flex md:flex-col">

        <div class="flex justify-between items-baseline mb-1.5 md:mb-0 md:shrink-0 md:pb-4">
          <span class="font-mono text-[10px] tracking-[0.3em] uppercase text-text-secondary">
            {{ $t('home.recently_added') }}
          </span>
          <router-link to="/library" class="font-mono text-[10px] tracking-[0.2em] uppercase text-orange-neon hover:opacity-70 transition-opacity">
            {{ $t('home.go_to_library') }} →
          </router-link>
        </div>

        <!-- Loading -->
        <div v-if="loading" class="flex justify-center mt-16">
          <v-progress-circular indeterminate color="primary" size="24" width="2" />
        </div>

        <!-- Empty -->
        <div v-else-if="recentBooks.length === 0" class="pt-12">
          <p class="font-heading text-2xl font-bold text-text-primary mb-2">{{ $t('library.empty_heading') }}</p>
          <p class="text-sm text-text-secondary">{{ $t('library.empty_body') }}</p>
        </div>

        <!-- Book rows -->
        <div v-else class="md:flex-1 md:flex md:flex-col md:min-h-0 md:border-t md:border-charcoal-border">
          <div
            v-for="book in recentBooks"
            :key="book.id"
            class="flex items-center gap-4 md:gap-4.5 py-3.5 md:py-0 md:flex-1 border-b border-charcoal-border cursor-pointer -mx-6 md:-mx-14 px-6 md:px-14 hover:bg-charcoal-light transition-colors"
            @click="openDetail(book)"
          >
            <div class="w-9 md:w-10 h-13 flex-none bg-charcoal-light border border-charcoal-border relative shrink-0 overflow-hidden">
              <img
                v-if="book.cover_url"
                :src="book.cover_url"
                :alt="book.title || book.isbn"
                class="absolute inset-0 w-full h-full object-cover"
              />
              <div v-else class="absolute left-0 top-0 bottom-0 w-0.75 bg-primary" />
            </div>
            <div class="flex-1 min-w-0">
              <p class="font-heading font-bold text-sm md:text-base text-text-primary leading-snug truncate">
                {{ book.title || book.isbn }}
              </p>
              <p class="font-mono text-[10px] md:text-[11px] text-text-secondary mt-1">
                {{ book.author || $t('book.unknown_author') }}
              </p>
            </div>
            <div class="hidden lg:flex flex-none w-28 items-center gap-1.5">
              <div class="w-1.5 h-1.5 rounded-full shrink-0" :style="{ background: statusColor(book.status) }" />
              <span class="text-[10px] tracking-[0.15em] uppercase font-medium" :style="{ color: statusColor(book.status) }">
                {{ $t(`book.${book.status}`) }}
              </span>
            </div>
            <div class="flex-none font-mono text-[10px] text-text-secondary/65 tracking-[0.05em] text-right w-20">
              {{ timeAgo(book.created_at) }}
            </div>
          </div>
        </div>

      </div>
    </div>

    <!-- ── Book detail dialog ──────────────────────────────────────────────────── -->
    <BookDetail
      v-if="selectedBook"
      v-model="detailDialog"
      :book="selectedBook"
      :guest="false"
      @cycle-status="cycleStatus(selectedBook!)"
      @delete="detailDialog = false; openDeleteDialog(selectedBook!)"
      @refreshed="handleRefreshed"
    />

    <!-- ── Delete confirmation ─────────────────────────────────────────────────── -->
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
          <v-btn
            variant="text"
            size="small"
            class="text-[10px] tracking-[0.2em] uppercase text-text-secondary"
            @click="deleteDialog = false"
          >
            {{ $t('library.cancel') }}
          </v-btn>
          <v-btn
            variant="flat"
            size="small"
            color="error"
            rounded="0"
            class="text-[10px] tracking-[0.2em] uppercase"
            :loading="deleting"
            @click="confirmDelete"
          >
            {{ $t('library.remove') }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- ── First-name onboarding dialog ─────────────────────────────────────── -->
    <v-dialog v-model="firstnameDialog" max-width="420" persistent>
      <v-card rounded="0" :color="themeStore.isDark ? '#1c1b19' : '#f5f2ed'">
        <v-card-text class="px-8 pt-8 pb-8">
          <p class="font-mono text-[10px] tracking-[0.3em] uppercase text-text-secondary mb-3">
            {{ $t('home.firstname_dialog_eyebrow') }}
          </p>
          <h2 class="font-heading font-black text-3xl text-text-primary leading-tight mb-2">
            {{ $t('home.firstname_dialog_heading') }}
          </h2>
          <p class="text-sm text-text-secondary mb-8">
            {{ $t('home.firstname_dialog_body') }}
          </p>
          <div class="border-b border-charcoal-border pb-2 mb-8">
            <label class="block text-[10px] tracking-[0.2em] uppercase text-text-secondary mb-1">
              {{ $t('home.firstname_placeholder') }}
            </label>
            <input
              v-model="firstnameInput"
              type="text"
              autocomplete="given-name"
              autofocus
              class="w-full bg-transparent text-text-primary text-base outline-none placeholder:text-charcoal-border"
              :placeholder="$t('home.firstname_placeholder')"
              @keyup.enter="saveFirstname"
            />
          </div>
          <button
            :disabled="!firstnameInput.trim() || savingFirstname"
            class="w-full bg-text-primary text-charcoal py-4 text-xs font-bold tracking-[0.25em] uppercase hover:opacity-80 transition-opacity disabled:opacity-40"
            @click="saveFirstname"
          >
            {{ savingFirstname ? '—' : $t('home.firstname_save') }}
          </button>
        </v-card-text>
      </v-card>
    </v-dialog>

    <AppToast v-model="errorToast" :message="errorMessage" type="error" :timeout="4000" />
  </div>
</template>

<script lang="ts" setup>
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { useAuthStore } from '@/stores/auth'
import { useThemeStore } from '@/stores/theme'
import { useLocaleStore } from '@/stores/locale'
import AppHeader from '@/components/AppHeader.vue'
import BookDetail from '@/components/BookDetail.vue'
import AppToast from '@/components/AppToast.vue'
import type { Book, ReadStatus } from '@/types/book'
import { useApi } from '@/composables/useApi'
import { useFieldDefsStore } from '@/stores/fieldDefs'

const { t } = useI18n()
const authStore = useAuthStore()
const themeStore = useThemeStore()
const localeStore = useLocaleStore()
const { apiFetch } = useApi()
const fieldDefsStore = useFieldDefsStore()

const PAGE_SIZE = 200

// ── State ─────────────────────────────────────────────────────────────────────

const serverBooks = ref<Book[]>([])
const loading = ref(false)
const deleteDialog = ref(false)
const bookToDelete = ref<Book | null>(null)
const deleting = ref(false)
const detailDialog = ref(false)
const selectedBook = ref<Book | null>(null)
const errorToast = ref(false)
const errorMessage = ref('')

// ── First-name onboarding ─────────────────────────────────────────────────────

const firstnameDialog = ref(!authStore.firstname)
const firstnameInput = ref('')
const savingFirstname = ref(false)

const saveFirstname = async () => {
  if (!firstnameInput.value.trim() || savingFirstname.value) return
  savingFirstname.value = true
  try {
    const res = await apiFetch('/api/auth/me', {
      method: 'PATCH',
      body: JSON.stringify({ firstname: firstnameInput.value.trim() }),
    })
    if (res.ok) {
      authStore.setFirstname(firstnameInput.value.trim())
      firstnameDialog.value = false
    }
  } catch {}
  savingFirstname.value = false
}

// ── Computed ──────────────────────────────────────────────────────────────────

const recentBooks = computed(() => serverBooks.value.slice(0, 4))

const statusCounts = computed(() => ({
  reading: serverBooks.value.filter(b => b.status === 'reading').length,
  read:    serverBooks.value.filter(b => b.status === 'read').length,
  unread:  serverBooks.value.filter(b => b.status === 'unread').length,
}))

const stats = computed(() => [
  { key: 'total',   label: t('home.stat_in_library'), value: serverBooks.value.length.toLocaleString() },
  { key: 'reading', label: t('home.stat_reading'),    value: statusCounts.value.reading.toLocaleString() },
  { key: 'read',    label: t('home.stat_read'),       value: statusCounts.value.read.toLocaleString() },
  { key: 'unread',  label: t('home.stat_to_read'),    value: statusCounts.value.unread.toLocaleString() },
])

const greeting = computed(() => {
  const hour = new Date().getHours()
  const name = authStore.firstname ?? (() => {
    const raw = (authStore.email ?? '').split('@')[0]
    return raw.charAt(0).toUpperCase() + raw.slice(1)
  })()
  const key  = hour < 12 ? 'greeting_morning'
    : hour < 17 ? 'greeting_afternoon'
    : hour < 22 ? 'greeting_evening'
    : 'greeting_night'
  return t(`home.${key}`, { name })
})

const metaLine = computed(() => {
  const locale  = localeStore.locale === 'de' ? 'de-DE' : 'en-GB'
  const dateStr = new Date().toLocaleDateString(locale, { weekday: 'long', day: 'numeric', month: 'long' })
  return t('home.meta', { date: dateStr, count: serverBooks.value.length.toLocaleString() })
})

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusColor(s: ReadStatus): string {
  if (s === 'reading') return 'rgb(var(--v-theme-primary))'
  if (s === 'read')    return 'rgb(var(--v-theme-success))'
  return 'rgba(138,128,120,0.45)'
}

function timeAgo(dateStr: string): string {
  const h    = (Date.now() - new Date(dateStr).getTime()) / 3_600_000
  const days = Math.floor(h / 24)
  if (h < 1)     return t('home.time_just_now')
  if (h < 24)    return t('home.time_hours_ago',  { n: Math.floor(h) })
  if (days === 1) return t('home.time_yesterday')
  if (days < 7)  return t('home.time_days_ago',   { n: days })
  if (days < 30) return t('home.time_weeks_ago',  { n: Math.floor(days / 7) })
  return            t('home.time_months_ago', { n: Math.floor(days / 30) })
}

// ── Data fetching ─────────────────────────────────────────────────────────────

const fetchBooks = async () => {
  try {
    const res = await apiFetch(`/api/scans?limit=${PAGE_SIZE}&offset=0&sort=date_desc&locale=${localeStore.locale}`)
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || 'Failed to fetch')
    serverBooks.value = data
  } catch (err: any) {
    errorMessage.value = err.message
    errorToast.value   = true
  }
}

// ── Actions ───────────────────────────────────────────────────────────────────

const NEXT_STATUS: Record<ReadStatus, ReadStatus> = {
  unread: 'reading', reading: 'read', read: 'unread',
}

const cycleStatus = async (book: Book) => {
  const newStatus = NEXT_STATUS[book.status]
  const prev = book.status
  book.status = newStatus
  try {
    const res = await apiFetch(`/api/scans/${book.id}`, {
      method: 'PATCH',
      body:   JSON.stringify({ status: newStatus }),
    })
    if (!res.ok) throw new Error()
  } catch {
    book.status = prev
    errorMessage.value = t('library.error_update_status')
    errorToast.value   = true
  }
}

const openDetail      = (book: Book) => { selectedBook.value = book; detailDialog.value = true }
function handleRefreshed(updated: Partial<Book>) {
  if (!selectedBook.value) return;
  const merged = { ...selectedBook.value, ...updated } as Book;
  selectedBook.value = merged;
  const idx = serverBooks.value.findIndex(b => b.id === merged.id);
  if (idx !== -1) serverBooks.value[idx] = merged;
}
const openDeleteDialog = (book: Book) => { bookToDelete.value = book; deleteDialog.value  = true }

const confirmDelete = async () => {
  const book = bookToDelete.value
  if (!book) return
  deleting.value = true
  try {
    const res = await apiFetch(`/api/scans/${book.id}`, { method: 'DELETE' })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || t('library.error_delete'))
    serverBooks.value = serverBooks.value.filter(b => b.id !== book.id)
    deleteDialog.value = false
  } catch (err: any) {
    errorMessage.value = err.message
    errorToast.value   = true
  } finally {
    deleting.value     = false
    bookToDelete.value = null
  }
}

// ── Init ──────────────────────────────────────────────────────────────────────

onMounted(async () => {
  loading.value = true
  await Promise.all([fetchBooks(), fieldDefsStore.load()])
  loading.value = false
})
</script>
