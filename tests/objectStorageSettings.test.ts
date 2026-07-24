import { describe, expect, it } from 'vitest'
import {
  applyVolcengineTosRegionPreset,
  createEmptyObjectStorageSettings,
  createObjectStorageProvider,
  normalizeObjectStorageSettings
} from '../src/shared/objectStorage'

describe('normalizeObjectStorageSettings', () => {
  it('keeps providers list', () => {
    const next = normalizeObjectStorageSettings({
      providers: [
        {
          id: 'oss1',
          providerKind: 'volcengine-tos',
          label: 'TOS',
          enabled: true,
          tos: {
            accessKeyId: 'AK',
            accessKeySecret: 'SK',
            region: 'cn-beijing',
            endpoint: 'https://tos-cn-beijing.volces.com',
            bucket: 'demo',
            publicBaseUrl: ''
          }
        }
      ]
    })
    expect(next.providers).toHaveLength(1)
    expect(next.providers[0].tos.bucket).toBe('demo')
  })

  it('returns empty for unknown shapes', () => {
    expect(normalizeObjectStorageSettings({ foo: 1 })).toEqual(createEmptyObjectStorageSettings())
  })
})

describe('volcengine tos helpers', () => {
  it('applies region preset endpoint', () => {
    const provider = createObjectStorageProvider()
    const next = applyVolcengineTosRegionPreset(provider.tos, 'cn-shanghai')
    expect(next.region).toBe('cn-shanghai')
    expect(next.endpoint).toBe('https://tos-cn-shanghai.volces.com')
  })

  it('normalizes endpoint without scheme', () => {
    const next = normalizeObjectStorageSettings({
      providers: [
        {
          providerKind: 'volcengine-tos',
          tos: {
            region: 'cn-beijing',
            endpoint: 'tos-cn-beijing.volces.com',
            accessKeyId: '',
            accessKeySecret: '',
            bucket: '',
            publicBaseUrl: ''
          }
        }
      ]
    })
    expect(next.providers[0].tos.endpoint).toBe('https://tos-cn-beijing.volces.com')
  })
})
