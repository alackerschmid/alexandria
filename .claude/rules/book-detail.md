---
paths:
  - "src/components/BookDetail.vue"
  - "src/components/book-detail/**"
  - "src/utils/detail-tabs.ts"
  - "src/composables/useWorkEditions.ts"
  - "src/composables/useDetailRoute.ts"
  - "src/composables/useRatingPrompt.ts"
---

# Book detail

`BookDetail.vue` is the dialog shell: card/full mode switch, tab state, enrichment poll,
edit state and both saves. Its subcomponents live in `src/components/book-detail/`.
**Full mode is a masthead over tabbed panes.**

## Mode

Card vs full is a component-local ref **mirrored into the URL** as `?view=full` by
`useDetailRoute`: within a session the ref leads and the query follows every assignment to
`mode` (one `watch`, so the back button, the edition switch and the close reset all route
themselves), but across a page load the query wins — `mode` is re-seeded from it when the
dialog opens. Without that, a reload or a shared link restored the *book* and dropped the
reader back into the card they had already expanded past.

It is written with `replace`, not `push`, so expanding is not a history step Back has to undo
one at a time, and `closeDetail` strips `view` along with `work`/`edition`/`scan`. The seed
happens in **two** places for the same reason `DEFAULT_TAB` does — at setup for a deep link
that mounts already-open, and in the `modelValue` watcher for the ordinary cold load, where
the book resolves a tick after mount and the dialog opens only then.

The active tab is still not routed: it resets to `DEFAULT_TAB` on reload.

## Measure and bands

Everything sits on `DetailMeasure`, the shared middle-⅔ content column with empty gutters
that the rest of the app uses (`w-full md:max-w-[66.6667%] mx-auto px-6 md:px-10`) — the
*bands* (top bar, masthead, tab row, edit footer) stay full-bleed so their backgrounds and
hairlines span the page, exactly like `AppHeader`, and only their contents are constrained.

It is a component rather than a repeated utility string because four bands have to agree on
that width or their contents visibly fail to line up, and it is needed at all because the
fullscreen `v-dialog` teleports to the overlay container and escapes `App.vue`'s
`max-w-[1440px]` wrapper.

## Masthead

The masthead carries identity plus the three things the user *sets* (status / owning / rating)
via `RecordControls`, which renders `inline` there on desktop and stacked inside `RecordPane`
on mobile — one component, two layouts, so the behaviour can't drift between breakpoints.

**"Edit fields" is not one of them and is not here.** It opens a form over the metadata
overrides and custom-field values the *Details* pane displays, so it sits at the foot of that
pane beside Refresh — the two ways to change what those ledgers say, next to the ledgers. It
had been a fourth control in this cluster, which put the entry point a full tab away from
everything it writes.

**Whether the Record tab exists is decided by `matchMedia("(min-width: 840px)")`, the exact
query the CSS uses** — not by `window.innerWidth`. The two answer the same question by
different rounding (`innerWidth` is an integer; the media query compares the fractional layout
width), and when they disagree the user gets no Record tab *and* no masthead cluster, leaving
no way to set status, ownership or rating at all.

The mockup sat that cluster *beside* the title; on the app's ⅔ measure it doesn't fit (it
needs ~720px and would leave the title under 100px), so the masthead is a two-row grid
instead — cover + identity, then the cluster indented under the identity column.

The status picker is deliberately not `AppSegmented` (that primitive can't colour an option
by its value) but it is squared and hairline-bordered like everything else, with the status
colour carried as text + tint + inset underline; owning is an `AppSelect` menu, because five
states never fit a segmented track.

## Tabs

**The tab row is the same for every book.** `utils/detail-tabs.ts` still owns the set (not
`v-if`s in the template), but it no longer gates on **content**: Overview, Details, Editions and
All are offered whether or not they have anything in them, and Review whenever the book is the
user's. Nothing in the set depends on the book, only on the *view* (see the two conditions
below), so the row can't reshuffle as the user moves between books.
**The cost is that every pane owes an empty state** — Overview says "no description
available", Editions says "no other editions found yet" and offers the dialog, and Details'
custom-field column says "no custom fields yet". An empty state has to say *which* empty it is:
`EditionsPane` distinguishes still-loading (`useWorkEditions` exposes `loading`), none-found, and
no-work-link, which is a different sentence and no button at all (see Editions below).

