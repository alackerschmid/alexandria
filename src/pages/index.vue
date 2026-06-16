<template>
  <div class="bg-charcoal min-h-screen">
    <!-- Header -->
    <div class="px-6 pt-14 pb-8 border-b border-charcoal-border">
      <div class="flex justify-between items-start">
        <div>
          <p class="text-[10px] text-text-secondary tracking-[0.3em] uppercase mb-3">Library</p>
          <h1 class="font-heading text-5xl font-bold text-text-primary leading-[1.05]">
            Your<br>Books.
          </h1>
        </div>
        <div class="flex flex-col items-end gap-3 pt-1">
          <div class="flex gap-1">
            <v-btn
              :icon="themeStore.isDark ? 'mdi-weather-sunny' : 'mdi-weather-night'"
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
          <span v-if="!loading && books.length > 0" class="text-[10px] text-text-secondary tracking-widest uppercase">
            {{ books.length }} {{ books.length === 1 ? 'title' : 'titles' }}
          </span>
        </div>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex justify-center mt-20">
      <v-progress-circular indeterminate color="primary" size="24" width="2" />
    </div>

    <!-- Error -->
    <v-alert
      v-if="error"
      type="error"
      variant="tonal"
      rounded="0"
      class="mx-6 mt-6"
    >{{ error }}</v-alert>

    <!-- Empty state -->
    <div v-if="!loading && books.length === 0" class="px-6 pt-16 pb-8">
      <p class="font-heading text-3xl font-bold text-text-primary mb-3">Nothing here yet.</p>
      <p class="text-sm text-text-secondary leading-relaxed">
        Tap the button below to scan your first barcode.
      </p>
    </div>

    <!-- Book list -->
    <div v-if="books.length > 0" class="pb-28">
      <div
        v-for="book in books"
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
          <div class="font-heading text-base font-bold text-text-primary leading-snug line-clamp-2 mb-1">
            {{ book.title || "Unknown Title" }}
          </div>
          <div class="text-xs text-text-secondary mb-2">
            {{ book.author || "Unknown Author" }}
          </div>
          <div class="text-[10px] text-text-secondary font-mono tracking-wide">
            {{ book.isbn }}
          </div>
        </div>

        <!-- Delete -->
        <v-btn
          icon="mdi-delete-outline"
          variant="text"
          color="primary"
          size="x-small"
          class="flex-shrink-0 mt-0.5"
          @click="deleteBook(book.id)"
        />
      </div>
    </div>

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
  </div>
</template>

<script lang="ts" setup>
import { ref, onMounted } from "vue";
import { useAuthStore } from "@/stores/auth";
import { useThemeStore } from "@/stores/theme";

const authStore = useAuthStore();
const themeStore = useThemeStore();

interface Book {
  id: number;
  isbn: string;
  title: string;
  author: string;
  cover_url: string;
  created_at: string;
}

const books = ref<Book[]>([]);
const loading = ref(true);
const error = ref("");
const API_BASE = import.meta.env.VITE_API_URL || "";

const fetchBooks = async () => {
  try {
    loading.value = true;
    const res = await fetch(`${API_BASE}/api/scans`, {
      headers: {
        Authorization: `Bearer ${authStore.token}`,
      },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to fetch books");
    books.value = data;
  } catch (err: any) {
    error.value = err.message;
  } finally {
    loading.value = false;
  }
};

const deleteBook = async (id: number) => {
  if (!confirm("Are you sure you want to delete this scan?")) return;

  try {
    const res = await fetch(`${API_BASE}/api/scans/${id}`, {
      method: "DELETE",
      headers: {
        Authorization: `Bearer ${authStore.token}`,
      },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to delete book");

    books.value = books.value.filter((b) => b.id !== id);
  } catch (err: any) {
    alert(err.message);
  }
};

onMounted(() => {
  fetchBooks();
});
</script>
