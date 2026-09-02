import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { ObjectStorageProviderInstance } from '../src/shared/objectStorage'
import { startMainRuntime, stopMainRuntime } from '../src/main/runtime'

const tosMocks = vi.hoisted(() => ({
  putObjectFromFile: vi.fn().mockResolvedValue(undefined),
  putObject: vi.fn().mockResolvedValue(undefined),
  deleteObject: vi.fn().mockResolvedValue(undefined),
  getPreSignedUrl: vi
    .fn()
    .mockReturnValue('https://signed.example/aiartengine/media-refs/obj.mp4'),
  ctorArgs: [] as Array<Record<string, unknown>>
}))

vi.mock('@volcengine/tos-sdk', () => ({
  TosClient: class {
    constructor(opts: Record<string, unknown>) {
      tosMocks.ctorArgs.push(opts)
    }
    putObjectFromFile = tosMocks.putObjectFromFile
    putObject = tosMocks.putObject
    deleteObject = tosMocks.deleteObject
    getPreSignedUrl = tosMocks.getPreSignedUrl
  }
}))

const serviceMocks = vi.hoisted(() => ({
  getSettings: vi.fn(),
  isOpen: vi.fn(),
  getRoot: vi.fn()
}))

vi.mock('../src/main/services/settingsService', () => ({
  settingsService: {
    get: (...args: unknown[]) => serviceMocks.getSettings(...args)
  }
}))

vi.mock('../src/main/services/projectService', () => ({
  projectService: {
    isOpen: (...args: unknown[]) => serviceMocks.isOpen(...args),
    getRoot: (...args: unknown[]) => serviceMocks.getRoot(...args)
  }
}))

import {
  deleteUploads,
  ensureRemoteMediaUrl,
  uploadLocalFile,
  uploadProjectMedia
} from '../src/main/services/objectStorageUploadService'

function makeProvider(
  tosOverrides?: Partial<ObjectStorageProviderInstance['tos']>
): ObjectStorageProviderInstance {
  return {
    id: 'tos-1',
    providerKind: 'volcengine-tos',
    label: 'Demo TOS',
    enabled: true,
    tos: {
      accessKeyId: 'AK',
      accessKeySecret: 'SK',
      region: 'cn-beijing',
      endpoint: 'https://tos-cn-beijing.volces.com',
      bucket: 'demo-bucket',
      publicBaseUrl: '',
      ...tosOverrides
    },
    oss: {
      accessKeyId: '',
      accessKeySecret: '',
      region: 'oss-cn-hangzhou',
      endpoint: 'https://oss-cn-hangzhou.aliyuncs.com',
      bucket: '',
      publicBaseUrl: ''
    },
    cos: {
      secretId: '',
      secretKey: '',
      region: 'ap-guangzhou',
      bucket: '',
      publicBaseUrl: ''
    }
  }
}

