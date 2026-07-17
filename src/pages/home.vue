<template>
  <div
    class="bg-charcoal min-h-screen md:h-screen flex flex-col overflow-hidden"
    :class="{ 'blur-sm': firstnameDialog }"
  >
    <AppHeader />

    <!-- Top band: greeting + scan CTA -->
    <div class="shrink-0 px-6 md:px-14 pt-5 pb-3 md:py-8">
      <div
        class="flex flex-col md:flex-row md:items-end md:justify-between gap-6 md:gap-16"
      >
        <div>
          <p
            class="font-mono text-[9px] tracking-[0.3em] uppercase text-orange-neon mb-4"
          >
            {{ $t("home.welcome") }}
          </p>
          <h1
            class="font-heading font-black text-[2.2rem] md:text-[2.75rem] leading-[1.02] text-text-primary mb-2"
          >
            {{ greeting }}
          </h1>
          <p
            v-if="statsData"
            class="font-mono text-[10px] md:text-[11px] tracking-[0.05em] text-text-secondary"
          >
            {{ metaLine }}
          </p>
        </div>
        <div class="flex gap-3 shrink-0">
          <button
            type="button"
            class="flex justify-between items-center px-6 py-3 md:py-3 flex-1 md:w-52 cursor-pointer hover:opacity-90 transition-opacity"
            style="background: rgb(var(--v-theme-primary))"
            @click="$router.push('/scanner')"
          >
            <p
              class="font-heading font-black text-2xl leading-none"
              style="color: #111110"
            >
              {{ $t("home.scan_cta") }}
            </p>
            <v-icon icon="mdi-barcode" size="28" style="color: #111110" />
          </button>
          <button
            type="button"
            class="flex justify-between items-center px-5 py-3 md:py-3 flex-1 md:w-52 cursor-pointer border border-charcoal-border hover:opacity-70 transition-opacity"
            @click="$router.push('/library')"
          >
            <p
              class="font-heading font-black text-2xl leading-none text-text-primary"
            >
              {{ $t("home.go_to_library") }}
            </p>
            <v-icon
              icon="mdi-bookshelf"
              size="28"
              class="text-text-secondary"
            />
          </button>
        </div>
      </div>
    </div>

    <!-- Loading -->
    <div v-if="loading" class="flex-1 flex items-center justify-center">
      <v-progress-circular indeterminate color="primary" size="24" width="2" />
    </div>

    <!-- Empty state -->
    <div
      v-else-if="statsData && statsData.total === 0"
      class="flex-1 flex flex-col items-center justify-center gap-3 px-6"
    >
      <p class="font-heading font-black text-3xl text-text-primary text-center">
        {{ $t("home.dashboard_empty_heading") }}
      </p>
      <p class="text-sm text-text-secondary text-center max-w-xs">
        {{ $t("home.dashboard_empty_body") }}
      </p>
    </div>

    <!-- Dashboard -->
    <div
      v-else-if="statsData"
      class="flex-1 md:min-h-0 overflow-y-auto px-6 md:px-14 pb-28 md:pb-8 flex flex-col gap-5"
    >
      <!-- Random first line spotlight -->
      <div v-if="randomQuote" class="shrink-0">
        <p
          class="font-mono text-[15px] md:text-[17px] text-text-primary leading-snug"
        >
          "{{ randomQuote.firstLine }}"
        </p>
        <p
          class="font-mono text-[10px] tracking-[0.15em] uppercase text-text-secondary mt-1.5"
        >
          — {{ randomQuote.title }}
        </p>
      </div>

      <!-- Stat tiles: 2×3 mobile, 5-col desktop -->
      <div
        class="grid grid-cols-2 md:grid-cols-5 border-t border-l border-charcoal-border shrink-0"
      >
        <div
          v-for="tile in statTiles"
          :key="tile.key"
          class="border-r border-b border-charcoal-border px-[18px] py-[16px] md:px-[22px] md:py-[18px] flex flex-col"
        >
          <div class="flex items-center gap-2 mb-3">
            <span
              class="w-[7px] h-[7px] rounded-full shrink-0"
              :style="{ background: tile.color }"
            ></span>
            <span
              class="font-mono text-[9px] tracking-[0.2em] uppercase text-text-secondary"
              >{{ tile.label }}</span
            >
          </div>
          <div class="flex items-baseline gap-2 mb-3">
            <span
              class="font-heading font-black text-[1.8rem] md:text-[2.4rem] leading-none text-text-primary"
              >{{ tile.value }}</span
            >
            <span class="font-mono text-[9px] text-text-secondary">{{
              tile.pctLabel
            }}</span>
          </div>
          <div class="h-[3px] bg-charcoal-border relative">
            <div
              class="absolute left-0 top-0 bottom-0 transition-[width] duration-700"
              :style="{ width: tile.barWidth, background: tile.color }"
            ></div>
          </div>
        </div>
      </div>

      <!-- Two columns -->
      <div class="flex flex-col md:flex-row gap-5 md:gap-9 flex-1 md:min-h-0">
        <!-- Left: at-a-glance + by-the-numbers -->
        <div class="flex-1 min-w-0 flex flex-col gap-5">
          <!-- Collection at a glance -->
          <div
            class="border border-charcoal-border px-[22px] py-[18px] md:px-[26px] md:py-[22px] shrink-0"
          >
            <div class="flex justify-between items-baseline mb-4">
              <span
                class="font-mono text-[9px] tracking-[0.3em] uppercase text-orange-neon"
                >{{ $t("home.glance_title") }}</span
              >
              <AppSelect
                v-model="glanceMode"
                :options="dimensionOptions"
                :min-width="140"
              />
            </div>
            <div class="flex h-3 gap-0.5 mb-4">
              <div
                v-for="seg in glanceData"
                :key="seg.label"
                class="transition-[width] duration-500"
                :style="{ width: seg.pctWidth, background: seg.color }"
              ></div>
            </div>
            <div class="grid grid-cols-2 md:grid-cols-3 gap-y-2 gap-x-5">
              <div
                v-for="seg in glanceData"
                :key="seg.label"
                class="flex items-center gap-2"
              >
                <span
                  class="w-2 h-2 shrink-0"
                  :style="{ background: seg.color }"
                ></span>
                <span
                  class="flex-1 min-w-0 text-[11px] text-text-primary truncate"
                  >{{ seg.label }}</span
                >
                <span class="font-mono text-[10px] text-text-secondary">{{
                  seg.pctLabel
                }}</span>
              </div>
            </div>
          </div>

          <!-- By the numbers -->
          <div
            class="flex flex-col md:flex-row gap-5 md:gap-0 flex-1 md:min-h-0"
          >
            <div class="md:w-[280px] md:shrink-0 flex flex-col justify-start">
              <p
                class="font-mono text-[8px] tracking-[0.22em] uppercase text-text-secondary mb-2.5"
              >
                {{ $t("home.median_year") }}
              </p>
              <p
                v-if="statsData.medianYear != null"
                class="font-heading font-black text-[3.5rem] md:text-[82px] leading-[0.85] tracking-[-0.02em] text-text-primary"
              >
                {{ statsData.medianYear }}
              </p>
              <p
                v-else
                class="font-heading font-black text-[3.5rem] md:text-[82px] leading-none text-text-secondary"
              >
                —
              </p>
              <p class="text-[13px] text-text-secondary leading-snug mt-3">
                {{ $t("home.median_year_desc") }}
              </p>
              <p
                class="font-mono text-[8px] tracking-[0.22em] uppercase text-text-secondary mt-4 pt-4 border-t border-charcoal-border mb-2.5"
              >
                {{ $t("home.avg_length") }}
              </p>
              <p class="flex items-baseline gap-2">
                <span
                  v-if="statsData.avgPages != null"
                  class="font-heading font-black text-[3.5rem] md:text-[82px] leading-[0.85] tracking-[-0.02em] text-text-primary"
                  >{{ formatCount(statsData.avgPages) }}</span
                >
                <span
                  v-else
                  class="font-heading font-black text-[3.5rem] md:text-[82px] leading-none text-text-secondary"
                  >—</span
                >
                <span
                  v-if="statsData.avgPages != null"
                  class="font-heading font-bold text-[14px] text-orange-neon"
                  >{{ $t("home.unit_pp") }}</span
                >
              </p>
              <p class="text-[13px] text-text-secondary leading-snug mt-3">
                {{ $t("home.avg_length_desc") }}
              </p>
            </div>
            <div
              class="md:flex-1 border-t md:border-t-0 border-charcoal-border pt-4 md:pt-0 md:pl-9 flex flex-col justify-start"
            >
              <div
                v-for="item in trioItems"
                :key="item.key"
                class="flex items-baseline justify-between py-[13px] border-b border-charcoal-border"
              >
                <span
                  class="font-mono text-[9px] tracking-[0.2em] uppercase text-text-secondary"
                  >{{ item.kicker }}</span
                >
                <span class="flex items-baseline gap-1.5">
                  <span
                    class="font-heading font-black text-[28px] leading-none text-text-primary"
                    >{{ item.value ?? "—" }}</span
                  >
                  <span
                    v-if="item.unit"
                    class="font-heading font-bold text-[14px] text-orange-neon"
                    >{{ item.unit }}</span
                  >
                </span>
              </div>
            </div>
          </div>
        </div>

        <!-- Right: top authors -->
        <div
          class="md:w-[330px] md:shrink-0 border-t md:border-t-0 md:border-l border-charcoal-border pt-5 md:pt-0 md:pl-9 flex flex-col"
        >
          <div class="flex justify-between items-baseline mb-5">
            <span
              class="font-mono text-[9px] tracking-[0.3em] uppercase text-orange-neon"
              >{{ $t("home.most_represented") }}</span
            >
            <AppSelect
              v-model="mostRepMode"
              :options="dimensionOptions"
              :min-width="140"
            />
          </div>
          <div class="flex flex-col gap-4">
            <div
              v-for="(item, i) in mostRepresentedData"
              :key="item.name"
              :class="i >= 4 ? 'hidden md:block' : ''"
            >
              <div class="flex justify-between items-baseline mb-[7px]">
                <span
                  class="font-heading font-bold text-[14px] text-text-primary"
                  >{{ item.name }}</span
                >
                <span class="font-mono text-[11px] text-text-secondary">{{
                  item.count
                }}</span>
              </div>
              <div class="h-[3px] bg-charcoal-border relative">
                <div
                  class="absolute left-0 top-0 bottom-0"
                  :style="{ width: item.barWidth, background: item.color }"
                ></div>
              </div>
            </div>
          </div>
          <!-- Translation ratio -->
          <div
            v-if="statsData.translationRatio"
            class="mt-5 pt-2 border-t border-charcoal-border"
          >
            <div class="flex items-baseline justify-between">
              <span
                class="font-mono text-[9px] tracking-[0.2em] uppercase text-text-secondary"
                >{{ $t("home.translation_ratio") }}</span
              >
              <span class="flex items-baseline gap-1.5">
                <span
                  class="font-heading font-black text-[28px] leading-none text-text-primary"
                  >{{ statsData.translationRatio.pct }}</span
                >
                <span
                  class="font-heading font-bold text-[14px] text-orange-neon"
                  >%</span
                >
              </span>
            </div>
            <div class="h-[3px] bg-charcoal-border relative mt-2">
              <div
                class="absolute left-0 top-0 bottom-0"
                :style="{
                  width: statsData.translationRatio.pct + '%',
                  background: 'rgb(var(--v-theme-primary))',
                }"
              ></div>
            </div>
          </div>

          <!-- Decade × genre rotator -->
          <div
            v-if="currentDecadeGenre"
            class="mt-5 pt-4 border-t border-charcoal-border"
          >
            <transition name="fade" mode="out-in">
              <p
                :key="currentDecadeGenre.decade"
                class="text-[13px] text-text-secondary leading-snug"
              >
                {{
                  $t("home.decade_genre_line", {
                    decade: currentDecadeGenre.decade,
                    genre: currentDecadeGenre.genre,
                    count: currentDecadeGenre.count,
                    total: currentDecadeGenre.total_count,
                  })
                }}
              </p>
            </transition>
          </div>
        </div>
      </div>
    </div>

    <!-- First-name onboarding dialog -->
    <v-dialog v-model="firstnameDialog" max-width="420" persistent>
      <v-card rounded="0" class="bg-menu-surface">
        <v-card-text class="px-8 pt-8 pb-8">
          <p
            class="font-mono text-[10px] tracking-[0.3em] uppercase text-text-secondary mb-3"
          >
            {{ $t("home.firstname_dialog_eyebrow") }}
          </p>
          <h2
            class="font-heading font-black text-3xl text-text-primary leading-tight mb-2"
          >
            {{ $t("home.firstname_dialog_heading") }}
          </h2>
          <p class="text-sm text-text-secondary mb-8">
            {{ $t("home.firstname_dialog_body") }}
          </p>
          <div class="border-b border-charcoal-border pb-2 mb-8">
            <label
              for="firstname-input"
              class="block text-[10px] tracking-[0.2em] uppercase text-text-secondary mb-1"
            >
              {{ $t("home.firstname_placeholder") }}
            </label>
            <input
              id="firstname-input"
              v-model="firstnameInput"
              type="text"
              autocomplete="given-name"
              autofocus
              class="w-full bg-transparent text-text-primary text-base placeholder:text-charcoal-border"
              :placeholder="$t('home.firstname_placeholder')"
              @keyup.enter="saveFirstname"
            />
          </div>
          <LoadingButton
            :loading="savingFirstname"
            :disabled="!firstnameInput.trim()"
            class="bg-text-primary text-charcoal hover:opacity-80"
            @click="saveFirstname"
          >
            {{
              savingFirstname ? $t("detail.saving") : $t("home.firstname_save")
            }}
          </LoadingButton>
        </v-card-text>
      </v-card>
    </v-dialog>

    <AppToast
      v-model="errorToast"
      :message="errorMessage"
      type="error"
      :timeout="4000"
    />
  </div>
