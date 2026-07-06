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
