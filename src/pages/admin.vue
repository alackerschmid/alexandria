<template>
  <!-- force-dark: an operator board reads as an instrument panel, and the signal colors are
       tuned against a near-black surface — so it stays dark in either app theme. -->
  <div class="force-dark bg-charcoal min-h-screen flex flex-col">
    <AppHeader />

    <SignalPips
      :quota-percent="quotaPercent"
      :quota-level="quotaLevel"
      :enrichment-percent="enrichmentPercent"
      :run-failure-percent="runFailurePercent"
      :run-failure-level="runFailureLevel"
      :rate-limited="rateLimitedInRange"
      :range-label="rangeLabel"
      :loading="loading"
      @refresh="loadAll"
    />

    <main
      class="flex-1 px-5 md:px-10 pt-5 pb-9 md:pt-6.5 md:pb-11 flex flex-col gap-6.5 md:gap-7.5"
    >
      <SectionSkeleton v-if="usage.loading && !usage.data" :rows="3" />
      <SectionError
        v-else-if="usage.error"
        :title="$t('admin.quota.title')"
        :detail="usage.error"
        :retrying="usage.loading"
        @retry="loadUsage"
      />
      <QuotaGauge
        v-else-if="usage.data"
        :used="usage.data.googleBooksToday.calls"
        :limit="GOOGLE_BOOKS_DAILY_QUOTA"
        :level="quotaLevel"
        :projected="projectedEod"
        :peak="peakLabel"
      />

      <SectionSkeleton v-if="overview.loading && !overview.data" :rows="5" />
      <SectionError
        v-else-if="overview.error"
        :title="$t('admin.vitals.title')"
        :detail="overview.error"
        :retrying="overview.loading"
        @retry="loadOverview"
      />
      <VitalsStrips v-else-if="overview.data" :overview="overview.data" />

      <template v-if="usage.data && !usage.error">
        <UsageChart
          :columns="hourColumns"
          :hours="hours"
          @update:hours="setHours"
        />
        <EndpointTable :rows="usage.data.totals" :range-label="rangeLabel" />
      </template>

      <SectionSkeleton v-if="users.loading && !users.data" :rows="4" />
      <SectionError
        v-else-if="users.error"
        :title="$t('admin.roster.title')"
        :detail="users.error"
        :retrying="users.loading"
        @retry="loadUsers"
      />
      <UserRoster v-else-if="users.data" :users="users.data" />
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import AppHeader from "@/components/AppHeader.vue";
import SignalPips from "@/components/admin/SignalPips.vue";
import QuotaGauge from "@/components/admin/QuotaGauge.vue";
import VitalsStrips from "@/components/admin/VitalsStrips.vue";
import UsageChart from "@/components/admin/UsageChart.vue";
import EndpointTable from "@/components/admin/EndpointTable.vue";
import UserRoster from "@/components/admin/UserRoster.vue";
import SectionError from "@/components/admin/SectionError.vue";
import SectionSkeleton from "@/components/admin/SectionSkeleton.vue";
import { useApi } from "@/composables/useApi";
import type { AdminOverview, AdminUsage, AdminUserRow } from "@/types/admin";
import {
  GOOGLE_BOOKS_DAILY_QUOTA,
  buildHourColumns,
  peakHour,
  percent,
  projectEndOfDay,
  quotaLevel as quotaLevelFor,
} from "@/utils/admin-usage";
import { failureLevel } from "@/utils/admin-signal";
import type { SignalLevel } from "@/utils/admin-signal";

const { apiFetch } = useApi();
const { t, locale } = useI18n();
const router = useRouter();

type Section<T> = { data: T | null; loading: boolean; error: string | null };

const overview = reactive<Section<AdminOverview>>({
  data: null,
  loading: false,
  error: null,
});
const usage = reactive<Section<AdminUsage>>({
  data: null,
  loading: false,
  error: null,
});
const users = reactive<Section<AdminUserRow[]>>({
  data: null,
  loading: false,
  error: null,
});

