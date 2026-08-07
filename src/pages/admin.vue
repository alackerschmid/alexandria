<template>
  <!-- force-dark: an operator board reads as an instrument panel, and the signal colors are
       tuned against a near-black surface — so it stays dark in either app theme. -->
  <div class="force-dark bg-charcoal min-h-screen flex flex-col">
    <AppHeader />

    <SignalPips :readings="pips" :loading="loading" @refresh="loadAll" />

    <main
      class="flex-1 px-5 md:px-10 pt-5 pb-9 md:pt-6.5 md:pb-11 flex flex-col gap-6.5 md:gap-7.5"
    >
      <AdminSection
        :section="usage"
        :title="$t('admin.quota.title')"
        :rows="3"
        @retry="loadUsage"
      >
        <template #default="{ data }">
          <QuotaGauge
            :used="data.googleBooksToday.calls"
            :limit="GOOGLE_BOOKS_DAILY_QUOTA"
            :level="quotaLevel"
            :projected="projectedEod"
            :peak="peakLabel"
          />
        </template>
      </AdminSection>

      <AdminSection
        :section="overview"
        :title="$t('admin.vitals.title')"
        :rows="5"
        @retry="loadOverview"
      >
        <template #default="{ data }">
          <VitalsPanel
            :overview="data"
            @inspect="runDrill.inspect"
            @inspect-works="workDrill.inspect"
          />
        </template>
      </AdminSection>

      <RunDetailDialog
        v-model="runDrill.open.value"
        :reason="runDrill.filter.value"
        :section="runDrill.section"
        @filter="runDrill.inspect"
        @retry="runDrill.reload"
      />
      <WorkListDialog
        v-model="workDrill.open.value"
        :status="workDrill.filter.value"
        :section="workDrill.section"
        @filter="workDrill.inspect"
        @retry="workDrill.reload"
      />

      <template v-if="usage.data && !usage.error">
        <UsageChart
          :columns="hourColumns"
          :hours="hours"
          @update:hours="setHours"
        />
        <EndpointTable :rows="usage.data.totals" :range-label="rangeLabel" />
      </template>

      <AdminSection
        :section="users"
        :title="$t('admin.roster.title')"
        :rows="4"
        @retry="loadUsers"
      >
        <template #default="{ data }">
          <UserRoster :users="data" />
        </template>
      </AdminSection>
    </main>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from "vue";
import { useRouter } from "vue-router";
import { useI18n } from "vue-i18n";
import AppHeader from "@/components/AppHeader.vue";
import SignalPips from "@/components/admin/SignalPips.vue";
import QuotaGauge from "@/components/admin/QuotaGauge.vue";
import VitalsPanel from "@/components/admin/VitalsPanel.vue";
import UsageChart from "@/components/admin/UsageChart.vue";
import EndpointTable from "@/components/admin/EndpointTable.vue";
import UserRoster from "@/components/admin/UserRoster.vue";
import AdminSection from "@/components/admin/AdminSection.vue";
import RunDetailDialog from "@/components/admin/RunDetailDialog.vue";
import WorkListDialog from "@/components/admin/WorkListDialog.vue";
import { useApi } from "@/composables/useApi";
import { useAdminFormat } from "@/composables/useAdminFormat";
import type {
  AdminOverview,
  AdminRuns,
  AdminUsage,
  AdminUserRow,
  AdminWorks,
  Section,
} from "@/types/admin";
import {
  DEFAULT_USAGE_HOURS,
  GOOGLE_BOOKS_DAILY_QUOTA,
  buildHourColumns,
  enrichmentBreakdown,
  peakHour,
  percent,
  projectEndOfDay,
  quotaLevel as quotaLevelFor,
  rangeUnit,
  sweeperStatus,
} from "@/utils/admin-usage";
import {
  enrichmentLevel,
  failureLevel,
  worstLevel,
} from "@/utils/admin-signal";
import type { SignalLevel } from "@/utils/admin-signal";

