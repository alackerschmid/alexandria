<template>
  <div>
    <template v-if="book.review">
      <div
        class="flex items-center justify-between gap-4 mb-7 flex-wrap md:flex-nowrap"
      >
        <div class="flex items-center gap-3.5 min-w-0">
          <RatingStars
            v-if="book.rating != null"
            :rating="book.rating"
            size="md"
            class="hidden md:inline-flex"
          />
          <span class="font-mono text-[10.5px] md:text-[11px] text-text-secondary truncate">
            {{ metaLine }}
          </span>
        </div>
        <button
          class="shrink-0 flex items-center gap-1.5 border border-control-border px-3.5 py-2 text-[10px] tracking-[0.16em] uppercase text-text-primary hover:border-orange-neon transition-colors"
          @click="$emit('open-rating')"
        >
          <v-icon icon="mdi-pencil-outline" size="12" />
          {{ $t("detail.edit") }}
        </button>
      </div>

      <MarkdownText :source="book.review" />
    </template>

    <!-- The empty review is the most important state on this page, because it's the one the user
         is meant to act on. It gets the whole pane as an invitation, not a dash in a corner. -->
    <template v-else>
      <h2
        class="font-heading font-bold text-xl md:text-3xl text-text-primary mb-3"
      >
        {{ $t("detail.review_empty_title") }}
      </h2>
      <p class="text-sm md:text-[15px] leading-[1.8] text-text-secondary mb-7">
        {{ $t("detail.review_empty_body") }}
      </p>
      <div class="flex flex-wrap gap-3">
        <AppButton size="sm" @click="$emit('open-rating')">
          {{ $t("detail.review_empty_write") }}
        </AppButton>
        <AppButton
          v-if="book.rating == null"
          variant="secondary"
          size="sm"
          @click="$emit('focus-rating')"
        >
          {{ $t("detail.review_empty_rate") }}
        </AppButton>
      </div>
    </template>
  </div>
</template>

<script lang="ts" setup>
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useLocaleStore } from "@/stores/locale";
import { BCP47 } from "@/plugins/i18n";
import { reviewWordCount, REVIEW_META_MIN_WORDS } from "@/utils/review";
import AppButton from "@/components/AppButton.vue";
import RatingStars from "@/components/RatingStars.vue";
import MarkdownText from "@/components/MarkdownText.vue";
import type { Book } from "@/types/book";

// The review finally gets a reading measure. It used to live in a ~320px rail where a long entry
// physically could not render, so it collapsed to a label and an "Edit" link.
const props = defineProps<{ book: Book }>();

defineEmits<{
  /** Raise the host-owned rating/review dialog (it owns the markdown editor). */
  "open-rating": [];
  /** Send the user to the masthead's star row instead — "rate it first" from the empty state. */
  "focus-rating": [];
}>();

const { t } = useI18n();
const localeStore = useLocaleStore();

const writtenOn = computed(() => {
  if (!props.book.review_updated_at) return null;
  const loc = BCP47[localeStore.locale] ?? "en-GB";
  return new Date(props.book.review_updated_at).toLocaleDateString(loc, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
});

// Word count and date only appear once the review is long enough for them to mean anything —
// "3 words" under a one-line note is noise, not metadata.
const metaLine = computed(() => {
  const words = reviewWordCount(props.book.review);
  const long = words >= REVIEW_META_MIN_WORDS;
  return [
    props.book.rating == null
      ? null
      : `${props.book.rating}${t("detail.of_ten")}`,
    long && writtenOn.value
      ? t("detail.review_written", { date: writtenOn.value })
      : null,
    long ? t("detail.review_words", { n: words }, words) : null,
    long ? t("detail.review_markdown") : null,
  ]
    .filter(Boolean)
    .join(" · ");
});
</script>
