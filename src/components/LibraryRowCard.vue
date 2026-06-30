<template>
  <article
    class="flex items-start gap-3 p-4 border border-charcoal-border cursor-pointer hover:border-charcoal-border/60 transition-colors"
    @click="$emit('select')"
  >
    <!-- Cover / spine -->
    <div
      class="w-10 h-15 shrink-0 relative overflow-hidden bg-charcoal-light border border-charcoal-border"
    >
      <img
        v-if="book.cover_url"
        :src="book.cover_url"
        :alt="book.title || book.isbn"
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
        {{ book.title || book.isbn
        }}<span v-if="seriesBracket" class="font-normal text-text-secondary">{{
          seriesBracket
        }}</span>
      </div>
      <div class="text-[11px] text-text-secondary">
        {{ book.author || $t("book.unknown_author") }}
      </div>
      <div class="flex items-center justify-between gap-2 mt-auto pt-2">
        <button
          class="flex items-center gap-1 text-[10px] tracking-[0.12em] uppercase transition-colors"
          :class="STATUS_CONFIG[book.status].class"
          @click.stop="$emit('cycle-status')"
        >
          <span
            class="w-1.5 h-1.5 rounded-full shrink-0"
            :class="STATUS_CONFIG[book.status].dotClass"
          />
          {{ STATUS_CONFIG[book.status].label }}
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

    <!-- Delete -->
    <v-btn
      icon="mdi-delete-outline"
      variant="text"
      color="primary"
      size="x-small"
      class="shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
      @click.stop="$emit('delete')"
    />
  </article>
</template>

<script lang="ts" setup>
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { Book } from "@/types/book";
import { tintFor, initials } from "@/utils/cover";

const props = defineProps<{ book: Book }>();
defineEmits<{ "cycle-status": []; delete: []; select: [] }>();

const { t } = useI18n();

const tint = computed(() => tintFor(props.book.title || props.book.isbn));
const glyph = computed(() => initials(props.book.title || props.book.isbn));

const seriesBracket = computed(() => {
  if (!props.book.series_name) return "";
  const ord =
    props.book.series_ordinal != null ? ` #${props.book.series_ordinal}` : "";
  return `  (${props.book.series_name}${ord})`;
});

const getYear = computed(() =>
  props.book.publish_date ? String(props.book.publish_date).slice(0, 4) : "",
);

const STATUS_CONFIG = computed(() => ({
  unread: {
    label: t("book.unread"),
    class: "text-text-secondary/50 hover:text-text-secondary",
    dotClass: "bg-text-secondary/30",
  },
  reading: {
    label: t("book.reading"),
    class: "text-orange-neon",
    dotClass: "bg-orange-neon",
  },
  read: {
    label: t("book.read"),
    class: "text-[#22c55e]",
    dotClass: "bg-[#22c55e]",
  },
}));
</script>
