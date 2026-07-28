<template>
  <div>
    <div class="flex flex-col md:flex-row gap-10 md:gap-16 items-start">
      <div class="flex-1 min-w-0 w-full">
        <div class="pane-label mb-3.5">{{ $t("detail.this_edition") }}</div>
        <EditionDetails :book="book" />
      </div>
      <div v-if="workFacts" class="flex-1 min-w-0 w-full">
        <div class="pane-label mb-3.5">{{ $t("detail.the_work") }}</div>
        <WorkFacts
          :book="book"
          @filter="(field, value) => $emit('filter', field, value)"
        />
      </div>
    </div>

    <!-- Manual enrichment retry. Out of the top bar (where it was one unlabelled icon among four)
         and down here beside the facts it actually repopulates — it is the only way for a user to
         retry a work whose Wikidata lookup failed, so it can't simply go away. -->
    <div v-if="!guest && !readonly" class="mt-8">
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
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed } from "vue";
import EditionDetails from "@/components/book-detail/EditionDetails.vue";
import WorkFacts from "@/components/book-detail/WorkFacts.vue";
import { workFactCount } from "@/utils/detail-tabs";
import type { BookWithOverrides } from "@/types/book";

// Every catalogue fact in one place, as two ledgers: what is true of *this copy* and what is true
// of *the work*. They used to be split by nothing but position — edition facts under the cover,
// work facts in the right rail — which is why neither read as a list.
const props = defineProps<{
  book: BookWithOverrides;
  refreshing?: boolean;
  guest?: boolean;
  readonly?: boolean;
}>();

defineEmits<{
  filter: [
    field: "form" | "original_language" | "location" | "country" | "award",
    value: string,
  ];
  refresh: [];
}>();

const workFacts = computed(() => workFactCount(props.book) > 0);

const refreshClass = computed(() => {
  if (props.book.enrichment_status === "failed")
    return "text-error/70 hover:text-error";
  if (props.book.enrichment_status === "pending")
    return "text-orange-neon/50 hover:text-orange-neon";
  return "text-text-secondary hover:text-text-primary";
});
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
