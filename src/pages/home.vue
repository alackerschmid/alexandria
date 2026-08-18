<template>
  <!-- Home scrolls. The old `md:h-screen overflow-hidden` shell fitted a grid of numbers into one
       viewport; this page shows covers, which need room. -->
  <div
    class="bg-charcoal min-h-screen flex flex-col"
    :class="{ 'blur-sm': firstnameDialog }"
  >
    <AppHeader />

    <!-- Welcome band -->
    <div class="shrink-0 w-full max-w-300 mx-auto px-6 md:px-10 pt-5 md:pt-8 pb-3">
      <div
        class="flex flex-col md:flex-row md:items-end md:justify-between gap-6 md:gap-16"
      >
        <div class="min-w-0">
          <p
            class="font-mono text-[9px] tracking-[0.3em] uppercase text-orange-neon mb-4"
          >
            {{ $t("home.welcome") }}
          </p>
          <h1
            class="font-heading font-bold text-[2.2rem] md:text-[2.75rem] leading-[1.02] text-text-primary mb-2"
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
              class="font-heading font-bold text-2xl leading-none"
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
              class="font-heading font-bold text-2xl leading-none text-text-primary"
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
    <div v-if="loading" class="flex-1 flex items-center justify-center py-20">
      <v-progress-circular indeterminate color="primary" size="24" width="2" />
    </div>

    <!-- Load error, but only with nothing to fall back on. A failed refetch keeps the page it
         already has and says so through the toast; a failed first load used to leave every
         branch below false, i.e. a page with a greeting and nothing else. -->
    <div
      v-else-if="loadError && !statsData"
      class="flex-1 flex flex-col items-center justify-center gap-4 px-6 py-20"
    >
      <p class="text-sm text-text-secondary text-center">
        {{ $t("home.load_failed") }}
      </p>
      <button
        type="button"
        class="text-xs font-bold tracking-[0.25em] uppercase border-b border-text-primary pb-0.5 text-text-primary hover:opacity-70 transition-opacity cursor-pointer"
        @click="load"
      >
        {{ $t("home.retry") }}
      </button>
    </div>

    <!-- Empty states. Two of them, matching `/stats`: a genuinely empty library, and one whose
         books all sit outside the current collection scope — a Goodreads import writes every row
         at owning_status "unknown", where "scan your first book" would be plainly false. -->
    <div
      v-else-if="statsData && statsData.total === 0"
      class="flex-1 flex flex-col items-center justify-center gap-3 px-6 py-20"
    >
      <!-- Also gated on the scope: after a failed refetch the payload can lag the pill, and a
           switch-to-all button while the preference already reads All would be inert. -->
      <template v-if="unscopedCount > 0 && scope === 'owned'">
        <p class="font-heading font-bold text-3xl text-text-primary text-center">
          {{ $t("home.empty_scoped_heading") }}
        </p>
        <p class="text-sm text-text-secondary text-center max-w-sm">
          {{ $t("home.empty_scoped_body", { count: unscopedCount }) }}
        </p>
        <AppButton class="mt-2" @click="scope = 'all'">
          {{ $t("home.empty_scoped_action") }}
        </AppButton>
      </template>
      <template v-else>
        <p class="font-heading font-bold text-3xl text-text-primary text-center">
          {{ $t("home.dashboard_empty_heading") }}
        </p>
        <p class="text-sm text-text-secondary text-center max-w-xs">
          {{ $t("home.dashboard_empty_body") }}
        </p>
      </template>
    </div>

    <!-- Content. pb-28 on mobile clears the fixed bottom tab bar. -->
    <div
      v-else-if="statsData"
      class="flex-1 w-full max-w-300 mx-auto px-6 md:px-10 pb-28 md:pb-10 flex flex-col gap-6 md:gap-8"
    >
      <!-- From the shelf -->
      <section v-if="spotlightPool.length" class="pt-2">
        <h2 class="font-mono text-[9px] tracking-[0.3em] uppercase text-orange-neon mb-4">{{ $t("home.shelf_title") }}</h2>
        <ShelfSpotlight :books="spotlightPool" />
      </section>

      <!-- Recently added -->
      <section
        v-if="recentInScope.length"
        class="pt-5 border-t border-charcoal-border"
      >
        <header class="flex justify-between items-baseline gap-3 mb-4">
          <h2
            class="font-mono text-[9px] tracking-[0.3em] uppercase text-orange-neon"
          >
            {{ $t("home.recently_added") }}
          </h2>
          <router-link
            :to="{ name: 'library' }"
            class="font-mono text-[10px] tracking-[0.14em] text-text-secondary hover:text-text-primary transition-colors"
          >
            {{ $t("home.recent_all", { count: statsData.total.toLocaleString() }) }}
            &rarr;
          </router-link>
        </header>
        <RecentlyAdded :books="recentInScope" />
      </section>

      <!-- Gaps + oddities -->
      <div
        v-if="gapRows.length || hasOddities"
        class="flex flex-col md:flex-row gap-6 md:gap-9 pt-5 border-t border-charcoal-border"
      >
        <section v-if="gapRows.length" class="flex-1 min-w-0">
          <h2 class="font-mono text-[9px] tracking-[0.3em] uppercase text-orange-neon mb-1.5">{{ $t("home.gaps_title") }}</h2>
          <ShelfGaps :rows="gapRows" />
          <router-link
            v-if="incompleteSeries.length > GAP_ROWS"
            :to="{ name: 'stats' }"
            class="inline-block mt-3.5 font-mono text-[10px] tracking-[0.14em] uppercase text-orange-neon hover:opacity-70 transition-opacity"
          >
            {{ $t("home.gaps_all", { count: incompleteSeries.length }) }} &rarr;
          </router-link>
        </section>

        <!-- The divider between the two columns belongs to whichever one is second, so a page
             with no series gaps doesn't draw a rule against the row's own top border. -->
        <section
          v-if="hasOddities"
          class="w-full md:flex-none"
          :class="
            gapRows.length
              ? 'md:w-82.5 border-t border-charcoal-border pt-5 md:border-t-0 md:pt-0 md:border-l md:border-charcoal-border md:pl-9'
              : 'md:w-full'
          "
        >
          <h2 class="font-mono text-[9px] tracking-[0.3em] uppercase text-orange-neon mb-1.5">{{ $t("home.oddities_title") }}</h2>
          <ShelfOddities :exemplars="statsData.exemplars" />
        </section>
      </div>

      <!-- The other half of the split: home names books, `/stats` counts them. -->
      <router-link
        :to="{ name: 'stats' }"
        class="self-center mt-2 font-mono text-[10px] tracking-[0.2em] uppercase text-orange-neon hover:opacity-70 transition-opacity"
      >
        {{ $t("home.see_all_stats") }} &rarr;
      </router-link>
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
            class="font-heading font-bold text-3xl text-text-primary leading-tight mb-2"
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
          <AppButton
            variant="primary"
            size="md"
            block
            :loading="savingFirstname"
            :disabled="!firstnameInput.trim()"
            @click="saveFirstname"
          >
            {{
              savingFirstname ? $t("detail.saving") : $t("home.firstname_save")
            }}
          </AppButton>
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
import { ref, computed, watch, onMounted } from "vue";
import { storeToRefs } from "pinia";
import { useI18n } from "vue-i18n";
import { useAuthStore } from "@/stores/auth";
import { useLocaleStore } from "@/stores/locale";
import { useFieldDefsStore } from "@/stores/fieldDefs";
import { useStatsDefaultsStore } from "@/stores/statsDefaults";
import { useLibraryDefaultsStore } from "@/stores/libraryDefaults";
import { usePreferencesStore } from "@/stores/preferences";
import AppHeader from "@/components/AppHeader.vue";
import AppToast from "@/components/AppToast.vue";
import AppButton from "@/components/AppButton.vue";
import ShelfSpotlight from "@/components/home/ShelfSpotlight.vue";
import RecentlyAdded from "@/components/home/RecentlyAdded.vue";
import ShelfGaps from "@/components/home/ShelfGaps.vue";
import ShelfOddities from "@/components/home/ShelfOddities.vue";
import { useApi } from "@/composables/useApi";
import { useToast } from "@/composables/useToast";
import type { SeriesMemberships } from "@/composables/useShelfGroups";
import { BCP47 } from "@/plugins/i18n";
import type { Book, OwningStatus } from "@/types/book";
import type {
  CollectionStats,
  SpotlightBook,
  StatsScope,
} from "@/types/stats";
import { countOutsideScope, normalizeStats } from "@/utils/stats-view";
import { createFetchSequencer } from "@/utils/fetch-seq";
import { summarizeSeries } from "@/utils/series-completeness";
import { greetingKey, greetingName } from "@/utils/greeting";

