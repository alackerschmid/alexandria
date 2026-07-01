-- Discovery source switched from LibraryThing (thingISBN) to OpenLibrary's own works/editions.json:
-- LibraryThing sits behind Cloudflare, which blocks Workers-origin traffic via Bot Fight Mode
-- (confirmed: requests returned Cloudflare's own "Attention Required" challenge page, not an
-- app-level rejection from LibraryThing — unfixable from a server-side fetch()). OpenLibrary
-- needs no token and returns richer per-edition data (real language codes) in the same call.
ALTER TABLE works RENAME COLUMN librarything_checked_at TO editions_checked_at;
