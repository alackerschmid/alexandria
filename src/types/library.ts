export type GroupBy =
  | "none"
  | "author"
  | "series"
  | "genre"
  | "status"
  | "owning"
  | "rating"
  | "publisher"
  | "language"
  | "form"
  | "country"
  | "decade"
  | "subject"
  | `cf:${number}`;
export type SortOption = "asc" | "desc";

/**
 * How much of the ownership axis the library shows. One control instead of two
 * independent booleans, because the two ends are mutually exclusive: "owned"
 * hides entries you don't possess, "missing" reveals series entries you never
 * added at all.
 */
export type OwnershipScope = "owned" | "all" | "missing";
