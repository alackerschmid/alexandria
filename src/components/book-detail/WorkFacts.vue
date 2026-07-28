<template>
  <div>
    <div v-if="book.original_pub_date" class="fact-row">
      <span class="fact-label">{{ $t("detail.original_pub_date") }}</span>
      <span class="fact-value">{{ book.original_pub_date }}</span>
    </div>

    <div v-if="book.form_of_work" class="fact-row">
      <span class="fact-label">{{ $t("detail.form_of_work") }}</span>
      <button
        class="fact-value hover:text-orange-neon transition-colors text-right"
        :aria-label="
          $t('detail.filter_by', {
            field: $t('detail.form_of_work'),
            value: book.form_of_work,
          })
        "
        @click="$emit('filter', 'form', book.form_of_work!)"
      >
        {{ book.form_of_work }}
      </button>
    </div>

    <div v-if="book.language_of_work" class="fact-row">
      <span class="fact-label">{{ $t("detail.language_of_work") }}</span>
      <button
        class="fact-value hover:text-orange-neon transition-colors text-right"
        :aria-label="
          $t('detail.filter_by', {
            field: $t('detail.language_of_work'),
            value: book.language_of_work,
          })
        "
        @click="$emit('filter', 'original_language', book.language_of_work!)"
      >
        {{ book.language_of_work }}
      </button>
    </div>

    <div v-if="book.countries_of_origin?.length" class="fact-row">
      <span class="fact-label">{{ $t("detail.countries_of_origin") }}</span>
      <span class="fact-value text-right flex flex-wrap justify-end gap-x-1.5">
        <template v-for="(c, i) in book.countries_of_origin" :key="c">
          <button
            class="hover:text-orange-neon transition-colors"
            :aria-label="
              $t('detail.filter_by', {
                field: $t('detail.countries_of_origin'),
                value: c,
              })
            "
            @click="$emit('filter', 'country', c)"
          >
            {{ c }}</button
          ><span
            v-if="i < book.countries_of_origin!.length - 1"
            class="text-text-secondary/40"
            >·</span
          >
        </template>
      </span>
    </div>

    <div v-if="book.main_subject" class="fact-row">
      <span class="fact-label">{{ $t("detail.main_subject") }}</span>
      <span class="fact-value text-right">{{ book.main_subject }}</span>
    </div>

    <div v-if="book.narrative_locations?.length" class="fact-row">
      <span class="fact-label">{{ $t("detail.narrative_locations") }}</span>
      <span class="fact-value text-right flex flex-wrap justify-end gap-x-1.5">
        <template v-for="(loc, i) in book.narrative_locations" :key="loc">
          <button
            class="hover:text-orange-neon transition-colors"
            :aria-label="
              $t('detail.filter_by', {
                field: $t('detail.narrative_locations'),
                value: loc,
              })
            "
            @click="$emit('filter', 'location', loc)"
          >
            {{ loc }}</button
          ><span
            v-if="i < book.narrative_locations!.length - 1"
            class="text-text-secondary/40"
            >·</span
          >
        </template>
      </span>
    </div>

    <!-- Recognition stays a disclosure: award lists run long and are the least-consulted fact
         here, but the count alone still answers "did this win anything". -->
    <div v-if="recognitionCount" class="fact-row">
      <button
        class="w-full flex items-baseline justify-between gap-4"
        :aria-expanded="expanded"
        @click="expanded = !expanded"
      >
        <span class="fact-label">{{ $t("detail.recognition") }}</span>
        <span class="fact-value flex items-center gap-1">
          {{ recognitionCount }}
          <v-icon
            :icon="expanded ? 'mdi-chevron-up' : 'mdi-chevron-down'"
            size="14"
          />
        </span>
      </button>
      <div v-if="expanded" class="mt-3 flex flex-col gap-3 w-full">
        <div v-if="book.awards?.length">
          <div class="fact-label mb-1.5 block">{{ $t("detail.awards") }}</div>
          <div
            class="text-sm text-text-primary leading-relaxed flex flex-wrap items-baseline gap-x-1.5"
          >
            <template v-for="(a, i) in book.awards" :key="a">
              <button
                class="hover:text-orange-neon transition-colors text-left"
                :aria-label="
                  $t('detail.filter_by', {
                    field: $t('detail.awards'),
                    value: a,
                  })
                "
                @click="$emit('filter', 'award', a)"
              >
                {{ a }}</button
              ><span
                v-if="i < book.awards!.length - 1"
                class="text-text-secondary/40"
                >·</span
              >
            </template>
          </div>
        </div>
        <div v-if="book.nominations?.length">
          <div class="fact-label mb-1.5 block">
            {{ $t("detail.nominations") }}
          </div>
          <div
            class="text-sm text-text-primary leading-relaxed flex flex-wrap items-baseline gap-x-1.5"
          >
            <template v-for="(a, i) in book.nominations" :key="a">
              <button
                class="hover:text-orange-neon transition-colors text-left"
                :aria-label="
                  $t('detail.filter_by', {
                    field: $t('detail.nominations'),
                    value: a,
                  })
                "
                @click="$emit('filter', 'award', a)"
              >
                {{ a }}</button
              ><span
                v-if="i < book.nominations!.length - 1"
                class="text-text-secondary/40"
                >·</span
              >
            </template>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed, ref, watch } from "vue";
import type { Book } from "@/types/book";

// The work's Wikidata facts as one ledger column, beside the edition's own in DetailsPane. These
// used to be interleaved with the user's status/rating in a single "Your record" rail, which made
// eleven near-identical rows out of two unrelated things — read-only catalogue data on one side,
// the four things the user decides on the other.
const props = defineProps<{ book: Book }>();

defineEmits<{
  filter: [
    field: "form" | "original_language" | "location" | "country" | "award",
    value: string,
  ];
}>();

const expanded = ref(false);

const recognitionCount = computed(
  () => (props.book.awards?.length ?? 0) + (props.book.nominations?.length ?? 0),
);

watch(() => props.book.isbn, () => (expanded.value = false));
</script>

<style scoped>
.fact-row {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.25rem 1rem;
  padding: 0.7rem 0;
  border-bottom: 1px solid var(--color-charcoal-border);
}
.fact-label {
  flex-shrink: 0;
  font-size: 11px;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--color-text-secondary);
}
.fact-value {
  font-family: var(--font-mono);
  font-size: 12px;
  color: var(--color-text-primary);
}
</style>
