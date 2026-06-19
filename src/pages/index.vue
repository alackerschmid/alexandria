<template>
  <div class="bg-charcoal min-h-screen flex flex-col">
    <AppHeader />
    <div class="w-full max-w-300 mx-auto flex-1 flex flex-col">
      <!-- Page title -->
      <div class="px-6 md:px-10 pt-10 pb-6 border-b border-charcoal-border">
        <div class="flex justify-between items-end">
          <div>
            <p class="text-[10px] text-text-secondary tracking-[0.3em] uppercase mb-3">
              {{ $t('library.section') }}
            </p>
            <h1 class="font-heading text-5xl md:text-6xl font-bold text-text-primary leading-[1.05]">
              {{ $t('library.heading_word1') }}<br class="md:hidden" /><span class="hidden md:inline">&nbsp;</span>{{ $t('library.heading_word2') }}
            </h1>
          </div>
          <span
            v-if="!loading && allBooks.length > 0"
            class="text-[10px] text-text-secondary tracking-widest uppercase pb-1"
          >
            {{ displayedBooks.length
            }}<template v-if="displayedBooks.length !== allBooks.length"
              >/{{ allBooks.length }}</template
            >
            {{ displayedBooks.length === 1 ? $t('library.title_singular') : $t('library.title_plural') }}
          </span>
        </div>
      </div>

      <!-- Guest banner -->
      <div
        v-if="isGuest"
        class="px-6 md:px-10 py-4 border-b border-charcoal-border flex flex-wrap items-center justify-between gap-3"
      >
        <div class="text-xs text-text-secondary leading-relaxed">
          <span>{{ $t('guest.banner', { used: guestStore.scans.length, max: 3 }) }}</span>
          <span class="block text-text-secondary/60 mt-0.5">{{ $t('guest.create_account') }}</span>
        </div>
        <div class="flex gap-2 shrink-0">
          <v-btn
            variant="text"
            size="small"
            color="primary"
            class="text-[10px] tracking-[0.15em] uppercase px-4"
            @click="$router.push('/login')"
          >
            {{ $t('guest.sign_in') }}
          </v-btn>
          <v-btn
            variant="flat"
            size="small"
            color="primary"
            rounded="0"
            elevation="0"
            class="text-[10px] tracking-[0.15em] uppercase px-4"
            @click="$router.push('/login?mode=register')"
          >
            {{ $t('guest.register') }}
          </v-btn>
        </div>
      </div>

      <!-- Search + controls -->
      <div
        class="px-6 md:px-10 pt-5 pb-4 border-b border-charcoal-border space-y-4"
      >
        <!-- Search -->
        <div
          class="border-b border-charcoal-border pb-2 flex items-center gap-2"
        >
          <v-icon
            icon="mdi-magnify"
            size="16"
            class="text-text-secondary shrink-0"
          />
          <input
            v-model="search"
            type="search"
            :placeholder="$t('library.search_placeholder')"
            class="flex-1 bg-transparent text-text-primary text-sm outline-none placeholder:text-text-secondary/50"
          />
          <button
            v-if="search"
            class="text-text-secondary hover:text-text-primary transition-colors"
            @click="search = ''"
          >
            <v-icon icon="mdi-close" size="14" />
          </button>
        </div>

        <!-- Sort + Status filter + View toggle row -->
        <div class="flex items-center justify-between gap-4">
          <!-- Sort -->
          <select
            v-model="sortBy"
            class="w-44 bg-transparent text-[10px] text-text-secondary tracking-[0.15em] uppercase outline-none cursor-pointer border-b border-charcoal-border pb-0.5"
          >
            <option value="date_desc">{{ $t('library.sort_date_desc') }}</option>
            <option value="date_asc">{{ $t('library.sort_date_asc') }}</option>
            <option value="title_asc">{{ $t('library.sort_title_asc') }}</option>
            <option value="title_desc">{{ $t('library.sort_title_desc') }}</option>
            <option value="author_asc">{{ $t('library.sort_author_asc') }}</option>
          </select>

          <div class="flex items-center gap-4">
            <!-- Status filter tabs -->
            <div class="flex gap-4">
              <button
                v-for="tab in STATUS_TABS"
                :key="tab.value"
                class="text-[10px] tracking-[0.15em] uppercase transition-colors"
                :class="
                  filterStatus === tab.value
                    ? 'text-text-primary border-b border-text-primary pb-0.5'
                    : 'text-text-secondary/50'
                "
                @click="filterStatus = tab.value"
              >
                {{ tab.label }} <span class="font-mono">({{ statusCounts[tab.value] }})</span>
              </button>
            </div>

            <!-- View toggle -->
            <div class="flex items-center gap-1 shrink-0 border-l border-charcoal-border pl-4">
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
          </div>
        </div>
      </div>

      <!-- Loading -->
      <div v-if="loading" class="flex justify-center mt-20">
        <v-progress-circular
          indeterminate
          color="primary"
          size="24"
          width="2"
        />
      </div>

      <!-- Error -->
      <div
        v-if="error"
        class="mx-6 mt-6 pl-4 py-2 border-l-2 text-sm"
        style="
          border-color: rgb(var(--v-theme-error));
          color: rgb(var(--v-theme-error));
        "
      >
        {{ error }}
      </div>

      <!-- Empty state -->
      <div
        v-if="!loading && allBooks.length === 0"
        class="px-6 md:px-10 pt-16 pb-8"
      >
        <p class="font-heading text-3xl font-bold text-text-primary mb-3">
          {{ $t('library.empty_heading') }}
        </p>
        <p class="text-sm text-text-secondary leading-relaxed">
          {{ $t('library.empty_body') }}
        </p>
      </div>

      <!-- No results for current filter -->
      <div
        v-else-if="!loading && allBooks.length > 0 && displayedBooks.length === 0"
        class="px-6 md:px-10 pt-16 pb-8"
      >
        <p class="text-sm text-text-secondary">{{ $t('library.no_results') }}</p>
      </div>

      <!-- List view -->
      <div v-if="displayedBooks.length > 0 && viewMode === 'list'" class="pb-28">
        <div class="md:px-10 md:grid md:grid-cols-2 xl:grid-cols-3 md:gap-x-10">
          <BookCard
            v-for="book in displayedBooks"
            :key="book.id"
            :book="book"
            @cycle-status="cycleStatus(book)"
            @delete="openDeleteDialog(book)"
            @select="openDetail(book)"
          />
        </div>

        <!-- Load more -->
        <div v-if="hasMore" class="flex justify-center py-8">
          <button
            class="text-[10px] text-text-secondary tracking-[0.25em] uppercase border-b border-charcoal-border pb-0.5 hover:text-text-primary transition-colors"
            :class="{ 'opacity-50 pointer-events-none': loadingMore }"
            @click="loadMore"
          >
            {{ loadingMore ? '—' : $t('library.load_more') }}
          </button>
        </div>
      </div>

      <!-- Tile view -->
      <div v-else-if="displayedBooks.length > 0 && viewMode === 'tile'" class="px-6 md:px-10 pt-5 pb-28">
        <div class="grid grid-cols-4 sm:grid-cols-5 md:grid-cols-7 xl:grid-cols-8 gap-3 md:gap-4">
          <div
            v-for="book in displayedBooks"
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

        <!-- Load more -->
        <div v-if="hasMore" class="flex justify-center py-8">
          <button
            class="text-[10px] text-text-secondary tracking-[0.25em] uppercase border-b border-charcoal-border pb-0.5 hover:text-text-primary transition-colors"
            :class="{ 'opacity-50 pointer-events-none': loadingMore }"
            @click="loadMore"
          >
            {{ loadingMore ? '—' : $t('library.load_more') }}
          </button>
        </div>
      </div>

      <!-- Footer -->
      <AppFooter class="mt-auto" />
    </div>

    <!-- Scan pill (mobile only) -->
    <button
      class="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 md:hidden flex items-center justify-center gap-2 rounded-full py-4 text-[10px] font-bold tracking-[0.25em] uppercase text-white"
      style="background: rgb(var(--v-theme-primary)); min-width: 58vw; box-shadow: 0 4px 28px rgba(255, 102, 0, 0.3);"
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
      @refreshed="(updated) => Object.assign(selectedBook!, updated)"
    />

    <!-- Delete confirmation dialog -->
    <v-dialog v-model="deleteDialog" max-width="360">
      <v-card rounded="0" :color="themeStore.isDark ? '#1c1b19' : '#ffffff'">
        <v-card-title
          class="font-heading text-xl pt-6 px-6 font-bold text-text-primary"
        >
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

    <!-- Error snackbar -->
    <AppToast
      v-model="errorToast"
      :message="errorMessage"
      type="error"
      :timeout="4000"
    />
  </div>
