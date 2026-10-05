import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelProviderInstance } from '../src/shared/modelProvider'
import { createEmptyModalityMap } from '../src/shared/modelProvider'

const getMock = vi.fn()
const postMock = vi.fn()
const createdConfigs: Array<{ headers?: Record<string, string>; baseURL?: string }> = []

vi.mock('axios', () => ({
  default: {
    create: (config: { headers?: Record<string, string>; baseURL?: string }) => {
      createdConfigs.push(config)
      return { get: getMock, post: postMock }
    },
    isAxiosError: (err: unknown) =>
      Boolean(err && typeof err === 'object' && (err as { isAxiosError?: boolean }).isAxiosError)
  }
}))

import { worldlabsAdapter } from '../src/main/services/modelProviders/worldlabs/adapter'

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

describe('worldlabsAdapter', () => {
  beforeEach(() => {
    getMock.mockReset()
    postMock.mockReset()
    createdConfigs.length = 0
  })

  it('assertAuth hits the credits endpoint with the WLT-Api-Key header', async () => {
    getMock.mockResolvedValueOnce({ data: { remaining_credits: 42 } })
    await worldlabsAdapter.assertAuth(provider())
    expect(getMock).toHaveBeenCalledWith('/marble/v1/credits', expect.objectContaining({}))
    expect(createdConfigs[0]?.headers?.['WLT-Api-Key']).toBe('wlk-test')
    expect(createdConfigs[0]?.headers).not.toHaveProperty('Authorization')
  })

  it('assertAuth surfaces upstream failures', async () => {
    getMock.mockRejectedValueOnce(
      Object.assign(new Error('Request failed with status code 401'), {
        isAxiosError: true,
        response: { data: { detail: 'Invalid API key' } }
      })
    )
    await expect(worldlabsAdapter.assertAuth(provider())).rejects.toThrow(/Invalid API key/)
  })

  it('returns marble catalogs for world modality only', async () => {
    const models = await worldlabsAdapter.fetchCatalog(provider(), 'spatialWorld')
    expect(models.map((m) => m.id)).toEqual([
      'marble-1.1',
      'marble-1.1-plus',
      'marble-1.0',
      'marble-1.0-draft'
    ])
    expect(models.every((m) => m.modality === 'spatialWorld')).toBe(true)
    expect(await worldlabsAdapter.fetchCatalog(provider(), 'model3d')).toEqual([])
    expect(await worldlabsAdapter.fetchCatalog(provider(), 'text')).toEqual([])
  })

  it('keeps the previous-generation model ids instead of coercing them to 1.1', async () => {
    postMock.mockResolvedValueOnce({ data: { operation_id: 'op-legacy' } })
    const job = await worldlabsAdapter.submitSpatialWorld?.(provider(), 'marble-1.0', {
      prompt: 'x'
    })
    expect(job?.model).toBe('marble-1.0')
    expect(postMock.mock.calls[0]?.[1]).toMatchObject({ model: 'marble-1.0' })
  })

  it('rejects text/image/speech/model3d modalities', async () => {
    await expect(worldlabsAdapter.generateText(provider(), 'm', { prompt: 'hi' })).rejects.toThrow(
      /不支持文本/
    )
    await expect(worldlabsAdapter.generateImage(provider(), 'm', { prompt: 'hi' })).rejects.toThrow(
      /不支持图片/
    )
    await expect(worldlabsAdapter.generateSpeech(provider(), 'm', { input: 'hi' })).rejects.toThrow(
      /不支持语音合成/
    )
    await expect(
      worldlabsAdapter.submitModel3d(provider(), 'm', { prompt: 'a chair' })
    ).rejects.toThrow(/空间世界提供商/)
  })

  it('submits text-to-world with a text world_prompt', async () => {
    postMock.mockResolvedValueOnce({ data: { operation_id: 'op-123' } })
    const job = await worldlabsAdapter.submitSpatialWorld?.(provider(), 'marble-1.1', {
      prompt: 'mystical forest'
    })
    expect(job).toMatchObject({ jobId: 'op-123', pollingUrl: 'op-123', model: 'marble-1.1' })
    expect(postMock).toHaveBeenCalledWith(
      '/marble/v1/worlds:generate',
      expect.objectContaining({
        model: 'marble-1.1',
        world_prompt: { type: 'text', text_prompt: 'mystical forest' }
      })
    )
  })

  it('submits image-to-world with a uri image_prompt and optional text', async () => {
    postMock.mockResolvedValueOnce({ data: { operation_id: 'op-1' } })
    await worldlabsAdapter.submitSpatialWorld?.(provider(), 'marble-1.1-plus', {
      prompt: 'a cozy cabin',
      inputReferences: [{ kind: 'image_url', url: 'https://cdn.example.com/a.jpg' }]
    })
    expect(postMock).toHaveBeenCalledWith(
      '/marble/v1/worlds:generate',
      expect.objectContaining({
        model: 'marble-1.1-plus',
        world_prompt: {
          type: 'image',
          image_prompt: { source: 'uri', uri: 'https://cdn.example.com/a.jpg' },
          text_prompt: 'a cozy cabin'
        }
      })
    )
  })

  it('submits multi-image world prompts capped at 4 references', async () => {
    postMock.mockResolvedValueOnce({ data: { operation_id: 'op-2' } })
    await worldlabsAdapter.submitSpatialWorld?.(provider(), 'marble-1.1', {
      prompt: '',
      inputReferences: [1, 2, 3, 4, 5].map((i) => ({
        kind: 'image_url' as const,
        url: `https://cdn.example.com/${i}.jpg`
      }))
    })
    const body = postMock.mock.calls[0]?.[1] as {
      world_prompt: { type: string; multi_image_prompt: Array<{ content: { uri: string } }> }
    }
    expect(body.world_prompt.type).toBe('multi-image')
    expect(body.world_prompt.multi_image_prompt).toHaveLength(4)
    expect(body.world_prompt.multi_image_prompt[0]?.content.uri).toBe(
      'https://cdn.example.com/1.jpg'
    )
    expect(body.world_prompt).not.toHaveProperty('text_prompt')
  })

  it('passes displayName and clamps seed into the request body', async () => {
    postMock.mockResolvedValueOnce({ data: { operation_id: 'op-3' } })
    await worldlabsAdapter.submitSpatialWorld?.(provider(), 'marble-1.1', {
      prompt: 'x',
      displayName: 'My World',
      seed: 99
    })
    expect(postMock.mock.calls[0]?.[1]).toMatchObject({
      display_name: 'My World',
      seed: 99
    })
  })

  it('maps panoMode onto the official is_pano flag (single-image form only)', async () => {
    const imageRef = [{ kind: 'image_url' as const, url: 'https://cdn.example.com/pano.jpg' }]
    postMock.mockResolvedValueOnce({ data: { operation_id: 'op-p1' } })
    await worldlabsAdapter.submitSpatialWorld?.(provider(), 'marble-1.1', {
      prompt: '',
      inputReferences: imageRef,
      panoMode: 'always'
    })
    expect(
      (postMock.mock.calls[0]?.[1] as { world_prompt: Record<string, unknown> }).world_prompt
    ).toMatchObject({ type: 'image', is_pano: true })

    postMock.mockResolvedValueOnce({ data: { operation_id: 'op-p2' } })
    await worldlabsAdapter.submitSpatialWorld?.(provider(), 'marble-1.1', {
      prompt: '',
      inputReferences: imageRef,
      panoMode: 'never'
    })
    expect(
      (postMock.mock.calls[1]?.[1] as { world_prompt: Record<string, unknown> }).world_prompt
    ).toMatchObject({ is_pano: false })

    // auto（默认）不下发字段，交给上游自动识别；多图形态本来就没有 is_pano
    postMock.mockResolvedValueOnce({ data: { operation_id: 'op-p3' } })
    await worldlabsAdapter.submitSpatialWorld?.(provider(), 'marble-1.1', {
      prompt: '',
      inputReferences: imageRef,
      panoMode: 'auto'
    })
    expect(
      (postMock.mock.calls[2]?.[1] as { world_prompt: Record<string, unknown> }).world_prompt
    ).not.toHaveProperty('is_pano')

    postMock.mockResolvedValueOnce({ data: { operation_id: 'op-p4' } })
    await worldlabsAdapter.submitSpatialWorld?.(provider(), 'marble-1.1', {
      prompt: '',
      inputReferences: [
        { kind: 'image_url', url: 'https://cdn.example.com/a.jpg' },
        { kind: 'image_url', url: 'https://cdn.example.com/b.jpg' }
      ],
      panoMode: 'always'
    })
    expect(
      (postMock.mock.calls[3]?.[1] as { world_prompt: Record<string, unknown> }).world_prompt
    ).not.toHaveProperty('is_pano')
  })

  it('sends disable_recaption, tags and permission.public when asked', async () => {
    postMock.mockResolvedValueOnce({ data: { operation_id: 'op-meta' } })
    await worldlabsAdapter.submitSpatialWorld?.(provider(), 'marble-1.1', {
      prompt: 'a quiet courtyard',
      disableRecaption: true,
      tags: ['  courtyard ', 'snow', ...Array.from({ length: 12 }, (_, i) => `t${i}`)],
      publicWorld: true
    })
    const body = postMock.mock.calls[0]?.[1] as {
      world_prompt: Record<string, unknown>
      tags?: string[]
      permission?: { public?: boolean }
    }
    expect(body.world_prompt.disable_recaption).toBe(true)
    expect(body.permission).toEqual({ public: true })
    // 官方 tags 上限：10 个、每个 ≤32 字符
    expect(body.tags).toHaveLength(10)
    expect(body.tags?.[0]).toBe('courtyard')
  })

  it('uses hosted media assets for image and video references', async () => {
    postMock.mockResolvedValueOnce({ data: { operation_id: 'op-ma1' } })
    await worldlabsAdapter.submitSpatialWorld?.(provider(), 'marble-1.1', {
      prompt: 'from a hosted pano',
      mediaAssets: [{ kind: 'image', id: 'ma-1' }]
    })
    expect(
      (postMock.mock.calls[0]?.[1] as { world_prompt: Record<string, unknown> }).world_prompt
    ).toMatchObject({
      type: 'image',
      image_prompt: { source: 'media_asset', media_asset_id: 'ma-1' }
    })

    postMock.mockResolvedValueOnce({ data: { operation_id: 'op-ma2' } })
    await worldlabsAdapter.submitSpatialWorld?.(provider(), 'marble-1.1', {
      prompt: '',
      mediaAssets: [
        { kind: 'image', id: 'ma-a' },
        { kind: 'image', id: 'ma-b' }
      ]
    })
    expect(
      (postMock.mock.calls[1]?.[1] as { world_prompt: Record<string, unknown> }).world_prompt
    ).toMatchObject({
      type: 'multi-image',
      multi_image_prompt: [
        { content: { source: 'media_asset', media_asset_id: 'ma-a' } },
        { content: { source: 'media_asset', media_asset_id: 'ma-b' } }
      ]
    })

    postMock.mockResolvedValueOnce({ data: { operation_id: 'op-ma3' } })
    await worldlabsAdapter.submitSpatialWorld?.(provider(), 'marble-1.1', {
      prompt: '',
      mediaAssets: [{ kind: 'video', id: 'ma-v' }]
    })
    expect(
      (postMock.mock.calls[2]?.[1] as { world_prompt: Record<string, unknown> }).world_prompt
    ).toMatchObject({
      type: 'video',
      video_prompt: { source: 'media_asset', media_asset_id: 'ma-v' }
    })
  })

  it('turns 402 into an actionable credits error and 429 into a retry hint', async () => {
    postMock.mockRejectedValueOnce(
      Object.assign(new Error('Request failed with status code 402'), {
        isAxiosError: true,
        response: { status: 402, data: { detail: 'Insufficient credits' } }
      })
    )
    await expect(
      worldlabsAdapter.submitSpatialWorld?.(provider(), 'marble-1.1', { prompt: 'x' })
    ).rejects.toThrow(/积分不足/)

    postMock.mockRejectedValueOnce(
      Object.assign(new Error('Request failed with status code 429'), {
        isAxiosError: true,
        response: { status: 429, data: { detail: 'Rate limit exceeded' } }
      })
    )
    await expect(
      worldlabsAdapter.submitSpatialWorld?.(provider(), 'marble-1.1', { prompt: 'x' })
    ).rejects.toThrow(/限流/)
  })

  it('flattens 422 validation details and appends request_id', async () => {
    postMock.mockRejectedValueOnce(
      Object.assign(new Error('Request failed with status code 422'), {
        isAxiosError: true,
        response: {
          status: 422,
          data: {
            detail: [{ loc: ['body', 'world_prompt', 'type'], msg: 'Field required' }],
            request_id: 'req-123'
          }
        }
      })
    )
    await expect(
      worldlabsAdapter.submitSpatialWorld?.(provider(), 'marble-1.1', { prompt: 'x' })
    ).rejects.toThrow(/world_prompt\.type: Field required · request_id=req-123/)
  })

  it('submits video-to-world with a uri video_prompt and optional text', async () => {
    postMock.mockResolvedValueOnce({ data: { operation_id: 'op-5' } })
    await worldlabsAdapter.submitSpatialWorld?.(provider(), 'marble-1.1', {
      prompt: 'a slow walk through a courtyard',
      inputReferences: [{ kind: 'video_url', url: 'https://cdn.example.com/clip.mp4' }]
    })
    expect(postMock).toHaveBeenCalledWith(
      '/marble/v1/worlds:generate',
      expect.objectContaining({
        world_prompt: {
          type: 'video',
          video_prompt: { source: 'uri', uri: 'https://cdn.example.com/clip.mp4' },
          text_prompt: 'a slow walk through a courtyard'
        }
      })
    )
  })

  it('prefers the video over images and ignores non-http video urls', async () => {
    postMock.mockResolvedValueOnce({ data: { operation_id: 'op-6' } })
    await worldlabsAdapter.submitSpatialWorld?.(provider(), 'marble-1.1', {
      prompt: '',
      inputReferences: [
        { kind: 'image_url', url: 'https://cdn.example.com/a.jpg' },
        { kind: 'video_url', url: 'https://cdn.example.com/clip.mp4' }
      ]
    })
    const body = postMock.mock.calls[0]?.[1] as { world_prompt: Record<string, unknown> }
    expect(body.world_prompt.type).toBe('video')
    expect(body.world_prompt).not.toHaveProperty('text_prompt')

    postMock.mockResolvedValueOnce({ data: { operation_id: 'op-7' } })
    await worldlabsAdapter.submitSpatialWorld?.(provider(), 'marble-1.1', {
      prompt: 'x',
      inputReferences: [{ kind: 'video_url', url: 'Assets/Clips/local.mp4' }]
    })
    expect(
      (postMock.mock.calls[1]?.[1] as { world_prompt: { type: string } }).world_prompt
    ).toEqual({
      type: 'text',
      text_prompt: 'x'
    })
  })

  it('rejects an empty text-only prompt before hitting the API', async () => {
    // 官方 schema：text 形态的 text_prompt 必填，空文本会被上游 400 拒绝
    await expect(
      worldlabsAdapter.submitSpatialWorld?.(provider(), 'marble-1.1', { prompt: '' })
    ).rejects.toThrow(/需要提示词/)
    expect(postMock).not.toHaveBeenCalled()
  })

  it('submits a PLY splat export and returns the download url immediately', async () => {
    postMock.mockResolvedValueOnce({
      data: {
        operation_id: 'op-ex1',
        done: true,
        response: {
          asset_type: 'splats',
          format: 'ply',
          resolution: '500k',
          url: 'https://cdn.example.com/world.ply'
        }
      }
    })
    const job = await worldlabsAdapter.submitSpatialWorldExport?.(provider(), 'w-123', {
      spatialWorldId: 'w-123',
      assetType: 'splats',
      format: 'ply',
      resolution: '500k'
    })
    expect(postMock).toHaveBeenCalledWith('/marble/v1/worlds/w-123:export', {
      asset_type: 'splats',
      format: 'ply',
      resolution: '500k'
    })
    expect(job).toMatchObject({
      jobId: 'op-ex1',
      pollingUrl: 'op-ex1',
      status: 'completed',
      downloadUrl: 'https://cdn.example.com/world.ply'
    })
  })

  it('submits an async HQ mesh export without a download url', async () => {
    postMock.mockResolvedValueOnce({ data: { operation_id: 'op-ex2', done: false } })
    const job = await worldlabsAdapter.submitSpatialWorldExport?.(provider(), 'w-123', {
      spatialWorldId: 'w-123',
      assetType: 'mesh',
      format: 'glb',
      meshVariant: 'vertex_colored'
    })
    expect(postMock).toHaveBeenCalledWith('/marble/v1/worlds/w-123:export', {
      asset_type: 'mesh',
      format: 'glb',
      mesh_variant: 'vertex_colored'
    })
    expect(job).toMatchObject({ status: 'in_progress' })
    expect(job?.downloadUrl).toBeUndefined()
  })

  it('refuses an export without a world id, and maps 402 to the credits hint', async () => {
    await expect(
      worldlabsAdapter.submitSpatialWorldExport?.(provider(), '   ', {
        spatialWorldId: '   ',
        assetType: 'mesh',
        format: 'glb'
      })
    ).rejects.toThrow(/world_id/)
    expect(postMock).not.toHaveBeenCalled()

    postMock.mockRejectedValueOnce(
      Object.assign(new Error('Request failed with status code 402'), {
        isAxiosError: true,
        response: { status: 402, data: { detail: 'Insufficient API credits' } }
      })
    )
    await expect(
      worldlabsAdapter.submitSpatialWorldExport?.(provider(), 'w-9', {
        spatialWorldId: 'w-9',
        assetType: 'splats',
        format: 'ply'
      })
    ).rejects.toThrow(/积分不足/)
  })

  it('polls an export operation until the result url shows up', async () => {
    getMock.mockResolvedValueOnce({ data: { operation_id: 'op-ex3', done: false } })
    const pending = await worldlabsAdapter.pollSpatialWorldExport?.(provider(), {
      jobId: 'op-ex3',
      pollingUrl: 'op-ex3'
    })
    expect(pending).toMatchObject({ status: 'in_progress' })

    getMock.mockResolvedValueOnce({
      data: {
        operation_id: 'op-ex3',
        done: true,
        response: { asset_type: 'mesh', format: 'glb', url: 'https://cdn.example.com/hq.glb' }
      }
    })
    const done = await worldlabsAdapter.pollSpatialWorldExport?.(provider(), {
      jobId: 'op-ex3',
      pollingUrl: 'op-ex3'
    })
    expect(done).toMatchObject({
      status: 'completed',
      downloadUrl: 'https://cdn.example.com/hq.glb'
    })

    // 完成但没有下载地址要判失败，而不是返回空产物
    getMock.mockResolvedValueOnce({
      data: { operation_id: 'op-ex4', done: true, response: { asset_type: 'mesh', format: 'glb' } }
    })
    const noUrl = await worldlabsAdapter.pollSpatialWorldExport?.(provider(), {
      jobId: 'op-ex4',
      pollingUrl: 'op-ex4'
    })
    expect(noUrl?.status).toBe('failed')
    expect(noUrl?.error).toContain('未返回下载地址')
  })

  it('falls back to marble-1.1 for unknown model ids', async () => {
    postMock.mockResolvedValueOnce({ data: { operation_id: 'op-4' } })
    const job = await worldlabsAdapter.submitSpatialWorld?.(provider(), 'marble-9.9', {
      prompt: 'x'
    })
    expect(job?.model).toBe('marble-1.1')
    expect(postMock.mock.calls[0]?.[1]).toMatchObject({ model: 'marble-1.1' })
  })

  it('rejects submission without an operation id', async () => {
    postMock.mockResolvedValueOnce({ data: { operation_id: null } })
    await expect(
      worldlabsAdapter.submitSpatialWorld?.(provider(), 'marble-1.1', { prompt: 'x' })
    ).rejects.toThrow(/未返回生成任务 operation id/)
  })

  it('wraps upstream submission failures with detail', async () => {
    postMock.mockRejectedValueOnce(
      Object.assign(new Error('Request failed with status code 402'), {
        isAxiosError: true,
        response: { data: { detail: 'Insufficient credits' } }
      })
    )
    await expect(
      worldlabsAdapter.submitSpatialWorld?.(provider(), 'marble-1.1', { prompt: 'x' })
    ).rejects.toThrow(/Insufficient credits/)
  })

  it('polls an in-progress operation', async () => {
    getMock.mockResolvedValueOnce({
      data: { operation_id: 'op-1', done: false, response: null }
    })
    const result = await worldlabsAdapter.pollWorld?.(provider(), {
      jobId: 'op-1',
      pollingUrl: 'op-1'
    })
    expect(result).toMatchObject({ status: 'in_progress' })
    expect(getMock).toHaveBeenCalledWith('/marble/v1/operations/op-1')
  })

  it('polls a completed world and returns the collider mesh GLB', async () => {
    getMock.mockResolvedValueOnce({
      data: {
        operation_id: 'op-1',
        done: true,
        response: {
          id: 'w-1',
          assets: {
            mesh: { collider_mesh_url: 'https://cdn.example.com/world.glb' },
            splats: { spz_urls: { full_res: 'https://cdn.example.com/world.spz' } }
          }
        }
      }
    })
    const result = await worldlabsAdapter.pollWorld?.(provider(), {
      jobId: 'op-1',
      pollingUrl: 'op-1'
    })
    expect(result).toMatchObject({
      status: 'completed',
      progress: 100,
      downloadUrl: 'https://cdn.example.com/world.glb'
    })
  })

  it('reports operation errors as failed', async () => {
    getMock.mockResolvedValueOnce({
      data: { operation_id: 'op-1', done: true, error: { code: 13, message: 'boom' } }
    })
    const result = await worldlabsAdapter.pollWorld?.(provider(), {
      jobId: 'op-1',
      pollingUrl: 'op-1'
    })
    expect(result?.status).toBe('failed')
    expect(result?.error).toContain('boom')
  })

  it('reports a finished world without mesh assets as failed', async () => {
    getMock.mockResolvedValueOnce({
      data: { operation_id: 'op-1', done: true, response: { id: 'w-1', assets: {} } }
    })
    const result = await worldlabsAdapter.pollWorld?.(provider(), {
      jobId: 'op-1',
      pollingUrl: 'op-1'
    })
    expect(result?.status).toBe('failed')
    expect(result?.error).toContain('网格')
  })
})
