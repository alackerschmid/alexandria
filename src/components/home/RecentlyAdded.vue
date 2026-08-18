<template>
  <!-- Bleeds to the viewport edge on mobile so the strip reads as scrollable rather than as a
       row that happens to be clipped; the page's own gutter is restored as padding. -->
  <div
    class="flex gap-3 md:gap-4 overflow-x-auto -mx-6 px-6 md:mx-0 md:px-0 pb-1"
  >
    <router-link
      v-for="book in books"
      :key="book.isbn"
      :to="libraryDetailLink(book.work_id, book.isbn)"
      :title="book.title ?? undefined"
      class="w-21.5 md:w-26 flex-none group"
    >
      <div class="aspect-2/3 overflow-hidden bg-charcoal-light">
        <!-- CoverImage, not LibraryCoverCard: that card carries status dots, owning badges and
             novella markers, none of which this row is about. -->
        <CoverImage
          :cover-url="book.cover_url"
          :object-key="book.cover_object_key"
          :title="book.title"
          :alt="book.title ?? ''"
          text-class="text-[20px]"
          :icon-size="20"
          class="w-full h-full object-cover group-hover:opacity-80 transition-opacity"
        />
      </div>
      <p class="mt-1.5 text-[11px] leading-tight text-text-secondary truncate">
        {{ book.title ?? $t("series.untitled") }}
      </p>
    </router-link>
  </div>
</template>

<script lang="ts" setup>
import CoverImage from "@/components/CoverImage.vue";
import { libraryDetailLink } from "@/utils/book-link";
import type { Book } from "@/types/book";

defineProps<{ books: Book[] }>();
</script>