</template>

<script lang="ts" setup>
import { ref, computed, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { useAuthStore } from "@/stores/auth";
import { useThemeStore } from "@/stores/theme";
import { useGuestStore } from "@/stores/guest";
import AppHeader from "@/components/AppHeader.vue";
import AppToast from "@/components/AppToast.vue";
import AppFooter from "@/components/AppFooter.vue";
import BookCard, {
  type Book,
  type ReadStatus,
} from "@/components/BookCard.vue";
import BookDetail from "@/components/BookDetail.vue";

const { t } = useI18n();
const authStore = useAuthStore();
const themeStore = useThemeStore();
const guestStore = useGuestStore();

const isGuest = computed(() => !authStore.isAuthenticated);

// ── Types ──────────────────────────────────────────────────────────────────────

type SortOption =
  | "date_desc"
  | "date_asc"
  | "title_asc"
  | "title_desc"
  | "author_asc";
type StatusFilter = "all" | ReadStatus;

// ── Config ────────────────────────────────────────────────────────────────────

const STATUS_TABS = computed(() => [
  { label: t("library.filter_all"), value: "all" as StatusFilter },
  { label: t("library.filter_unread"), value: "unread" as StatusFilter },
  { label: t("library.filter_reading"), value: "reading" as StatusFilter },
  { label: t("library.filter_read"), value: "read" as StatusFilter },
]);

// ── State ─────────────────────────────────────────────────────────────────────

const serverBooks = ref<Book[]>([]);
const loading = ref(false);
const loadingMore = ref(false);
const hasMore = ref(false);
const error = ref("");
const search = ref("");
const sortBy = ref<SortOption>("date_desc");
const filterStatus = ref<StatusFilter>("all");
const viewMode = ref<"list" | "tile">("list");

const deleteDialog = ref(false);
const bookToDelete = ref<Book | null>(null);
const deleting = ref(false);

const detailDialog = ref(false);
const selectedBook = ref<Book | null>(null);

const errorToast = ref(false);
const errorMessage = ref("");

const API_BASE = import.meta.env.VITE_API_URL || "";
const PAGE_SIZE = 200;

// ── Computed ──────────────────────────────────────────────────────────────────

// Source of truth switches between guest localStorage and server data
const allBooks = computed<Book[]>(() =>
  isGuest.value ? guestStore.scans : serverBooks.value
);

const displayedBooks = computed(() => {
  let list = allBooks.value;

  if (filterStatus.value !== "all") {
    list = list.filter((b) => b.status === filterStatus.value);
  }

  if (search.value.trim()) {
    const q = search.value.toLowerCase();
    list = list.filter(
      (b) =>
        b.title?.toLowerCase().includes(q) ||
        b.author?.toLowerCase().includes(q) ||
        b.isbn.includes(q),
    );
  }

  return [...list].sort((a, b) => {
    switch (sortBy.value) {
      case "title_asc":
        return (a.title ?? a.isbn).localeCompare(b.title ?? b.isbn);
      case "title_desc":
        return (b.title ?? b.isbn).localeCompare(a.title ?? a.isbn);
      case "author_asc":
        return (a.author ?? "").localeCompare(b.author ?? "");
      case "date_asc":
        return a.created_at.localeCompare(b.created_at);
      default:
        return b.created_at.localeCompare(a.created_at);
    }
  });
});

const statusCounts = computed<Record<StatusFilter, number>>(() => ({
  all: allBooks.value.length,
  unread: allBooks.value.filter((b) => b.status === "unread").length,
  reading: allBooks.value.filter((b) => b.status === "reading").length,
  read: allBooks.value.filter((b) => b.status === "read").length,
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusDotColor(s: ReadStatus): string {
  if (s === "reading") return "rgb(var(--v-theme-primary))";
  if (s === "read") return "rgb(var(--v-theme-success))";
  return "rgba(138,128,120,0.35)";
}

// ── Data fetching (authenticated only) ───────────────────────────────────────

const fetchBooks = async (offset = 0) => {
  try {
    const res = await fetch(
      `${API_BASE}/api/scans?limit=${PAGE_SIZE}&offset=${offset}`,
      { headers: { Authorization: `Bearer ${authStore.token}` } },
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to fetch books");

    if (offset === 0) {
      serverBooks.value = data;
    } else {
      serverBooks.value = [...serverBooks.value, ...data];
    }
    hasMore.value = data.length === PAGE_SIZE;
  } catch (err: any) {
    error.value = err.message;
  }
};

const loadMore = async () => {
  loadingMore.value = true;
  await fetchBooks(serverBooks.value.length);
  loadingMore.value = false;
};

// ── Status cycling ────────────────────────────────────────────────────────────

const NEXT_STATUS: Record<ReadStatus, ReadStatus> = {
  unread: "reading",
  reading: "read",
  read: "unread",
};

const cycleStatus = async (book: Book) => {
  if (isGuest.value) {
    guestStore.cycleStatus(book.isbn);
    return;
  }

  const newStatus = NEXT_STATUS[book.status];
  const prev = book.status;
  book.status = newStatus;

  try {
    const res = await fetch(`${API_BASE}/api/scans/${book.id}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${authStore.token}`,
      },
      body: JSON.stringify({ status: newStatus }),
    });
    if (!res.ok) throw new Error();
  } catch {
    book.status = prev;
    errorMessage.value = t("library.error_update_status");
    errorToast.value = true;
  }
};

// ── Delete ────────────────────────────────────────────────────────────────────

const openDetail = (book: Book) => {
  selectedBook.value = book;
  detailDialog.value = true;
};

const openDeleteDialog = (book: Book) => {
  bookToDelete.value = book;
  deleteDialog.value = true;
};

const confirmDelete = async () => {
  const book = bookToDelete.value;
  if (!book) return;

  if (isGuest.value) {
    guestStore.removeScan(book.isbn);
    deleteDialog.value = false;
    bookToDelete.value = null;
    return;
  }

  deleting.value = true;
  try {
    const res = await fetch(`${API_BASE}/api/scans/${book.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${authStore.token}` },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || t("library.error_delete"));
    serverBooks.value = serverBooks.value.filter((b) => b.id !== book.id);
    deleteDialog.value = false;
  } catch (err: any) {
    errorMessage.value = err.message;
    errorToast.value = true;
  } finally {
    deleting.value = false;
    bookToDelete.value = null;
  }
};

// ── Init ──────────────────────────────────────────────────────────────────────

onMounted(async () => {
  if (authStore.isAuthenticated) {
    loading.value = true;
    await fetchBooks();
    loading.value = false;
  }
});
</script>