const hours = computed(() => usage.data?.hours ?? DEFAULT_HOURS);
const DEFAULT_HOURS = 48;
let requestedHours = DEFAULT_HOURS;

/**
 * Each section owns its own request and its own failure. A 403 is different in kind — it means
 * the stored admin flag is stale (the column was flipped off, or this is a session from before
 * it was flipped on), so the page bows out entirely rather than showing three access errors.
 */
async function load<T>(
  section: Section<T>,
  path: string,
  pick: (payload: any) => T,
): Promise<void> {
  section.loading = true;
  section.error = null;
  try {
    const res = await apiFetch(path);
    if (res.status === 403) {
      router.replace({ name: "dashboard" });
      return;
    }
    const payload = await res.json();
    if (!res.ok) {
      section.error = `GET ${path} — ${res.status} ${payload?.error ?? ""}`.trim();
      return;
    }
    section.data = pick(payload);
  } catch {
    section.error = `GET ${path} — ${t("admin.error.network")}`;
  } finally {
    section.loading = false;
  }
}

const loadOverview = () =>
  load(overview, "/api/admin/overview", (p) => p as AdminOverview);
const loadUsage = () =>
  load(usage, `/api/admin/usage?hours=${requestedHours}`, (p) => p as AdminUsage);
const loadUsers = () =>
  load(users, "/api/admin/users", (p) => (p.users ?? []) as AdminUserRow[]);

// Fired together, awaited together only so the Refresh button can show a single busy state.
const loadAll = () => Promise.all([loadOverview(), loadUsage(), loadUsers()]);

function setHours(next: number) {
  requestedHours = next;
  void loadUsage();
}

onMounted(loadAll);

const loading = computed(
  () => overview.loading || usage.loading || users.loading,
);

// ── Derived readings ─────────────────────────────────────────────────────────

const quotaPercent = computed(() =>
  usage.data
    ? percent(usage.data.googleBooksToday.calls, GOOGLE_BOOKS_DAILY_QUOTA)
    : null,
);
const quotaLevel = computed<SignalLevel>(() =>
  usage.data
    ? quotaLevelFor(usage.data.googleBooksToday.calls, GOOGLE_BOOKS_DAILY_QUOTA)
    : "neutral",
);

const projectedEod = computed(() =>
  usage.data
    ? projectEndOfDay(
        usage.data.googleBooksToday.calls,
        Date.now(),
        usage.data.googleBooksToday.utcDayStart,
      )
    : null,
);

const hourColumns = computed(() =>
  usage.data
    ? buildHourColumns(usage.data.series, usage.data.fromHour, usage.data.hours)
    : [],
);

const peakLabel = computed(() => {
  const peak = peakHour(hourColumns.value);
  if (!peak) return null;
  const time = new Date(peak.hourStart).toLocaleTimeString(locale.value, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  return `${time} · ${peak.total}`;
});

const rateLimitedInRange = computed(() =>
  usage.data
    ? usage.data.totals.reduce((sum, r) => sum + r.rateLimited, 0)
    : null,
);

const rangeLabel = computed(() =>
  hours.value >= 168
    ? t("admin.range.days", { days: Math.round(hours.value / 24) })
    : t("admin.range.hours", { hours: hours.value }),
);

const enrichmentPercent = computed(() => {
  if (!overview.data) return null;
  const e = overview.data.enrichment;
  const total = e.done + e.pending + e.failed + e.exhausted;
  return percent(e.done, total);
});

const runFailurePercent = computed(() => {
  if (!overview.data) return null;
  const r = overview.data.enrichmentRuns24h;
  return percent(r.byOutcome.failed, r.total);
});
const runFailureLevel = computed<SignalLevel>(() =>
  runFailurePercent.value === null
    ? "neutral"
    : failureLevel(runFailurePercent.value),
);
</script>
