# TO DO

## new batch

https://www.reddit.com/r/ClaudeAI/comments/1ulti1r/i_end_every_ai_session_with_two_questions/

- implement select field options properly
- add support for 2nd accent color, set central color scheme for stuff like read / dnf / unowned / lent etc. (also want color is hardcoded to orange)
- ~~add star review field~~
- add text review field (optional?)
- ~~implement proper CI deploy workflow~~
- add confirmation for switch
- add description from reference book
- ~~change the base page's random books to a curated batch (boolean flag in database column)~~
- add focus styling from settings to all other relevant fields (isbn title search)
- add proper backfill from other editions for stuff like description
- add support for numeric filters / groupby (page count, rating)
- ~~improve grouping visuals (fill rows)~~

## bugfixes

- ~~check automatic worker deployment~~
- ~~unscrew tolocalestring stats display on homepage~~
- ~~dnf doesnt show up in autocomplete status options~~
- add "quote" from wikidata
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

## batch 3: detail page

- metadata in list items is lacking
- look at books w/o cover
- edit should allow editing all fields (new ones are missing) (also not the cover url tho)
- overhaul edit process
- move edit / refresh / delete buttons to be more central

## lower priority UI improvements

- should be able to change reading status in the expanded view in the scnanner
- more granular loading indicator (current "scnaning now")
- show version number + release notes in the footer
- general legibility / contrast etc. check
- design uniform view for chip items (dropdown values when selected, genres, ...)
- write some taglines for the stats page, implement dynamic stats taglines

## features for v1.0.0

- new page-scrolling landing page that details all of the features
- wishlist feature
- "missing" filter that highlights incomplete series
- "to sell" marker
- bulk editing / import

## big picture things

- mass import books before prod go-live to prep enrichment (-> how?)
- incorporate CV page
- export all design elements as npm package
- add export button & functionality that exports all books as .csv
