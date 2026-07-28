<template>
  <div class="max-w-lg mx-auto px-6 py-10 pb-16">
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

    </div>

    <!-- Custom fields sit in the same form, behind the same Save: they are as much "the record"
         as the overrides above, and splitting them across two save models was what made the old
         panel commit silently on blur while this half waited for a button. -->
    <div
      v-if="!guest && fieldDefsStore.defs.length"
      class="mt-9 pt-8 border-t border-charcoal-border"
    >
      <div
        class="text-[10px] tracking-[0.24em] uppercase text-text-secondary/60 mb-4"
      >
        {{ $t("detail.custom_fields") }}
      </div>
      <CustomFieldsPanel
        v-model:values="customValues"
        @refreshed="$emit('tag-deleted')"
      />
    </div>

    <p
      v-if="saveError"
      class="text-[10px] text-error tracking-widest uppercase mt-6"
    >
      {{ $t("detail.edit_error") }}
    </p>
  </div>
</template>

<script setup lang="ts">
import type { Book } from "@/types/book";
import type { CustomFieldModel } from "@/utils/custom-fields";
import { authorDisplayName } from "@/utils/book-display";
import { useFieldDefsStore } from "@/stores/fieldDefs";
import CustomFieldsPanel from "@/components/book-detail/CustomFieldsPanel.vue";

// **One screen with every editable field**: the per-user metadata overrides and the user's own
// custom fields. Both models are owned by the parent, which performs the two saves and the
// override-flag computation; this component is presentational.
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
const customValues = defineModel<CustomFieldModel>("customValues", {
  required: true,
});

defineProps<{
  book: Pick<Book, "isbn" | "author" | "authors">;
  saveError: boolean;
  guest?: boolean;
}>();

defineEmits<{
  /** A tag was deleted from every book in the library — an immediate server action, not part of
   *  this form's draft, so the parent has to reconcile the book it holds. */
  "tag-deleted": [];
}>();

const fieldDefsStore = useFieldDefsStore();
</script>
