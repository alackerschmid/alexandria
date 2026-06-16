<template>
  <div class="bg-charcoal min-h-screen px-4 py-6">
    <div class="flex justify-between items-center mb-6">
      <h1 class="text-3xl font-bold text-text-primary">Your Books</h1>
      <v-btn
        icon="mdi-logout"
        variant="text"
        color="primary"
        @click="authStore.logout()"
      />
    </div>

    <!-- Error/Loading states -->
    <v-progress-circular
      v-if="loading"
      indeterminate
      color="primary"
      class="mx-auto block mt-10"
    ></v-progress-circular>
    <v-alert
      v-if="error"
      type="error"
      variant="tonal"
      class="mb-4 rounded-none"
      >{{ error }}</v-alert
    >

    <div
      v-if="!loading && books.length === 0"
      class="text-center text-text-secondary mt-10"
    >
      <p>No books scanned yet.</p>
      <p class="mt-2 text-sm">
        Tap the camera icon to start scanning barcodes.
      </p>
    </div>

    <v-list
      v-if="books.length > 0"
      bg-color="charcoal"
      class="divide-y divide-charcoal-border rounded-none"
    >
      <v-list-item v-for="book in books" :key="book.id" class="py-3">
        <div class="flex justify-between w-full items-start">
          <div class="flex gap-4 flex-1">
            <img
              v-if="book.cover_url"
              :src="book.cover_url"
              class="w-12 h-16 object-cover bg-charcoal-light border border-charcoal-border"
            />
            <div
              v-else
              class="w-12 h-16 bg-charcoal-light border border-charcoal-border flex items-center justify-center"
            >
              <span
                class="text-xs text-text-secondary text-center leading-tight"
                >No Cover</span
              >
            </div>

            <div class="flex-1 mt-1">
              <div
                class="font-semibold text-text-primary leading-tight line-clamp-2"
              >
                {{ book.title || "Unknown Title" }}
              </div>
              <div class="text-xs text-text-secondary mt-1">
                {{ book.author || "Unknown Author" }} • {{ book.isbn }}
              </div>
            </div>
          </div>
          <v-btn
            icon="mdi-delete"
            variant="text"
            color="primary"
            size="small"
            class="self-center ml-2"
            @click="deleteBook(book.id)"
          />
        </div>
      </v-list-item>
    </v-list>

    <!-- Floating action button to scan again -->
    <v-btn
      fab
      color="primary"
      size="x-large"
      icon="mdi-camera"
      class="fixed bottom-8 right-8 z-50 rounded-full elevation-4"
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
