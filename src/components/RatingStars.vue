<script setup lang="ts">
import { computed, nextTick, ref, useId } from "vue";
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
// That role carries a keyboard contract, so the row implements it rather than just claiming
// it: a roving tabindex (one tab stop for the whole group, landing on the current value) plus
// arrow/Home/End handling. Without those, a screen reader in forms mode announces a radiogroup
// whose arrow keys do nothing and takes ten Tab presses to get past — worse than the plain
// buttons this replaced.

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

const rootEl = ref<HTMLElement>();

/** The ten selectable values, in visual order: 1, 2, … 10. */
const values = computed(() =>
  data.value.stars.flatMap((s) => [s.halfValue, s.fullValue]),
);

// Exactly one radio is tabbable. When the book is unrated (or rated 0, which no star
// represents) that's the first one, so Tab still reaches the group.
const tabbableValue = computed(() =>
  props.rating != null && values.value.includes(props.rating)
    ? props.rating
    : values.value[0],
);

function onKeydown(e: KeyboardEvent) {
  if (!props.interactive) return;
  const list = values.value;
  const step =
    e.key === "ArrowRight" || e.key === "ArrowDown"
      ? 1
      : e.key === "ArrowLeft" || e.key === "ArrowUp"
        ? -1
        : 0;

  let next: number;
  if (step !== 0) {
    const current = props.rating == null ? -1 : list.indexOf(props.rating);
    // An unrated row enters at whichever end the user is heading away from; otherwise wrap,
    // as the radio-group pattern specifies.
    next =
      current === -1
        ? (step > 0 ? list[0] : list.at(-1)!)
        : list[(current + step + list.length) % list.length];
  } else if (e.key === "Home") {
    next = list[0];
  } else if (e.key === "End") {
    next = list.at(-1)!;
  } else {
    return;
  }

  e.preventDefault();
  emit("update:rating", next);
  // Moving focus is what makes the selection followable — the roving tabindex has just moved
  // to `next`, so the previously focused button is no longer tabbable.
  nextTick(() => {
    rootEl.value
      ?.querySelector<HTMLElement>(
        `[data-rating-value="${CSS.escape(String(next))}"]`,
      )
      ?.focus();
  });
}
</script>

<template>
  <span
    ref="rootEl"
    class="inline-flex items-center"
    :class="GAP_CLASS[size]"
    :role="interactive ? 'radiogroup' : undefined"
    :aria-label="interactive ? $t('detail.rate_book') : undefined"
    @keydown="onKeydown"
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
          :data-rating-value="s.halfValue"
          :tabindex="tabbableValue === s.halfValue ? 0 : -1"
          :aria-checked="rating === s.halfValue"
          :aria-label="valueLabel(s.halfValue)"
          class="absolute inset-y-0 left-0 w-1/2 p-0 border-0 bg-transparent cursor-pointer"
          @click="emit('update:rating', s.halfValue)"
        />
        <button
          type="button"
          role="radio"
          :data-rating-value="s.fullValue"
          :tabindex="tabbableValue === s.fullValue ? 0 : -1"
          :aria-checked="rating === s.fullValue"
          :aria-label="valueLabel(s.fullValue)"
          class="absolute inset-y-0 right-0 w-1/2 p-0 border-0 bg-transparent cursor-pointer"
          @click="emit('update:rating', s.fullValue)"
        />
      </template>
    </span>
  </span>
</template>