</template>

<script lang="ts" setup>
import { ref, computed, watch, onMounted, onUnmounted } from "vue";
import { useI18n } from "vue-i18n";
import { useAuthStore } from "@/stores/auth";
import { useThemeStore } from "@/stores/theme";
import { useLocaleStore } from "@/stores/locale";
import { useFieldDefsStore } from "@/stores/fieldDefs";
import AppHeader from "@/components/AppHeader.vue";
import AppSelect from "@/components/AppSelect.vue";
import AppToast from "@/components/AppToast.vue";
import LoadingButton from "@/components/LoadingButton.vue";
import { useApi } from "@/composables/useApi";
import { useToast } from "@/composables/useToast";
import { useGroupDimensions } from "@/composables/useGroupDimensions";
import { STATUS_META } from "@/composables/useBookStatus";
import { BCP47 } from "@/plugins/i18n";
import type { CollectionStats } from "@/types/stats";
import type { GroupBy } from "@/types/library";
import { languageDisplayFormatter } from "@/utils/language";

const { t } = useI18n();
const authStore = useAuthStore();
const themeStore = useThemeStore();
const localeStore = useLocaleStore();
const fieldDefsStore = useFieldDefsStore();
const { apiFetch } = useApi();
const { dimensionOptions } = useGroupDimensions();

