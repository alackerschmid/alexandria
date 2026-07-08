export type GroupBy =
  | "none"
  | "author"
  | "series"
  | "genre"
  | "status"
  | "owning"
  | "publisher"
  | "language"
  | "form"
  | "country"
  | "decade"
  | "subject"
  | `cf:${number}`;
export type SortOption = "asc" | "desc";