The two conditions left are neither of them about emptiness. `readonly`: `series.vue` renders
editions the user doesn't own, where Record and Review would offer controls that write to a
scan that doesn't exist. `mobile`: **Record is a tab below `md` only** — on desktop the
masthead already carries those four controls, so the pane would be a second copy of them on
the same screen.

An unwritten `review` used to carry an accent dot on its tab; the tab row is uniform now —
badges only, no attention markers — and the empty pane still does that work, as a full-width
invitation rather than a dash in a corner.

**`all` is last but `overview` is the default** — what the book *is* comes before a dump of
everything known about it. `all` stacks every pane in one scroll under `DetailSection` rules
that double as disclosures; pick a single tab and the rule disappears, since the tab already
names it.

The default is **one exported literal, `DEFAULT_TAB` in `detail-tabs.ts`, with two call sites**:
`resolveActiveTab` only ever replaces a tab that has ceased to exist, so `BookDetail` has to seed
and reset `activeTab` with it separately. Both read the same constant, so changing it is one edit.

`role="tabpanel"` follows the *selected* tab: in the All view the container around the panes
carries it (`#detail-panel-all`), and each section is a plain `<section>`. Only when a single
tab is selected does that pane become the panel. Marking every visible pane a tabpanel would
label five of them by tabs that aren't selected, and leave the selected tab's `aria-controls`
pointing at nothing.

The active tab and the collapse set are component-local. The tab returns to `DEFAULT_TAB` on
exactly the same condition as `mode` returns to card — a *different* work, or the dialog
closing — so clicking through editions of one work keeps the user where they were in that
browse loop.

Delete lives in the pane footer (not the top bar, where it was one unlabelled icon among
four); the top bar keeps only back and close.

**`DetailsPane` is three ledger columns — `EditionDetails` / `WorkFacts` / `CustomFacts`:**
this copy, the work, and what you recorded. The custom-field *values* were listed in
`RecordPane` until the tab set stopped gating on content; leaving them there would have shown
the same list twice in the All view, which stacks both panes. They stay read-only in all
three columns — "Edit fields" is the one way in. Guests and readonly editions get the two
catalogue columns only (`ownRecord`, which also gates the pane footer) — and
`BookDetail`'s `customFieldCount` has to test the same thing, or the collapsed Details rule
advertises rows the pane never draws.

**Its footer is `EditFieldsButton` + the enrichment refresh**, in that order: the two ways to
change what the three ledgers say — write your own answer, or ask the catalogue again. Both
were elsewhere once (the masthead cluster; one unlabelled top-bar icon), which is how the app
ended up letting you edit fields from a screen that showed none of them. Refresh is the only
user-facing retry for a work whose Wikidata lookup failed, so it can't simply go away.

Both are gated on `ownRecord`, the same test as the custom-field column: a guest has nothing
recorded to edit, and a readonly edition isn't the user's to edit or to spend a lookup on.

## Editing

**Editing is one screen with every editable field**: `BookEditForm` holds the metadata
overrides *and* `CustomFieldsPanel`, both behind one Cancel/Save, and `BookDetail.save()`
issues the two PATCHes (`/api/books/override`, `/api/books/custom-fields`) as one action.

**`CustomFieldsPanel` is controlled and no longer saves on blur** — that is what makes a
single Save honest; its one immediate write is the tag *global* delete, which is a
destructive cross-library action rather than a field edit. That delete reports **which value
it removed**, and the shell applies that one removal to the book's *saved*
`custom_field_values` — never to the draft. Handing the draft back would commit whatever else
the user had typed but not saved, so a later Cancel would leave phantom edits on screen until
the next refetch.

