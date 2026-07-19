// ISBN validation and normalization for route boundaries. Only applied to user-supplied ISBNs —
// never to ISBNs coming back from external APIs (OpenLibrary edition discovery etc.), which are
// trusted as-is.

export function normalizeIsbn(raw: string): string {
  return raw.replace(/[-\s]/g, "").toUpperCase();
}

function isValidIsbn10(s: string): boolean {
  if (!/^\d{9}[\dX]$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    const c = s[i];
    const value = c === "X" ? 10 : Number(c);
    sum += value * (10 - i);
  }
  return sum % 11 === 0;
}

function isValidIsbn13(s: string): boolean {
  if (!/^\d{13}$/.test(s)) return false;
  let sum = 0;
  for (let i = 0; i < 13; i++) {
    sum += Number(s[i]) * (i % 2 === 0 ? 1 : 3);
  }
  return sum % 10 === 0;
}

export function isValidIsbn(s: string): boolean {
  return s.length === 10
    ? isValidIsbn10(s)
    : s.length === 13
      ? isValidIsbn13(s)
      : false;
}

// Shape-only check (10 or 13 digits, optional trailing X on the 10-digit form) — no checksum.
// Used where a malformed-but-right-shaped ISBN must still be accepted (e.g. a scanned barcode
// misread that got one check digit wrong): the offline-scan queue resolves metadata later and
// tolerates an unresolvable ISBN, so rejecting on checksum here would just be a worse UX than
// letting it queue and fail to enrich.
export function isIsbnFormat(s: string): boolean {
  return /^(?:\d{9}[\dX]|\d{13})$/.test(s);
}

// Converts a valid ISBN-10 to its ISBN-13 form (prepend 978, recompute the check digit).
// Returns null for anything that isn't a valid ISBN-10 — callers should validate first.
export function isbn10To13(s: string): string | null {
  if (!isValidIsbn10(s)) return null;
  const core = "978" + s.slice(0, 9);
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += Number(core[i]) * (i % 2 === 0 ? 1 : 3);
  }
  const check = (10 - (sum % 10)) % 10;
  return core + check;
}

// Converts a 978-prefixed ISBN-13 back to ISBN-10. Returns null for non-978 ISBN-13s (979 has
// no 10-digit form) or anything that isn't a valid ISBN-13.
export function isbn13To10(s: string): string | null {
  if (!isValidIsbn13(s) || !s.startsWith("978")) return null;
  const core = s.slice(3, 12);
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += Number(core[i]) * (10 - i);
  }
  const remainder = (11 - (sum % 11)) % 11;
  const check = remainder === 10 ? "X" : String(remainder);
  return core + check;
}

// Returns the other valid form of a valid ISBN (10<->13), or null when `s` isn't a valid ISBN or
// has no alternate form (a 979-prefixed ISBN-13 has no ISBN-10 equivalent). Lets a caller check
// whether a `books` row already exists under the other form before minting a duplicate — the same
// edition can be scanned/looked-up under either form depending on which barcode was read.
export function alternateIsbnForm(s: string): string | null {
  return s.length === 13 ? isbn13To10(s) : s.length === 10 ? isbn10To13(s) : null;
}
