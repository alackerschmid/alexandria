<template>
  <div class="max-w-lg mx-auto px-6 py-10">
    <!-- title -->
    <input
      v-model="form.title"
      :aria-label="$t('scanner.title_label')"
      class="w-full bg-transparent font-heading text-xl font-bold text-text-primary leading-snug mb-2 border-b border-charcoal-border pb-1 focus-ring-none focus:border-orange-neon"
      :placeholder="book.isbn"
    />
    <div class="text-sm text-text-secondary/60 mb-6">
      {{ authorDisplayName(book) || $t("book.unknown_author") }}
    </div>

    <div class="flex flex-col gap-4">
      <div>
        <label
          for="edit-description"
          class="text-[10px] text-text-secondary/60 tracking-[0.2em] uppercase mb-1 block"
        >
          {{ $t("detail.description") }}
        </label>
        <textarea
          id="edit-description"
          v-model="form.description"
          rows="4"
          class="w-full bg-charcoal border border-charcoal-border text-xs text-text-primary px-3 py-2 resize-none focus-ring-none focus:border-orange-neon"
        />
      </div>
      <div class="grid grid-cols-2 gap-4">
        <div>
          <label
            for="edit-publisher"
            class="text-[10px] text-text-secondary/60 tracking-[0.2em] uppercase mb-1 block"
          >
            {{ $t("detail.publisher") }}
          </label>
          <input
            id="edit-publisher"
            v-model="form.publisher"
            class="w-full bg-charcoal border border-charcoal-border text-xs text-text-primary px-3 py-2 focus-ring-none focus:border-orange-neon"
          />
        </div>
        <div>
          <label
            for="edit-language"
            class="text-[10px] text-text-secondary/60 tracking-[0.2em] uppercase mb-1 block"
          >
            {{ $t("detail.language") }}
          </label>
          <input
            id="edit-language"
            v-model="form.language"
            class="w-full bg-charcoal border border-charcoal-border text-xs text-text-primary px-3 py-2 focus-ring-none focus:border-orange-neon"
          />
        </div>
        <div>
          <label
            for="edit-publish-date"
            class="text-[10px] text-text-secondary/60 tracking-[0.2em] uppercase mb-1 block"
          >
            {{ $t("detail.published") }}
          </label>
          <input
            id="edit-publish-date"
            v-model="form.publish_date"
            class="w-full bg-charcoal border border-charcoal-border text-xs text-text-primary px-3 py-2 focus-ring-none focus:border-orange-neon"
          />
        </div>
        <div>
          <label
            for="edit-pages"
            class="text-[10px] text-text-secondary/60 tracking-[0.2em] uppercase mb-1 block"
          >
            {{ $t("detail.pages") }}
          </label>
          <input
            id="edit-pages"
            v-model.number="form.number_of_pages_median"
            type="number"
            min="1"
            class="w-full bg-charcoal border border-charcoal-border text-xs text-text-primary px-3 py-2 focus-ring-none focus:border-orange-neon"
          />
        </div>
      </div>
      <div>
        <label
          for="edit-cover-url"
          class="text-[10px] text-text-secondary/60 tracking-[0.2em] uppercase mb-1 block"
        >
          {{ $t("detail.cover_url") }}
        </label>
        <input
          id="edit-cover-url"
          v-model="form.cover_url"
          class="w-full bg-charcoal border border-charcoal-border text-xs text-text-primary px-3 py-2 focus-ring-none focus:border-orange-neon"
        />
      </div>

      <p
        v-if="saveError"
        class="text-[10px] text-error tracking-widest uppercase"
      >
        {{ $t("detail.edit_error") }}
      </p>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Book } from "@/types/book";
import { authorDisplayName } from "@/utils/book-display";

// The editable override fields. The model object is owned by the parent
// (which performs the save + override-flag computation); this component is
// presentational and edits the fields via v-model.
export interface EditForm {
  title: string;
  cover_url: string;
  language: string;
  publish_date: string;
  number_of_pages_median: number | null;
  description: string;
  publisher: string;
}

const form = defineModel<EditForm>("form", { required: true });

defineProps<{
  book: Pick<Book, "isbn" | "author" | "authors">;
  saveError: boolean;
}>();
</script>
