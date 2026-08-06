<template>
  <div>
    <div class="flex flex-col md:flex-row gap-10 md:gap-16 items-start">
      <div class="flex-1 min-w-0 w-full">
        <div class="micro-label mb-3.5">{{ $t("detail.this_edition") }}</div>
        <EditionDetails :book="book" />
      </div>
      <div v-if="workFacts" class="flex-1 min-w-0 w-full">
        <div class="micro-label mb-3.5">{{ $t("detail.the_work") }}</div>
        <WorkFacts
          :book="book"
          @filter="(field, value) => $emit('filter', field, value)"
        />
      </div>
      <!-- The third ledger: what *you* recorded about it. Read-only here like the other two —
           "Edit fields" in the footer below is the one way in. Guests have no custom fields,
           and a readonly edition isn't the user's to have recorded anything about, so both get
           the two catalogue columns only. -->
      <div v-if="ownRecord" class="flex-1 min-w-0 w-full">
        <div class="micro-label mb-3.5">{{ $t("detail.custom_fields") }}</div>
        <CustomFacts
          v-if="fieldDefsStore.defs.length"
          :book="book"
          :defs="fieldDefsStore.defs"
        />
        <p v-else class="text-sm text-text-secondary/70 italic">
          {{ $t("detail.custom_fields_empty") }}
        </p>
      </div>
    </div>

    <!-- The two ways to change what this pane shows, side by side: pull the catalogue's answer
         again, or write your own. Both belong here rather than in the top bar or the masthead —
         every field either one touches is in a ledger directly above them.
         Refresh is the only user-facing retry for a work whose Wikidata lookup failed, so it
         can't simply go away. -->
    <div v-if="ownRecord" class="mt-8 flex items-center gap-4">
      <EditFieldsButton @click="$emit('edit')" />
      <button
        class="flex items-center gap-2 text-[10px] tracking-[0.18em] uppercase transition-colors disabled:opacity-30"
        :class="refreshClass"
        :disabled="refreshing"
        @click="$emit('refresh')"
      >
        <v-icon
          icon="mdi-refresh"
          size="14"
          :class="refreshing ? 'animate-spin' : ''"
        />
        {{ refreshing ? $t("detail.loading") : $t("detail.refresh") }}
      </button>
      <span v-if="refreshError" class="text-[11px] text-red-400">
        {{ $t(refreshError) }}
      </span>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed } from "vue";
import { useFieldDefsStore } from "@/stores/fieldDefs";
import EditionDetails from "@/components/book-detail/EditionDetails.vue";
import WorkFacts from "@/components/book-detail/WorkFacts.vue";
import CustomFacts from "@/components/book-detail/CustomFacts.vue";
import EditFieldsButton from "@/components/book-detail/EditFieldsButton.vue";
import { workFactCount } from "@/utils/detail-tabs";
import type { BookWithOverrides } from "@/types/book";

// Every fact in one place, as three ledgers: what is true of *this copy*, what is true of *the
// work*, and what *you* recorded. The first two used to be split by nothing but position — edition
// facts under the cover, work facts in the right rail — which is why neither read as a list.
const props = defineProps<{
  book: BookWithOverrides;
  refreshing?: boolean;
  /** i18n key of the last refresh failure, or null. Refresh is the only user-facing retry for a
   *  failed enrichment, so a silent failure leaves the user with nothing to act on. */
  refreshError?: string | null;
  guest?: boolean;
  readonly?: boolean;
}>();

defineEmits<{
  filter: [
    field: "form" | "original_language" | "location" | "country" | "award",
    value: string,
  ];
  refresh: [];
  /** Into the unified edit screen — this pane is where everything it writes is displayed. */
  edit: [];
}>();

const fieldDefsStore = useFieldDefsStore();

// The two parts of this pane that are about *the user's* copy rather than the catalogue: the
// custom-field column and the enrichment retry. Guests have neither, and a readonly edition isn't
// theirs to have recorded anything about or to spend a lookup on. `BookDetail.customFieldCount`
// mirrors this for the collapsed section summary — keep the two in step.
const ownRecord = computed(() => !props.guest && !props.readonly);

const workFacts = computed(() => workFactCount(props.book) > 0);

const refreshClass = computed(() => {
  if (props.book.enrichment_status === "failed")
    return "text-error/70 hover:text-error";
  if (props.book.enrichment_status === "pending")
    return "text-orange-neon/50 hover:text-orange-neon";
  return "text-text-secondary hover:text-text-primary";
});
</script>
