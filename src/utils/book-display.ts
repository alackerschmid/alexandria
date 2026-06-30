// Shared book display formatters — keep title/author fallbacks and date parsing in one place.
import { BCP47 } from '@/plugins/i18n'
import type { Book } from '@/types/book'
import type { SortOption } from '@/types/library'

/** Stable sort by acquisition date: `asc` oldest-first, `desc` newest-first. */
export function sortByCreatedAt(list: Book[], dir: SortOption): Book[] {
  return [...list].sort((a, b) =>
    dir === 'asc'
      ? a.created_at.localeCompare(b.created_at)
      : b.created_at.localeCompare(a.created_at),
  )
}

/** Title with ISBN fallback when a book has no catalogued title. */
export function displayTitle(book: Pick<Book, 'title' | 'isbn'>): string {
  return book.title || book.isbn
}

/** Author with a translated "unknown author" fallback. Pass the i18n `t`. */
export function displayAuthor(book: Pick<Book, 'author'>, t: (key: string) => string): string {
  return book.author || t('book.unknown_author')
}

/** 4-digit year, preferring the edition's publish date then the work's original date. */
export function bookYear(book: Pick<Book, 'publish_date' | 'original_pub_date'>): string {
  const d = book.publish_date || book.original_pub_date
  return d ? String(d).slice(0, 4) : ''
}

/**
 * Locale-aware human date for partial or full ISO date strings.
 * Handles `YYYY-MM-DD` (full date), `YYYY-MM` (month + year), and returns
 * anything else (e.g. a bare year) unchanged.
 */
export function formatPublishDate(date: string | null | undefined, locale: string): string {
  if (!date) return ''
  const loc = BCP47[locale] ?? 'en-GB'
  if (/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const [y, m, d] = date.split('-').map(Number)
    return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(loc, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }
  if (/^\d{4}-\d{2}$/.test(date)) {
    const [y, m] = date.split('-').map(Number)
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(loc, {
      year: 'numeric',
      month: 'long',
    })
  }
  return date
}
