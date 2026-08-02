<template>
  <section>
    <div class="flex justify-between items-baseline mb-3">
      <h2
        class="font-mono text-[10px] md:text-[11px] tracking-[0.24em] md:tracking-[0.28em] uppercase text-orange-neon"
      >
        {{ $t("admin.roster.title") }}
      </h2>
      <span
        class="font-mono text-[9px] md:text-[10px] tracking-[0.14em] uppercase text-text-secondary"
      >
        {{ $t("admin.roster.meta", { count: users.length }) }}
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
          <div
            class="grid grid-cols-[70px_1fr_140px_120px_1fr_150px] px-4.5 bg-charcoal-light border-b border-charcoal-border"
          >
            <span v-for="h in HEADERS" :key="h.key" :class="headerClass(h)">
              {{ $t(`admin.roster.${h.key}`) }}
            </span>
          </div>
          <div
            v-for="u in rows"
            :key="u.id"
            class="grid grid-cols-[70px_1fr_140px_120px_1fr_150px] px-4.5 border-b border-charcoal-border/60 items-center"
          >
            <span class="py-2.5">
              <span
                class="font-mono text-[9px] tracking-[0.14em] uppercase px-1.5 py-0.5 border"
                :class="
                  u.isAdmin
                    ? 'text-orange-neon border-orange-neon'
                    : 'text-chart-muted border-charcoal-border'
                "
                >{{ u.isAdmin ? $t("admin.roster.admin") : $t("admin.roster.user") }}</span
              >
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
              <span class="flex-1 h-1.5 bg-search-bg">
                <span
                  class="block h-full"
                  :class="u.isAdmin ? 'bg-orange-neon' : 'bg-chart-total'"
                  :style="{ width: `${u.scanPercent}%` }"
                />
              </span>
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
            v-for="u in rows"
            :key="u.id"
            class="px-3 py-2.5 border-b border-charcoal-border/60"
          >
            <div class="flex justify-between items-center gap-2.5">
              <span class="font-mono text-xs text-text-primary truncate">{{
                u.email
              }}</span>
              <span
                class="font-mono text-[9px] tracking-[0.14em] uppercase px-1.5 py-0.5 border flex-none"
                :class="
                  u.isAdmin
                    ? 'text-orange-neon border-orange-neon'
                    : 'text-chart-muted border-charcoal-border'
                "
                >{{ u.isAdmin ? $t("admin.roster.admin") : $t("admin.roster.user") }}</span
              >
            </div>
            <div class="flex items-center gap-2.5 mt-1.5">
              <span class="font-mono text-[10px] text-text-secondary flex-none">
                {{ u.firstname ?? "—" }} · {{ u.signedUp }}
              </span>
              <span class="flex-1 h-1.25 bg-search-bg">
                <span
                  class="block h-full"
                  :class="u.isAdmin ? 'bg-orange-neon' : 'bg-chart-total'"
                  :style="{ width: `${u.scanPercent}%` }"
                />
              </span>
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
import { ageMs, relativeTime } from "@/utils/admin-usage";
import { BCP47 } from "@/plugins/i18n";

const props = defineProps<{ users: AdminUserRow[] }>();

const { t, locale } = useI18n();

const HEADERS = [
  { key: "role", align: "left" },
  { key: "email", align: "left" },
  { key: "firstname", align: "left" },
  { key: "signed_up", align: "left" },
  { key: "scans", align: "left" },
  { key: "last_activity", align: "right" },
] as const;

const headerClass = (h: (typeof HEADERS)[number]) => [
  "font-mono text-[9px] tracking-[0.16em] uppercase text-text-secondary py-2.75",
  h.align === "right" ? "text-right" : "",
];

/** Past this, "last seen" is dimmed — the account is dormant rather than active. */
const STALE_AFTER_MS = 48 * 3_600_000;

const rows = computed(() => {
  // Fixed once per render rather than per row, so every relative label on screen agrees.
  const now = Date.now();
  const tag = BCP47[locale.value] ?? locale.value;
  const busiest = props.users.reduce((m, u) => Math.max(m, u.scanCount), 0);

  return props.users.map((u) => {
    const age = ageMs(u.lastScanAt, now);
    return {
      ...u,
      signedUp: relativeTime(u.createdAt, now, tag) ?? "—",
      lastActivity:
        relativeTime(u.lastScanAt, now, tag) ?? t("admin.roster.never"),
      stale: age === null || age > STALE_AFTER_MS,
      scanPercent: busiest > 0 ? (u.scanCount / busiest) * 100 : 0,
    };
  });
});
</script>
