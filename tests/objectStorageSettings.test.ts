import { describe, expect, it } from 'vitest'
import {
  applyAliyunOssRegionPreset,
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
    expect(next.providers[0].oss).toBeTruthy()
    expect(next.providers[0].cos).toBeTruthy()
  })

  it('keeps aliyun-oss and tencent-cos kinds', () => {
    const next = normalizeObjectStorageSettings({
      providers: [
        {
          id: 'a1',
          providerKind: 'aliyun-oss',
          oss: {
            accessKeyId: 'ak',
            accessKeySecret: 'sk',
            region: 'oss-cn-hangzhou',
            endpoint: '',
            bucket: 'b1',
            publicBaseUrl: ''
          }
        },
        {
          id: 'c1',
          providerKind: 'tencent-cos',
          cos: {
            secretId: 'id',
            secretKey: 'key',
            region: 'ap-guangzhou',
            bucket: 'demo-1250000000',
            publicBaseUrl: ''
          }
        }
      ]
    })
    expect(next.providers[0].providerKind).toBe('aliyun-oss')
    expect(next.providers[0].label).toBe('阿里云 OSS')
    expect(next.providers[0].oss.endpoint).toContain('oss-cn-hangzhou')
    expect(next.providers[1].providerKind).toBe('tencent-cos')
    expect(next.providers[1].label).toBe('腾讯云 COS')
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

  it('applies aliyun oss region preset', () => {
    const provider = createObjectStorageProvider('aliyun-oss')
    const next = applyAliyunOssRegionPreset(provider.oss, 'oss-cn-beijing')
    expect(next.region).toBe('oss-cn-beijing')
    expect(next.endpoint).toBe('https://oss-cn-beijing.aliyuncs.com')
  })
})

describe('single enabled object storage', () => {
  it('keeps only the first enabled provider when normalizing', () => {
    const next = normalizeObjectStorageSettings({
      providers: [
        {
          id: 'a',
          providerKind: 'aliyun-oss',
          enabled: true,
          oss: {
            accessKeyId: 'ak',
            accessKeySecret: 'sk',
            region: 'oss-cn-hangzhou',
            endpoint: '',
            bucket: 'b1',
            publicBaseUrl: ''
          }
        },
        {
          id: 'b',
          providerKind: 'tencent-cos',
          enabled: true,
          cos: {
            secretId: 'id',
            secretKey: 'key',
            region: 'ap-guangzhou',
            bucket: 'demo-1250000000',
            publicBaseUrl: ''
          }
        }
      ]
    })
    expect(next.providers.filter((p) => p.enabled)).toHaveLength(1)
    expect(next.providers[0].enabled).toBe(true)
    expect(next.providers[1].enabled).toBe(false)
  })
})
