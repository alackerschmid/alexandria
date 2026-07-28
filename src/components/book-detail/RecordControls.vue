<template>
  <div :class="inline ? 'flex items-end gap-7' : 'flex flex-col gap-2.5'">
    <!-- reading status -->
    <div :class="inline ? '' : 'w-full'">
      <div v-if="inline" class="record-label mb-2.5">
        {{ $t("library.filter_status") }}
      </div>
      <div
        class="flex border border-control-border"
        :class="inline ? '' : 'w-full'"
        role="radiogroup"
        :aria-label="$t('library.filter_status')"
      >
        <button
          v-for="(s, i) in STATUS_ORDER"
          :key="s"
          type="button"
          role="radio"
          :aria-checked="book.status === s"
          class="text-[9.5px] tracking-[0.12em] uppercase transition-colors"
          :class="[
            inline ? 'px-4 py-2.5' : 'flex-1 py-4 text-center',
            i < STATUS_ORDER.length - 1 ? 'border-r border-control-border' : '',
            book.status === s
              ? 'font-bold'
              : 'text-text-secondary hover:text-text-primary',
          ]"
          :style="book.status === s ? activeSegmentStyle(s) : undefined"
          @click="$emit('set-status', s)"
        >
          {{ statusLabels[s] }}
        </button>
      </div>
    </div>

    <!-- Owning and rating share a row when stacked; `contents` dissolves this wrapper in the
         inline layout so both sit directly in the masthead's own flex row. -->
    <div :class="inline ? 'contents' : 'flex gap-2.5'">
      <!-- owning status — a menu, not a segmented control: five states never fit a track -->
      <div v-if="inline">
        <div class="record-label mb-2.5">{{ $t("owning.label") }}</div>
        <AppSelect
          :model-value="owningStatus"
          :options="owningOptions"
          :aria-label="$t('owning.label')"
          @update:model-value="
            $emit('set-owning-status', $event as OwningStatus)
          "
        />
      </div>
      <div v-else class="flex-1 flex">
        <AppSelect
          block
          :model-value="owningStatus"
          :options="owningOptions"
          :aria-label="$t('owning.label')"
          @update:model-value="
            $emit('set-owning-status', $event as OwningStatus)
          "
        />
      </div>

      <!-- rating — five half-stars, always paired with the number, because stars alone can't
           tell 7 from 8 -->
      <div v-if="inline">
        <div class="record-label mb-2.5">{{ $t("detail.rating") }}</div>
        <div class="flex items-center gap-3 py-2">
          <RatingStars
            :rating="book.rating"
            size="md"
            interactive
            @update:rating="$emit('set-rating', $event)"
          />
          <span class="font-mono text-[13px] text-text-primary">
            {{ book.rating ?? "–"
            }}<span class="text-text-secondary/70">{{
              $t("detail.of_ten")
            }}</span>
          </span>
        </div>
      </div>
      <div
        v-else
        class="flex-1 flex items-center justify-center gap-2.5 h-[46px] border border-control-border"
      >
        <RatingStars
          :rating="book.rating"
          size="md"
          interactive
          @update:rating="$emit('set-rating', $event)"
        />
        <span class="font-mono text-xs text-text-primary">
          {{ book.rating ?? "–"
          }}<span class="text-text-secondary/70">{{ $t("detail.of_ten") }}</span>
        </span>
      </div>
    </div>

    <!-- the whole edit surface: metadata overrides + custom fields, one form -->
    <div v-if="!guest" :class="inline ? '' : 'w-full'">
      <div v-if="inline" class="record-label mb-2.5">
        {{ $t("detail.your_record") }}
      </div>
      <EditFieldsButton
        :block="!inline"
        @click="$emit('edit')"
      />
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed } from "vue";
import {
  useBookStatus,
  STATUS_ORDER,
  STATUS_META,
} from "@/composables/useBookStatus";
import {
  useOwningStatus,
  OWNING_ORDER,
  OWNING_META,
} from "@/composables/useOwningStatus";
import AppSelect from "@/components/AppSelect.vue";
import RatingStars from "@/components/RatingStars.vue";
import EditFieldsButton from "@/components/book-detail/EditFieldsButton.vue";
import type { Book, OwningStatus, ReadStatus } from "@/types/book";

// The four things the user sets about a book, in one component rendered twice: `inline` in the
// desktop masthead (labelled cluster) and stacked in the mobile Record pane (full-width rows, every
// target ≥ 44px). One component rather than two so the behaviour can't drift between breakpoints.
//
// The status control is deliberately not `AppSegmented`: that primitive can't colour an option by
// its value, and reading status is colour-carried everywhere else in the app.
const props = withDefaults(
  defineProps<{
    book: Book;
    /** Masthead layout when true, stacked mobile layout when false. */
    inline?: boolean;
    guest?: boolean;
  }>(),
  { inline: false, guest: false },
);

defineEmits<{
  "set-status": [status: ReadStatus];
  "set-owning-status": [status: OwningStatus];
  "set-rating": [rating: number | null];
  edit: [];
}>();

const { statusLabels } = useBookStatus();
const { owningLabels } = useOwningStatus();

const owningStatus = computed<OwningStatus>(
  () => props.book.owning_status ?? "owned",
);

const owningOptions = computed(() =>
  OWNING_ORDER.map((value) => ({
    value,
    label: owningLabels.value[value],
    dotColor: OWNING_META[value].color,
  })),
);

// Squared and hairline-bordered like the rest of the app — the active segment carries the status
// colour as text, a tint fill and an inset underline, rather than a sliding capsule thumb.
function activeSegmentStyle(status: ReadStatus) {
  const meta = STATUS_META[status];
  return {
    color: meta.color,
    background: meta.tint,
    boxShadow: `inset 0 -2px 0 ${meta.color}`,
  };
}
</script>

<style scoped>
.record-label {
  font-size: 9.5px;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--color-text-secondary);
  opacity: 0.75;
}
</style>
