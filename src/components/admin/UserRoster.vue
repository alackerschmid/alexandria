<template>
  <section>
    <div class="flex justify-between items-baseline mb-3">
      <SectionHeading :title="$t('admin.roster.title')" />
      <span
        class="font-mono text-[9px] md:text-[10px] tracking-[0.14em] uppercase text-text-secondary"
      >
        {{
          sortKey
            ? $t("admin.roster.meta_count", { count: users.length })
            : $t("admin.roster.meta", { count: users.length })
        }}
      </span>
    </div>

    <div class="border border-charcoal-border">
      <p
        v-if="!users.length"
        class="px-4 py-8 text-center text-xs text-text-secondary"
      >
        {{ $t("admin.roster.empty") }}
      </p>

      <template v-else>
        <div class="hidden md:block">
          <TableHeader
            :columns="COLUMNS"
            :grid-class="GRID"
            key-prefix="admin.roster"
            :right-aligned="['last_activity']"
            :sort-key="sortKey"
            :sort-direction="sortDirection"
            @sort="toggle"
          />
          <div
            v-for="u in sorted"
            :key="u.id"
            class="px-4.5 border-b border-charcoal-border/60 items-center"
            :class="GRID"
          >
            <span class="py-2.5">
              <span :class="[ROLE_BADGE, u.roleClass]">{{ u.roleLabel }}</span>
            </span>
            <span
              class="font-mono text-xs text-text-primary py-2.5 pr-4 truncate"
              :title="u.email"
              >{{ u.email }}</span
            >
            <span class="text-[13px] text-text-primary py-2.5 truncate">{{
              u.firstname ?? "—"
            }}</span>
            <span class="font-mono text-xs text-text-secondary py-2.5">{{
              u.signedUp
            }}</span>
            <span class="flex items-center gap-3 py-2.5 pr-6">
              <span
                class="font-mono text-xs text-text-primary w-9 text-right flex-none"
                >{{ u.scanCount || "—" }}</span
              >
              <ShareBar
                class="flex-1 h-1.5"
                :percent="u.scanPercent"
                :bar-class="u.barClass"
              />
            </span>
            <span
              class="font-mono text-xs py-2.5 text-right"
              :class="u.stale ? 'text-text-secondary' : 'text-text-primary'"
              >{{ u.lastActivity }}</span
            >
          </div>
        </div>

        <div class="md:hidden">
          <div
            v-for="u in sorted"
            :key="u.id"
            class="px-3 py-2.5 border-b border-charcoal-border/60"
          >
            <div class="flex justify-between items-center gap-2.5">
              <span class="font-mono text-xs text-text-primary truncate">{{
                u.email
              }}</span>
              <span :class="[ROLE_BADGE, 'flex-none', u.roleClass]">{{
                u.roleLabel
              }}</span>
            </div>
            <div class="flex items-center gap-2.5 mt-1.5">
              <span class="font-mono text-[10px] text-text-secondary flex-none">
                {{ u.firstname ?? "—" }} · {{ u.signedUp }}
              </span>
              <ShareBar
                class="flex-1 h-1.25"
                :percent="u.scanPercent"
                :bar-class="u.barClass"
              />
              <span class="font-mono text-[10px] text-text-secondary flex-none">
                {{ u.scanCount }} ·
                <span :class="u.stale ? '' : 'text-text-primary'">{{
                  u.lastActivity
                }}</span>
              </span>
            </div>
          </div>
        </div>
      </template>
    </div>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { AdminUserRow } from "@/types/admin";
import SectionHeading from "@/components/admin/SectionHeading.vue";
import ShareBar from "@/components/admin/ShareBar.vue";
import TableHeader from "@/components/admin/TableHeader.vue";
import { ageMs, barPercent } from "@/utils/admin-usage";
import { useAdminFormat } from "@/composables/useAdminFormat";
import { useTableSort } from "@/composables/useTableSort";

const props = defineProps<{ users: AdminUserRow[] }>();

const { t } = useI18n();
const { formatRelative } = useAdminFormat();

const GRID = "grid grid-cols-[70px_1fr_140px_120px_1fr_150px]";
const ROLE_BADGE =
  "font-mono text-[9px] tracking-[0.14em] uppercase px-1.5 py-0.5 border";
const COLUMNS = [
  "role",
  "email",
  "firstname",
  "signed_up",
  "scans",
  "last_activity",
] as const;

/** Past this, "last seen" is dimmed — the account is dormant rather than active. */
const STALE_AFTER_MS = 48 * 3_600_000;

const rows = computed(() => {
  // Fixed once per render rather than per row, so every relative label on screen agrees.
  const now = Date.now();
  const busiest = props.users.reduce((m, u) => Math.max(m, u.scanCount), 0);

  return props.users.map((u) => {
    const age = ageMs(u.lastScanAt, now);
    return {
      ...u,
      signedUp: formatRelative(u.createdAt, now) ?? "—",
      lastActivity:
        formatRelative(u.lastScanAt, now) ?? t("admin.roster.never"),
      stale: age === null || age > STALE_AFTER_MS,
      scanPercent: barPercent(u.scanCount, busiest),
      roleLabel: u.isAdmin ? t("admin.roster.admin") : t("admin.roster.user"),
      roleClass: u.isAdmin
        ? "text-orange-neon border-orange-neon"
        : "text-chart-muted border-charcoal-border",
      barClass: u.isAdmin ? "bg-orange-neon" : "bg-chart-total",
    };
  });
});

// The two date columns sort on the raw instant, not on the relative label the cell shows —
// "2 months ago" and "3 months ago" compare in the wrong direction as strings.
const { sortKey, sortDirection, toggle, sorted } = useTableSort(
  () => rows.value,
  {
    role: { value: (u) => u.isAdmin, descFirst: true },
    email: { value: (u) => u.email },
    firstname: { value: (u) => u.firstname },
    signed_up: { value: (u) => u.createdAt, descFirst: true },
    scans: { value: (u) => u.scanCount, descFirst: true },
    last_activity: { value: (u) => u.lastScanAt, descFirst: true },
  },
);
</script>
