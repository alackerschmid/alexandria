import { describe, it, expect } from 'vitest'
import { classifyError, SparqlError } from '../src/enrichment'

describe('classifyError', () => {
  it('extracts the kind from a SparqlError', () => {
    expect(classifyError(new SparqlError('timed out', 'timeout'))).toBe('timeout')
    expect(classifyError(new SparqlError('rate limited', 'rate_limited'))).toBe('rate_limited')
    expect(classifyError(new SparqlError('server error', 'http_5xx'))).toBe('http_5xx')
    expect(classifyError(new SparqlError('bad request', 'other'))).toBe('other')
  })

  it('classifies any non-SparqlError as network (infrastructure-adjacent, not a hopeless work)', () => {
    expect(classifyError(new Error('some D1 exception'))).toBe('network')
    expect(classifyError('a plain string')).toBe('network')
    expect(classifyError(null)).toBe('network')
  })
})
