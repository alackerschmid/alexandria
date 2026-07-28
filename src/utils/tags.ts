// Tag-type custom fields store their value as a JSON array of strings in the
// single `field_value` TEXT column. Parse it defensively into a flat string list.
export function parseTagList(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr)
      ? arr.filter((v): v is string => typeof v === "string" && v !== "")
      : [];
  } catch {
    return [];
  }
}

/** Serialize a tag list back into the stored column form: JSON, or null when nothing is left —
 *  "no tags" has one representation, matching what the save path sends. */
export function serializeTagList(tags: string[]): string | null {
  return tags.length ? JSON.stringify(tags) : null;
}

/** Remove one value from a stored tag column, for the global tag delete. Returns the column's new
 *  value; a non-tag column (or one that never held the value) is returned unchanged. */
export function stripTagValue(
  raw: string | null | undefined,
  value: string,
): string | null {
  const tags = parseTagList(raw);
  if (!tags.includes(value)) return raw ?? null;
  return serializeTagList(tags.filter((t) => t !== value));
}