/** Covers in the recently-added strip. Deliberately small — this is a landing page, not the
 *  library, and the strip scrolls rather than paginating. */
const RECENT_LIMIT = 12;
/** Rows asked for, before the collection scope is applied. `GET /api/scans` takes no `?scope=`,
 *  so the strip is filtered on the client and has to draw from a wider window than it shows or a
 *  run of out-of-scope arrivals empties it. Still a fraction of the library's 500-row page. */
const RECENT_FETCH = 48;
/** Series named before the block defers to `/stats` for the rest. */
const GAP_ROWS = 4;

const { t } = useI18n();
const authStore = useAuthStore();
const localeStore = useLocaleStore();
const fieldDefsStore = useFieldDefsStore();
// One collection-scope preference, two collection surfaces: home must not default to `owned`
// independently, or an import-only library shows a blank home while `/stats` offers the fix.
const { scope } = storeToRefs(useStatsDefaultsStore());
const libraryDefaults = useLibraryDefaultsStore();
const preferencesStore = usePreferencesStore();
const { apiFetch } = useApi();
const { visible: errorToast, message: errorMessage, showToast } = useToast();

// ── State ─────────────────────────────────────────────────────────────────────

const statsData = ref<CollectionStats | null>(null);
const recent = ref<Book[]>([]);
const memberships = ref<SeriesMemberships>({});
const loading = ref(false);
const loadError = ref(false);
// Held across a *locale* refetch — the quote shouldn't change under the reader because they
// switched language — but not across a scope switch, which changes which books are eligible.
const spotlightPool = ref<SpotlightBook[]>([]);
const spotlightScope = ref<StatsScope | null>(null);

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

