# TO DO

## new batch

- add confirmation for switch
- change the base page's random books to a curated batch (boolean flag in database column)
- add focus styling from settings to all other relevant fields (isbn title search)

## bugfixes

- check automatic worker deployment
- ~~unscrew tolocalestring stats display on homepage~~
- ~~dnf doesnt show up in autocomplete status options~~
- veirfy switch edition logic
- add proper error handling in the frontend for worker offline (Failed to execute 'json' on 'Response': Unexpected end of JSON input), database incompatible
- only display "series lookup pending" if it is actually pending
- fix autocomplete (ie typing author:jim does not suggest author: jim butcher)
- add display names and titles to the DB that the user can edit

## batch 1: making series more robust

- ~~incorporate librarything search for related ISBNs (<https://www.librarything.com/developer/documentation/thingapis>) (You can make only one request per second on an API.)~~
- look at <https://isbndb.com>
- properly handle multilingual editions:
  - intended behaviour: different editions of one book are all grouped by one identifier (different print, format, language etc.)
  - series names are always displayed the user language if possible

## batch 2: improve library view

- move "delete" to fourth option of reading status

## batch 3: detail page

- metadata in list items is lacking
- look at books w/o cover
- edit should allow editing all fields (new ones are missing) (also not the cover url tho)
- overhaul edit process
- move edit / refresh / delete buttons to be more central

## lower priority UI improvements

- should be able to change reading status in the expanded view in the scnanner
- more granular loading indicator (current "scnaning now")
- add "rating" as field, should be asked in the scanner view after selecting "read"
- show version number + release notes in the footer
- general legibility / contrast etc. check
- design uniform view for chip items (dropdown values when selected, genres, ...)
- write some taglines for the stats page, implement dynamic stats taglines

## big picture items

- wishlist feature
- "missing" filter that highlights incomplete series
- "to sell" marker
- mass import books before prod go-live to prep enrichment (-> how?)
- bulk editing / import
- incorporate CV page
- export all design elements as npm package
- add export button & functionality that exports all books as .csv