const { apiFetch } = useApi();
const { t } = useI18n();
const { formatHour, formatRelative } = useAdminFormat();
const router = useRouter();

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
const hours = ref(DEFAULT_USAGE_HOURS);

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
      section.error =
        `GET ${path} — ${res.status} ${payload?.error ?? ""}`.trim();
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
  load(usage, `/api/admin/usage?hours=${hours.value}`, (p) => p as AdminUsage);
const loadUsers = () =>
  load(users, "/api/admin/users", (p) => (p.users ?? []) as AdminUserRow[]);

/**
 * One drill-down behind the vitals panel: a dialog fetched when a count is clicked and re-fetched
 * per filter, rather than on the board's Refresh — nothing pays for a dialog nobody has opened.
 *
 * `inspect` drops the previous list before re-filtering: it belongs to another filter, and holding
 * it visible under a new heading would misattribute rows to a reason that didn't produce them.
 */
function useDrillDown<T>(pathFor: (filter: string | null) => string) {
  const open = ref(false);
  const filter = ref<string | null>(null);
  // The generic defeats `reactive`'s return-type inference; the shape is unchanged by the wrapper.
  const section = reactive<Section<T>>({
    data: null,
    loading: false,
    error: null,
  }) as Section<T>;

  /**
   * Which request the section is currently showing. Clearing `data` only orders the *synchronous*
   * part: these lists are the board's slowest reads (an unindexed sort over `works`, a join over a
   * day of runs), so a request for the previous filter can land after a newer one and repaint its
   * rows under the new filter's chip and total — the exact misattribution `inspect` clears data to
   * avoid. A superseded response is dropped instead.
   */
  let generation = 0;

  const reload = async () => {
    const mine = ++generation;
    const staging = reactive<Section<T>>({
      data: null,
      loading: false,
      error: null,
    }) as Section<T>;
    section.loading = true;
    section.error = null;
    await load(staging, pathFor(filter.value), (p) => p as T);
    if (mine !== generation) return;
    section.data = staging.data;
    section.error = staging.error;
    section.loading = false;
  };

  function inspect(next: string | null) {
    filter.value = next;
    section.data = null;
    open.value = true;
    void reload();
  }

  return { open, filter, section, reload, inspect };
}

const runDrill = useDrillDown<AdminRuns>((reason) =>
  reason
    ? `/api/admin/runs?reason=${encodeURIComponent(reason)}`
    : "/api/admin/runs",
);
const workDrill = useDrillDown<AdminWorks>((status) =>
  status
    ? `/api/admin/works?status=${encodeURIComponent(status)}`
    : "/api/admin/works",
);

// Fired together, awaited together only so the Refresh button can show a single busy state.
const loadAll = () => Promise.all([loadOverview(), loadUsage(), loadUsers()]);

