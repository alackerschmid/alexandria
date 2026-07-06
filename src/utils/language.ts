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
