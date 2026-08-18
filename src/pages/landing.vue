<template>
  <div class="bg-charcoal min-h-screen flex flex-col">
    <!-- ── Top bar ──────────────────────────────────────────────────────────── -->
    <header
      class="shrink-0 flex justify-between items-center px-6 md:px-16 py-4 md:py-5.5 border-b border-charcoal-border"
    >
      <span
        class="text-orange-neon font-mono text-[9px] md:text-[10px] font-bold tracking-[0.28em] md:tracking-[0.35em] uppercase leading-snug max-w-40 md:max-w-none"
      >
        {{ $t("app_name") }}
      </span>
      <div class="flex items-center gap-1">
        <v-btn
          variant="text"
          color="primary"
          size="small"
          class="text-[10px] tracking-widest font-mono"
          @click="localeStore.toggle()"
        >
          {{ localeStore.locale === "en" ? "DE" : "EN" }}
        </v-btn>
        <v-btn
          :icon="themeStore.isDark ? 'mdi-weather-sunny' : 'mdi-weather-night'"
          variant="text"
          color="primary"
          size="small"
          :aria-label="
            themeStore.isDark ? $t('home.theme_light') : $t('home.theme_dark')
          "
          @click="themeStore.toggle()"
        />
        <button
          class="ml-2 md:ml-4 text-text-primary text-[10px] md:text-[11px] font-medium tracking-[0.18em] uppercase border-b border-text-primary/50 pb-[3px] hover:border-text-primary transition-colors"
          @click="$router.push('/login')"
        >
          {{ $t("auth.sign_in") }}
        </button>
      </div>
    </header>

    <!-- ── Main ────────────────────────────────────────────────────────────── -->
    <div class="flex-1 flex flex-col md:flex-row">
      <!-- Left: hero + scanner + CTAs -->
      <div
        class="md:flex-1 px-6 md:px-16 py-8 md:py-0 flex flex-col justify-start md:justify-center gap-5 md:gap-7"
      >
        <h1
          class="font-heading text-[2.2rem] md:text-6xl font-bold text-text-primary leading-[1.02]"
        >
          {{ $t("marketing.heading") }}
        </h1>

        <p
          class="text-[13px] md:text-base text-text-secondary leading-relaxed max-w-xs md:max-w-lg"
        >
          {{ $t("marketing.body") }}
        </p>

        <!-- Scanner + CTAs row -->
        <div class="flex flex-col md:flex-row md:items-center gap-4 md:gap-6">
          <!-- Scanner widget -->
          <!-- Labelled explicitly: its only child is a decorative preview graphic, so without
               this the button reaches a screen reader unnamed. -->
          <button
            type="button"
            :aria-label="$t('marketing.cta_primary')"
            class="shrink-0 cursor-pointer hover:opacity-80 transition-opacity w-full md:w-[300px]"
            @click="$router.push('/scanner')"
          >
            <ScannerPreview size="sm" :dark="false" />
          </button>

          <!-- CTAs: desktop only; orange band covers mobile -->
          <div class="hidden md:flex flex-col gap-3">
            <AppButton
              variant="inverse"
              size="md"
              class="w-full md:w-auto"
              @click="$router.push('/scanner')"
            >
              {{ $t("marketing.cta_primary") }}
            </AppButton>
            <button
              class="text-text-primary text-[11px] font-medium tracking-[0.2em] uppercase text-center hover:opacity-70 transition-opacity"
              @click="$router.push('/login')"
            >
              {{ $t("marketing.cta_secondary") }} →
            </button>
          </div>
        </div>

        <!-- Mobile-only CTA band (sits between scanner and library preview) -->
        <div
          class="md:hidden -mx-6 px-6 py-6 flex flex-col gap-4"
          style="background: rgb(var(--v-theme-primary))"
        >
          <h2
            class="font-heading font-bold text-[1.3rem] leading-[1.05]"
            style="color: #111110"
          >
            {{ $t("marketing.band_heading") }}
          </h2>
          <AppButton
            variant="inverse"
            size="lg"
            class="self-start"
            @click="$router.push('/scanner')"
          >
            {{ $t("marketing.cta_primary") }}
          </AppButton>
        </div>
      </div>

      <!-- Right: library card preview -->
      <div
        class="md:flex-none md:w-100 border-t md:border-t-0 md:border-l border-charcoal-border flex flex-col md:overflow-hidden"
      >
        <!-- Card header -->
        <div
          class="shrink-0 flex justify-between items-end px-6 py-4 md:py-5 border-b border-charcoal-border"
        >
          <div>
            <p
              class="font-mono text-[9px] text-text-secondary tracking-[0.3em] uppercase mb-1.5"
            >
              {{ $t("marketing.preview_section") }}
            </p>
            <h2
              class="font-heading font-bold text-xl md:text-[25px] text-text-primary leading-none"
            >
              {{ $t("marketing.preview_title") }}
            </h2>
          </div>
          <p
            class="font-mono text-[9px] text-text-secondary tracking-[0.12em] uppercase"
          >
            {{ totalCount.toLocaleString() }}
            {{ $t("marketing.preview_count") }}
          </p>
        </div>

        <!-- Book list -->
        <div class="overflow-hidden">
          <div
            v-for="book in demoBooks"
            :key="book.title"
            class="flex gap-3.5 px-6 py-3.5 md:py-4 border-b border-charcoal-border"
          >
            <!-- Cover (spine placeholder as fallback) -->
            <div
              class="w-9 h-[50px] md:h-14 flex-none bg-charcoal border border-charcoal-border relative shrink-0 overflow-hidden"
            >
              <img
                v-if="coverFor(book)"
                :src="coverFor(book)"
                :alt="book.title"
                referrerpolicy="no-referrer"
                class="absolute inset-0 w-full h-full object-cover"
              />
              <div
                v-else
                class="absolute left-0 top-0 bottom-0 w-0.75 bg-primary"
              />
            </div>
            <!-- Info -->
            <div class="min-w-0 flex-1">
              <p
                class="font-heading font-bold text-[13px] md:text-sm text-text-primary leading-snug"
              >
                {{ book.title }}
              </p>
              <p class="font-mono text-[10px] text-text-secondary mt-1">
                {{ book.author }}
              </p>
              <div class="flex items-center gap-1.5 mt-2">
                <div
                  class="w-1.5 h-1.5 rounded-full shrink-0"
                  :style="{ background: statusDot(book.status) }"
                />
                <span
                  class="text-[9px] tracking-[0.15em] uppercase font-medium"
                  :style="{ color: statusColor(book.status) }"
                >
                  {{ $t(`book.${book.status}`) }}
                </span>
              </div>
            </div>
          </div>

          <!-- …and many more (in place of a fourth book) -->
          <div
            class="flex items-center justify-end px-6 py-4 border-b border-charcoal-border"
          >
            <p
              class="font-mono text-[11px] text-text-primary tracking-[0.2em] uppercase"
            >
              {{ $t("marketing.preview_more") }}
            </p>
          </div>
        </div>
      </div>
    </div>

    <!-- ── CTA band (desktop only) ───────────────────────────────────────────── -->
    <div
      class="hidden md:flex shrink-0 px-6 md:px-16 py-6 md:py-8 flex-col md:flex-row md:items-center md:justify-between gap-4 md:gap-12"
      style="background: rgb(var(--v-theme-primary))"
    >
      <h2
        class="font-heading font-bold text-[1.3rem] md:text-[2.1rem] leading-[1.05] md:max-w-xl"
        style="color: #111110"
      >
        {{ $t("marketing.band_heading") }}
      </h2>
      <AppButton
        variant="inverse"
        size="lg"
        class="shrink-0"
        @click="$router.push('/scanner')"
      >
        {{ $t("marketing.cta_primary") }}
      </AppButton>
    </div>
  </div>
