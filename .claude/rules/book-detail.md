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

The masthead carries identity plus the four things the user sets (status / owning / rating /
"Edit fields") via `RecordControls`, which renders `inline` there on desktop and stacked
inside `RecordPane` on mobile — one component, two layouts, so the behaviour can't drift
between breakpoints.

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

**Which tabs exist is derived from the book by `utils/detail-tabs.ts`, not by `v-if`s in the
template: a pane that would be empty is never a tab** — no description and no first line
means no Overview tab, and the view opens on Details.

`review` is the deliberate exception: always offered for an owned book, dotted until
written, because an empty review is the state the user is most meant to act on, so its empty
pane is a full-width invitation rather than a dash in a corner.

**`all` is last and is the default** — it stacks every pane in one scroll under
`DetailSection` rules that double as disclosures; pick a single tab and the rule disappears,
since the tab already names it.

`role="tabpanel"` follows the *selected* tab: in the All view the container around the panes
carries it (`#detail-panel-all`), and each section is a plain `<section>`. Only when a single
tab is selected does that pane become the panel. Marking every visible pane a tabpanel would
label five of them by tabs that aren't selected, and leave the selected tab's `aria-controls`
pointing at nothing.

The active tab and the collapse set are component-local and reset on book change, exactly
like `mode`: `useDetailRoute` identifies the *book*, not how far into it you are.

Delete lives in the pane footer (not the top bar, where it was one unlabelled icon among
four) and the manual enrichment refresh lives in `DetailsPane` beside the facts it
repopulates — it's the only user-facing retry for a work whose Wikidata lookup failed, so it
can't simply go away; the top bar keeps only back and close.

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
pane is ever rendered (a single-edition work gets no Editions tab), and it discards a
response superseded by a newer work while in flight. It skips the request outright when the
caller already knows the work has one edition, and **caches per work rather than per
open** — collapsing to card mode and re-expanding must not refetch, or the Editions tab
blinks out mid-flight and takes the user's tab selection with it.

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
