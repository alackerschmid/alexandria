import { describe, it, expect } from 'vitest'
import { classifyError, scheduleRetry, SparqlError, RETRY_POLICY, LONG_COOLDOWN_MINUTES, type FailureReason } from '../src/enrichment'

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

describe('scheduleRetry', () => {
  it('schedules each reason at its policy backoff while under the cap', () => {
    for (const reason of Object.keys(RETRY_POLICY) as FailureReason[]) {
      expect(scheduleRetry(reason, 1)).toEqual({
        status: 'failed',
        nextRetryMinutes: RETRY_POLICY[reason].backoffMinutes,
      })
    }
  })

  it('marks the work exhausted with the long cooldown once the cap is reached', () => {
    const { capAttempts } = RETRY_POLICY.timeout
    expect(scheduleRetry('timeout', capAttempts)).toEqual({
      status: 'exhausted',
      nextRetryMinutes: LONG_COOLDOWN_MINUTES,
    })
  })

  it('keeps an exhausted work exhausted when it fails again past the cap', () => {
    const { capAttempts } = RETRY_POLICY.other
    expect(scheduleRetry('other', capAttempts + 3)).toEqual({
      status: 'exhausted',
      nextRetryMinutes: LONG_COOLDOWN_MINUTES,
    })
  })

  it('honors a Retry-After hint longer than the policy backoff', () => {
    const hintSeconds = (RETRY_POLICY.rate_limited.backoffMinutes + 10) * 60
    expect(scheduleRetry('rate_limited', 1, hintSeconds).nextRetryMinutes)
      .toBe(RETRY_POLICY.rate_limited.backoffMinutes + 10)
  })

  it('ignores a Retry-After hint shorter than the policy backoff', () => {
    expect(scheduleRetry('rate_limited', 1, 30).nextRetryMinutes)
      .toBe(RETRY_POLICY.rate_limited.backoffMinutes)
  })
})
