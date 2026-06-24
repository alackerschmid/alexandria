# TO DO

## bugfixes
- fix linux / windows npm stuff
- add proper error handling in the frontend for worker offline (Failed to execute 'json' on 'Response': Unexpected end of JSON input), database incompatible
- favicon not properly displayed on ios (shown as default vue icon)
- proper capitalization for genres
- only display "series lookup pending" if it is actually pending
- fix autocomplete (ie typing author:jim does not suggest author: jim butcher)

## batch 1: making series more robust
- distinguish main / side series (ie dresden files)
- properly handle multilingual series
- handle exotic editions (ie infinite jest 30th anniversary edition)

# batch 2: improve library view
- sorting needs to depend on group by
- ~~some sort of automated lookup for un-enriched books~~
- ~~backfill of enrichment for series items (directly on queue?)~~
- pagination for grid view
- ~~add expanded view for details page~~
- ~~idea: show preceding / following books to the left / right, slightly transparent, blurred or os (on mobile, give icons to cycle left / right)~~ shelved for now

# batch 3: improve custom field handling and management
- ~~move custom-field management (& hiding default fields) to settings page~~
- ~~add a theme color picker to the settings page~~
- incorporate custom fields into search prefix options, groupby and so on
- allow custom fields to have types (int, str, literal, date) -> not working properly atm
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