<template>
  <article
    class="group flex items-start gap-3 p-4 border border-charcoal-border cursor-pointer hover:border-charcoal-border/60 transition-colors"
    role="button"
    tabindex="0"
    @click="$emit('select')"
    @keydown.enter="onKeydownSelect"
    @keydown.space.prevent="onKeydownSelect"
  >
    <!-- Cover / spine -->
    <div
      class="w-10 h-15 shrink-0 relative overflow-hidden bg-charcoal-light border border-charcoal-border"
    >
      <img
        v-if="book.cover_url"
        :src="book.cover_url"
        :alt="displayTitle(book)"
        class="w-full h-full object-cover"
      />
      <div
        v-else
        class="absolute inset-0 flex items-center justify-center"
        :style="{ background: tint }"
      >
        <span class="font-heading font-bold text-sm" style="color: rgba(236,233,227,0.3)">
          {{ glyph }}
        </span>
      </div>
      <!-- orange left spine accent -->
      <div class="absolute left-0 top-0 bottom-0 w-0.5 bg-orange-neon" />
    </div>

    <!-- Text -->
    <div class="flex-1 min-w-0 flex flex-col gap-1">
      <div
        class="font-heading text-sm font-bold text-text-primary leading-snug line-clamp-2"
      >
        {{ displayTitle(book)
        }}<span v-if="seriesBracket" class="font-normal text-text-secondary">{{
          seriesBracket
        }}</span>
      </div>
      <div class="text-[11px] text-text-secondary">
        {{ displayAuthor(book, t) }}
      </div>
      <div class="flex items-center justify-between gap-2 mt-auto pt-2">
        <button
          class="flex items-center gap-1 text-[10px] tracking-[0.12em] uppercase transition-colors"
          :class="statusConfig[book.status].textClass"
          @click.stop="$emit('cycle-status')"
          @keydown.enter.stop
          @keydown.space.stop
        >
          <span
            class="w-1.5 h-1.5 rounded-full shrink-0"
            :class="statusConfig[book.status].dotClass"
          />
          {{ statusConfig[book.status].label }}
        </button>
        <span
          class="font-mono text-[9px] text-text-secondary/50 tracking-wide whitespace-nowrap"
        >
          {{
            book.publish_date && book.original_pub_date
              ? `${book.original_pub_date} / ${getYear}`
              : book.publish_date || book.original_pub_date
          }}
        </span>
      </div>
    </div>
  </article>
</template>

<script lang="ts" setup>
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { Book } from "@/types/book";
import { tintFor, initials } from "@/utils/cover";
import { displayTitle, displayAuthor } from "@/utils/book-display";
import { useBookStatus } from "@/composables/useBookStatus";

const props = defineProps<{ book: Book }>();
const emit = defineEmits<{ "cycle-status": []; select: [] }>();

const { t } = useI18n();
const { statusConfig } = useBookStatus();

function onKeydownSelect() {
  emit("select");
}

const tint = computed(() => tintFor(displayTitle(props.book)));
const glyph = computed(() => initials(displayTitle(props.book)));

const seriesBracket = computed(() => {
  if (!props.book.series_name) return "";
  const ord =
    props.book.series_ordinal != null ? ` #${props.book.series_ordinal}` : "";
  return `  (${props.book.series_name}${ord})`;
});

const getYear = computed(() =>
  props.book.publish_date ? String(props.book.publish_date).slice(0, 4) : "",
);
</script>