</template>

<script lang="ts" setup>
import { ref, onMounted } from "vue";
import { useI18n } from "vue-i18n";
import { useThemeStore } from "@/stores/theme";
import { useLocaleStore } from "@/stores/locale";
import AppButton from "@/components/AppButton.vue";
import ScannerPreview from "@/components/ScannerPreview.vue";
import { coverSrc } from "@/utils/cover";

const { t } = useI18n();
const themeStore = useThemeStore();
const localeStore = useLocaleStore();

const API_BASE = import.meta.env.VITE_API_URL || "";

type ReadStatus = "read" | "reading" | "unread";
type DemoBook = {
  title: string;
  author: string;
  status: ReadStatus;
  coverUrl?: string;
  /** R2 key of the cover stored on our own origin — see `coverFor`. */
  coverObjectKey?: string;
};

/**
 * The `<img>` src for a preview cover, preferring the copy on our own origin.
 *
 * This page is the one an *anonymous* visitor lands on, so a cover pointed at `books.google.com`
 * makes their browser announce three of the catalogue's books to Google, with their Google cookies
 * attached, before they have agreed to anything at all. `referrerpolicy="no-referrer"` on the
 * `<img>` is the fallback when there is no stored object yet; this is the actual fix.
 *
 * Deliberately not `CoverImage`: the fallback here is the bespoke orange spine strip below, not
 * `PlaceholderCover`, and that is marketing chrome rather than a library tile.
 */
