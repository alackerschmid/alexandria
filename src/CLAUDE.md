# Frontend (`src/`)

Vue 3 + TypeScript + Vite. Loaded when working under `src/`.
For the API routes and the scan-row shape see `worker/CLAUDE.md`; for the D1 schema,
`worker/migrations/CLAUDE.md`.

Feature-specific guidance loads on its own from `.claude/rules/` when you open a matching
file — `book-detail`, `import-wizard`, `library-pipeline`, `appearance`, `preferences`.
For the roster of an area (which components/composables/stores exist and what each is for),
ask the `inventory` subagent rather than expecting a list here.

## Layout

| Directory | Holds |
| --- | --- |
| `src/pages/` | Route-level components — `landing` (`/`), `home` (`/home`), `index` (`/library`), `series/:id`, `settings`, `import`, `welcome`, `login`, `scanner`, `privacy`, `admin` (`/admin`, `requiresAdmin`), `NotFound` |
| `src/components/` | App chrome and shared primitives, plus `book-detail/`, `import/`, `settings/` and `admin/` subfolders |
| `src/composables/` | Shared logic extracted from pages (API client, library pipeline, status/rating writes, polling, focus trap) |
| `src/stores/` | Pinia — cross-page state: auth/guest session, field definitions, preferences, theme/accent/locale |
| `src/utils/` | Pure helpers. Several are unit-tested in `test/*.spec.ts` — keep new pure logic here so it can be tested without mounting a component |
| `src/types/` | `book.ts` (the scan-row shape), `library.ts`, `stats.ts`, `admin.ts` |
| `src/locales/` | `en.json`, `de.json` — all UI strings |
| `src/plugins/` | `i18n.ts`, `vuetify.ts` (Vuetify 4, `editorial` / `editorial-dark` themes) |
| `src/styles/` | `tailwind.css` — Tailwind v4 config and design tokens |
| `src/router/` | Route guards — authed users redirect from `/`, `/login` → `/home`; unauthed from `/home`, `/series/:id`, `/welcome` → `/`; `/welcome` → `/home` once `WELCOME_SEEN_KEY` is set |

## Invariants

- **`useApi().apiFetch(path, init?, opts?)` is the canonical API client.** It prepends
  `VITE_API_URL`, sets `Content-Type` + `Authorization` from the auth store, and logs the user
  out on a 401 (opt out with `{ on401: "ignore" }`; `{ token }` overrides the store's token,
  for a call that has to outlive logout). All authenticated frontend calls go through it —
  don't hand-roll `fetch`. The raw `fetch`es that remain are **pre-auth by construction**:
  `login.vue`, `stores/guest.ts`'s `syncToAccount` (explicit token, mid-login), and the three
  public endpoints — `landing.vue`'s `books/sample` and the scanner's `guest-lookup` /
  `guest-search`. Those three send no headers at all, so they stay simple cross-origin GETs
  instead of picking up a preflight from `apiFetch`'s `Content-Type`.
- **`MarkdownText` is the only `v-html` in the app.** It renders through `utils/markdown.ts`,
  which sanitizes with DOMPurify behind a fixed tag/attribute allowlist; images are dropped
  deliberately, since a remote `<img>` in a review would leak the reader's IP the same way a
  font CDN would. Never bind unsanitized HTML anywhere else.
- **`AppButton` is the shared action-button primitive** — `variant`
  `primary`/`secondary`/`ghost`/`danger`/`inverse` × `size` `sm`/`md`/`lg`, plus
  `block`/`outlined`/`loading`/`mono`. Use it for all action buttons. `mono` is a typeface
  flag orthogonal to `variant` — monospace and unbolded, for the `/admin` board's
  instrument-panel surface; it composes with any variant. Segmented pickers and
  `AppToggle` are deliberately not this, and the scanner's camera mode keeps its
  dark-hardcoded secondary/ghost buttons — only its accent-fill buttons use `AppButton`.
- **`AppSegmented` is the shared single-select segmented control** — `variant` `fill`
  (default, accent-filled active option; every labelled settings-style row) / `highlight`
  (accent-tinted active text; toolbar chrome only). Not for the scanner's per-status colored
  pickers or login's auth-mode pills — those stay bespoke.
