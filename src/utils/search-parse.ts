// Pure query-string parsers for the library search bar. Kept free of Vue/i18n
// imports so they can be unit-tested in a plain node environment
// (test/search-suggestions.spec.ts). The reactive wrappers live in
// useSearchSuggestions.ts.

export interface SearchSegment {
  text: string;
  role: "key" | "plain";
}

/**
 * The trailing chunk the user is currently typing, after the last *committed*
 * structured token (a `key:value` with a non-empty value whose key is known).
 * Everything after that point is the fragment still being built — it may itself
 * contain spaces, so this can't be a simple last-word split.
 */
export function parseSearchFragment(
  search: string,
  knownKeys: Set<string>,
): string {
  const re = /\S+:"[^"]*"|"[^"]*"|\S+/g;
  let lastStructuredEnd = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(search)) !== null) {
    const part = m[0];
    const colonIdx = part.indexOf(":");
    if (colonIdx > 0) {
      const key = part.slice(0, colonIdx).toLowerCase();
      const val = part
        .slice(colonIdx + 1)
        .replace(/^"|"$/g, "")
        .toLowerCase();
      if (knownKeys.has(key) && val) lastStructuredEnd = m.index + part.length;
    }
  }
  return search.slice(lastStructuredEnd).replace(/^\s+/, "");
}

/**
 * Splits the query into highlight segments — `key` roles (the `foo:` prefixes)
 * get the accent color in the overlay, everything else is plain.
 */
export function parseSearchSegments(
  search: string,
  knownKeys: Set<string>,
): SearchSegment[] {
  if (!search) return [];
  const pattern = String.raw`((?:${[...knownKeys].join("|")}):)("(?:[^"]*)"?|\S*)`;
  const re = new RegExp(pattern, "gi");
  const segments: SearchSegment[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(search)) !== null) {
    const [, key, val] = m;
    if (m.index > last)
      segments.push({ text: search.slice(last, m.index), role: "plain" });
    segments.push({ text: key, role: "key" });
    if (val) segments.push({ text: val, role: "plain" });
    last = re.lastIndex;
  }
  if (last < search.length)
    segments.push({ text: search.slice(last), role: "plain" });
  return segments;
}
