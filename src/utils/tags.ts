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
