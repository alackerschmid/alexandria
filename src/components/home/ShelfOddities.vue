<template>
  <div>
    <router-link
      v-for="row in rows"
      :key="row.key"
      :to="libraryDetailLink(row.book.workId, row.book.isbn)"
      class="block py-3 border-b border-charcoal-border hover:opacity-70 transition-opacity"
    >
      <p
        class="font-mono text-[9px] tracking-[0.2em] uppercase text-text-secondary"
      >
        {{ row.kicker }}
      </p>
      <p class="flex items-baseline justify-between gap-3 mt-1">
        <span class="text-sm text-text-primary min-w-0 truncate">
          {{ row.book.title ?? $t("series.untitled") }}
        </span>
        <span
          v-if="row.detail"
          class="flex-none font-mono text-[11px] text-text-secondary"
          >{{ row.detail }}</span
        >
      </p>
    </router-link>
  </div>
</template>

<script lang="ts" setup>
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { useLocaleStore } from "@/stores/locale";
import { libraryDetailLink } from "@/utils/book-link";
import { languageDisplayFormatter } from "@/utils/language";
import type { ExemplarBook, Exemplars } from "@/types/stats";

const props = defineProps<{ exemplars: Exemplars }>();

const { t } = useI18n();
const localeStore = useLocaleStore();

const langFmt = computed(() => languageDisplayFormatter(localeStore.locale));

interface OddityRow {
  key: string;
  kicker: string;
  book: ExemplarBook;
  /** The one figure the row is about, or null when even that is unknown. */
  detail: string | null;
}

// Only the entries the server could answer. All three null is a legitimate state (a library with
// no years, no page counts and one language), and the parent hides the block rather than
// rendering an empty frame.
const rows = computed<OddityRow[]>(() => {
  const { oldest, longest, soleLanguage } = props.exemplars;
  const out: OddityRow[] = [];
  if (oldest)
    out.push({
      key: "oldest",
      kicker: t("home.oddity_oldest"),
      book: oldest,
      detail: oldest.year != null ? String(oldest.year) : null,
    });
  if (longest)
    out.push({
      key: "longest",
      kicker: t("home.oddity_longest"),
      book: longest,
      detail:
        longest.pages != null
          ? t("home.pages_short", { count: longest.pages.toLocaleString() })
          : null,
    });
  if (soleLanguage)
    out.push({
      key: "soleLanguage",
      kicker: t("home.oddity_sole_language", {
        language: langFmt.value(soleLanguage.language),
      }),
      book: soleLanguage,
      detail: soleLanguage.author,
    });
  return out;
});
</script>
