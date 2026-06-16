<template>
  <div class="bg-charcoal min-h-screen">
    <!-- Header -->
    <div class="px-6 pt-14 pb-6 border-b border-charcoal-border">
      <div class="flex justify-between items-start">
        <div>
          <p
            class="text-[10px] text-text-secondary tracking-[0.3em] uppercase mb-3"
          >
            Library
          </p>
          <h1
            class="font-heading text-5xl font-bold text-text-primary leading-[1.05]"
          >
            Your<br />Books.
          </h1>
        </div>
        <div class="flex flex-col items-end gap-3 pt-1">
          <div class="flex gap-1">
            <v-btn
              :icon="
                themeStore.isDark ? 'mdi-weather-sunny' : 'mdi-weather-night'
              "
              variant="text"
              color="primary"
              size="small"
              @click="themeStore.toggle()"
            />
            <v-btn
              icon="mdi-logout"
              variant="text"
              color="primary"
              size="small"
              @click="authStore.logout()"
            />
          </div>
          <span
            v-if="!loading && books.length > 0"
            class="text-[10px] text-text-secondary tracking-widest uppercase"
          >
            {{ displayedBooks.length
            }}<template v-if="displayedBooks.length !== books.length"
              >/{{ books.length }}</template
            >
            {{ displayedBooks.length === 1 ? "title" : "titles" }}
          </span>
        </div>
      </div>
    </div>

    <!-- Search + controls -->
    <div class="px-6 pt-5 pb-4 border-b border-charcoal-border space-y-4">
      <!-- Search -->
      <div class="border-b border-charcoal-border pb-2 flex items-center gap-2">
        <v-icon
          icon="mdi-magnify"
          size="16"
          class="text-text-secondary shrink-0"
        />
        <input
          v-model="search"
          type="search"
          placeholder="Search titles, authors, ISBNs…"
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

      <!-- Sort + Status filter row -->
      <div class="flex items-center justify-between gap-4">
        <!-- Sort -->
        <select
          v-model="sortBy"
          class="bg-transparent text-[10px] text-text-secondary tracking-[0.15em] uppercase outline-none cursor-pointer border-b border-charcoal-border pb-0.5"
        >
          <option value="date_desc">Newest first</option>
          <option value="date_asc">Oldest first</option>
          <option value="title_asc">Title A–Z</option>
          <option value="title_desc">Title Z–A</option>
          <option value="author_asc">Author A–Z</option>
        </select>

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
            {{ tab.label }}
          </button>
        </div>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex justify-center mt-20">
      <v-progress-circular indeterminate color="primary" size="24" width="2" />
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
    <div v-if="!loading && books.length === 0" class="px-6 pt-16 pb-8">
      <p class="font-heading text-3xl font-bold text-text-primary mb-3">
        Nothing here yet.
      </p>
      <p class="text-sm text-text-secondary leading-relaxed">
        Tap the button below to scan your first barcode.
      </p>
    </div>

    <!-- No results for current filter -->
    <div
      v-else-if="!loading && books.length > 0 && displayedBooks.length === 0"
      class="px-6 pt-16 pb-8"
    >
      <p class="text-sm text-text-secondary">No books match this filter.</p>
    </div>

    <!-- Book list -->
    <div v-if="displayedBooks.length > 0" class="pb-28">
      <div
        v-for="book in displayedBooks"
        :key="book.id"
        class="flex items-start gap-4 px-6 py-5 border-b border-charcoal-border"
      >
        <!-- Cover -->
        <img
          v-if="book.cover_url"
          :src="book.cover_url"
          class="w-12 h-18 object-cover shrink-0"
        />
        <div
          v-else
          class="w-12 h-18 bg-charcoal border border-charcoal-border flex items-center justify-center shrink-0"
        >
          <v-icon icon="mdi-book-outline" size="18" color="primary" />
        </div>

        <!-- Info -->
        <div class="flex-1 min-w-0 mt-0.5">
          <div
            class="font-heading text-base font-bold text-text-primary leading-snug line-clamp-2 mb-1"
          >
            {{ book.title || book.isbn }}
          </div>
          <div class="text-xs text-text-secondary mb-2">
            {{ book.author || "Unknown Author" }}
          </div>
          <div class="flex items-center gap-3">
            <div
              class="text-[10px] text-text-secondary/50 font-mono tracking-wide"
            >
              {{ book.isbn }}
            </div>
            <div
              class="text-[10px] text-text-secondary/50 font-mono tracking-wide"
            >
              {{ book.created_at }}
            </div>
            <!-- Status button -->
            <button
              class="flex items-center gap-1 text-[10px] tracking-[0.15em] uppercase transition-colors"
              :class="STATUS_CONFIG[book.status].class"
              @click="cycleStatus(book)"
            >
              <v-icon :icon="STATUS_CONFIG[book.status].icon" size="10" />
              {{ STATUS_CONFIG[book.status].label }}
            </button>
          </div>
        </div>

        <!-- Delete -->
        <v-btn
          icon="mdi-delete-outline"
          variant="text"
          color="primary"
          size="x-small"
          class="shrink-0 mt-0.5"
          @click="openDeleteDialog(book)"
        />
      </div>

      <!-- Load more -->
      <div v-if="hasMore" class="flex justify-center py-8">
        <button
          class="text-[10px] text-text-secondary tracking-[0.25em] uppercase border-b border-charcoal-border pb-0.5 hover:text-text-primary transition-colors"
          :class="{ 'opacity-50 pointer-events-none': loadingMore }"
          @click="loadMore"
        >
          {{ loadingMore ? "—" : "Load more" }}
        </button>
      </div>
    </div>

    <!-- Footer -->
    <AppFooter />

    <!-- Scan FAB -->
    <v-btn
      color="primary"
      size="x-large"
      icon="mdi-camera"
      class="fixed bottom-8 right-6 z-50"
      elevation="0"
      rounded="0"
      @click="$router.push('/scanner')"
    />

    <!-- Delete confirmation dialog -->
    <v-dialog v-model="deleteDialog" max-width="360">
      <v-card rounded="0" :color="themeStore.isDark ? '#1c1b19' : '#ffffff'">
        <v-card-title
          class="font-heading text-xl pt-6 px-6 font-bold text-text-primary"
        >
          Remove book?
        </v-card-title>
        <v-card-text class="px-6 text-sm text-text-secondary">
          "{{ bookToDelete?.title || bookToDelete?.isbn }}" will be removed from
          your library.
        </v-card-text>
        <v-card-actions class="px-4 pb-4 gap-2">
          <v-spacer />
          <v-btn
            variant="text"
            size="small"
            class="text-[10px] tracking-[0.2em] uppercase text-text-secondary"
            @click="deleteDialog = false"
          >
            Cancel
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
            Remove
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
import { useAuthStore } from "@/stores/auth";
import { useThemeStore } from "@/stores/theme";
import AppToast from "@/components/AppToast.vue";
import AppFooter from "@/components/AppFooter.vue";

