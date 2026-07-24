import { describe, expect, it } from 'vitest'
import { pickActiveObjectStorage } from '../src/shared/objectStorage'

describe('pickActiveObjectStorage', () => {
  it('returns null when incomplete', () => {
    expect(
      pickActiveObjectStorage({
        providers: [
          {
            id: '1',
            providerKind: 'volcengine-tos',
            label: 'TOS',
            enabled: true,
            tos: {
              accessKeyId: 'ak',
              accessKeySecret: '',
              region: 'cn-beijing',
              endpoint: 'https://tos-cn-beijing.volces.com',
              bucket: 'demo',
              publicBaseUrl: ''
            }
          }
        ]
      })
    ).toBeNull()
  })

  it('picks first enabled complete provider', () => {
    const picked = pickActiveObjectStorage({
      providers: [
        {
          id: 'skip',
          providerKind: 'volcengine-tos',
          label: 'off',
          enabled: false,
          tos: {
            accessKeyId: 'ak',
            accessKeySecret: 'sk',
            region: 'cn-beijing',
            endpoint: 'https://tos-cn-beijing.volces.com',
            bucket: 'demo',
            publicBaseUrl: ''
          }
        },
        {
          id: 'ok',
          providerKind: 'volcengine-tos',
          label: 'TOS',
          enabled: true,
          tos: {
            accessKeyId: 'ak',
            accessKeySecret: 'sk',
            region: 'cn-beijing',
            endpoint: 'https://tos-cn-beijing.volces.com',
            bucket: 'demo',
            publicBaseUrl: ''
          }
        }
      ]
    })
    expect(picked?.id).toBe('ok')
  })
})