// ── Header ────────────────────────────────────────────────────────────────────

const greeting = computed(() => {
  const key = greetingKey(new Date().getHours());
  const name = greetingName(authStore.firstname, authStore.email);
  // No name at all falls to the nameless variant rather than interpolating "" and leaving a
  // comma with nothing after it.
  return name ? t(`home.${key}`, { name }) : t(`home.${key}_plain`);
});

// The status tiles are gone; the two counts they were worth survive here, and the full status
// breakdown lives on `/stats`.
const metaLine = computed(() => {
  const s = statsData.value;
  if (!s) return "";
  const locale = BCP47[localeStore.locale] ?? "en-GB";
  const dateStr = new Date().toLocaleDateString(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  return t("home.meta", {
    date: dateStr,
    count: s.total.toLocaleString(),
    unread: s.byStatus.unread.toLocaleString(),
  });
});

const unscopedCount = computed(() => countOutsideScope(statsData.value));

// ── Blocks ────────────────────────────────────────────────────────────────────

// The hero counts the collection scope, so everything under it must too. This strip used to be
// unscoped — the documented divergence — which under the default Owned scope on an imported
// library read "3 books" over a row of seventeen covers. `/api/scans` has no `?scope=`, so the
// gate is applied here, using the same pair of statuses the server's own ownership gate does.
const OWNED_STATUSES: ReadonlySet<OwningStatus> = new Set([
  "owned",
  "lent_out",
]);

const recentInScope = computed(() =>
  (scope.value === "owned"
    ? recent.value.filter((b) => OWNED_STATUSES.has(b.owning_status))
    : recent.value
  ).slice(0, RECENT_LIMIT),
);

// Honours the library's "Count novellas & side stories" setting, which is what that setting says
// it does ("Include non-whole-numbered entries in series counts") — these gaps are series counts.
// Reading the shared preference rather than deciding locally is what keeps this row, the stats
// page's completeness block and the library shelf from each claiming a different "N missing".
// Unnamed series are dropped rather than rendered through `stats.series_unnamed`: a dashboard
// row reading "Untitled series — 3 missing" reads as corrupted data, and the reader can do
// nothing with it. The name is `COALESCE(series_names.name, series.canonical_name)` server-side,
// so it is missing exactly when Wikidata found a series but nothing has named it yet — the empty
// string is checked as well as null, since COALESCE happily returns one.
const incompleteSeries = computed(() =>
  summarizeSeries(memberships.value, {
    mainOnly: libraryDefaults.mainOnly,
  }).rows.filter((r) => !r.complete && !!r.name?.trim()),
);

// Owned-only, matching `/stats`. `/api/series` takes no scope and answers against its own
// ownership gate, so under `all` this block would offer "all N series →" into a page that
// suppresses the whole completeness section and shows nothing the link promised.
const gapRows = computed(() =>
  scope.value === "owned" ? incompleteSeries.value.slice(0, GAP_ROWS) : [],
);

const hasOddities = computed(() => {
  const e = statsData.value?.exemplars;
  return !!(e && (e.oldest || e.longest || e.soleLanguage));
});

// ── Data ──────────────────────────────────────────────────────────────────────

// Sequenced for the same reason as /stats: a scope or locale switch can re-trigger load()
// while the previous request set is still in flight, and the stale set must not overwrite the
// fresh one (`scope=all` is systematically the slower stats query, so it tends to land last).
const nextLoad = createFetchSequencer();

const load = async () => {
  const isCurrent = nextLoad();
  const locale = localeStore.locale;
  // Read once, so the pool is compared against the scope this request actually asked for and
  // not against whatever the preference has moved to by the time it lands.
  const requestedScope = scope.value;
  // Owned by load() so a watcher-triggered refetch shows the spinner rather than the previous
  // scope's blocks under an already-switched preference.
  loading.value = true;
  try {
    // Three requests rather than one, run in parallel. Even at RECENT_FETCH rows `/api/scans` is
    // far lighter than the library's 500-row page, and a landing page can afford the fan-out.
    // The scope that request can't express is applied to the result in `recentInScope`.
    const [statsRes, scansRes, seriesRes] = await Promise.all([
      apiFetch(`/api/stats?locale=${locale}&scope=${requestedScope}`),
      apiFetch(
        `/api/scans?limit=${RECENT_FETCH}&sort=date_desc&locale=${locale}`,
      ),
      apiFetch(`/api/series?locale=${locale}`),
    ]);

    // Status before body: an upstream HTML error page makes `json()` throw a parse error, which
    // would otherwise mask the status it came with.
    if (!statsRes.ok) throw new Error(`GET /api/stats ${statsRes.status}`);
    const statsBody = await statsRes.json();
    // `/api/scans` answers with a bare array; anything else is a shape this page shouldn't
    // render through, so the strip stays empty rather than the block half-painting.
    const scansBody = scansRes.ok
      ? await scansRes.json().catch(() => null)
      : null;
    const seriesBody = seriesRes.ok
      ? await seriesRes.json().catch(() => null)
      : null;
    if (!isCurrent()) return; // superseded — a newer load() owns the page now
    statsData.value = normalizeStats(statsBody);
    loadError.value = false;
    // Re-drawn when the scope changes, so switching to Owned can't leave an `unowned` book
    // quoted under "From the shelf"; held otherwise, so a locale refetch keeps the quote.
    if (
      spotlightPool.value.length === 0 ||
      spotlightScope.value !== requestedScope
    ) {
      spotlightPool.value = statsData.value.spotlight;
      spotlightScope.value = requestedScope;
    }

    // Both secondary blocks degrade on their own rather than blanking the page — the pattern
    // `/stats` already uses for its series fetch.
    if (Array.isArray(scansBody)) recent.value = scansBody;
    if (seriesBody) memberships.value = seriesBody;
  } catch (err) {
    if (!isCurrent()) return;
    // Raw `err.message` was untranslated and often unreadable — offline gives "Failed to fetch".
    console.error("[home] load failed", err);
    loadError.value = true;
    showToast(t("home.load_failed"), "error");
  } finally {
    if (isCurrent()) loading.value = false;
  }
};

// Preferences first: both the locale and the collection scope this page fetches under are
// stored ones, and the watcher below re-loads when either changes — so loading before they
// arrive meant every cold load fetching the whole set twice.
onMounted(async () => {
  // Spinner up front, for the same reason: `load()` raises `loading` itself, but only once the
  // preferences it waits for have arrived.
  loading.value = true;
  await preferencesStore.whenReady();
  await Promise.all([load(), fieldDefsStore.load()]);
});

watch([() => localeStore.locale, scope], () => load());
</script>
