import { describe, it, expect } from 'vitest'
import { mergeMetadata, splitAuthors, normalizeStr } from '../src/editions'
import type { BookMetadata } from '../src/types'

const empty: BookMetadata = {
  title: null,
  author: null,
  cover_url: null,
  language: null,
  publish_date: null,
  number_of_pages_median: null,
  description: null,
  publisher: null,
  physical_format: null,
  edition_name: null,
  physical_dimensions: null,
  categories: null,
}

describe('mergeMetadata', () => {
  it('fills null fields on primary from fallback', () => {
    const primary = { ...empty, title: 'Dune' }
    const fallback = { ...empty, title: 'Other Title', author: 'Frank Herbert', publisher: 'Ace' }
    const merged = mergeMetadata(primary, fallback)
    expect(merged.title).toBe('Dune') // primary wins
    expect(merged.author).toBe('Frank Herbert') // filled from fallback
    expect(merged.publisher).toBe('Ace')
  })

  it('does not mutate the inputs', () => {
    const primary = { ...empty, title: 'Dune' }
    const fallback = { ...empty, author: 'Frank Herbert' }
    mergeMetadata(primary, fallback)
    expect(primary.author).toBeNull()
  })

  it('returns primary unchanged when fallback is entirely empty', () => {
    const primary = { ...empty, title: 'Dune', author: 'Frank Herbert' }
    expect(mergeMetadata(primary, empty)).toEqual(primary)
  })
})

describe('splitAuthors', () => {
  it('splits a comma-joined author string', () => {
    expect(splitAuthors('Jane Doe, John Smith')).toEqual(['Jane Doe', 'John Smith'])
  })

  it('trims whitespace around each name', () => {
    expect(splitAuthors('Jane Doe ,  John Smith')).toEqual(['Jane Doe', 'John Smith'])
  })

  it('returns [] for null', () => {
    expect(splitAuthors(null)).toEqual([])
  })

  it('drops empty segments', () => {
    expect(splitAuthors('Jane Doe,,')).toEqual(['Jane Doe'])
  })

  it('returns a single-element array for one author', () => {
    expect(splitAuthors('Frank Herbert')).toEqual(['Frank Herbert'])
  })
})

describe('normalizeStr', () => {
  it('lowercases input', () => {
    expect(normalizeStr('Frank Herbert')).toBe('frank herbert')
  })

  it('strips combining diacritics', () => {
    expect(normalizeStr('J.R.R. Tolkien')).toBe('j.r.r. tolkien')
    expect(normalizeStr('Émile Zola')).toBe('emile zola')
  })

  it('collapses repeated whitespace', () => {
    expect(normalizeStr('Frank   Herbert')).toBe('frank herbert')
  })

  it('returns "" for null/undefined', () => {
    expect(normalizeStr(null)).toBe('')
    expect(normalizeStr(undefined)).toBe('')
  })
})
