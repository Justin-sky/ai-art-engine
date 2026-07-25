import { describe, expect, it } from 'vitest'
import {
  createEmptyAliyunOssParams,
  createEmptyTencentCosParams,
  createEmptyVolcengineTosParams,
  createObjectStorageProvider,
  pickActiveObjectStorage
} from '../src/shared/objectStorage'

describe('pickActiveObjectStorage', () => {
  it('returns null when incomplete', () => {
    const provider = createObjectStorageProvider('volcengine-tos', {
      id: '1',
      tos: {
        ...createEmptyVolcengineTosParams(),
        accessKeyId: 'ak',
        accessKeySecret: '',
        bucket: 'demo'
      }
    })
    expect(pickActiveObjectStorage({ providers: [provider] })).toBeNull()
  })

  it('picks first enabled complete TOS provider', () => {
    const off = createObjectStorageProvider('volcengine-tos', {
      id: 'skip',
      enabled: false,
      tos: {
        ...createEmptyVolcengineTosParams(),
        accessKeyId: 'ak',
        accessKeySecret: 'sk',
        bucket: 'demo'
      }
    })
    const ok = createObjectStorageProvider('volcengine-tos', {
      id: 'ok',
      tos: {
        ...createEmptyVolcengineTosParams(),
        accessKeyId: 'ak',
        accessKeySecret: 'sk',
        bucket: 'demo'
      }
    })
    expect(pickActiveObjectStorage({ providers: [off, ok] })?.id).toBe('ok')
  })

  it('picks aliyun-oss when ready', () => {
    const provider = createObjectStorageProvider('aliyun-oss', {
      id: 'oss1',
      oss: {
        ...createEmptyAliyunOssParams(),
        accessKeyId: 'ak',
        accessKeySecret: 'sk',
        bucket: 'demo'
      }
    })
    expect(pickActiveObjectStorage({ providers: [provider] })?.providerKind).toBe('aliyun-oss')
  })

  it('picks tencent-cos when ready', () => {
    const provider = createObjectStorageProvider('tencent-cos', {
      id: 'cos1',
      cos: {
        ...createEmptyTencentCosParams(),
        secretId: 'id',
        secretKey: 'key',
        bucket: 'demo-1250000000'
      }
    })
    expect(pickActiveObjectStorage({ providers: [provider] })?.providerKind).toBe('tencent-cos')
  })
})
