# TO DOS

## PRIORITY 1 — done

- [x] fix toast styling (proper setting of colors, positioning of elements in the toast) → `AppToast.vue`
- [x] when the camera cannot be accessed, the user should instead be shown the manual isbn import → dedicated full-screen manual-entry screen in `scanner.vue`
- [x] format footer / header properly at the top / bottom of the page, make them into reusable components → `AppHeader.vue` / `AppFooter.vue`

## PRIORITY 2

- implement proper redirecting / dialogueing between account creation, login window & login
- write a comprehensive readme as introductory page for github
- expand desktop view:
  - modify camera button palcement / UI if not on mobile
  - modify login UI for desktop
  - modify book UI for desktop (tiles)

## PRIORITY 3

- cross-reference / fill missing or wrong data through double API call
- improve book cover loading speed on page initialization
- add detail page for books
- work around / add check for google books api rate limit
- automatic re query for incomplete data (ie covers)

## FUTURE

- export all design elements as npm package
- add export button & functionality that exports all books as .csv
- modify database structure to create unique isbn table and use m:n relationship between users / books for faster lookup
- bulk editing / import
- incorporate CV page
