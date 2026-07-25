import { createHmac } from 'crypto'
import { describe, expect, it } from 'vitest'
import { decodeKlingJwtPayload, signKlingJwt } from '../src/main/services/modelProviders/kling/jwt'

describe('signKlingJwt', () => {
  it('signs HS256 JWT with iss/exp/nbf', () => {
    const now = 1_700_000_000
    const token = signKlingJwt('ak-test', 'sk-test', { nowSec: now, ttlSec: 1800, skewSec: 5 })
    const parts = token.split('.')
    expect(parts).toHaveLength(3)

    const payload = decodeKlingJwtPayload(token)
    expect(payload.iss).toBe('ak-test')
    expect(payload.exp).toBe(now + 1800)
    expect(payload.nbf).toBe(now - 5)

    const signingInput = `${parts[0]}.${parts[1]}`
    const expectedSig = createHmac('sha256', 'sk-test')
      .update(signingInput)
      .digest('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
    expect(parts[2]).toBe(expectedSig)
  })

  it('rejects empty credentials', () => {
    expect(() => signKlingJwt('', 'sk')).toThrow(/Access Key/)
    expect(() => signKlingJwt('ak', '')).toThrow(/Secret Key/)
  })
})
