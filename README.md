<div align="center">
  <img src="public/icons/web-app-manifest-192x192.png" alt="The Library of Alexandria" width="96" height="96">

  # The Library of Alexandria

  **Do you know what books you actually own?**

  A personal book catalogue for people with too many books and not enough shelf space to keep track.

</div>

---

## What it does

The Library of Alexandria is a web app for cataloguing your personal book collection. Point your phone camera at any barcode, and the app pulls title, author, cover, publisher, language, and page count from Google Books and OpenLibrary in seconds. In the background, it quietly enriches each book with data from Wikidata — series membership, genres, awards, original publication year, narrative locations, and more.

The result is a searchable library with statistics you can actually enjoy browsing.

## Features

- **Barcode scanning** — real-time camera scanning on mobile; manual ISBN entry or title search on desktop. Scans made without a signal are queued locally and sync when you're back online
- **Automatic metadata** — title, author, cover, publisher, page count, language, and publish date from Google Books and OpenLibrary
- **Wikidata enrichment** — genres, series, awards, original publication year, first lines, and narrative locations, filled in automatically in the background
- **Series tracking** — see every volume in a series and exactly which ones you own
- **Reading status** — mark books as Unread, Reading, Read, or DNF
- **Ownership status** — separate from reading status: Owned, Lent out, Want, Unowned, or Unknown, so a wishlist and a lent-out shelf live in the same library
- **Ratings and reviews** — a half-star 0–10 rating and a Markdown review per book, shared across every edition you own of the same work
- **Editions** — one work, many editions: see the other editions of a book you own and switch your copy to the right one
- **Smart search** — free-text plus structured filters (`status:dnf`, `author:le guin`, `series:…`, any custom field) with autocomplete, grouping and sorting
- **Library statistics** — total titles, read/unread counts, top authors, language distribution, median publication year, and page stats
- **Goodreads import** — bring in your existing library from a Goodreads CSV export, reading status, ratings and shelves included
- **Custom fields** — add your own metadata to any book (text, number, date, dropdown, or tags)
- **Field overrides** — correct any metadata detail without affecting the shared cache
- **Appearance** — light/dark/auto, plus a choice of accent colour, background tone and typeface
- **Admin board** — instance owners get a status board for enrichment health, API quota usage and the user roster
- **Multilingual** — Full i18n support, English and German are currently implemented
- **Guest mode** — scan up to 3 books before creating an account

## How it works

1. Open the app on your phone and tap the scanner
2. Point the camera at a book's barcode — or type the ISBN manually
3. Review the matched metadata: title, author, cover, year, pages
4. Set a reading status and save

Within minutes, the background enrichment fills in genres, series membership, and other Wikidata data without any extra steps on your part.

> [!NOTE]
> The first scan of a new ISBN triggers a live metadata lookup. Subsequent scans of the same edition hit a shared cache and return instantly.

## Getting started

The app runs entirely in your browser — no installation required.

> [!TIP]
> Try guest mode first: scan up to 3 books without signing up to see if it works for your collection.

## Tech stack

Built on Cloudflare's edge infrastructure — Cloudflare Pages for the frontend and Cloudflare Workers with D1 (SQLite) for the backend. The UI is Vue 3 + Vuetify + Tailwind CSS. Book metadata comes from Google Books and OpenLibrary; enrichment data from Wikidata via SPARQL.

## To be implemented

Some of the features I'm aiming to implement in the future are:
- library export to CSV and JSON (Goodreads CSV import already works)
- reading dates, and a books-read-per-year view to go with them
- a dedicated statistics page with more granular support for playing with and visualizing collection data
- richer edition management on top of the existing works/editions model
- an installable, offline-capable app (the scan queue works offline today, but only once the page is loaded)