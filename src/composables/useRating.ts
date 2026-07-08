import type { CSSProperties } from "vue";

// Rating uses its own accent (distinct from any read/owning status color) since it's an
// independent, orthogonal axis of "your record" rather than another state in those enums.
export const RATING_COLOR = "#d9ac4e";
const RATING_TRACK = "rgba(255,255,255,0.14)";

const DOT_SIZES = { sm: "6px", md: "9px", lg: "14px" } as const;

export function ratingDotStyle(
  filled: boolean,
  size: "sm" | "md" | "lg",
): CSSProperties {
  const dim = DOT_SIZES[size];
  return {
    display: "inline-block",
    width: dim,
    height: dim,
    borderRadius: "50%",
    background: filled ? RATING_COLOR : "transparent",
    border: `1px solid ${filled ? RATING_COLOR : RATING_TRACK}`,
    flexShrink: 0,
  };
}

// Builds a 10-dot row for a given rating (null/0 = all empty). `n` is included so interactive
// callers (the rating dialog, the scanner picker) can wire an onPick without recomputing indices.
export function ratingDots(
  value: number | null,
  size: "sm" | "md" | "lg" = "sm",
) {
  const v = value ?? 0;
  return Array.from({ length: 10 }, (_, i) => ({
    n: i + 1,
    filled: i + 1 <= v,
    style: ratingDotStyle(i + 1 <= v, size),
  }));
}