// ── State ─────────────────────────────────────────────────────────────────────

const statsData = ref<CollectionStats | null>(null);
const loading = ref(false);
const {
  visible: errorToast,
  message: errorMessage,
  showToast,
} = useToast();
const randomQuote = ref<{ title: string; firstLine: string } | null>(null);

function normalizeStats(payload: any): CollectionStats {
  return {
    total: payload?.total ?? 0,
    byStatus: {
      read: payload?.byStatus?.read ?? 0,
      reading: payload?.byStatus?.reading ?? 0,
      unread: payload?.byStatus?.unread ?? 0,
      dnf: payload?.byStatus?.dnf ?? 0,
    },
    genres: payload?.genres ?? [],
    uncategorizedGenreCount: payload?.uncategorizedGenreCount ?? 0,
    languages: payload?.languages ?? [],
    languageCount: payload?.languageCount ?? 0,
    topAuthors: payload?.topAuthors ?? [],
    authorCount: payload?.authorCount ?? 0,
    publishers: payload?.publishers ?? [],
    forms: payload?.forms ?? [],
    subjects: payload?.subjects ?? [],
    countries: payload?.countries ?? [],
    decades: payload?.decades ?? [],
    decadeGenres: payload?.decadeGenres ?? [],
    topSeries: payload?.topSeries ?? [],
    customFields: payload?.customFields ?? [],
    avgPages: payload?.avgPages ?? null,
    totalPagesRead: payload?.totalPagesRead ?? null,
    medianYear: payload?.medianYear ?? null,
    yearKnownCount: payload?.yearKnownCount ?? 0,
    genreCount: payload?.genreCount ?? 0,
    translationRatio: payload?.translationRatio ?? null,
    randomFirstLine: payload?.randomFirstLine ?? null,
  };
}

