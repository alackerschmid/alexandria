# TO DO

## bugfixes
- add proper error handling in the frontend for worker offline (Failed to execute 'json' on 'Response': Unexpected end of JSON input), database incompatible
- ~~favicon not properly displayed on ios (shown as default vue icon~~)
- ~~proper capitalization for genres~~
- only display "series lookup pending" if it is actually pending
- fix autocomplete (ie typing author:jim does not suggest author: jim butcher)
- add display names and titles to the DB that the user can edit

## batch 1: making series more robust
- ~~distinguish main / side series (ie dresden files) -> series entries without a numbering should be labelled as "side entries"~~ 
- properly handle multilingual editions: 
    - intended behaviour: different editions of one book are all grouped by one identifier (different print, format, language etc.)
    - series names are always displayed the user language if possible
- ~~handle exotic editions (ie infinite jest 30th anniversary edition)~~

# batch 2: improve library view
- sorting, tile view need to behave differently if library is grouped (how?) -> small redesign for library view necessary
- move "delete" to fourth option of reading status
- back fill items when in group view so that there's always 4 items per row
- option to show unowned books (in a series) grayed out
- group by criteria should be one common component (so home and library stay in sync)
- adjust layout of detail page:
  - triple column layout:
  - col1: cover
  - col2: title, series (more prominent, also display position in series), reading status, author, description, genres, prizes
  - col3: edition stats, your stats (added on, custom fields)
- groupby does not play nice with pagination
- ~~some sort of automated lookup for un-enriched books~~
- ~~backfill of enrichment for series items (directly on queue?)~~
- ~~pagination for grid view -> make pagination adjustable~~
- ~~add expanded view for details page~~
- ~~idea: show preceding / following books to the left / right, slightly transparent, blurred or os (on mobile, give icons to cycle left / right)~~ shelved for now

# batch 3: improve custom field handling and management
- ~~move custom-field management (& hiding default fields) to settings page~~
- ~~add a theme color picker to the settings page~~
- incorporate custom fields into search prefix options, groupby and so on
- allow custom fields to have types (int, str, literal, date) -> not working properly atm
- make custom fields always editable
- overhaul edit process
- edit should allow editing all fields (new ones are missing) (also not the cover url tho)

# lower priority UI improvements
- should be able to change reading status in the expanded view in the scnanner
- add "rating" as field, should be asked in the scanner view after selecting "read"
- show version number + release notes in the footer
- general legibility / contrast etc. check
- should be able to manualyl enter title / isbn on mobile too
- design uniform view for chip items (dropdown values when selected, genres, ...)
- ~~re-add library button to stats page~~
- write some taglines for the stats page
- ~~sharpen marketing page~~
- ~~redo home page (typography styled)~~
- ~~redo home / scan / library flow for guests~~

# big picture items
- proper versioning / releases / patch notes
- mass import books before prod go-live to prep enrichment (-> how?)
- bulk editing / import
- incorporate CV page
- export all design elements as npm package
- add export button & functionality that exports all books as .csv