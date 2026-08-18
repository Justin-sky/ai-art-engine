import { afterEach, describe, expect, it } from 'vitest'
import { OBJECT_STORAGE_PROVIDER_KINDS } from '../src/shared/objectStorage'
import { createStoragePlugin } from '../src/main/plugins/objectStorage'
import type { ObjectStorageAdapter } from '../src/main/services/objectStorage/types'
import {
  getObjectStorageAdapter,
  listRegisteredObjectStorageKinds,
  startMainRuntime,
  stopMainRuntime
} from '../src/main/runtime'

describe('main Cordis object storage plugins', () => {
  afterEach(async () => {
    await stopMainRuntime()
  })

  it('registers every builtin adapter through ctx.plugin', async () => {
    await startMainRuntime()
    expect(listRegisteredObjectStorageKinds()).toEqual([...OBJECT_STORAGE_PROVIDER_KINDS])
    expect(getObjectStorageAdapter('volcengine-tos').kind).toBe('volcengine-tos')
    expect(getObjectStorageAdapter('aliyun-oss').kind).toBe('aliyun-oss')
    expect(getObjectStorageAdapter('tencent-cos').kind).toBe('tencent-cos')
  })

  it('rejects adapter lookup after the runtime stops', async () => {
    await startMainRuntime()
    await stopMainRuntime()
    expect(() => getObjectStorageAdapter('aliyun-oss')).toThrow(/has not started/)
  })

  it('requires catalog meta when creating a storage plugin', () => {
    expect(() =>
      createStoragePlugin({ kind: 'not-a-kind' } as unknown as ObjectStorageAdapter)
    ).toThrow(/Unknown object storage kind/)
  })
})
