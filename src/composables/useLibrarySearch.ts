import { computed, type ComputedRef, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { useLocaleStore } from '@/stores/locale'
import { parseTagList } from '@/utils/tags'
import { bookCustomValue } from '@/utils/custom-fields'
import { languageDisplayFormatter } from '@/utils/language'
import type { Book, ReadStatus } from '@/types/book'
import type { CustomFieldMeta } from '@/composables/useGroupDimensions'

// Structured search keys with first-class handling (status:, author:, genre:, …).
// Custom-field slugs are appended at runtime.
const STATUS_VALUES: ReadStatus[] = ['unread', 'reading', 'read']

const BUILTIN_KEYS = [
  'status',
  'author',
  'genre',
  'series',
  'publisher',
  'language',
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
}) {
  const { books, search, customFieldMetas } = options
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
      if (key === 'status' && STATUS_VALUES.includes(val as ReadStatus)) {
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
      list = list.filter(b => b.status === status)
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
      list = list.filter(b => b.author?.toLowerCase().includes(author))
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
          b.author?.toLowerCase().includes(text) ||
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
    const awardLabel = t('library.filter_awards')
    const formLabel = t('library.group_form')
    const countryLabel = t('library.group_country')
    const subjectLabel = t('library.group_subject')
    const locationLabel = t('library.group_location')

    const entries: SuggestionFacet[] = []

    // Only suggest statuses that actually exist in the current filtered pool
    const presentStatuses = new Set(pool.map(b => b.status))
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
    for (const b of pool) {
      if (b.author) {
        const k = b.author.toLowerCase()
        if (!seen.has(`author:${k}`)) {
          seen.add(`author:${k}`)
          entries.push({
            kind: 'facet',
            token: `author:${quote(b.author)}`,
            icon: 'mdi-account-outline',
            label: b.author,
            typeLabel: authorLabel,
          })
        }
      }
      for (const g of b.genres ?? []) {
        const k = g.toLowerCase()
        if (!seen.has(`genre:${k}`)) {
          seen.add(`genre:${k}`)
          entries.push({
            kind: 'facet',
            token: `genre:${quote(g)}`,
            icon: 'mdi-tag-outline',
            label: g,
            typeLabel: genreLabel,
          })
        }
      }
      if (b.series_name) {
        const k = b.series_name.toLowerCase()
        if (!seen.has(`series:${k}`)) {
          seen.add(`series:${k}`)
          entries.push({
            kind: 'facet',
            token: `series:${quote(b.series_name)}`,
            icon: 'mdi-bookshelf',
            label: b.series_name,
            typeLabel: seriesLabel,
          })
        }
      }
      if (b.publisher) {
        const k = b.publisher.toLowerCase()
        if (!seen.has(`publisher:${k}`)) {
          seen.add(`publisher:${k}`)
          entries.push({
            kind: 'facet',
            token: `publisher:${quote(b.publisher)}`,
            icon: 'mdi-domain',
            label: b.publisher,
            typeLabel: publisherLabel,
          })
        }
      }
      if (b.language) {
        const k = b.language.toLowerCase()
        if (!seen.has(`language:${k}`)) {
          seen.add(`language:${k}`)
          entries.push({
            kind: 'facet',
            token: `language:${quote(b.language)}`,
            icon: 'mdi-translate',
            label: langFmt.value(b.language),
            typeLabel: languageLabel,
          })
        }
      }
      for (const a of b.awards ?? []) {
        const k = a.toLowerCase()
        if (!seen.has(`award:${k}`)) {
          seen.add(`award:${k}`)
          entries.push({
            kind: 'facet',
            token: `award:${quote(a)}`,
            icon: 'mdi-trophy-outline',
            label: a,
            typeLabel: awardLabel,
          })
        }
      }
      for (const a of b.nominations ?? []) {
        const k = a.toLowerCase()
        if (!seen.has(`award:${k}`)) {
          seen.add(`award:${k}`)
          entries.push({
            kind: 'facet',
            token: `award:${quote(a)}`,
            icon: 'mdi-trophy-outline',
            label: a,
            typeLabel: awardLabel,
          })
        }
      }
      if (b.form_of_work) {
        const k = b.form_of_work.toLowerCase()
        if (!seen.has(`form:${k}`)) {
          seen.add(`form:${k}`)
          entries.push({
            kind: 'facet',
            token: `form:${quote(b.form_of_work)}`,
            icon: 'mdi-text-box-outline',
            label: b.form_of_work,
            typeLabel: formLabel,
          })
        }
      }
      for (const c of b.countries_of_origin ?? []) {
        const k = c.toLowerCase()
        if (!seen.has(`country:${k}`)) {
          seen.add(`country:${k}`)
          entries.push({
            kind: 'facet',
            token: `country:${quote(c)}`,
            icon: 'mdi-earth',
            label: c,
            typeLabel: countryLabel,
          })
        }
      }
      if (b.main_subject) {
        const k = b.main_subject.toLowerCase()
        if (!seen.has(`subject:${k}`)) {
          seen.add(`subject:${k}`)
          entries.push({
            kind: 'facet',
            token: `subject:${quote(b.main_subject)}`,
            icon: 'mdi-lightbulb-outline',
            label: b.main_subject,
            typeLabel: subjectLabel,
          })
        }
      }
      for (const loc of b.narrative_locations ?? []) {
        const k = loc.toLowerCase()
        if (!seen.has(`location:${k}`)) {
          seen.add(`location:${k}`)
          entries.push({
            kind: 'facet',
            token: `location:${quote(loc)}`,
            icon: 'mdi-map-marker-outline',
            label: loc,
            typeLabel: locationLabel,
          })
        }
      }
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