function formatCount(value: number | null | undefined): string {
  return value == null ? "—" : value.toLocaleString();
}

// ── First-name onboarding ─────────────────────────────────────────────────────

const firstnameDialog = ref(!authStore.firstname);
const firstnameInput = ref("");
const savingFirstname = ref(false);

const saveFirstname = async () => {
  if (!firstnameInput.value.trim() || savingFirstname.value) return;
  savingFirstname.value = true;
  try {
    const res = await apiFetch("/api/auth/me", {
      method: "PATCH",
      body: JSON.stringify({ firstname: firstnameInput.value.trim() }),
    });
    if (res.ok) {
      authStore.setFirstname(firstnameInput.value.trim());
      firstnameDialog.value = false;
    }
  } catch {}
  savingFirstname.value = false;
};

// ── Derived ───────────────────────────────────────────────────────────────────

const greeting = computed(() => {
  const hour = new Date().getHours();
  const name =
    authStore.firstname ??
    (() => {
      const raw = (authStore.email ?? "").split("@")[0];
      return raw.charAt(0).toUpperCase() + raw.slice(1);
    })();
  const key =
    hour < 6
      ? "greeting_night"
      : hour < 12
        ? "greeting_morning"
        : hour < 17
          ? "greeting_afternoon"
          : hour < 22
            ? "greeting_evening"
            : "greeting_night";
  return t(`home.${key}`, { name });
});

