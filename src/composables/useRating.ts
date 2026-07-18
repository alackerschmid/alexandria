// Rating follows the user's accent color, same as every other primary action/highlight in the
// app (AppButton, AppSegmented, MobileTabBar) — set via --v-theme-primary in App.vue from the
// accent store.
export const RATING_COLOR = "rgb(var(--v-theme-primary))";
export const RATING_TRACK = "var(--color-rating-track)";

const STAR_SIZES = { sm: 13, md: 17, lg: 24 } as const;

// Material Design's "star" glyph, optically centered in its 24x24 grid — drawn as SVG rather
// than a Unicode ★ character so the icon's bounding box lines up exactly with surrounding text.
// A font glyph's ink is never symmetric within its own em box (varies by font/browser), so no
// amount of geometric centering keeps it looking aligned; an SVG path has no such ambiguity.
export const STAR_PATH =
  "M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z";

export interface RatingStar {
  n: number;
  /** Rating value (1-10) represented by clicking the star's left half. */
  halfValue: number;
  /** Rating value (1-10) represented by clicking the star's right half. */
  fullValue: number;
  /** How much of the star is filled: 0, 0.5 or 1. */
  fraction: number;
}

// Builds a 5-star row (half-star granularity) for a given 0-10 rating (null/0 = all empty).
// Each star covers two rating points: `halfValue` (left half, odd) and `fullValue` (right half,
// even) so the underlying 0-10 integer scale — unchanged, it's what the API stores — maps
// directly onto star fill without any conversion at the call sites.
export function ratingStars(
  value: number | null,
  size: "sm" | "md" | "lg" = "sm",
): { stars: RatingStar[]; sizePx: number } {
  const v = value ?? 0;
  const stars = Array.from({ length: 5 }, (_, i) => {
    const halfValue = i * 2 + 1;
    const fullValue = i * 2 + 2;
    const fraction = v >= fullValue ? 1 : v >= halfValue ? 0.5 : 0;
    return { n: i + 1, halfValue, fullValue, fraction };
  });
  return { stars, sizePx: STAR_SIZES[size] };
}
