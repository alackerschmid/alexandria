import { useI18n } from "vue-i18n";
import { humanizeToken } from "@/utils/admin-labels";

/**
 * Display names for the machine strings the admin board reads out of D1 — `api_usage`'s provider
 * and operation columns, and `enrichment_runs.failure_reason` / `source`. Those are stable
 * identifiers the worker writes; the board is the only place they're read by a human, so they get
 * translated here rather than being prettified at the source.
 *
 * A value with no entry falls back to `humanizeToken`, so a counter from a newer worker still
 * renders (see the note there). Lookups are functions rather than a computed map for the same
 * reason: the set of values is whatever the API returned, not a fixed enum.
 */
export function useAdminLabels() {
  const { t, te } = useI18n();

  // `value` is typed loosely on purpose: these are raw column values off a blind-cast API payload, so
  // an absent one arrives as undefined and must render rather than throw — see `humanizeToken`.
  const lookup = (key: string, value: string | null | undefined): string =>
    value != null && te(key) ? t(key) : humanizeToken(value);
  const label = (group: string, value: string | null | undefined): string =>
    lookup(`admin.labels.${group}.${value}`, value);

  type Value = string | null | undefined;

  return {
    providerLabel: (provider: Value) => label("provider", provider),
    operationLabel: (operation: Value) => label("operation", operation),
    reasonLabel: (reason: Value) => label("reason", reason),
    /** What triggered an enrichment run — `enrichment_runs.source`. */
    sourceLabel: (source: Value) => label("source", source),
    /**
     * `works.enrichment_status`. Reads the vitals panel's own key group rather than a second copy
     * under `admin.labels` — the bar, its drill-down and the run list all name the same four
     * states, and three sets of translations for them would drift.
     */
    workStatusLabel: (status: Value) =>
      lookup(`admin.vitals.status.${status}`, status),
  };
}
