import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelProviderInstance } from '../src/shared/modelProvider'
import { createEmptyModalityMap } from '../src/shared/modelProvider'

const getMock = vi.fn()
const postMock = vi.fn()
const requestMock = vi.fn()
const createdConfigs: Array<{ headers?: Record<string, string>; baseURL?: string }> = []

vi.mock('axios', () => ({
  default: {
    create: (config: { headers?: Record<string, string>; baseURL?: string }) => {
      createdConfigs.push(config)
      return { get: getMock, post: postMock }
    },
    // 工厂体会在模块导入时求值：这里用闭包延迟到调用时再取 mock，避免 TDZ
    request: (...args: unknown[]) => requestMock(...args),
    isAxiosError: (err: unknown) =>
      Boolean(err && typeof err === 'object' && (err as { isAxiosError?: boolean }).isAxiosError)
  }
}))

import {
  trimMediaFileName,
  uploadWorldlabsMediaAsset
} from '../src/main/services/modelProviders/worldlabs/mediaAssets'

function provider(overrides?: Partial<ModelProviderInstance>): ModelProviderInstance {
  return {
    id: 'wl-1',
    providerKind: 'worldlabs',
    label: 'World Labs',
    apiKey: 'wlk-test',
    baseUrl: 'https://api.worldlabs.ai',
    enabled: true,
    modalities: createEmptyModalityMap(),
    ...overrides
  }
}

describe('uploadWorldlabsMediaAsset', () => {
  beforeEach(() => {
    getMock.mockReset()
    postMock.mockReset()
    requestMock.mockReset()
    createdConfigs.length = 0
  })

  it('prepares the upload then PUTs the bytes to the signed URL', async () => {
    postMock.mockResolvedValueOnce({
      data: {
        media_asset: { media_asset_id: 'ma-1' },
        upload_info: {
          upload_url: 'https://storage.example.com/signed',
          upload_method: 'PUT',
          required_headers: { 'x-goog-meta': 'v1' }
        }
      }
    })
    requestMock.mockResolvedValueOnce({ status: 200 })

    const asset = await uploadWorldlabsMediaAsset({
      provider: provider(),
      bytes: Buffer.from('image-bytes'),
      kind: 'image',
      fileName: 'landscape.jpg',
      extension: 'jpg',
      contentType: 'image/jpeg'
    })

    expect(postMock).toHaveBeenCalledWith('/marble/v1/media-assets:prepare_upload', {
      file_name: 'landscape.jpg',
      kind: 'image',
      extension: 'jpg'
    })
    expect(asset).toMatchObject({ kind: 'image', id: 'ma-1', sourceLabel: 'landscape.jpg' })

    const putConfig = requestMock.mock.calls[0]?.[0] as {
      url: string
      method: string
      headers: Record<string, string>
      data: Buffer
    }
    expect(putConfig.url).toBe('https://storage.example.com/signed')
    expect(putConfig.method).toBe('put')
    expect(putConfig.headers).toMatchObject({
      'x-goog-meta': 'v1',
      'Content-Type': 'image/jpeg'
    })
    // 签名地址自带鉴权：不能把 WLT-Api-Key 带到存储侧
    expect(putConfig.headers).not.toHaveProperty('WLT-Api-Key')
    expect(putConfig.data.toString()).toBe('image-bytes')
  })

  it('keeps the prepare call on the provider client (WLT-Api-Key + baseURL)', async () => {
    postMock.mockResolvedValueOnce({
      data: { media_asset: { media_asset_id: 'ma-2' }, upload_info: { upload_url: 'https://s/x' } }
    })
    requestMock.mockResolvedValueOnce({ status: 200 })
    await uploadWorldlabsMediaAsset({
      provider: provider(),
      bytes: Buffer.from('v'),
      kind: 'video',
      fileName: 'clip.mp4'
    })
    expect(createdConfigs[0]?.headers?.['WLT-Api-Key']).toBe('wlk-test')
    expect(createdConfigs[0]?.baseURL).toBe('https://api.worldlabs.ai')
  })

  it('reports a missing upload url instead of silently continuing', async () => {
    postMock.mockResolvedValueOnce({ data: { media_asset: { media_asset_id: 'ma-3' } } })
    await expect(
      uploadWorldlabsMediaAsset({
        provider: provider(),
        bytes: Buffer.from('v'),
        kind: 'image',
        fileName: 'a.png'
      })
    ).rejects.toThrow(/未返回媒体上传地址/)
    expect(requestMock).not.toHaveBeenCalled()
  })

  it('wraps prepare and upload failures with upstream detail', async () => {
    postMock.mockRejectedValueOnce(
      Object.assign(new Error('Request failed with status code 422'), {
        isAxiosError: true,
        response: { status: 422, data: { detail: [{ loc: ['body', 'kind'], msg: 'bad kind' }] } }
      })
    )
    await expect(
      uploadWorldlabsMediaAsset({
        provider: provider(),
        bytes: Buffer.from('v'),
        kind: 'image',
        fileName: 'a.png'
      })
    ).rejects.toThrow(/kind: bad kind/)

    postMock.mockResolvedValueOnce({
      data: { media_asset: { media_asset_id: 'ma-4' }, upload_info: { upload_url: 'https://s/y' } }
    })
    requestMock.mockRejectedValueOnce(
      Object.assign(new Error('Request failed with status code 403'), {
        isAxiosError: true,
        response: { status: 403, data: { detail: 'signature expired' } }
      })
    )
    await expect(
      uploadWorldlabsMediaAsset({
        provider: provider(),
        bytes: Buffer.from('v'),
        kind: 'image',
        fileName: 'a.png'
      })
    ).rejects.toThrow(/signature expired/)
  })

  it('trims the file name to the official 64-character limit', () => {
    expect(trimMediaFileName('short.png')).toBe('short.png')
    const long = `${'a'.repeat(80)}.png`
    const trimmed = trimMediaFileName(long)
    expect(trimmed.length).toBe(64)
    expect(trimmed.endsWith('.png')).toBe(true)
    expect(trimMediaFileName('')).toBe('reference')
  })
})
