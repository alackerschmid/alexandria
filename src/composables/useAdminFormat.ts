import { computed } from "vue";
import { useI18n } from "vue-i18n";
import { BCP47 } from "@/plugins/i18n";
import { relativeTime } from "@/utils/admin-usage";

/**
 * Locale-dependent formatting for the admin board. One place resolves the BCP-47 tag, so the
 * board's counts, hour labels and relative times can't end up resolving the locale three
 * different ways — and the components stay free of `toLocaleString` boilerplate.
 */
export function useAdminFormat() {
  const { locale } = useI18n();
  const tag = computed(() => BCP47[locale.value] ?? locale.value);

  // Built once per locale rather than per call: the chart labels 168 hours at the 7d range, and
  // `toLocaleTimeString` constructs a fresh formatter every time — the expensive part by far.
  const hourFormat = computed(
    () =>
      new Intl.DateTimeFormat(tag.value, {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
      }),
  );

  return {
    /** The active BCP-47 tag, for callers passing it into `admin-usage` helpers directly. */
    tag,
    /** A count with locale-appropriate grouping: "1,024" / "1.024". */
    formatCount: (n: number) => n.toLocaleString(tag.value),
    /** An hour bucket as "14:00" — always 24-hour, this is an operator board. */
    formatHour: (ms: number) => hourFormat.value.format(ms),
    formatRelative: (atMs: number | null, nowMs: number) =>
      relativeTime(atMs, nowMs, tag.value),
  };
}
