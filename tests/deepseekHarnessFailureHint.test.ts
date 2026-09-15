import { describe, expect, it } from 'vitest'
import { isDshQuotaError } from '../src/main/services/deepseekHarnessFailure'

describe('isDshQuotaError', () => {
  it('matches dsh normalized QUOTA prefix', () => {
    expect(isDshQuotaError('QUOTA: Insufficient Balance')).toBe(true)
    expect(isDshQuotaError('quota: insufficient balance')).toBe(true)
  })

  it('matches upstream DeepSeek insufficient_balance code', () => {
    expect(isDshQuotaError('error: insufficient_balance on account')).toBe(true)
    expect(isDshQuotaError('Insufficient Balance for the requested resource.')).toBe(true)
  })

  it('matches Chinese phrasing', () => {
    expect(isDshQuotaError('DeepSeek 账户余额不足，请充值')).toBe(true)
    expect(isDshQuotaError('API Key 已欠费，请联系管理员')).toBe(true)
  })

  it('detects quota phrase anywhere in combined stdout/stderr', () => {
    const captured = [
      '[aiart-runner] starting dsh',
      'error: 401',
      'QUOTA: Insufficient Balance'
    ].join('\n')
    expect(isDshQuotaError(captured)).toBe(true)
  })

  it('does not match unrelated errors', () => {
    expect(isDshQuotaError('')).toBe(false)
    expect(isDshQuotaError('rate limit exceeded, retry after 30s')).toBe(false)
    expect(isDshQuotaError('invalid api key')).toBe(false)
    expect(isDshQuotaError('network timeout')).toBe(false)
  })
})