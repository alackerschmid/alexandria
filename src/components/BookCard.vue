<template>
  <article
    class="flex flex-col px-6 md:px-0 pt-5 pb-2 border-b border-charcoal-border cursor-pointer"
    @click="$emit('select')"
  >
    <!-- Cover + title / author / status -->
    <div class="flex flex-row items-start gap-4">
      <!-- Cover -->
      <img
        v-if="book.cover_url"
        :src="book.cover_url"
        class="w-12 h-18 object-cover shrink-0"
      />
      <div
        v-else
        class="w-12 h-18 bg-charcoal border border-charcoal-border flex items-center justify-center shrink-0"
      >
        <v-icon icon="mdi-book-outline" size="18" color="primary" />
      </div>

      <!-- Title / author / status -->
      <div class="flex-1 min-w-0 mt-0.5">
        <div
          class="font-heading text-base font-bold text-text-primary leading-snug line-clamp-2 mb-1"
        >
          {{ book.title || book.isbn }}
        </div>
        <div class="text-xs text-text-secondary mb-2">
          {{ book.author || $t("book.unknown_author") }}
        </div>
        <button
          class="flex items-center gap-1 text-[10px] tracking-[0.15em] uppercase transition-colors"
          :class="STATUS_CONFIG[book.status].class"
          @click.stop="$emit('cycle-status')"
        >
          <v-icon :icon="STATUS_CONFIG[book.status].icon" size="10" />
          {{ STATUS_CONFIG[book.status].label }}
        </button>
      </div>

      <!-- Delete -->
      <v-btn
        icon="mdi-delete-outline"
        variant="text"
        color="primary"
        size="x-small"
        class="shrink-0 mt-0.5"
        @click.stop="$emit('delete')"
      />
    </div>

    <!-- Added on (below cover + info, left aligned) -->
    <div class="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
      <div
        class="text-[10px] text-text-secondary/50 font-mono tracking-wide uppercase"
      >
        {{ $t("book.added_on_at", { date: formatDatePart(book.created_at, locale as string), time: formatTimePart(book.created_at, locale as string) }) }}
      </div>
    </div>
  </article>
</template>

<script lang="ts" setup>
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { BCP47 } from "@/plugins/i18n";
import type { Book } from "@/types/book";

defineProps<{ book: Book }>();
defineEmits<{ "cycle-status": []; delete: []; select: [] }>();

const { t, locale } = useI18n();

function formatDatePart(isoString: string, loc: string): string {
  return new Date(isoString.replace(" ", "T")).toLocaleDateString(BCP47[loc] ?? "en-GB", {
    year: "numeric", month: "short", day: "numeric",
  });
}

function formatTimePart(isoString: string, loc: string): string {
  return new Date(isoString.replace(" ", "T")).toLocaleTimeString(BCP47[loc] ?? "en-GB", {
    hour: "2-digit", minute: "2-digit",
  });
}

const STATUS_CONFIG = computed(() => ({
  unread: {
    label: t("book.unread"),
    icon: "mdi-circle-outline",
    class: "text-text-secondary/40 hover:text-text-secondary",
  },
  reading: {
    label: t("book.reading"),
    icon: "mdi-book-open-outline",
    class: "text-orange-neon",
  },
  read: {
    label: t("book.read"),
    icon: "mdi-check-circle-outline",
    class: "text-[#22c55e]",
  },
}));
</script>
