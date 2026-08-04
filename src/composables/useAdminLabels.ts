import { useI18n } from "vue-i18n";
import { humanizeToken } from "@/utils/admin-labels";

/**
 * Display names for the machine strings the admin board reads out of D1 — `api_usage`'s provider
 * and operation columns, and `enrichment_runs.failure_reason`. Those are stable identifiers the
 * worker writes; the board is the only place they're read by a human, so they get translated here
 * rather than being prettified at the source.
 *
 * A value with no entry falls back to `humanizeToken`, so a counter from a newer worker still
 * renders (see the note there). Lookups are functions rather than a computed map for the same
 * reason: the set of values is whatever the API returned, not a fixed enum.
 */
export function useAdminLabels() {
  const { t, te } = useI18n();

  const label = (group: string, value: string): string => {
    const key = `admin.labels.${group}.${value}`;
    return te(key) ? t(key) : humanizeToken(value);
  };

  return {
    providerLabel: (provider: string) => label("provider", provider),
    operationLabel: (operation: string) => label("operation", operation),
    reasonLabel: (reason: string) => label("reason", reason),
  };
}