describe('objectStorageUploadService', () => {
  let tmpDir = ''
  let sampleFile = ''

  beforeEach(async () => {
    vi.clearAllMocks()
    tosMocks.ctorArgs.length = 0
    tosMocks.putObjectFromFile.mockResolvedValue(undefined)
    tosMocks.putObject.mockResolvedValue(undefined)
    tosMocks.deleteObject.mockResolvedValue(undefined)
    tosMocks.getPreSignedUrl.mockReturnValue(
      'https://signed.example/aiartengine/media-refs/obj.mp4'
    )
    serviceMocks.getSettings.mockReturnValue({
      objectStorage: { providers: [makeProvider()] }
    })
    serviceMocks.isOpen.mockReturnValue(false)
    serviceMocks.getRoot.mockReturnValue('')

    tmpDir = mkdtempSync(join(tmpdir(), 'tos-upload-test-'))
    sampleFile = join(tmpDir, 'clip.mp4')
    writeFileSync(sampleFile, Buffer.from('fake-mp4-bytes'))
    await startMainRuntime()
  })

  afterEach(async () => {
    await stopMainRuntime()
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true })
  })

  describe('uploadLocalFile', () => {
    it('throws when file is missing', async () => {
      await expect(uploadLocalFile(join(tmpDir, 'missing.mp4'))).rejects.toThrow(
        /待上传文件不存在/
      )
      expect(tosMocks.putObjectFromFile).not.toHaveBeenCalled()
    })

    it('throws when object storage is not configured', async () => {
      serviceMocks.getSettings.mockReturnValue({ objectStorage: { providers: [] } })
      await expect(uploadLocalFile(sampleFile)).rejects.toThrow(/未配置可用的对象存储/)
      expect(tosMocks.putObjectFromFile).not.toHaveBeenCalled()
    })

    it('uploads local file and returns signed url when publicBaseUrl is empty', async () => {
      const result = await uploadLocalFile(sampleFile, { sourceLabel: 'ref.mp4' })

      expect(tosMocks.ctorArgs[0]?.endpoint).toBe('tos-cn-beijing.volces.com')
      expect(tosMocks.putObjectFromFile).toHaveBeenCalledTimes(1)
      const arg = tosMocks.putObjectFromFile.mock.calls[0][0]
      expect(arg.bucket).toBe('demo-bucket')
      expect(arg.filePath).toBe(sampleFile)
      expect(arg.key).toMatch(/^aiartengine\/media-refs\/\d{4}-\d{2}-\d{2}\/[a-f0-9]{12}\.mp4$/)

      expect(tosMocks.getPreSignedUrl).toHaveBeenCalledWith(
        expect.objectContaining({
          bucket: 'demo-bucket',
          key: result.objectKey,
          method: 'GET'
        })
      )
      expect(result.url).toBe('https://signed.example/aiartengine/media-refs/obj.mp4')
      expect(result.bytes).toBe(Buffer.byteLength('fake-mp4-bytes'))
      expect(result.bucket).toBe('demo-bucket')
      expect(result.providerId).toBe('tos-1')
      expect(result.sourceLabel).toBe('ref.mp4')
      expect(result.logs.some((l) => l.level === 'info' && /开始上传/.test(l.message))).toBe(true)
      expect(result.logs.some((l) => l.level === 'info' && /上传完成/.test(l.message))).toBe(true)
    })

    it('rejects malformed signed urls from endpoint-with-scheme and falls back', async () => {
      tosMocks.getPreSignedUrl.mockReturnValue(
        'https://aae-test.https://tos-cn-beijing.volces.com/k.mp4?sig=1'
      )
      serviceMocks.getSettings.mockReturnValue({
        objectStorage: {
          providers: [makeProvider({ bucket: 'aae-test' })]
        }
      })

      const result = await uploadLocalFile(sampleFile)

      expect(tosMocks.ctorArgs[0]?.endpoint).toBe('tos-cn-beijing.volces.com')
      expect(result.url).toBe(`https://aae-test.tos-cn-beijing.volces.com/${result.objectKey}`)
    })

    it('uses publicBaseUrl when configured', async () => {
      serviceMocks.getSettings.mockReturnValue({
        objectStorage: {
          providers: [makeProvider({ publicBaseUrl: 'https://cdn.example.com/media/' })]
        }
      })

      const result = await uploadLocalFile(sampleFile)

      expect(tosMocks.getPreSignedUrl).not.toHaveBeenCalled()
      expect(result.url).toBe(`https://cdn.example.com/media/${result.objectKey}`)
    })
  })

  describe('ensureRemoteMediaUrl', () => {
    it('skips upload for existing http(s) url', async () => {
      const remote = 'https://cdn.example.com/a.mp4'
      const result = await ensureRemoteMediaUrl(remote)
      expect(result).toEqual({ url: remote })
      expect(tosMocks.putObjectFromFile).not.toHaveBeenCalled()
      expect(tosMocks.putObject).not.toHaveBeenCalled()
    })

    it('uploads data url via putObject', async () => {
      const dataUrl = `data:video/mp4;base64,${Buffer.from('abc').toString('base64')}`
      const result = await ensureRemoteMediaUrl(dataUrl, { sourceLabel: 'inline' })

      expect(tosMocks.putObject).toHaveBeenCalledTimes(1)
      const arg = tosMocks.putObject.mock.calls[0][0]
      expect(arg.bucket).toBe('demo-bucket')
      expect(arg.key).toMatch(/\.mp4$/)
      expect(Buffer.isBuffer(arg.body)).toBe(true)
      expect(arg.body.toString()).toBe('abc')

      expect(result.uploaded?.bytes).toBe(3)
      expect(result.uploaded?.sourceLabel).toBe('inline')
      expect(result.url).toBe(result.uploaded?.url)
    })

    it('throws on invalid data url', async () => {
      await expect(ensureRemoteMediaUrl('data:not-valid')).rejects.toThrow(/无效的 data URL/)
    })

    it('uploads file under projectRoot', async () => {
      const relDir = join(tmpDir, 'assets')
      mkdirSync(relDir, { recursive: true })
      const relFile = join(relDir, 'shot.mp4')
      writeFileSync(relFile, Buffer.from('rel'))

      const result = await ensureRemoteMediaUrl('assets/shot.mp4', {
        projectRoot: tmpDir,
        sourceLabel: 'assets/shot.mp4'
      })

      expect(tosMocks.putObjectFromFile).toHaveBeenCalledWith(
        expect.objectContaining({
          filePath: relFile,
          bucket: 'demo-bucket'
        })
      )
      expect(result.uploaded?.sourceLabel).toBe('assets/shot.mp4')
      expect(result.url).toBeTruthy()
    })
  })

  describe('uploadProjectMedia', () => {
    it('throws when project is not open', async () => {
      serviceMocks.isOpen.mockReturnValue(false)
      await expect(uploadProjectMedia('a.mp4')).rejects.toThrow(/未打开工程/)
    })

    it('uploads from project root when open', async () => {
      serviceMocks.isOpen.mockReturnValue(true)
      serviceMocks.getRoot.mockReturnValue(tmpDir)
      const result = await uploadProjectMedia('clip.mp4')
      expect(tosMocks.putObjectFromFile).toHaveBeenCalledWith(
        expect.objectContaining({ filePath: sampleFile })
      )
      expect(result.sourceLabel).toBe('clip.mp4')
    })
  })

  describe('deleteUploads', () => {
    it('returns empty logs and skips SDK for empty list', async () => {
      const logs = await deleteUploads([])
      expect(logs).toEqual([])
      expect(tosMocks.deleteObject).not.toHaveBeenCalled()
    })

    it('warns and skips when object storage is unavailable', async () => {
      serviceMocks.getSettings.mockReturnValue({ objectStorage: { providers: [] } })
      const logs = await deleteUploads([
        { bucket: 'demo-bucket', objectKey: 'aiartengine/a.mp4', sourceLabel: 'a.mp4' }
      ])
      expect(tosMocks.deleteObject).not.toHaveBeenCalled()
      expect(logs.some((l) => l.level === 'warn' && /跳过删除/.test(l.message))).toBe(true)
    })

    it('deletes each object and records info logs', async () => {
      const logs = await deleteUploads([
        { bucket: 'demo-bucket', objectKey: 'k1.mp4', sourceLabel: 'one' },
        { bucket: 'demo-bucket', objectKey: 'k2.mp4', sourceLabel: 'two' }
      ])

      expect(tosMocks.deleteObject).toHaveBeenCalledTimes(2)
      expect(tosMocks.deleteObject).toHaveBeenNthCalledWith(1, {
        bucket: 'demo-bucket',
        key: 'k1.mp4'
      })
      expect(tosMocks.deleteObject).toHaveBeenNthCalledWith(2, {
        bucket: 'demo-bucket',
        key: 'k2.mp4'
      })
      expect(logs.filter((l) => l.level === 'info' && /已删除/.test(l.message))).toHaveLength(2)
    })

    it('continues when one delete fails', async () => {
      tosMocks.deleteObject
        .mockRejectedValueOnce(new Error('not found'))
        .mockResolvedValueOnce(undefined)

      const logs = await deleteUploads([
        { bucket: 'demo-bucket', objectKey: 'bad.mp4', sourceLabel: 'bad' },
        { bucket: 'demo-bucket', objectKey: 'ok.mp4', sourceLabel: 'ok' }
      ])

      expect(tosMocks.deleteObject).toHaveBeenCalledTimes(2)
      expect(logs.some((l) => l.level === 'warn' && /删除临时参考媒体失败/.test(l.message))).toBe(
        true
      )
      expect(logs.some((l) => l.level === 'info' && /已删除临时参考媒体：ok/.test(l.message))).toBe(
        true
      )
    })

    it('skips entries with empty objectKey', async () => {
      const logs = await deleteUploads([
        { bucket: 'demo-bucket', objectKey: '  ', sourceLabel: 'blank' },
        { bucket: 'demo-bucket', objectKey: 'keep.mp4', sourceLabel: 'keep' }
      ])
      expect(tosMocks.deleteObject).toHaveBeenCalledTimes(1)
      expect(tosMocks.deleteObject).toHaveBeenCalledWith({
        bucket: 'demo-bucket',
        key: 'keep.mp4'
      })
      expect(logs.some((l) => /keep/.test(l.message))).toBe(true)
    })
  })
})
