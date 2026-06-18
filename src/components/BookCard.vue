<template>
  <article
    class="flex flex-col px-6 md:px-0 pt-5 pb-2 border-b border-charcoal-border cursor-pointer"
    @click="$emit('select')"
  >
    <!-- Cover + title / author / status -->
    <div class="flex flex-row items-start gap-4">
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

      <!-- Title / author / status -->
      <div class="flex-1 min-w-0 mt-0.5">
        <div
          class="font-heading text-base font-bold text-text-primary leading-snug line-clamp-2 mb-1"
        >
          {{ book.title || book.isbn }}
        </div>
        <div class="text-xs text-text-secondary mb-2">
          {{ book.author || "Unknown Author" }}
        </div>
        <button
          class="flex items-center gap-1 text-[10px] tracking-[0.15em] uppercase transition-colors"
          :class="STATUS_CONFIG[book.status].class"
          @click.stop="$emit('cycle-status')"
        >
          <v-icon :icon="STATUS_CONFIG[book.status].icon" size="10" />
          {{ STATUS_CONFIG[book.status].label }}
        </button>
      </div>

      <!-- Delete -->
      <v-btn
        icon="mdi-delete-outline"
        variant="text"
        color="primary"
        size="x-small"
        class="shrink-0 mt-0.5"
        @click.stop="$emit('delete')"
      />
    </div>

    <!-- Added on (below cover + info, left aligned) -->
    <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
      <div class="text-[10px] text-text-secondary/50 font-mono tracking-wide">
        ADDED ON {{ book.created_at }}
      </div>
      <div
        v-if="book.number_of_pages_median"
        class="text-[10px] text-text-secondary/50 font-mono tracking-wide"
      >
        {{ book.number_of_pages_median }} pages
      </div>
    </div>
  </article>
</template>

<script lang="ts" setup>
export type ReadStatus = "unread" | "reading" | "read";

export interface Book {
  id: number;
  isbn: string;
  title: string | null;
  author: string | null;
  cover_url: string | null;
  status: ReadStatus;
  created_at: string;
  language?: string | null;
  publish_date?: string | null;
  number_of_pages_median?: number | null;
  description?: string | null;
  publisher?: string | null;
}

defineProps<{ book: Book }>();
defineEmits<{ "cycle-status": []; delete: []; select: [] }>();

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
