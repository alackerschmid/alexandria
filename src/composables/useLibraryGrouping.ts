import { computed, type ComputedRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { useLocaleStore } from '@/stores/locale'
import { useFieldDefsStore } from '@/stores/fieldDefs'
import { parseTagList } from '@/utils/tags'
import { bookCustomValue } from '@/utils/custom-fields'
import { sortByCreatedAt } from '@/utils/book-display'
import { languageDisplayFormatter } from '@/utils/language'
import type { Book, ReadStatus } from '@/types/book'
import type { GroupBy, SortOption } from '@/types/library'

export interface BookGroup {
  key: string
  label: string
  books: Book[]
  seriesId?: number | null
  seriesTotal?: number | null
}

interface ValueGroupOptions {
  /** Group keys a book belongs to; an empty array routes the book to the "missing" bucket. */
  values: (b: Book) => string[]
  /** Display label for a key (defaults to the key itself). */
  label?: (key: string) => string
  missingKey: string
  missingLabel: string
  /** Sort by the numeric value of the key instead of the locale-compared label. */
  numeric?: boolean
}

// Shared map → sort → trailing "missing" bucket pattern used by every value-based
// grouping (author, genre, publisher, language, form, subject, country, decade, custom).
function groupByValues(
  books: Book[],
  dir: SortOption,
  locale: string,
  opts: ValueGroupOptions,
): BookGroup[] {
  const map = new Map<string, Book[]>()
  const missing: Book[] = []
  for (const b of books) {
    const vals = opts.values(b)
    if (!vals.length) {
      missing.push(b)
      continue
    }
    for (const v of vals) {
      let arr = map.get(v)
      if (!arr) {
        arr = []
        map.set(v, arr)
      }
      arr.push(b)
    }
  }
  const labelFor = opts.label ?? ((k: string) => k)
  const groups: BookGroup[] = [...map.entries()].map(([key, bks]) => ({
    key,
    label: labelFor(key),
    books: bks,
  }))
  groups.sort((a, b) => {
    const cmp = opts.numeric
      ? Number.parseInt(a.key) - Number.parseInt(b.key)
      : a.label.localeCompare(b.label, locale)
    return dir === 'asc' ? cmp : -cmp
  })
  if (missing.length) {
    groups.push({ key: opts.missingKey, label: opts.missingLabel, books: missing })
  }
  return groups
}

/**
 * Owns the library grouping pipeline: turns the filtered book list into ordered
 * shelves for the current `groupBy`. Status and series are bespoke (they carry
 * extra metadata); every other dimension funnels through {@link groupByValues}.
 */
export function useLibraryGrouping(options: {
  baseFiltered: ComputedRef<Book[]>
  filteredBooks: ComputedRef<Book[]>
  groupBy: ComputedRef<GroupBy>
  sortDirection: ComputedRef<SortOption>
  /** Resolves the status used for the "group by status" bucket — lets callers freeze
   *  a book's shelf after an in-place status edit instead of using the live value. */
  statusOf?: (b: Book) => ReadStatus
}) {
  const { baseFiltered, filteredBooks, groupBy, sortDirection, statusOf = (b: Book) => b.status } = options
  const { t } = useI18n()
  const localeStore = useLocaleStore()
  const fieldDefsStore = useFieldDefsStore()
  const langFmt = computed(() => languageDisplayFormatter(localeStore.locale))

  // Flat series-ordered list — the pagination source when grouping by series.
  const seriesOrderedBooks = computed<Book[]>(() => {
    if (groupBy.value !== 'series') return []
    const seriesMap = new Map<number, Book[]>()
    const standalones: Book[] = []
    for (const b of baseFiltered.value) {
      if (b.series_id != null) {
        let arr = seriesMap.get(b.series_id)
        if (!arr) {
          arr = []
          seriesMap.set(b.series_id, arr)
        }
        arr.push(b)
      } else {
        standalones.push(b)
      }
    }
    const sortedGroups = [...seriesMap.entries()].sort(([, a], [, b]) => {
      const cmp = (a[0].series_name ?? '').localeCompare(
        b[0].series_name ?? '',
        localeStore.locale,
      )
      return sortDirection.value === 'asc' ? cmp : -cmp
    })
    const flat: Book[] = []
    for (const [, books] of sortedGroups) {
      books.sort(
        (a, b) => (a.series_ordinal ?? Infinity) - (b.series_ordinal ?? Infinity),
      )
      flat.push(...books)
    }
    flat.push(...sortByCreatedAt(standalones, sortDirection.value))
    return flat
  })

  // All groups over the full filtered set (paging happens by group in the page).
  const allGroups = computed<BookGroup[]>(() => {
    const gb = groupBy.value
    const dir = sortDirection.value
    const locale = localeStore.locale
    const books = gb === 'series' ? seriesOrderedBooks.value : filteredBooks.value

    if (gb === 'none') {
      return [{ key: '__all__', label: '', books }]
    }

    if (gb === 'status') {
      const order: ReadStatus[] =
        dir === 'asc'
          ? ['reading', 'unread', 'read', 'dnf']
          : ['dnf', 'read', 'unread', 'reading']
      return order
        .map(s => ({
          key: s,
          label: t(`book.${s}`),
          books: books.filter(b => statusOf(b) === s),
        }))
        .filter(g => g.books.length)
    }

    if (gb === 'series') {
      const map = new Map<number, BookGroup>()
      const standalones: Book[] = []
      for (const b of books) {
        if (b.series_id != null) {
          let g = map.get(b.series_id)
          if (!g) {
            g = {
              key: String(b.series_id),
              label: b.series_name || t('detail.series'),
              books: [],
              seriesId: b.series_id,
              seriesTotal: b.series_total ?? null,
            }
            map.set(b.series_id, g)
          }
          g.books.push(b)
        } else {
          standalones.push(b)
        }
      }
      const groups = [...map.values()]
      groups.sort((a, b) => {
        const cmp = a.label.localeCompare(b.label, locale)
        return dir === 'asc' ? cmp : -cmp
      })
      if (standalones.length) {
        groups.push({
          key: '__standalone__',
          label: t('library.standalone'),
          books: standalones,
        })
      }
      return groups
    }

    const unclassified = t('library.unclassified')

    switch (gb) {
      case 'author':
        return groupByValues(books, dir, locale, {
          values: b => (b.author ? [b.author] : []),
          missingKey: '__unknown__',
          missingLabel: t('book.unknown_author'),
        })
      case 'genre':
        return groupByValues(books, dir, locale, {
          values: b => (b.genres?.[0] ? [b.genres[0]] : []),
          missingKey: '__unclassified__',
          missingLabel: unclassified,
        })
      case 'publisher':
        return groupByValues(books, dir, locale, {
          values: b => (b.publisher ? [b.publisher] : []),
          missingKey: '__unclassified__',
          missingLabel: unclassified,
        })
      case 'language':
        return groupByValues(books, dir, locale, {
          values: b => (b.language ? [b.language] : []),
          label: langFmt.value,
          missingKey: '__unclassified__',
          missingLabel: unclassified,
        })
      case 'form':
        return groupByValues(books, dir, locale, {
          values: b => (b.form_of_work ? [b.form_of_work] : []),
          missingKey: '__unclassified__',
          missingLabel: unclassified,
        })
      case 'subject':
        return groupByValues(books, dir, locale, {
          values: b => (b.main_subject ? [b.main_subject] : []),
          missingKey: '__unclassified__',
          missingLabel: unclassified,
        })
      case 'country':
        return groupByValues(books, dir, locale, {
          values: b => b.countries_of_origin ?? [],
          missingKey: '__unclassified__',
          missingLabel: unclassified,
        })
      case 'decade':
        return groupByValues(books, dir, locale, {
          values: b => {
            const year = Number.parseInt(b.original_pub_date ?? '')
            return Number.isNaN(year) ? [] : [`${Math.floor(year / 10) * 10}s`]
          },
          missingKey: '__unclassified__',
          missingLabel: unclassified,
          numeric: true,
        })
    }

    if (gb.startsWith('cf:')) {
      const defId = Number(gb.slice(3))
      const def = fieldDefsStore.defs.find(d => d.id === defId)
      return groupByValues(books, dir, locale, {
        values: b => {
          const raw = bookCustomValue(b, defId)
          return def?.type === 'tag' ? parseTagList(raw) : raw ? [raw] : []
        },
        missingKey: '__cfnone__',
        missingLabel: unclassified,
      })
    }

    return [{ key: '__all__', label: '', books }]
  })

  return { seriesOrderedBooks, allGroups }
}
