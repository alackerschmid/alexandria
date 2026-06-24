# TO DO

## bugfixes
- fix linux / windows npm stuff
- add proper error handling in the frontend for worker offline (Failed to execute 'json' on 'Response': Unexpected end of JSON input), database incompatible
- favicon not properly displayed on ios (shown as default vue icon)
- proper capitalization for genres
- only display "series lookup pending" if it is actually pending
- fix autocomplete (ie typing author:jim does not suggest author: jim butcher)

## batch 1: making series more robust
- ~~distinguish main / side series (ie dresden files) -> series entries without a numbering should be labelled as "side entries"~~ 
- properly handle multilingual editions: 
    - intended behaviour: different editions of one book are all grouped by one identifier (different print, format, language etc.)
    - series names are always displayed the user language if possible
- handle exotic editions (ie infinite jest 30th anniversary edition)

# batch 2: improve library view
- sorting needs to depend on group by
- move "delete" to fourth option of reading status
- adjust layout of detail page:
  - triple column layout:
  - col1: cover
  - col2: title, series (more prominent, also display position in series), reading status, author, description, genres, prizes
  - col3: edition stats, your stats (added on, custom fields)
- ~~some sort of automated lookup for un-enriched books~~
- ~~backfill of enrichment for series items (directly on queue?)~~
- pagination for grid view -> make pagination adjustable
- ~~add expanded view for details page~~
- ~~idea: show preceding / following books to the left / right, slightly transparent, blurred or os (on mobile, give icons to cycle left / right)~~ shelved for now

# batch 3: improve custom field handling and management
- ~~move custom-field management (& hiding default fields) to settings page~~
- ~~add a theme color picker to the settings page~~
- incorporate custom fields into search prefix options, groupby and so on
- allow custom fields to have types (int, str, literal, date) -> not working properly atm
- make custom fields always editable
- overhaul edit process

# lower priority UI improvements
- sharpen marketing page
- redo home page (typography styled)
- redo home / scan / library flow for guests

# big picture items
- proper versioning / releases / patch notes
- mass import books before prod go-live to prep enrichment (-> how?)
- bulk editing / import
- incorporate CV page
- export all design elements as npm package
- add export button & functionality that exports all books as .csv