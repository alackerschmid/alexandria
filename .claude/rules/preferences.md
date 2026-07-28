---
paths:
  - "src/stores/preferences.ts"
  - "src/stores/libraryDefaults.ts"
  - "src/stores/locale.ts"
  - "src/stores/accent.ts"
  - "src/stores/paper.ts"
  - "src/stores/typeface.ts"
  - "src/stores/theme.ts"
  - "worker/src/preferences.ts"
---

# User preferences

`src/stores/preferences.ts` is **the single owner of every persisted user preference**
(accent/paper/typeface/theme/locale + all library display defaults).

## Where the truth lives

Preferences are strictly per-user:

- the server row (`users.preferences`, via `GET`/`PUT /api/auth/preferences`) is the source of
  truth
- a per-user `localStorage` bucket keyed by JWT `userId` (`prefs:<id>`) is **only** a
  paint-before-load cache
- a **logged-out visitor always starts from the defaults** and persists nothing

The appearance/locale/library-defaults stores are thin reactive wrappers that read and write
individual string keys through this store — **never `localStorage` directly**. So on login the
look switches to that user's saved preferences, and on logout it reverts to defaults.

## Adding a preference

Each wrapper is built from the `persistedStr`/`persistedBool`/`persistedNum` helpers this
module exports (a key + fallback + optional validator → a writable computed that reads through
`get` and writes through `set`). Use them rather than calling `get`/`set` by hand, so
validation stays the default.

**Adding a preference means one `persisted*` call and nothing else** — there is no second key
list to keep in sync.

## Login paints without a round-trip

`POST /api/auth/login`/`register` return the user's blob, and `login.vue` hands it to `seed()`
**before** `authStore.setAuth` (which is what flips the token the store's watcher runs off), so
a login paints the right look with no `GET /api/auth/preferences` round-trip. That GET is only
for a token restored from `localStorage` on boot.

`register` always returns `{}` — the INSERT never sets `preferences` — for the same reason
login returns the blob: it rides a row that was already read.

## Server side

`worker/src/preferences.ts` holds `sanitizePreferences`/`parsePreferences` for the opaque
per-user blob on `users.preferences`. The server validates a flat string→string map within
size bounds and is otherwise blind to it — **the frontend owns the key set**.

`PUT /api/auth/preferences` is a **full replace, not a merge**; body
`{ preferences: { [key]: string } }`, and an out-of-shape payload is a `400`. It returns `204`
(no body — the client already has the set). The frontend holds the whole set in memory and
sends all of it.

## Related store notes

- `theme.ts` also owns `THEME_HINT_KEY` — the device-global `theme` `localStorage` hint read
  by `index.html`/`plugins/vuetify.ts` before Vue boots, kept in sync by a watcher on `isDark`
  so a logged-out reload doesn't flash the previous user's dark theme
- `locale.ts` is the sole authority for the i18n locale; `plugins/i18n.ts` just starts at `en`
  and the store pushes the real locale in, so `App.vue` instantiates it before any child
  renders