const authStore = useAuthStore();
const themeStore = useThemeStore();

// ── Types ──────────────────────────────────────────────────────────────────────

type ReadStatus = "unread" | "reading" | "read";
type SortOption =
  | "date_desc"
  | "date_asc"
  | "title_asc"
  | "title_desc"
  | "author_asc";
type StatusFilter = "all" | ReadStatus;

interface Book {
  id: number;
  isbn: string;
  title: string | null;
  author: string | null;
  cover_url: string | null;
  status: ReadStatus;
  created_at: string;
}

// ── Config ────────────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<
  ReadStatus,
  { label: string; icon: string; class: string }
> = {
  unread: {
    label: "Unread",
    icon: "mdi-circle-outline",
    class: "text-text-secondary/40 hover:text-text-secondary",
  },
  reading: {
    label: "Reading",
    icon: "mdi-book-open-outline",
    class: "text-orange-neon",
  },
  read: {
    label: "Read",
    icon: "mdi-check-circle-outline",
    class: "text-[#22c55e]",
  },
};

const STATUS_TABS: { label: string; value: StatusFilter }[] = [
  { label: "All", value: "all" },
  { label: "Unread", value: "unread" },
  { label: "Reading", value: "reading" },
  { label: "Read", value: "read" },
];

// ── State ─────────────────────────────────────────────────────────────────────

const books = ref<Book[]>([]);
const loading = ref(true);
const loadingMore = ref(false);
const hasMore = ref(false);
const error = ref("");
const search = ref("");
const sortBy = ref<SortOption>("date_desc");
const filterStatus = ref<StatusFilter>("all");

const deleteDialog = ref(false);
const bookToDelete = ref<Book | null>(null);
const deleting = ref(false);

const errorToast = ref(false);
const errorMessage = ref("");

const API_BASE = import.meta.env.VITE_API_URL || "";
const PAGE_SIZE = 200;

// ── Computed ──────────────────────────────────────────────────────────────────

const displayedBooks = computed(() => {
  let list = books.value;

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

// ── Data fetching ─────────────────────────────────────────────────────────────

const fetchBooks = async (offset = 0) => {
  try {
    const res = await fetch(
      `${API_BASE}/api/scans?limit=${PAGE_SIZE}&offset=${offset}`,
      { headers: { Authorization: `Bearer ${authStore.token}` } },
    );
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to fetch books");

    if (offset === 0) {
      books.value = data;
    } else {
      books.value = [...books.value, ...data];
    }
    hasMore.value = data.length === PAGE_SIZE;
  } catch (err: any) {
    error.value = err.message;
  }
};

const loadMore = async () => {
  loadingMore.value = true;
  await fetchBooks(books.value.length);
  loadingMore.value = false;
};

// ── Status cycling ────────────────────────────────────────────────────────────

const NEXT_STATUS: Record<ReadStatus, ReadStatus> = {
  unread: "reading",
  reading: "read",
  read: "unread",
};

const cycleStatus = async (book: Book) => {
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
    errorMessage.value = "Failed to update status";
    errorToast.value = true;
  }
};

// ── Delete ────────────────────────────────────────────────────────────────────

const openDeleteDialog = (book: Book) => {
  bookToDelete.value = book;
  deleteDialog.value = true;
};

const confirmDelete = async () => {
  const book = bookToDelete.value;
  if (!book) return;
  deleting.value = true;

  try {
    const res = await fetch(`${API_BASE}/api/scans/${book.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${authStore.token}` },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to delete book");
    books.value = books.value.filter((b) => b.id !== book.id);
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
  await fetchBooks();
  loading.value = false;
});
</script>
