import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { startMainRuntime, stopMainRuntime } from '../src/main/runtime'
import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  createEmptyAliyunOssParams,
  createEmptyTencentCosParams,
  createObjectStorageProvider
} from '../src/shared/objectStorage'

const ossMocks = vi.hoisted(() => ({
  put: vi.fn().mockResolvedValue({}),
  delete: vi.fn().mockResolvedValue({}),
  signatureUrl: vi.fn().mockReturnValue('https://oss-signed.example/obj.mp4')
}))

const cosMocks = vi.hoisted(() => ({
  putObject: vi.fn((_p: unknown, cb: (err: Error | null, data?: unknown) => void) =>
    cb(null, {})
  ),
  deleteObject: vi.fn((_p: unknown, cb: (err: Error | null, data?: unknown) => void) =>
    cb(null, {})
  ),
  getObjectUrl: vi.fn().mockReturnValue('https://cos-signed.example/obj.mp4')
}))

vi.mock('ali-oss', () => ({
  default: class {
    put = ossMocks.put
    delete = ossMocks.delete
    signatureUrl = ossMocks.signatureUrl
  }
}))

vi.mock('cos-nodejs-sdk-v5', () => ({
  default: class {
    putObject = cosMocks.putObject
    deleteObject = cosMocks.deleteObject
    getObjectUrl = cosMocks.getObjectUrl
  }
}))

vi.mock('@volcengine/tos-sdk', () => ({
  TosClient: class {}
}))

const serviceMocks = vi.hoisted(() => ({
  getSettings: vi.fn()
}))

vi.mock('../src/main/services/settingsService', () => ({
  settingsService: {
    get: (...args: unknown[]) => serviceMocks.getSettings(...args)
  }
}))

vi.mock('../src/main/services/projectService', () => ({
  projectService: {
    isOpen: () => false,
    getRoot: () => ''
  }
}))

import { deleteUploads, uploadLocalFile } from '../src/main/services/objectStorageUploadService'

describe('object storage multi-cloud upload', () => {
  let tmpDir = ''
  let sampleFile = ''

  beforeEach(async () => {
    vi.clearAllMocks()
    ossMocks.put.mockResolvedValue({})
    ossMocks.delete.mockResolvedValue({})
    ossMocks.signatureUrl.mockReturnValue('https://oss-signed.example/obj.mp4')
    tmpDir = mkdtempSync(join(tmpdir(), 'oss-multi-'))
    sampleFile = join(tmpDir, 'clip.mp4')
    writeFileSync(sampleFile, Buffer.from('fake-video'))
    await startMainRuntime()
  })

  afterEach(async () => {
    await stopMainRuntime()
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
  })

  it('uploads via aliyun-oss', async () => {
    const provider = createObjectStorageProvider('aliyun-oss', {
      id: 'oss-1',
      oss: {
        ...createEmptyAliyunOssParams(),
        accessKeyId: 'ak',
        accessKeySecret: 'sk',
        bucket: 'demo'
      }
    })
    serviceMocks.getSettings.mockReturnValue({ objectStorage: { providers: [provider] } })

    const result = await uploadLocalFile(sampleFile, { sourceLabel: 'clip.mp4' })
    expect(ossMocks.put).toHaveBeenCalled()
    expect(result.url).toContain('oss-signed.example')
    expect(result.bucket).toBe('demo')
  })

  it('uploads via tencent-cos', async () => {
    const provider = createObjectStorageProvider('tencent-cos', {
      id: 'cos-1',
      cos: {
        ...createEmptyTencentCosParams(),
        secretId: 'id',
        secretKey: 'key',
        bucket: 'demo-1250000000'
      }
    })
    serviceMocks.getSettings.mockReturnValue({ objectStorage: { providers: [provider] } })

    const result = await uploadLocalFile(sampleFile)
    expect(cosMocks.putObject).toHaveBeenCalled()
    expect(result.url).toContain('cos-signed.example')
  })

  it('deletes via aliyun-oss', async () => {
    const provider = createObjectStorageProvider('aliyun-oss', {
      oss: {
        ...createEmptyAliyunOssParams(),
        accessKeyId: 'ak',
        accessKeySecret: 'sk',
        bucket: 'demo'
      }
    })
    serviceMocks.getSettings.mockReturnValue({ objectStorage: { providers: [provider] } })
    await deleteUploads([{ bucket: 'demo', objectKey: 'k.mp4', sourceLabel: 'k' }])
    expect(ossMocks.delete).toHaveBeenCalledWith('k.mp4')
  })
})
