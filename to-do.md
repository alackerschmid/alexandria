# TO DOS

## PRIORITY 1 — done

- fix toast styling (proper setting of colors, positioning of elements in the toast)
- [x] when the camera cannot be accessed, the user should instead be shown the manual isbn import → dedicated full-screen manual-entry screen in `scanner.vue`
- [x] format footer / header properly at the top / bottom of the page, make them into reusable components → `AppHeader.vue` / `AppFooter.vue`

## PRIORITY 2

- add pagination to index view and show # before each status
- implement proper redirecting / dialogueing between account creation, login window & login
- write a comprehensive readme as introductory page for github
- [x] expand desktop view:
  - [x] modify camera button palcement / UI if not on mobile
  - [x] modify login UI for desktop
  - [x] modify book UI for desktop (tiles)
- [x] add detail page for books
  - description
  - publisher
  - published_date
  - language
  - page count

## PRIORITY 3

- cross-reference / fill missing or wrong data through double API call
- improve book cover loading speed on page initialization
- work around / add check for google books api rate limit
- automatic re query for incomplete data (ie covers)
- implement i18n

## FUTURE

- export all design elements as npm package
- add export button & functionality that exports all books as .csv
- [x] modify database structure to create unique isbn table and use m:n relationship between users / books for faster lookup
- bulk editing / import
- incorporate CV page
