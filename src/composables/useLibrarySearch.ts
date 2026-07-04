import { computed, type ComputedRef, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useLocaleStore } from '@/stores/locale'
import { parseTagList } from '@/utils/tags'
import { bookCustomValue } from '@/utils/custom-fields'
import { languageDisplayFormatter } from '@/utils/language'
import { authorNames } from '@/utils/book-display'
import { STATUS_ORDER } from '@/composables/useBookStatus'
import type { Book, ReadStatus } from '@/types/book'
import type { CustomFieldMeta } from '@/composables/useGroupDimensions'

// Structured search keys with first-class handling (status:, author:, genre:, …).
// Custom-field slugs are appended at runtime.
const STATUS_VALUES = new Set<ReadStatus>(STATUS_ORDER)

const BUILTIN_KEYS = [
  'status',
  'author',
  'genre',
  'series',
  'publisher',
  'language',
  'original_language',
  'award',
  'form',
  'country',
  'year',
  'subject',
  'location',
]

export interface ParsedSearch {
  status: ReadStatus | null
  series: string
  award: string
  author: string
  genre: string
  publisher: string
  language: string
  original_language: string
  form: string
  country: string
  year: string
  subject: string
  location: string
  custom: Record<string, string> // custom-field slug → search value
  text: string
  tokens: string[] // the structured parts only, for the active-token pills
}

export interface SuggestionFacet {
  kind: 'facet'
  token: string
  icon: string
  label: string
  typeLabel: string
}

export function cfIcon(type: string): string {
  switch (type) {
    case 'tag':
      return 'mdi-tag-multiple-outline'
    case 'date':
      return 'mdi-calendar-outline'
    case 'integer':
      return 'mdi-numeric'
    default:
      return 'mdi-form-textbox'
  }
}

function tokenize(s: string): string[] {
  return s.match(/\S+:"[^"]*"|"[^"]*"|\S+/g) ?? []
}

function quote(v: string): string {
  return /\s/.test(v) ? `"${v}"` : v
}

/**
 * Owns the library search pipeline: raw query string → parsed tokens → filtered
 * book list → autocomplete facet entries. Pure derivation over the inputs; the
 * page keeps the DOM-bound autocomplete widget and feeds it these computeds.
 */