const metaLine = computed(() => {
  const locale = BCP47[localeStore.locale] ?? "en-GB";
  const dateStr = new Date().toLocaleDateString(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  return t("home.meta", {
    date: dateStr,
    count: (statsData.value?.total ?? 0).toLocaleString(),
  });
});

// ── Color helpers ─────────────────────────────────────────────────────────────

const colorRamp = computed<string[]>(() =>
  themeStore.isDark
    ? [
        "rgb(var(--v-theme-primary))",
        "#b8afa6",
        "#8a8078",
        "#5c544e",
        "#3a3631",
        "#2a2724",
      ]
    : [
        "rgb(var(--v-theme-primary))",
        "#8a7a70",
        "#5c5249",
        "#3d3631",
        "#2a2421",
        "#c9c3bb",
      ],
);

// ── Dimension data helper ─────────────────────────────────────────────────────

const langFmt = computed(() => languageDisplayFormatter(localeStore.locale));

function getBreakdown(
  mode: GroupBy,
  stats: CollectionStats,
): { label: string; count: number }[] {
  switch (mode) {
    case "genre":
      return stats.genres;
    case "language":
      return stats.languages.map((l) => ({
        label: langFmt.value(l.code),
        count: l.count,
      }));
    case "author":
      return stats.topAuthors;
    case "series":
      return stats.topSeries;
    case "publisher":
      return stats.publishers;
    case "form":
      return stats.forms;
    case "country":
      return stats.countries;
    case "decade":
      return stats.decades;
    case "subject":
      return stats.subjects;
    case "status":
      return []; // handled separately with fixed colors
    case "none":
      return [];
    default: {
      const m = (mode as string).match(/^cf:(\d+)$/);
      if (m)
        return (
          stats.customFields.find((cf) => cf.fieldDefId === Number(m[1]))
            ?.values ?? []
        );
      return [];
    }
  }
}

// ── At a glance ───────────────────────────────────────────────────────────────

const glanceMode = ref<GroupBy>("genre");
const mostRepMode = ref<GroupBy>("author");

const glanceData = computed(() => {
  if (!statsData.value) return [];
  const { total, byStatus } = statsData.value;
  const ramp = colorRamp.value;
  const pctOf = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);
  const pctStr = (n: number) => pctOf(n) + "%";

  if (glanceMode.value === "status") {
    return [
      {
        label: t("book.read"),
        color: STATUS_META.read.themeColor,
        pctWidth: pctStr(byStatus.read),
        pctLabel: pctStr(byStatus.read),
      },
      {
        label: t("book.unread"),
        color: STATUS_META.unread.themeColor,
        pctWidth: pctStr(byStatus.unread),
        pctLabel: pctStr(byStatus.unread),
      },
      {
        label: t("book.reading"),
        color: STATUS_META.reading.themeColor,
        pctWidth: pctStr(byStatus.reading),
        pctLabel: pctStr(byStatus.reading),
      },
      {
        label: t("book.dnf"),
        color: STATUS_META.dnf.themeColor,
        pctWidth: pctStr(byStatus.dnf),
        pctLabel: pctStr(byStatus.dnf),
      },
    ].filter((s) => s.pctWidth !== "0%");
  }

  const top = getBreakdown(glanceMode.value, statsData.value).slice(0, 5);
  const topTotal = top.reduce((s, a) => s + a.count, 0);
  const otherCount = total - topTotal;
  const segs = top.map((item, i) => ({
    label: item.label,
    color: ramp[i] ?? ramp.at(-1),
    pctWidth: pctStr(item.count),
    pctLabel: pctStr(item.count),
  }));
  if (otherCount > 0)
    segs.push({
      label: t("home.glance_other"),
      color: ramp[5] ?? ramp[4],
      pctWidth: pctStr(otherCount),
      pctLabel: pctStr(otherCount),
    });
  return segs;
});

