// Returns a function that maps BCP-47 / ISO-639 language codes to localised display names.
// Creates one Intl.DisplayNames instance per call; pass to a closure when iterating many values.
export function languageDisplayFormatter(
  locale: string,
): (code: string | null | undefined) => string {
  let dn: Intl.DisplayNames | null = null;
  try {
    dn = new Intl.DisplayNames([locale, "en"], { type: "language" });
  } catch {}
  return (code) => {
    if (!code) return "";
    try {
      return dn?.of(code) ?? code;
    } catch {
      return code;
    }
  };
}

/**
 * The localised name for a language code, or `null` when it isn't one.
 *
 * `languageDisplayFormatter` can't answer that question — it echoes an unrecognised code back, so
 * "German" would read as a valid tag named "German". `Intl.DisplayNames.of` throws a RangeError
 * only on a *structurally* invalid tag ("12"); a well-formed but unknown one comes back canonically
 * cased ("German" → "german", "xx" → "xx"), which is why the echo test has to ignore case.
 */
export function resolveLanguageName(
  code: string,
  locale: string,
): string | null {
  const tag = code.trim();
  if (!tag) return null;
  try {
    const name = new Intl.DisplayNames([locale, "en"], {
      type: "language",
    }).of(tag);
    if (!name || name.toLowerCase() === tag.toLowerCase()) return null;
    return name;
  } catch {
    return null;
  }
}
