<template>
  <div class="max-w-[28rem]">
    <!-- On desktop these same controls live in the masthead beside the title; here they are the
         only copy, so every target is a full-width row clearing 44px. -->
    <RecordControls
      class="md:hidden mb-8"
      :book="book"
      :guest="guest"
      @set-status="$emit('set-status', $event)"
      @set-owning-status="$emit('set-owning-status', $event)"
      @set-rating="$emit('set-rating', $event)"
      @edit="$emit('edit')"
    />

    <div v-if="!guest && fieldDefsStore.defs.length">
      <div class="pane-label mb-3.5">{{ $t("detail.custom_fields") }}</div>
      <div
        v-for="def in fieldDefsStore.defs"
        :key="def.id"
        class="flex items-baseline justify-between gap-4 py-3 border-b border-charcoal-border/50"
      >
        <span
          class="shrink-0 text-[11px] tracking-[0.06em] uppercase text-text-secondary"
          >{{ def.name }}</span
        >
        <span
          class="font-mono text-xs text-right"
          :class="displayValue(def) ? 'text-text-primary' : 'text-text-secondary/50'"
        >
          {{ displayValue(def) || "—" }}
        </span>
      </div>
      <button
        class="hidden md:flex mt-5 items-center gap-2 border border-control-border px-3.5 py-2.5 text-[10px] tracking-[0.13em] uppercase text-text-primary hover:border-orange-neon transition-colors"
        @click="$emit('edit')"
      >
        <v-icon icon="mdi-pencil-outline" size="13" />
        {{ $t("detail.edit_fields") }}
      </button>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { useFieldDefsStore, type FieldDef } from "@/stores/fieldDefs";
import { bookCustomValue } from "@/utils/custom-fields";
import { parseTagList } from "@/utils/tags";
import RecordControls from "@/components/book-detail/RecordControls.vue";
import type { Book, OwningStatus, ReadStatus } from "@/types/book";

// Everything about this book that is *yours*: the four controls (on mobile, where the masthead
// can't hold them) and your custom field values. Values are read-only here — editing all of them,
// alongside the metadata overrides, happens on the one edit screen behind "Edit fields".
const props = defineProps<{
  book: Book;
  guest?: boolean;
}>();

defineEmits<{
  "set-status": [status: ReadStatus];
  "set-owning-status": [status: OwningStatus];
  "set-rating": [rating: number | null];
  edit: [];
}>();

const fieldDefsStore = useFieldDefsStore();

function displayValue(def: FieldDef): string {
  const raw = bookCustomValue(props.book, def.id);
  if (def.type === "tag") return parseTagList(raw).join(", ");
  return raw ?? "";
}
</script>

<style scoped>
.pane-label {
  font-size: 10px;
  letter-spacing: 0.24em;
  text-transform: uppercase;
  color: var(--color-text-secondary);
  opacity: 0.75;
}
</style>