// ── Most represented (right column) ──────────────────────────────────────────

const mostRepresentedData = computed(() => {
  if (!statsData.value) return [];
  const { byStatus, total } = statsData.value;
  const ramp = colorRamp.value;
  const barWidth = (count: number, max: number) =>
    max > 0 ? Math.round((count / max) * 100) + "%" : "0%";

  if (mostRepMode.value === "status") {
    const items = [
      {
        label: t("book.read"),
        count: byStatus.read,
        color: STATUS_META.read.themeColor,
      },
      {
        label: t("book.unread"),
        count: byStatus.unread,
        color: STATUS_META.unread.themeColor,
      },
      {
        label: t("book.reading"),
        count: byStatus.reading,
        color: STATUS_META.reading.themeColor,
      },
      {
        label: t("book.dnf"),
        count: byStatus.dnf,
        color: STATUS_META.dnf.themeColor,
      },
    ].filter((s) => s.count > 0);
    const max = total > 0 ? total : 1;
    return items.map((s) => ({
      name: s.label,
      count: s.count,
      barWidth: barWidth(s.count, max),
      color: s.color,
    }));
  }

  const items = getBreakdown(mostRepMode.value, statsData.value).slice(0, 6);
  const max = items[0]?.count ?? 1;
  return items.map((item, i) => ({
    name: item.label,
    count: item.count,
    barWidth: barWidth(item.count, max),
    color:
      mostRepMode.value === "author" && i === 0
        ? "rgb(var(--v-theme-primary))"
        : mostRepMode.value === "author"
          ? "var(--color-chart-muted)"
          : (ramp[i] ?? ramp.at(-1)),
  }));
});

// ── Stat tiles ────────────────────────────────────────────────────────────────