function setHours(next: number) {
  hours.value = next;
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
// A real banding whenever there is data; the "no reading yet" case is resolved once, by `levelFor`
// below, so the gauge — which only renders with data — never has to handle it.
const quotaLevel = computed(() =>
  usage.data
    ? quotaLevelFor(usage.data.googleBooksToday.calls, GOOGLE_BOOKS_DAILY_QUOTA)
    : "ok",
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

// Google Books only, and only today: this sits in the quota panel, whose other three figures are
// all "today's Google Books calls". The busiest hour overall is usually a Wikidata burst, and
// reading that as quota spend would be wrong in the alarming direction.
const peakLabel = computed(() => {
  if (!usage.data) return null;
  const dayStart = usage.data.googleBooksToday.utcDayStart;
  const peak = peakHour(
    hourColumns.value.filter((c) => c.hourStart >= dayStart),
    (c) => c.google_books,
  );
  return peak ? `${formatHour(peak.hourStart)} · ${peak.value}` : null;
});

const rateLimitedInRange = computed(() =>
  usage.data
    ? usage.data.totals.reduce((sum, r) => sum + r.rateLimited, 0)
    : null,
);

const rangeLabel = computed(() =>
  rangeUnit(hours.value) === "days"
    ? t("admin.range.days", { days: Math.round(hours.value / 24) })
    : t("admin.range.hours", { hours: hours.value }),
);

const enrichment = computed(() =>
  overview.data ? enrichmentBreakdown(overview.data.enrichment) : null,
);

const runFailurePercent = computed(() => {
  if (!overview.data) return null;
  const r = overview.data.enrichmentRuns24h;
  return percent(r.byOutcome.failed, r.total);
});

/**
 * The cron's own health, which the status counts can't show: a stalled sweeper and a draining
 * backlog both read `pending`. Recomputed on each load rather than on a timer — the board is
 * manually refreshed, and a clock ticking under a static reading would only mislead.
 */
const sweeper = computed(() => {
  if (!overview.data) return null;
  const now = Date.now();
  return {
    ...sweeperStatus(overview.data.sweeper, now),
    lastRunLabel: formatRelative(overview.data.sweeper.lastRunAt, now),
  };
});

// Stall first: it's the actionable one, and it explains why the percentage isn't moving.
const enrichmentHint = computed(() => {
  const hints: string[] = [];
  const s = sweeper.value;
  if (s && s.level !== "ok") {
    hints.push(
      s.lastRunLabel
        ? t("admin.pips.sweeper_stalled", {
            due: s.dueCount,
            ago: s.lastRunLabel,
          })
        : t("admin.pips.sweeper_never", { due: s.dueCount }),
    );
  }
  if (enrichment.value?.terminalCount) {
    hints.push(
      t("admin.pips.enrichment_stuck", {
        count: enrichment.value.terminalCount,
      }),
    );
  }
  return hints.length ? hints.join(" · ") : undefined;
});

// A missing reading is neutral, not a fourth severity — resolved here, where the null already
// lives, so the strip is pure presentation.
const NO_READING = "—";
const asPercent = (v: number | null) =>
  v === null ? NO_READING : `${Math.round(v)}%`;
const levelFor = (value: number | null, level: SignalLevel): SignalLevel =>
  value === null ? "neutral" : level;

const pips = computed(() => [
  {
    key: "quota",
    label: t("admin.pips.quota"),
    value: asPercent(quotaPercent.value),
    level: levelFor(quotaPercent.value, quotaLevel.value),
  },
  {
    key: "enrichment",
    label: t("admin.pips.enrichment"),
    // Shows progress, coloured by whichever of two unrelated problems is worse: works that will
    // never enrich, and a sweeper that has stopped draining the ones that could. Neither is
    // readable off the percentage — see `enrichmentLevel` and `sweeperLevel` — so the title
    // names whichever is driving the colour, and a red "72%" can't read as "72% is bad".
    value: asPercent(enrichment.value?.donePercent ?? null),
    title: enrichmentHint.value,
    level: levelFor(
      enrichment.value?.donePercent ?? null,
      worstLevel(
        enrichmentLevel(enrichment.value?.terminalPercent ?? 0),
        sweeper.value?.level ?? "ok",
      ),
    ),
  },
  {
    key: "failures",
    label: t("admin.pips.run_failures"),
    value: asPercent(runFailurePercent.value),
    level: levelFor(
      runFailurePercent.value,
      failureLevel(runFailurePercent.value ?? 0),
    ),
  },
  {
    key: "rate_limited",
    label: t("admin.pips.rate_limited", { range: rangeLabel.value }),
    value:
      rateLimitedInRange.value === null
        ? NO_READING
        : String(rateLimitedInRange.value),
    level: levelFor(
      rateLimitedInRange.value,
      (rateLimitedInRange.value ?? 0) > 0 ? "warning" : "ok",
    ),
  },
]);
</script>
