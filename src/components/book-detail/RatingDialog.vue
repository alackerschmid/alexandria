<template>
  <v-dialog
    :model-value="modelValue"
    :max-width="withReview ? 560 : 320"
    @update:model-value="$emit('update:modelValue', $event)"
  >
    <!-- Rating and actions stay put; the review is the only region that scrolls, and only once it
         outgrows the viewport. Same fixed-header/scrolling-body/fixed-footer shape as
         BookDetail's full mode — it keeps DONE reachable no matter how long the review runs. -->
    <div
      class="bg-charcoal-light border border-charcoal-border max-h-[85dvh] flex flex-col"
    >
      <div class="shrink-0 p-6 pb-0">
        <div
          class="text-[10px] tracking-[0.16em] uppercase text-text-secondary/60 mb-1.5"
        >
          {{ $t("detail.rate_book") }}
        </div>
        <div
          class="font-mono text-[28px] mb-4"
          :style="{
            color: rating != null ? RATING_COLOR : 'var(--color-text-secondary)',
          }"
        >
          {{ rating ?? 0
          }}<span class="text-[13px] text-text-secondary/60">{{
            $t("detail.of_ten")
          }}</span>
        </div>
        <RatingStars
          :rating="rating"
          size="lg"
          interactive
          @update:rating="$emit('set-rating', $event)"
        />
      </div>

      <!-- review / notes. min-h-0 is what lets a flex child actually shrink and scroll. -->
      <div
        v-if="withReview"
        class="flex-1 min-h-0 overflow-y-auto px-6 pt-5 mt-5 border-t border-charcoal-border"
      >
        <div class="flex items-center justify-between mb-2">
          <span
            class="text-[10px] tracking-[0.16em] uppercase text-text-secondary/60"
          >
            {{ $t("detail.review") }}
          </span>
          <button
            v-if="draft.trim()"
            class="text-[10px] tracking-[0.08em] uppercase text-text-secondary/60 hover:text-text-secondary transition-colors"
            @click="previewing = !previewing"
          >
            {{ previewing ? $t("detail.review_write") : $t("detail.review_preview") }}
          </button>
        </div>
        <MarkdownText
          v-if="previewing"
          :source="draft"
          class="min-h-[160px] border border-charcoal-border p-3"
        />
        <textarea
          v-else
          ref="textareaEl"
          v-model="draft"
          class="w-full min-h-[160px] bg-charcoal border border-charcoal-border p-3 text-[14px] leading-relaxed text-text-primary resize-none overflow-hidden focus:outline-none focus:border-orange-neon/60 transition-colors"
          :placeholder="$t('detail.review_placeholder')"
          @input="autoGrow"
        />
        <p class="text-[10px] text-text-secondary/50 mt-1.5 pb-1">
          {{ $t("detail.review_markdown_hint") }}
        </p>
      </div>

      <div class="shrink-0 flex items-center justify-between p-6 pt-5">
        <button
          class="text-[11px] text-text-secondary/60 hover:text-text-secondary transition-colors"
          @click="$emit('set-rating', null)"
        >
          {{ $t("detail.clear_rating") }}
        </button>

        <button
          class="text-[11px] tracking-[0.08em] uppercase font-semibold bg-text-primary text-charcoal px-4.5 py-2 hover:opacity-90 transition-opacity"
          @click="$emit('update:modelValue', false)"
        >
          {{ $t("detail.done") }}
        </button>
      </div>
    </div>
  </v-dialog>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from "vue";
import MarkdownText from "@/components/MarkdownText.vue";
import RatingStars from "@/components/RatingStars.vue";
import { RATING_COLOR } from "@/composables/useRating";

const props = withDefaults(
  defineProps<{
    modelValue: boolean;
    rating: number | null;
    /** Current stored review; ignored unless `withReview`. */
    review?: string | null;
    /** Opt-in: the Goodreads-import wizard reuses this dialog for rating only. */
    withReview?: boolean;
  }>(),
  { review: null, withReview: false },
);

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  "set-rating": [rating: number | null];
  "set-review": [review: string | null];
}>();

// The rating saves on every star click, but the review is a text field — it would be hostile to
// PATCH on each keystroke, so it's held as a draft and flushed once on close.
const draft = ref(props.review ?? "");
const previewing = ref(false);
const textareaEl = ref<HTMLTextAreaElement | null>(null);

// The field grows with what's in it instead of scrolling inside a fixed 160px box — a scrollbar
// inside a form field never reads as designed, and a long review is exactly when you least want
// to write through a letterbox. The panel takes over scrolling past 85dvh.
function autoGrow() {
  const el = textareaEl.value;
  if (!el) return;
  el.style.height = "auto";
  // scrollHeight covers content + padding but not the border, and box-sizing is border-box here,
  // so the border has to be added back or the field settles one pixel-row short and clips.
  const border = el.offsetHeight - el.clientHeight;
  el.style.height = `${el.scrollHeight + border}px`;
}

// The single place the draft is seeded and flushed, so every close routes through it whoever
// initiated it — DONE, Esc, click-away, or the host page closing us (series.vue does that when
// the detail route unwinds on Back). `flush: "sync"` is what makes that last case work: the host
// clears the flag and tears the dialog down in the same tick, and a pre-flush watcher would be
// cancelled by the unmount before it ever ran, silently dropping the review.
//
// Seeding is open-only: the parent applies our own flushed value back into `review`, and
// re-seeding on that would fight the user if they reopened and kept typing.
watch(
  () => props.modelValue,
  async (open, wasOpen) => {
    if (!open) {
      if (wasOpen) flush();
      return;
    }
    draft.value = props.review ?? "";
    previewing.value = false;
    await nextTick();
    autoGrow();
  },
  { immediate: true, flush: "sync" },
);

// The textarea is v-if'd out in preview mode, so it returns at its CSS height and has to be
// re-measured when the user switches back to writing.
watch(previewing, async (isPreview) => {
  if (isPreview) return;
  await nextTick();
  autoGrow();
});

// Called only from the modelValue watcher above — never inline on a close path, or a close that
// also unmounts us would flush twice while one that came from the host wouldn't flush at all.
function flush() {
  if (!props.withReview) return;
  const next = draft.value.trim() || null;
  if (next !== (props.review ?? null)) emit("set-review", next);
}
</script>