const statTiles = computed(() => {
  if (!statsData.value) return [];
  const { total, byStatus } = statsData.value;
  const pctOf = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);
  const totalColor = "var(--color-chart-total)";
  return [
    {
      key: "total",
      label: t("home.stat_total"),
      value: formatCount(total),
      pctLabel: "100%",
      barWidth: "100%",
      color: totalColor,
    },
    {
      key: "read",
      label: t("home.stat_read"),
      value: formatCount(byStatus.read),
      pctLabel: pctOf(byStatus.read) + "%",
      barWidth: Math.max(pctOf(byStatus.read), byStatus.read > 0 ? 4 : 0) + "%",
      color: STATUS_META.read.themeColor,
    },
    {
      key: "unread",
      label: t("home.stat_unread"),
      value: formatCount(byStatus.unread),
      pctLabel: pctOf(byStatus.unread) + "%",
      barWidth: pctOf(byStatus.unread) + "%",
      color: STATUS_META.unread.themeColor,
    },
    {
      key: "reading",
      label: t("home.stat_reading"),
      value: formatCount(byStatus.reading),
      pctLabel: pctOf(byStatus.reading) + "%",
      barWidth:
        Math.max(pctOf(byStatus.reading), byStatus.reading > 0 ? 4 : 0) + "%",
      color: STATUS_META.reading.themeColor,
    },
    {
      key: "dnf",
      label: t("home.stat_dnf"),
      value: formatCount(byStatus.dnf),
      pctLabel: pctOf(byStatus.dnf) + "%",
      barWidth: Math.max(pctOf(byStatus.dnf), byStatus.dnf > 0 ? 4 : 0) + "%",
      color: STATUS_META.dnf.themeColor,
    },
  ];
});

// ── Decade × genre rotator ──────────────────────────────────────────────────────

const decadeGenreIndex = ref(0);
let decadeGenreTimer: ReturnType<typeof setInterval> | undefined;

const currentDecadeGenre = computed(() => {
  const list = statsData.value?.decadeGenres ?? [];
  if (list.length === 0) return null;
  return list[decadeGenreIndex.value % list.length];
});

// ── By the numbers ────────────────────────────────────────────────────────────

const trioItems = computed(() => {
  if (!statsData.value) return [];
  const { totalPagesRead, decades, languageCount, authorCount, genreCount } =
    statsData.value;
  return [
    {
      key: "total_pages",
      kicker: t("home.total_pages_read"),
      value: formatCount(totalPagesRead),
      unit: t("home.unit_pp"),
    },
    {
      key: "decade",
      kicker: t("home.richest_decade"),
      value: decades[0]?.label ?? null,
      unit: "",
    },
    {
      key: "langs",
      kicker: t("home.languages_label"),
      value: languageCount > 0 ? languageCount : null,
      unit: "",
    },
    {
      key: "authors",
      kicker: t("home.authors_label"),
      value: authorCount > 0 ? authorCount : null,
      unit: "",
    },
    {
      key: "genres",
      kicker: t("home.genres_label"),
      value: genreCount > 0 ? genreCount : null,
      unit: "",
    },
  ];
});

// ── Data fetching ─────────────────────────────────────────────────────────────

const fetchStats = async () => {
  try {
    const res = await apiFetch(`/api/stats?locale=${localeStore.locale}`);
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to fetch stats");
    statsData.value = normalizeStats(data);
    // Only set once per page load — locale-triggered refetches shouldn't change the quote.
    if (randomQuote.value === null && data.randomFirstLine) {
      randomQuote.value = data.randomFirstLine;
    }
  } catch (err: any) {
    showToast(err.message, "error");
  }
};

onMounted(async () => {
  loading.value = true;
  await Promise.all([fetchStats(), fieldDefsStore.load()]);
  loading.value = false;
  decadeGenreTimer = setInterval(() => {
    decadeGenreIndex.value++;
  }, 15_000);
});

onUnmounted(() => {
  if (decadeGenreTimer) clearInterval(decadeGenreTimer);
});

watch(
  () => localeStore.locale,
  () => fetchStats(),
);
</script>

<style scoped>
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s;
}
.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
