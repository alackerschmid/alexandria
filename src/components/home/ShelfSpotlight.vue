<template>
  <div v-if="current" class="flex gap-5 md:gap-8">
    <router-link
      :to="link"
      class="w-24 md:w-33 flex-none aspect-2/3 overflow-hidden bg-charcoal-light hover:opacity-80 transition-opacity"
    >
      <CoverImage
        :cover-url="current.coverUrl"
        :title="current.title"
        :alt="current.title ?? ''"
        text-class="text-[26px]"
        :icon-size="24"
        class="w-full h-full object-cover"
      />
    </router-link>

    <div class="flex-1 min-w-0 flex flex-col">
      <blockquote
        class="font-mono text-[13px] md:text-[16px] text-text-primary leading-snug"
      >
        &ldquo;{{ current.firstLine }}&rdquo;
      </blockquote>
      <h3
        class="font-heading font-bold text-lg md:text-2xl leading-tight text-text-primary mt-3"
      >
        {{ current.title ?? $t("series.untitled") }}
      </h3>
      <p
        v-if="identityLine"
        class="font-mono text-[10px] md:text-[11px] tracking-[0.05em] text-text-secondary mt-1.5"
      >
        {{ identityLine }}
      </p>

      <div class="flex flex-wrap items-center gap-x-6 gap-y-2 mt-auto pt-4">
        <router-link
          :to="link"
          class="font-mono text-[10px] tracking-[0.2em] uppercase text-orange-neon hover:opacity-70 transition-opacity"
        >
          {{ $t("home.spotlight_open") }} &rarr;
        </router-link>
        <!-- Cycles the pool the page already holds; deliberately not a refetch, which would
             recompute the whole `/api/stats` aggregate to change one book. -->
        <button
          v-if="books.length > 1"
          type="button"
          class="font-mono text-[10px] tracking-[0.2em] uppercase text-text-secondary hover:text-text-primary transition-colors cursor-pointer"
          @click="next"
        >
          {{ $t("home.spotlight_another") }} &#8635;
        </button>
      </div>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import CoverImage from "@/components/CoverImage.vue";
import { libraryDetailLink } from "@/utils/book-link";
import type { SpotlightBook } from "@/types/stats";

const props = defineProps<{ books: SpotlightBook[] }>();

const { t } = useI18n();

// Modulo rather than a wrapped counter, so a pool that changes length under the index can't
// leave it pointing past the end.
const index = ref(0);
const current = computed<SpotlightBook | null>(() =>
  props.books.length ? props.books[index.value % props.books.length] : null,
);

const link = computed(() =>
  libraryDetailLink(current.value?.workId, current.value?.isbn ?? ""),
);

/** "Jane Austen · 1813 · Penguin Classics · 432pp", minus whatever is unknown. */
const identityLine = computed(() => {
  const b = current.value;
  if (!b) return "";
  return [
    b.author,
    b.year != null ? String(b.year) : null,
    b.publisher,
    b.pages != null && b.pages > 0
      ? t("home.pages_short", { count: b.pages.toLocaleString() })
      : null,
  ]
    .filter(Boolean)
    .join(" · ");
});

const next = () => {
  index.value++;
};
</script>