export function useLibrarySearch(options: {
  books: ComputedRef<Book[]> | Ref<Book[]>
  search: Ref<string>
  customFieldMetas: ComputedRef<CustomFieldMeta[]>
  /** Resolves the status used for `status:` filtering — lets callers freeze a book's
   *  bucket membership after an in-place status edit instead of using the live value. */
  statusOf?: (b: Book) => ReadStatus
}) {
  const { books, search, customFieldMetas, statusOf = (b: Book) => b.status } = options
  const { t } = useI18n()
  const localeStore = useLocaleStore()
  const langFmt = computed(() => languageDisplayFormatter(localeStore.locale))

  const customSlugMap = computed(
    () => new Map(customFieldMetas.value.map(m => [m.slug, m.def])),
  )

  const knownKeys = computed(
    () =>
      new Set<string>([
        ...BUILTIN_KEYS,
        ...customFieldMetas.value.map(m => m.slug),
      ]),
  )

  const parsedSearch = computed<ParsedSearch>(() => {
    const parts = tokenize(search.value.trim())
    let status: ReadStatus | null = null
    let series = ''
    let award = ''
    let author = ''
    let genre = ''
    let publisher = ''
    let language = ''
    let originalLanguage = ''
    let form = ''
    let country = ''
    let year = ''
    let subject = ''
    let location = ''
    const custom: Record<string, string> = {}
    const remaining: string[] = []
    const tokens: string[] = []

    for (const part of parts) {
      const colon = part.indexOf(':')
      if (colon === -1) {
        remaining.push(part)
        continue
      }
      const key = part.slice(0, colon).toLowerCase()
      const rawVal = part.slice(colon + 1)
      const val = rawVal.replace(/^"|"$/g, '').toLowerCase()
      if (key === 'status' && STATUS_VALUES.has(val as ReadStatus)) {
        status = val as ReadStatus
        tokens.push(part.toLowerCase())
      } else if (key === 'series' && val) {
        series = val
        tokens.push(part.toLowerCase())
      } else if (key === 'award' && val) {
        award = val
        tokens.push(part.toLowerCase())
      } else if (key === 'author' && val) {
        author = val
        tokens.push(part)
      } else if (key === 'genre' && val) {
        genre = val
        tokens.push(part)
      } else if (key === 'publisher' && val) {
        publisher = val
        tokens.push(part)
      } else if (key === 'language' && val) {
        language = val
        tokens.push(part)
      } else if (key === 'original_language' && val) {
        originalLanguage = val
        tokens.push(part)
      } else if (key === 'form' && val) {
        form = val
        tokens.push(part)
      } else if (key === 'country' && val) {
        country = val
        tokens.push(part)
      } else if (key === 'year' && val) {
        year = val
        tokens.push(part)
      } else if (key === 'subject' && val) {
        subject = val
        tokens.push(part)
      } else if (key === 'location' && val) {
        location = val
        tokens.push(part)
      } else if (customSlugMap.value.has(key) && val) {
        custom[key] = val
        tokens.push(part)
      } else if (!knownKeys.value.has(key)) {
        remaining.push(part)
      }
      // Known key with no/invalid value (in-progress token like "status:") — silently ignored
    }

    return {
      status,
      series,
      award,
      author,
      genre,
      publisher,
      language,
      original_language: originalLanguage,
      form,
      country,
      year,
      subject,
      location,
      custom,
      text: remaining.join(' ').toLowerCase(),
      tokens,
    }
  })

  function removeToken(token: string) {
    const lower = token.toLowerCase()
    search.value = tokenize(search.value.trim())
      .filter(p => p.toLowerCase() !== lower)
      .join(' ')
  }

  // Pure filter — no sort. The series grouping sorts within groups by ordinal.
  const baseFiltered = computed<Book[]>(() => {
    const {
      status,
      series,
      award,
      author,
      genre,
      publisher,
      language,
      original_language: originalLanguage,
      form,
      country,
      year,
      subject,
      location,
      custom,
      text,
    } = parsedSearch.value
    let list = books.value

    if (status) {
      list = list.filter(b => statusOf(b) === status)
    }
    if (series) {
      list = list.filter(b => b.series_name?.toLowerCase().includes(series))
    }
    if (award) {
      list = list.filter(
        b =>
          b.awards?.some(a => a.toLowerCase().includes(award)) ||
          b.nominations?.some(n => n.toLowerCase().includes(award)),
      )
    }
    if (author) {
      list = list.filter(b => authorNames(b).some(n => n.toLowerCase().includes(author)))
    }
    if (genre) {
      list = list.filter(b =>
        b.genres?.some(g => g.toLowerCase().includes(genre)),
      )
    }
    if (publisher) {
      list = list.filter(b => b.publisher?.toLowerCase().includes(publisher))
    }
    if (language) {
      list = list.filter(b => b.language?.toLowerCase().includes(language))
    }
    if (originalLanguage) {
      list = list.filter(b =>
        b.language_of_work?.toLowerCase().includes(originalLanguage),
      )
    }
    if (form) {
      list = list.filter(b => b.form_of_work?.toLowerCase().includes(form))
    }
    if (country) {
      list = list.filter(b =>
        b.countries_of_origin?.some(c => c.toLowerCase().includes(country)),
      )
    }
    if (year) {
      list = list.filter(b => b.original_pub_date?.toLowerCase().includes(year))
    }
    if (subject) {
      list = list.filter(b => b.main_subject?.toLowerCase().includes(subject))
    }
    if (location) {
      list = list.filter(b =>
        b.narrative_locations?.some(l => l.toLowerCase().includes(location)),
      )
    }
    for (const [slug, val] of Object.entries(custom)) {
      const def = customSlugMap.value.get(slug)
      if (!def) continue
      list = list.filter(b => {
        const raw = bookCustomValue(b, def.id)
        if (!raw) return false
        return def.type === 'tag'
          ? parseTagList(raw).some(tg => tg.toLowerCase().includes(val))
          : raw.toLowerCase().includes(val)
      })
    }
    if (text) {
      list = list.filter(
        b =>
          b.title?.toLowerCase().includes(text) ||
          authorNames(b).some(n => n.toLowerCase().includes(text)) ||
          b.isbn.includes(text),
      )
    }

    return list
  })

  const facetEntries = computed<SuggestionFacet[]>(() => {
    const pool = baseFiltered.value
    const statusLabel = t('library.filter_status')
    const authorLabel = t('library.group_author')
    const genreLabel = t('library.group_genre')
    const seriesLabel = t('library.group_series')

    const publisherLabel = t('library.group_publisher')
    const languageLabel = t('library.group_language')
    const originalLanguageLabel = t('library.group_original_language')
    const awardLabel = t('library.filter_awards')
    const formLabel = t('library.group_form')
    const countryLabel = t('library.group_country')
    const subjectLabel = t('library.group_subject')
    const locationLabel = t('library.group_location')

    const entries: SuggestionFacet[] = []

    // Only suggest statuses that actually exist in the current filtered pool
    const presentStatuses = new Set(pool.map(statusOf))
    for (const [val, label] of [
      ['read', t('book.read')],
      ['reading', t('book.reading')],
      ['unread', t('book.unread')],
    ] as [string, string][]) {
      if (presentStatuses.has(val as ReadStatus))
        entries.push({
          kind: 'facet',
          token: `status:${val}`,
          icon: 'mdi-progress-check',
          label,
          typeLabel: statusLabel,
        })
    }

    // Resolve a book's custom-field value entries to their meta in one lookup,
    // avoiding a per-field scan of custom_field_values for every book.
    const metaByDefId = new Map(customFieldMetas.value.map(m => [m.def.id, m]))

    const seen = new Set<string>()
    function pushFacet(
      prefix: string,
      value: string,
      icon: string,
      typeLabel: string,
      label: string = value,
    ) {
      const k = `${prefix}:${value.toLowerCase()}`
      if (seen.has(k)) return
      seen.add(k)
      entries.push({ kind: 'facet', token: `${prefix}:${quote(value)}`, icon, label, typeLabel })
    }

    for (const b of pool) {
      for (const name of authorNames(b)) pushFacet('author', name, 'mdi-account-outline', authorLabel)
      for (const g of b.genres ?? []) pushFacet('genre', g, 'mdi-tag-outline', genreLabel)
      if (b.series_name) pushFacet('series', b.series_name, 'mdi-bookshelf', seriesLabel)
      if (b.publisher) pushFacet('publisher', b.publisher, 'mdi-domain', publisherLabel)
      if (b.language)
        pushFacet('language', b.language, 'mdi-translate', languageLabel, langFmt.value(b.language))
      if (b.language_of_work)
        pushFacet('original_language', b.language_of_work, 'mdi-translate-variant', originalLanguageLabel)
      for (const a of b.awards ?? []) pushFacet('award', a, 'mdi-trophy-outline', awardLabel)
      for (const a of b.nominations ?? []) pushFacet('award', a, 'mdi-trophy-outline', awardLabel)
      if (b.form_of_work) pushFacet('form', b.form_of_work, 'mdi-text-box-outline', formLabel)
      for (const c of b.countries_of_origin ?? []) pushFacet('country', c, 'mdi-earth', countryLabel)
      if (b.main_subject) pushFacet('subject', b.main_subject, 'mdi-lightbulb-outline', subjectLabel)
      for (const loc of b.narrative_locations ?? [])
        pushFacet('location', loc, 'mdi-map-marker-outline', locationLabel)

      for (const cf of b.custom_field_values ?? []) {
        if (cf.value == null) continue
        const meta = metaByDefId.get(cf.field_def_id)
        if (!meta || meta.def.type === 'date' || meta.def.type === 'integer')
          continue
        const vals =
          meta.def.type === 'tag' ? parseTagList(cf.value) : [cf.value]
        for (const v of vals) {
          const k = `${meta.slug}:${v.toLowerCase()}`
          if (!seen.has(k)) {
            seen.add(k)
            entries.push({
              kind: 'facet',
              token: `${meta.slug}:${quote(v)}`,
              icon: cfIcon(meta.def.type),
              label: v,
              typeLabel: meta.def.name,
            })
          }
        }
      }
    }
    return entries
  })

  return {
    knownKeys,
    parsedSearch,
    baseFiltered,
    facetEntries,
    removeToken,
  }
}