function coverFor(book: DemoBook): string | undefined {
  return coverSrc(book.coverUrl ?? null, book.coverObjectKey) ?? undefined;
}

// Decorative statuses, rotated across the previewed books for visual variety —
// the books table has no per-user status of its own.
const PREVIEW_STATUSES: ReadStatus[] = ["read", "reading", "unread"];

// Shown until the live sample loads (and if the request fails or the catalogue
// is too small), so the marketing preview is never empty.
const FALLBACK_BOOKS: DemoBook[] = [
  { title: "Infinite Jest", author: "David Foster Wallace", status: "read" },
  {
    title: "The Sun Also Rises",
    author: "Ernest Hemingway",
    status: "reading",
  },
  { title: "The White Album", author: "Joan Didion", status: "read" },
];

const demoBooks = ref<DemoBook[]>(FALLBACK_BOOKS);
const totalCount = ref(FALLBACK_BOOKS.length);

onMounted(async () => {
  try {
    const res = await fetch(`${API_BASE}/api/books/sample?limit=3`);
    if (!res.ok) return;
    const data: {
      books: {
        title: string;
        author: string | null;
        cover_url: string | null;
        cover_object_key?: string | null;
      }[];
      total: number;
    } = await res.json();
    if (data.books?.length >= 3) {
      demoBooks.value = data.books.slice(0, 3).map((b, i) => ({
        title: b.title,
        author: b.author || t("book.unknown_author"),
        status: PREVIEW_STATUSES[i % PREVIEW_STATUSES.length],
        coverUrl: b.cover_url || undefined,
        // Optional on the wire: a worker older than migration 0045 doesn't send it, and `coverFor`
        // falls back to the URL. Picked as a pair with `cover_url` — both come from one `books` row.
        coverObjectKey: b.cover_object_key || undefined,
      }));
      totalCount.value = data.total;
    }
  } catch {}
});

function statusDot(s: "read" | "reading" | "unread"): string {
  if (s === "reading") return "rgb(var(--v-theme-primary))";
  if (s === "read") return "rgb(var(--v-theme-success))";
  return "rgba(138,128,120,0.3)";
}

function statusColor(s: "read" | "reading" | "unread"): string {
  if (s === "reading") return "rgb(var(--v-theme-primary))";
  if (s === "read") return "rgba(138,128,120,0.6)";
  return "rgba(138,128,120,0.35)";
}
</script>