- **`CoverImage` wraps every book cover** — renders the `<img>` when `coverUrl` is set and
  falls back to `PlaceholderCover` when it's absent or the image fails. Don't hand-roll the
  `<img v-if>` / `PlaceholderCover v-else` pair.
- **`ConfirmDialog` is the shared destructive-confirm dialog** (library delete, account
  delete, import cancel).
- **Rating and review are stored per work, not per scan.** `useScanStatus`'s
  `setRating`/`setReview` fan out across every owned edition sharing a `work_id` — pass
  `useScanStatus({ books: () => allBooks.value })` from a page that holds a list, or the
  collapsed work-card and the edition carousel drift apart until the next refetch. Nothing
  clears a rating implicitly: it survives every status change.
- **`stores/preferences.ts` is the single owner of every persisted preference.** The
  appearance/locale/library-default stores are thin wrappers over it — never touch
  `localStorage` directly.
- **`types/book.ts` is where the scan-row shape lives.** Extend it when adding API response
  columns. `BookWithOverrides`, `CustomFieldValue` and `WorkEdition` live there too — they
  used to be exported from `BookDetail.vue` and imported by four other modules, and a type
  living in a component is a cycle waiting to happen.
- **`stores/guest.ts` caps unauthenticated users at 3 localStorage scans**; `syncToAccount()`
  migrates them server-side on register/login.
- **`stores/import.ts` is the deliberate exception to the cross-page-only store rule** — it
  holds page-shaped state specifically so an import survives navigation.
- **A persisted shape is a compatibility surface: every new field needs a default on the way back
  in.** `stores/import.ts`, `stores/guest.ts` and `stores/preferences.ts` all rehydrate from
  `localStorage` written by an *older build*, and the load is a bare `as` cast — so a field added
  today is `undefined` on every session stored before today, whatever the type says. Anything the
  UI reads *through* while rendering (`item.x.y`) then throws mid-render and paints a blank page
  rather than degrading. The established pattern is `stores/import.ts`'s `NewerImportedItemFields`
  plus a revive function that defaults each one (`reviveImportedItem`) — extend that union when you
  add a field, and derive the value if a sensible default exists. Assume nothing about stored data
  matching the current type.

## Data flow

Pages fetch via `useApi().apiFetch` and hold their own page-level state; Pinia stores mostly
hold cross-page state. The library page runs its book list through the composable pipeline
(`useLibrarySearch` → `useEditionGrouping` → `useLibraryGrouping` → pagination — see the
`library-pipeline` rule). After a scan, `useEnrichmentPoll` polls the scan row until
`enrichment_status` resolves.

## Styling

Tailwind for layout/spacing, Vuetify components for interactive elements. **Do not mix** — use
Tailwind classes on plain HTML, Vuetify props on `<v-*>` components. Deliberate exception:
`CustomFieldsPanel`'s per-type value inputs (text/integer/date/select) are all plain
Tailwind-styled HTML, because a book can have several custom fields of different types shown as
one visually uniform stack, and a `<v-*>` control for just one type would stand out rather than
blend in.

**Tailwind tokens** (defined in `src/styles/tailwind.css`, theme-aware via CSS variables):
`bg-charcoal`, `bg-charcoal-light`, `border-charcoal-border` (subtle hairline for
dividers/card edges), `border-control-border` (stronger border for interactive controls —
segmented toggles, secondary buttons, "add field"; use this, not the hairline, on actionable
outlines), `text-orange-neon`, `text-text-primary`, `text-text-secondary`.

Accent, paper and typeface are user-overridable at runtime, and scrollbars are restyled
globally — see the `appearance` rule before touching `tailwind.css`,
`src/utils/appearance.ts` or the font config in `vite.config.mts`.

**Breakpoints** (identical in Tailwind and Vuetify): `sm` 600px / `md` 840px / `lg` 1145px /
`xl` 1545px — `md` is the mobile/desktop threshold.

## i18n

All user-visible strings must go through `$t()` / `t()`, and every key must exist in **both**
`src/locales/en.json` and `src/locales/de.json` — `test/locales.spec.ts` fails `npm test`
otherwise (not `npm run build`, which doesn't run the tests). `useLocaleStore` handles persistence and updates `i18n.global.locale` reactively.
Status/owning/rating label config lives in `computed`s (`useBookStatus`/`useOwningStatus`) so
labels update on locale change — follow that pattern for any new locale-dependent config
object.
