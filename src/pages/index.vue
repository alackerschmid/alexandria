<template>
  <div class="bg-charcoal min-h-screen px-4 pt-8 pb-24">
    <div class="flex justify-between items-center mb-8 px-1">
      <div>
        <p class="text-xs text-text-secondary tracking-widest uppercase mb-1">Library</p>
        <h1 class="text-2xl font-semibold text-text-primary leading-tight">Your Books</h1>
      </div>
      <v-btn
        icon="mdi-logout"
        variant="text"
        color="primary"
        size="small"
        @click="authStore.logout()"
      />
    </div>

    <v-progress-circular
      v-if="loading"
      indeterminate
      color="primary"
      class="mx-auto block mt-16"
    />

    <v-alert
      v-if="error"
      type="error"
      variant="tonal"
      rounded="sm"
      class="mb-6"
    >{{ error }}</v-alert>

    <div
      v-if="!loading && books.length === 0"
      class="text-center mt-24 px-8"
    >
      <p class="text-text-primary font-medium mb-2">No books yet</p>
      <p class="text-sm text-text-secondary leading-relaxed">
        Tap the camera button below to scan your first barcode.
      </p>
    </div>

    <div v-if="books.length > 0" class="space-y-2">
      <div
        v-for="book in books"
        :key="book.id"
        class="bg-charcoal-light border border-charcoal-border rounded-md p-3 flex items-start gap-3"
      >
        <img
          v-if="book.cover_url"
          :src="book.cover_url"
          class="w-10 h-14 object-cover rounded flex-shrink-0"
        />
        <div
          v-else
          class="w-10 h-14 rounded bg-charcoal border border-charcoal-border flex items-center justify-center flex-shrink-0"
        >
          <v-icon icon="mdi-book-outline" size="18" color="text-secondary" />
        </div>

        <div class="flex-1 min-w-0 mt-0.5">
          <div class="font-medium text-text-primary leading-snug line-clamp-2 text-sm">
            {{ book.title || "Unknown Title" }}
          </div>
          <div class="text-xs text-text-secondary mt-1">
            {{ book.author || "Unknown Author" }}
          </div>
          <div class="text-xs text-text-secondary mt-0.5 font-mono">
            {{ book.isbn }}
          </div>
        </div>

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

    <v-btn
      color="primary"
      size="x-large"
      icon="mdi-camera"
      class="fixed bottom-8 right-6 z-50 rounded-full"
      elevation="0"
      @click="$router.push('/scanner')"
    />
  </div>
</template>

<script lang="ts" setup>
import { ref, onMounted } from "vue";
import { useAuthStore } from "@/stores/auth";

const authStore = useAuthStore();

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
