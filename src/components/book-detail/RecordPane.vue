<template>
  <!-- Mobile only — the tab itself is gated on the breakpoint, because on desktop the masthead
       already carries these three controls inline and this would be a second copy of them. The
       width cap only matters in the sliver where `matchMedia` and the CSS disagree. -->
  <div class="w-full md:max-w-md">
    <RecordControls
      :book="book"
      @set-status="$emit('set-status', $event)"
      @set-owning-status="$emit('set-owning-status', $event)"
      @set-rating="$emit('set-rating', $event)"
    />
  </div>
</template>

<script lang="ts" setup>
import RecordControls from "@/components/book-detail/RecordControls.vue";
import type { Book, OwningStatus, ReadStatus } from "@/types/book";

// The three things the user sets about a book, on mobile, where the masthead can't hold them.
// Their custom field *values* used to be listed here too; they are the third ledger of the Details
// pane now, beside the edition and work facts, so they aren't shown twice in the All view. Editing
// all of them — values and metadata overrides alike — happens behind "Edit fields", which sits in
// that pane too, beside the ledgers it writes to.
defineProps<{
  book: Book;
}>();

defineEmits<{
  "set-status": [status: ReadStatus];
  "set-owning-status": [status: OwningStatus];
  "set-rating": [rating: number | null];
}>();
</script>
