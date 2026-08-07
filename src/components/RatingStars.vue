<script setup lang="ts">
import { computed, useId } from "vue";
import { useI18n } from "vue-i18n";
import { ratingStars, RATING_COLOR, RATING_TRACK, STAR_PATH } from "@/composables/useRating";

// The 5-star (half-star) rating row, shared by every surface that shows or edits a rating: the
// book detail card + row, the rating dialog, the scanner picker and the Goodreads import table.
// The underlying scale is still 0-10 (each star = 2 points) — only the display changed. Stars
// are drawn as SVG (see useRating.ts) rather than a text glyph, for exact alignment with
// surrounding text.
//
// Interactive rows render each star as two half-width buttons (left = odd/half value, right =
// even/full value), and a click always *sets* that value. Clearing is the host's job — the
// dialog's "Clear rating" footer button, or the ✕ beside the row in `RecordControls` and the
// scanner picker. Re-clicking the current value used to clear it, which fires on any accidental
// double-tap, has no visible cue, and was redundant everywhere an explicit clear existed.
// Display-only rows render no buttons, because they are usually nested inside a button (which
// can't contain another button).
//
// An interactive row is exposed as a radiogroup of ten radios: the half-star buttons are a
// single-select over 0-10, and each one announces "7 of 10" rather than a bare "7", which a
// screen reader otherwise reads with no scale and no indication of which value is current.

const props = withDefaults(
  defineProps<{
    rating: number | null;
    size?: "sm" | "md" | "lg";
    interactive?: boolean;
  }>(),
  { size: "sm", interactive: false },
);

const emit = defineEmits<{ "update:rating": [rating: number | null] }>();

const GAP_CLASS = { sm: "gap-0", md: "gap-0.5", lg: "gap-0.5" } as const;

const { t } = useI18n();
const uid = useId();
const data = computed(() => ratingStars(props.rating, props.size));

const valueLabel = (n: number) => t("detail.rating_value_aria", { n });
</script>

<template>
  <span
    class="inline-flex items-center"
    :class="GAP_CLASS[size]"
    :role="interactive ? 'radiogroup' : undefined"
    :aria-label="interactive ? $t('detail.rate_book') : undefined"
  >
    <span
      v-for="s in data.stars"
      :key="s.n"
      class="relative inline-block"
      :style="{ width: data.sizePx + 'px', height: data.sizePx + 'px' }"
    >
      <svg
        :width="data.sizePx"
        :height="data.sizePx"
        viewBox="0 0 24 24"
        class="block"
      >
        <path :d="STAR_PATH" :fill="RATING_TRACK" />
        <template v-if="s.fraction > 0">
          <clipPath :id="`rs-${uid}-${s.n}`">
            <rect x="0" y="0" :width="24 * s.fraction" height="24" />
          </clipPath>
          <path
            :d="STAR_PATH"
            :fill="RATING_COLOR"
            :clip-path="`url(#rs-${uid}-${s.n})`"
          />
        </template>
      </svg>
      <template v-if="interactive">
        <button
          type="button"
          role="radio"
          :aria-checked="rating === s.halfValue"
          :aria-label="valueLabel(s.halfValue)"
          class="absolute inset-y-0 left-0 w-1/2 p-0 border-0 bg-transparent cursor-pointer"
          @click="emit('update:rating', s.halfValue)"
        />
        <button
          type="button"
          role="radio"
          :aria-checked="rating === s.fullValue"
          :aria-label="valueLabel(s.fullValue)"
          class="absolute inset-y-0 right-0 w-1/2 p-0 border-0 bg-transparent cursor-pointer"
          @click="emit('update:rating', s.fullValue)"
        />
      </template>
    </span>
  </span>
</template>