### The draft

**The mask has a draft, and the diff is a pure function of it** — `utils/book-edit.ts`
(`draftFromBook` / `overrideChanges` / `normalizeField` / `validateOverrides`, unit-tested in
`test/book-edit.spec.ts`). `save()` used to build the diff on its way out, so "is there anything
to save" had no answer before the button was pressed: Save was always enabled and a no-change
Save exited silently. `dirty` and `save()` now read the same function, and cannot disagree.

`EditDraft.reverted` is presentation state, not payload: reverting and emptying send the same
`{field: null}`. It exists so a blanked field can say *"will be reset to the catalogue value"*
rather than looking like data loss.

**Clearing a field that has no override is not a change.** It would write NULL into
`book_overrides` — i.e. no override — and the server would hand back the value the user just
cleared. `overrideChanges` drops it rather than lighting up Save for an edit that cannot take.

### Leaving

**Every exit goes through `requestExit`** — Cancel, both top-bar X buttons, Escape, the scrim,
and browser Back (`onBeforeRouteUpdate`, since closing the detail drops `edition` from the query
on the *same* route, which `onBeforeRouteLeave` never sees). Escape and the scrim arrive as
`@update:model-value(false)`; not forwarding it is what keeps the dialog open, because
`modelValue` is the host's prop. `persistent` would block the same keypress with a shake and no
explanation.

**Nothing may leave while `saving`.** The host renders `BookDetail` under `v-if="selectedBook"`,
so closing mid-request unmounts the component and the `refreshed` emit lands nowhere — server
changed, list stale until the next full refetch.

**`TagInput` and `CustomFieldsPanel` stop Escape only when they have a menu open.** Unstopped, it
reached the dialog and destroyed the draft on the keypress meant for the suggestion list;
unconditionally stopped, Escape would be dead in a closed field — and it is the only key that
dismisses the dialog.

**`useFocusTrap` is deliberately not used here.** It is scoped to non-`v-dialog` overlays,
`v-dialog` already traps and restores focus, and its capture-phase Escape listener would fight
both Vuetify and the guard above. Initial focus is `onMounted` in `BookEditForm`, which is
`v-else`-mounted only in edit mode — so mount *is* "entered edit".

### Saving

**Both PATCHes answer with the merged scan row**, not `{ ok: true }`. The effect of a save is only
knowable server-side: the `*_overridden` flags, and — when an override is *cleared* — the
catalogue value (or a sibling edition's description, see `library-query.ts`'s cross-edition
fallback) that surfaces underneath it. The shell used to recompute the flags itself and
optimistically show `null` for a cleared field, which the next page load would never agree with.
Whatever the first request applied is emitted **even when the second one fails**, or the screen
disagrees with the database.

Being a merged row, it is also locale-joined, so **both PATCHes carry `?locale=`** like every
other `buildScanSelect`-backed call. The worker defaults to `en`; the host spreads the reply
straight over the displayed book, so omitting it flips a localized `series_name` to English
until the next full refetch.

**A cleared description is indistinguishable from no override**, so the sibling-edition fallback
takes over. That is a known non-goal: representing "intentionally empty" needs a flag in
`book_overrides` honoured by the COALESCE chain, the edition switch and the refresh path.

### Validation

Per-field, on both sides, in stable machine codes the client maps to `detail.edit_err_<code>` —
`utils/book-edit.ts` and `worker/src/override-validation.ts`, kept in sync. The worker is the
enforcement point (`400 { error: "validation_failed", fields: {…} }`); the client's copy only
saves a round trip. One rule is stricter on the client: `language` must *resolve* through
`resolveLanguageName`, because "German" is a structurally valid subtag and only an ICU lookup
tells it from a real one — the same check that powers the field's inline name hint.

`FieldDef.required` is enforced client-side only (`missingRequiredFields`). The custom-fields
route silently clears values it can't accept rather than rejecting, and a hard server constraint
would reject every book saved before the flag was switched on.

