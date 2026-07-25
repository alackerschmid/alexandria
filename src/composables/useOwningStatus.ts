import { computed } from "vue";
import { useI18n } from "vue-i18n";
import type { OwningStatus } from "@/types/book";

// Mirrors useBookStatus.ts, but for the independent "do I own this copy" axis.
// Presentation is border-first (library cards), unlike reading status which is dot-first.

// "unknown" sits last: it's the blank/no-assertion end of the axis, and appending it leaves the
// existing sort order of the other four untouched (this list is also the library's owning-sort
// order and the search facet order, not just the pickers').
export const OWNING_ORDER: OwningStatus[] = [
  "owned",
  "unowned",
  "want",
  "lent_out",
  "unknown",
];

// Statuses that render a corner badge on library cards — "owned"/"unowned"/"unknown" get a
// border treatment only (see OwningMeta.borderClass), no badge.
const BADGE_STATUSES = new Set<OwningStatus>(["want", "lent_out"]);

export interface OwningMeta {
  /** Tailwind border classes for the library cards (tile cover box / list article) */
  borderClass: string;
  /** mdi icon name — shown as a corner badge on cards for non-default statuses */
  icon: string;
  /** Solid colour (hex) for inline styles — scanner picker, detail picker thumb, card badge */
  color: string;
  /** Translucent tint background (rgba) for inline styles */
  tint: string;
}

export const OWNING_META: Record<OwningStatus, OwningMeta> = {
  owned: {
    borderClass: "",
    icon: "mdi-check-circle-outline",
    color: "#8a8078",
    tint: "rgba(138,128,120,0.12)",
  },
  unowned: {
    // Wider border (vs. a plain 1px `border-dashed`) so the dash/gap pattern reads as
    // clearly distinct from the default owned card at a glance.
    borderClass: "border-2 border-dashed border-text-secondary/40",
    icon: "mdi-circle-outline",
    color: "#8a8078",
    tint: "rgba(138,128,120,0.08)",
  },
  want: {
    borderClass: "border-2 border-dashed border-orange-neon/50",
    icon: "mdi-heart-outline",
    color: "var(--color-orange-neon)",
    tint: "color-mix(in srgb, var(--color-orange-neon) 10%, transparent)",
  },
  lent_out: {
    borderClass: "border-2 border-dashed border-[#d4a017]/50",
    icon: "mdi-account-arrow-right-outline",
    color: "#d4a017",
    tint: "rgba(212,160,23,0.10)",
  },
  unknown: {
    // No border treatment, deliberately: a whole imported library lands on this status, and any
    // card decoration would turn "we don't know" into the loudest thing on the shelf. It reads
    // as a plain card like "owned" does; where the distinction matters (detail view, grouping,
    // the `owning:` search facet) it's carried by the label, not the card.
    borderClass: "",
    icon: "mdi-help-circle-outline",
    color: "#8a8078",
    tint: "rgba(138,128,120,0.08)",
  },
};

export interface OwningBadge {
  icon: string;
  label: string;
  color: string;
}

/** Reactive owning-status presentation with translated labels. */
export function useOwningStatus() {
  const { t } = useI18n();

  const owningLabels = computed<Record<OwningStatus, string>>(() => ({
    owned: t("owning.owned"),
    unowned: t("owning.unowned"),
    want: t("owning.want"),
    lent_out: t("owning.lent_out"),
    unknown: t("owning.unknown"),
  }));

  /** Corner-badge info for library cards — null for 'owned'/'unowned'/'unknown' (no badge). */
  function owningBadge(status: OwningStatus): OwningBadge | null {
    if (!BADGE_STATUSES.has(status)) return null;
    return {
      icon: OWNING_META[status].icon,
      label: owningLabels.value[status],
      color: OWNING_META[status].color,
    };
  }

  return { owningLabels, owningBadge };
}
