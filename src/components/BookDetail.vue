<template>
  <v-dialog
    :model-value="modelValue"
    max-width="560"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <div
      class="bg-charcoal-light border border-charcoal-border flex flex-col max-h-[90vh]"
    >
      <!-- Header -->
      <div class="flex items-start gap-4 p-6">
        <img
          v-if="book.cover_url"
          :src="book.cover_url"
          class="w-16 h-24 object-cover shrink-0"
        />
        <div
          v-else
          class="w-16 h-24 bg-charcoal border border-charcoal-border flex items-center justify-center shrink-0"
        >
          <v-icon icon="mdi-book-outline" size="24" color="primary" />
        </div>
        <div class="flex-1 min-w-0">
          <div
            class="font-heading text-xl font-bold text-text-primary leading-snug mb-1"
          >
            {{ book.title || book.isbn }}
          </div>
          <div class="text-sm text-text-secondary mb-3">
            {{ book.author || "Unknown Author" }}
          </div>
          <button
            class="flex items-center gap-1 text-[10px] tracking-[0.15em] uppercase transition-colors"
            :class="STATUS_CONFIG[book.status].class"
            @click="$emit('cycle-status')"
          >
            <v-icon :icon="STATUS_CONFIG[book.status].icon" size="10" />
            {{ STATUS_CONFIG[book.status].label }}
          </button>
        </div>
        <div class="flex items-center gap-1 shrink-0">
          <button
            class="text-text-secondary/50 hover:text-text-secondary transition-colors disabled:opacity-30"
            :disabled="refreshing"
            @click="refresh"
          >
            <v-icon icon="mdi-refresh" size="18" :class="refreshing ? 'animate-spin' : ''" />
          </button>
          <button
            class="text-text-secondary/50 hover:text-text-secondary transition-colors"
            @click="$emit('update:modelValue', false)"
          >
            <v-icon icon="mdi-close" size="18" />
          </button>
        </div>
      </div>

      <!-- Scrollable body -->
      <div class="overflow-y-auto flex-1">
        <div
          v-if="book.description"
          class="border-t border-charcoal-border px-6 py-4 cursor-pointer"
          @click="descriptionExpanded = !descriptionExpanded"
        >
          <p
            class="text-xs text-text-secondary leading-relaxed transition-all"
            :class="descriptionExpanded ? '' : 'line-clamp-2'"
          >
            {{ book.description }}
          </p>
          <span
            class="text-[10px] text-text-secondary/50 tracking-[0.15em] uppercase mt-2 inline-block"
          >
            {{ descriptionExpanded ? "Show less" : "Show more" }}
          </span>
        </div>

        <div
          class="border-t border-charcoal-border px-6 py-4 grid grid-cols-2 gap-y-4"
        >
          <div v-if="book.publisher">
            <div
              class="text-[10px] text-text-secondary/60 tracking-[0.2em] uppercase mb-1"
            >
              Publisher
            </div>
            <div class="text-xs text-text-primary">{{ book.publisher }}</div>
          </div>
          <div v-if="book.language">
            <div
              class="text-[10px] text-text-secondary/60 tracking-[0.2em] uppercase mb-1"
            >
              Language
            </div>
            <div class="text-xs text-text-primary uppercase">
              {{ book.language }}
            </div>
          </div>
          <div v-if="book.publish_date">
            <div
              class="text-[10px] text-text-secondary/60 tracking-[0.2em] uppercase mb-1"
            >
              Published
            </div>
            <div class="text-xs text-text-primary">{{ book.publish_date }}</div>
          </div>
          <div v-if="book.number_of_pages_median">
            <div
              class="text-[10px] text-text-secondary/60 tracking-[0.2em] uppercase mb-1"
            >
              Pages
            </div>
            <div class="text-xs text-text-primary">
              {{ book.number_of_pages_median }}
            </div>
          </div>
          <div class="col-span-2">
            <div
              class="text-[10px] text-text-secondary/60 tracking-[0.2em] uppercase mb-1"
            >
              ISBN
            </div>
            <div class="text-xs text-text-primary font-mono">
              {{ book.isbn }}
            </div>
          </div>
        </div>
      </div>

      <!-- Footer actions -->
      <div
        class="border-t border-charcoal-border flex justify-between items-center px-4 py-3"
      >
        <v-btn
          variant="text"
          size="small"
          class="text-[10px] tracking-[0.2em] uppercase text-text-secondary"
          @click="$emit('update:modelValue', false)"
        >
          Close
        </v-btn>
        <v-btn
          variant="text"
          size="small"
          color="error"
          class="text-[10px] tracking-[0.2em] uppercase"
          prepend-icon="mdi-delete-outline"
          @click="$emit('delete')"
        >
          Remove
        </v-btn>
      </div>
    </div>
  </v-dialog>
</template>

<script lang="ts" setup>
import { ref, watch } from "vue";
import { useAuthStore } from "@/stores/auth";
import type { Book, ReadStatus } from "./BookCard.vue";

const props = defineProps<{
  modelValue: boolean;
  book: Book;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  "cycle-status": [];
  delete: [];
  refreshed: [updated: Partial<Book>];
}>();

const descriptionExpanded = ref(false);
const refreshing = ref(false);

watch(() => props.book.isbn, () => { descriptionExpanded.value = false });

const authStore = useAuthStore();
const API_BASE = import.meta.env.VITE_API_URL || "";

const refresh = async () => {
  refreshing.value = true;
  try {
    const res = await fetch(`${API_BASE}/api/books/refresh?isbn=${props.book.isbn}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${authStore.token}` },
    });
    if (!res.ok) throw new Error();
    const updated = await res.json();
    emit("refreshed", updated);
  } finally {
    refreshing.value = false;
  }
};

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
</script>
