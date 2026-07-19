<template>
  <article
    class="group relative flex flex-col p-4 cursor-pointer transition-colors bg-row-card-surface border border-charcoal-border hover:border-charcoal-border/60"
    role="button"
    tabindex="0"
    @click="$emit('select')"
    @keydown.enter="onKeydownSelect"
    @keydown.space.prevent="onKeydownSelect"
  >
    <div class="flex items-start gap-3">
      <!-- Cover / spine — fanned stack when this card represents multiple owned editions -->
      <div
        class="w-10 h-15 shrink-0 relative"
        :class="hasEditions ? 'cursor-pointer' : ''"
        :role="hasEditions ? 'button' : undefined"
        :tabindex="hasEditions ? 0 : undefined"
        :aria-label="hasEditions ? $t('library.edition_count', { n: book.editionCount }) : undefined"
        :aria-pressed="hasEditions ? expanded : undefined"
        @click.stop="hasEditions && $emit('toggle-editions')"
        @keydown.enter.stop="hasEditions && $emit('toggle-editions')"
        @keydown.space.stop.prevent="hasEditions && $emit('toggle-editions')"
      >
        <template v-if="hasEditions">
          <div
            class="absolute w-10 h-15 border border-charcoal-border bg-text-secondary/15"
            style="top: 4px; left: 4px"
          />
          <div
            class="absolute w-10 h-15 border border-charcoal-border bg-text-secondary/30"
            style="top: 2px; left: 2px"
          />
        </template>
        <div
          class="absolute top-0 left-0 w-10 h-15 overflow-hidden bg-charcoal-light border border-charcoal-border"
          :class="owningBorderClass"
        >
          <CoverImage
            :cover-url="book.cover_url"
            :title="displayTitle(book)"
            :alt="displayTitle(book)"
            text-class="text-sm"
            :icon-size="10"
            class="w-full h-full object-cover"
          />
          <!-- orange left spine accent -->
          <div class="absolute left-0 top-0 bottom-0 w-0.5 bg-orange-neon" />
        </div>
        <span
          v-if="hasEditions"
          class="absolute -bottom-1.5 -right-1.5 w-4 h-4 rounded-full flex items-center justify-center font-mono text-[8px] bg-charcoal-light border border-charcoal-border text-text-secondary"
        >
          {{ book.editionCount }}
        </span>
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
        <div class="flex items-center flex-wrap gap-2 mt-auto pt-2">
          <button
            v-if="!hideStatus"
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
            v-if="owningTag"
            class="inline-flex items-center gap-[3px] font-mono text-[8.5px] tracking-[0.08em] uppercase border border-charcoal-border text-text-secondary px-[5px] py-[2px]"
          >
            <v-icon
              :icon="owningTag.icon"
              size="10"
              color="var(--color-text-secondary)"
            />
            {{ owningTag.label }}
          </span>
          <span
            class="ml-auto font-mono text-[9px] text-text-secondary/50 tracking-wide whitespace-nowrap"
          >
            {{
              book.publish_date && book.original_pub_date
                ? `${book.original_pub_date} / ${getYear}`
                : book.publish_date || book.original_pub_date
            }}
          </span>
        </div>
      </div>
    </div>

    <!-- Other owned editions of this work — inline, no orphan cards -->
    <div
      v-if="expanded && allEditions.length"
      class="mt-3 pt-3 border-t border-dashed border-charcoal-border flex flex-col gap-2"
    >
      <div
        v-for="ed in allEditions"
        :key="ed.id"
        class="flex items-center gap-2 cursor-pointer"
        @click.stop="$emit('select-edition', ed)"
      >
        <div
          class="w-5 h-7.5 shrink-0 relative overflow-hidden bg-charcoal-light border border-charcoal-border"
        >
          <CoverImage
            :cover-url="ed.cover_url"
            :title="displayTitle(ed)"
            :alt="displayTitle(ed)"
            text-class="text-[9px]"
            :icon-size="8"
            class="w-full h-full object-cover"
          />
        </div>
        <div class="flex-1 min-w-0 text-[10px] text-text-secondary truncate">
          {{ editionLabel(ed) }}
        </div>
        <span
          class="flex items-center gap-1 font-mono text-[8px] tracking-[0.08em] uppercase shrink-0"
          :class="statusConfig[ed.status].textClass"
        >
          <span
            class="w-1 h-1 rounded-full shrink-0"
            :class="statusConfig[ed.status].dotClass"
          />
          {{ statusConfig[ed.status].label }}
        </span>
      </div>
    </div>
  </article>
</template>

<script lang="ts" setup>
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { Book } from "@/types/book";
import { displayTitle, displayAuthor, bookYear } from "@/utils/book-display";
import { useBookStatus } from "@/composables/useBookStatus";
import { OWNING_META, useOwningStatus } from "@/composables/useOwningStatus";
import { languageDisplayFormatter } from "@/utils/language";
import { useLocaleStore } from "@/stores/locale";
import CoverImage from "@/components/CoverImage.vue";

const props = defineProps<{
  book: Book;
  hideStatus?: boolean;
  expanded?: boolean;
}>();
const emit = defineEmits<{
  "cycle-status": [];
  select: [];
  "select-edition": [book: Book];
  "toggle-editions": [];
}>();

const { t } = useI18n();
const { statusConfig } = useBookStatus();
const { owningLabels } = useOwningStatus();
const localeStore = useLocaleStore();
const langFmt = computed(() => languageDisplayFormatter(localeStore.locale));

function onKeydownSelect() {
  emit("select");
}

const owningBorderClass = computed(
  () => OWNING_META[props.book.owning_status ?? "owned"].borderClass,
);
const owningTag = computed(() => {
  const status = props.book.owning_status ?? "owned";
  if (status === "owned") return null;
  return {
    icon: OWNING_META[status].icon,
    label: owningLabels.value[status],
  };
});

const hasEditions = computed(
  () => !!props.book.editionCount && props.book.editionCount > 1,
);

// All owned editions, including the one shown in the card header above — the corner
// badge counts editionCount total, so the panel lists all editionCount of them.
const allEditions = computed(() => props.book.editions ?? []);
function editionLabel(ed: Book): string {
  return [langFmt.value(ed.language), ed.publisher, bookYear(ed)]
    .filter(Boolean)
    .join(" · ");
}

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
