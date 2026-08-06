/**
 * Every built-in group-by dimension, in the order the library's picker shows them.
 *
 * This is a runtime array rather than a bare type union because a union can't be enumerated at
 * runtime, and the things that need to enumerate it — the persisted-preference validator and the
 * picker's option list — were each keeping their own hand-written copy. They drifted: `rating`
 * was in the union and had a working `case` in `useLibraryGrouping`, but was missing from the
 * validator, so selecting it wrote the preference and the very next read rejected it and fell
 * back to `none`. The picker did nothing, and nothing failed loudly (`GroupBy[]` type-checks an
 * incomplete list just fine — every entry is valid, the array is merely short).
 *
 * So: add a dimension here and the type, the validator and the picker all follow. The picker's
 * label map is keyed by this type, so forgetting a label is a compile error.
 */
export const GROUP_BY_VALUES = [
  "none",
  "author",
  "series",
  "genre",
  "status",
  "owning",
  "rating",
  "publisher",
  "language",
  "form",
  "country",
  "decade",
  "subject",
] as const;

/** A built-in dimension — everything except the per-user custom fields. */
export type BuiltinGroupBy = (typeof GROUP_BY_VALUES)[number];

export type GroupBy = BuiltinGroupBy | `cf:${number}`;
export type SortOption = "asc" | "desc";

/**
 * How much of the ownership axis the library shows. One control instead of two
 * independent booleans, because the two ends are mutually exclusive: "owned"
 * hides entries you don't possess, "missing" reveals series entries you never
 * added at all.
 */
export type OwnershipScope = "owned" | "all" | "missing";