**The revert affordance can't preview what it will restore** — `GET /api/scans` returns only
merged values, so the catalogue value isn't on the client. It arrives in the PATCH response, so
the user sees it immediately after Save rather than before.

## Editions

`EditionsPane` is the browsing grid (owned copies first, the open edition marked in accent).

**An edition you already own is a different scan, so clicking it navigates** — the pane and
the dialog both emit `select`, which the shell forwards as `switch-edition` and the host turns
into `openDetail`. It is the same work, so the view stays in full mode. Everything else opens
`EditionsDialog`, which keeps the language filter, discovery and the click-twice-to-confirm
switch: a mis-tap in a grid must never move a scan to another edition. This split is not
cosmetic — `PATCH /api/scans/:id/edition` **409s** when the target is already in the library
(it would make two scans of one book), so routing an owned sibling into the switch path is a
guaranteed dead end.

`useWorkEditions` loads the other editions of a work once per work, from the detail shell.
It lives there rather than in `EditionsPane` because the *tab row* needs the count before the
pane is ever rendered — it badges the Editions tab with it — and it discards a response
superseded by a newer work while in flight. It skips the request outright when the caller
already knows the work has one edition (the pane then shows its empty state, which still
opens the dialog, where discovery lives), and **caches per work rather than per open** —
collapsing to card mode and re-expanding must not refetch, or the pane the user is looking at
blanks mid-flight.

**Everything the pane can do keys off `work_id`, so without one it must offer nothing** —
`EditionsDialog.load()` *and* `discover()` both early-return on a falsy `work_id`, so "Find more
editions" would open an empty dialog whose own discovery button does literally nothing. The pane
takes `work-linked` and swaps in a different sentence with no button. A book gets there by having
no Wikidata work link yet; the way out is the enrichment retry in `DetailsPane`, not this pane.

## RatingDialog

**`RatingDialog` is owned by the host page, not by `BookDetail`** — `index.vue`/`series.vue`
render it and `BookDetail` only emits `open-rating`, because marking a book read from a
library card (with no detail open) has to raise the same dialog.

The masthead stars are the exception: they are `interactive` and emit `set-rating` straight
to the host's `useScanStatus.setRating`, so setting a rating is one tap and doesn't raise a
dialog at all — the dialog is still what edits the *review*.

It takes `with-review` to show the review/notes textarea (rating stars save per click; the
review is a draft flushed once on close) — the Goodreads-import wizard reuses it without that
flag for rating only.

**The flush hangs off the `modelValue` true→false transition, with `flush: "sync"`, and
nowhere else**: that is the only hook that also fires when the *host* closes the dialog
rather than the user (`series.vue` clears the flag when the detail route unwinds on Back),
and sync is what lets it run before a host that closes-and-unmounts in one tick takes the
component down with the draft still in it. So a host must `v-model` it, never
`:model-value` alone.

**Seeding the draft is a separate watcher on the same source, and it must be `flush: "post"`,
not sync.** A sync watcher runs *during* the parent's prop patch, which assigns props in
template-attribute order — `v-model` lands before `:review` — so it reads the previous book's
review and the dialog reopens with the last entry still in it. Both watchers exist because
the two directions want opposite timing.

Both halves are offered at every reading status: a rating belongs to the work, not to having
finished a copy. The panel is a fixed-header / scrolling-body / fixed-footer column (same
shape as `BookDetail`'s full mode) and the **textarea auto-grows instead of scrolling** — a
scrollbar inside a form field never reads as designed, so the review region owns the
scrolling and DONE stays reachable however long the review runs. `autoGrow` must be re-run
whenever the textarea is re-created (it is `v-if`'d out in preview mode) or re-seeded on open.

`useRatingPrompt` holds the page-level state (`promptBook`/`promptOpen`) plus `promptIfRead`,
the rule that raises the dialog on a transition *into* `read` (and only that transition).
Used by `index.vue`; `series.vue` only needs the open flag, since every status change there
comes from the one open detail.
