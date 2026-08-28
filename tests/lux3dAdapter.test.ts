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

import { lux3dAdapter } from '../src/main/services/modelProviders/lux3d/adapter'

function provider(overrides?: Partial<ModelProviderInstance>): ModelProviderInstance {
  return {
    id: 'lux3d-1',
    providerKind: 'lux3d',
    label: 'Lux3D',
    apiKey: 'ak-test',
    baseUrl: 'https://api.aholo3d.cn',
    enabled: true,
    modalities: createEmptyModalityMap(),
    ...overrides
  }
}

/** AHOLO 网关信封：成功 c === '0'，业务数据在 d */
const ok = (d: unknown) => ({ data: { f: null, c: '0', m: '', d } })

describe('lux3dAdapter', () => {
  beforeEach(() => {
    getMock.mockReset()
    postMock.mockReset()
    createdConfigs.length = 0
  })

  it('assertAuth hits the task list endpoint with a raw Authorization header', async () => {
    getMock.mockResolvedValueOnce(ok({ items: [], total: 0 }))
    await lux3dAdapter.assertAuth(provider())
    expect(getMock).toHaveBeenCalledWith(
      '/lux3d/v1/generate/task/list',
      expect.objectContaining({ params: { page: 1, pagesize: 1 } })
    )
    // AHOLO 网关要求裸 Key（无 Bearer 前缀）
    expect(createdConfigs[0]?.headers?.Authorization).toBe('ak-test')
  })

  it('assertAuth surfaces envelope failures', async () => {
    getMock.mockResolvedValueOnce({ data: { f: null, c: '401', m: 'invalid api key' } })
    await expect(lux3dAdapter.assertAuth(provider())).rejects.toThrow(/invalid api key/)
  })

  it('returns G1 catalogs for model3d only', async () => {
    const models = await lux3dAdapter.fetchCatalog(provider(), 'model3d')
    expect(models.map((m) => m.id)).toEqual(['G1', 'G1-Turbo'])
    expect(await lux3dAdapter.fetchCatalog(provider(), 'text')).toEqual([])
  })

  it('rejects text/speech modalities', async () => {
    await expect(lux3dAdapter.generateText(provider(), 'G1', { prompt: 'hi' })).rejects.toThrow(
      /不支持文本/
    )
    await expect(lux3dAdapter.generateSpeech(provider(), 'G1', { input: 'hi' })).rejects.toThrow(
      /不支持语音合成/
    )
  })

  it('submits text-to-3d with version and glb output format', async () => {
    postMock.mockResolvedValueOnce(ok(1256173))
    const job = await lux3dAdapter.submitModel3d(provider(), 'G1', { prompt: 'a chair' })
    expect(job).toMatchObject({ jobId: '1256173', pollingUrl: '1256173', model: 'G1' })
    expect(postMock).toHaveBeenCalledWith(
      '/lux3d/v1/generate/text-to-3d/task/create',
      expect.objectContaining({ prompt: 'a chair', version: 'G1', outputFormat: ['glb'] })
    )
  })

  it('passes a valid style to text-to-3d and drops invalid values', async () => {
    postMock.mockResolvedValueOnce(ok(2001))
    await lux3dAdapter.submitModel3d(provider(), 'G1', { prompt: 'a chair', style: 'Anime' })
    expect(postMock.mock.calls[0]?.[1]).toMatchObject({ style: 'anime' })

    postMock.mockResolvedValueOnce(ok(2002))
    await lux3dAdapter.submitModel3d(provider(), 'G1', { prompt: 'a chair', style: 'nope' })
    const invalid = postMock.mock.calls[1]?.[1] as Record<string, unknown>
    // 非法值置为 undefined（JSON 序列化时剔除），走服务端缺省 photorealistic
    expect(invalid.style).toBeUndefined()
  })

  it('ignores style for img-to-3d', async () => {
    postMock.mockResolvedValueOnce(ok(2003))
    await lux3dAdapter.submitModel3d(provider(), 'G1', {
      prompt: '',
      style: 'anime',
      inputReferences: ['https://cdn.example.com/a.jpg']
    })
    const body = postMock.mock.calls[0]?.[1] as Record<string, unknown>
    expect(body).toMatchObject({ img: 'https://cdn.example.com/a.jpg' })
    expect(body).not.toHaveProperty('style')
  })

  it('submits img-to-3d with img for a single reference', async () => {
    postMock.mockResolvedValueOnce(ok(100))
    await lux3dAdapter.submitModel3d(provider(), 'G1-Turbo', {
      prompt: '',
      inputReferences: ['https://cdn.example.com/a.jpg']
    })
    expect(postMock).toHaveBeenCalledWith(
      '/lux3d/v1/generate/img-to-3d/task/create',
      expect.objectContaining({
        img: 'https://cdn.example.com/a.jpg',
        version: 'G1-Turbo',
        outputFormat: ['glb']
      })
    )
  })

  it('submits img-to-3d with ordered imgs for multiple references', async () => {
    postMock.mockResolvedValueOnce(ok(101))
    await lux3dAdapter.submitModel3d(provider(), 'G1', {
      prompt: '',
      inputReferences: [
        { kind: 'image_url', url: 'https://cdn.example.com/1.png' },
        { kind: 'image_url', url: 'https://cdn.example.com/2.png' }
      ]
    })
    expect(postMock).toHaveBeenCalledWith(
      '/lux3d/v1/generate/img-to-3d/task/create',
      expect.objectContaining({
        imgs: ['https://cdn.example.com/1.png', 'https://cdn.example.com/2.png'],
        version: 'G1'
      })
    )
    expect(postMock.mock.calls[0]?.[1]).not.toHaveProperty('img')
  })

  it('wraps envelope failures from task creation', async () => {
    postMock.mockResolvedValueOnce({ data: { f: null, c: '-1', m: '参数错误' } })
    await expect(
      lux3dAdapter.submitModel3d(provider(), 'G1', { prompt: 'a chair' })
    ).rejects.toThrow(/参数错误/)
  })

  it('rejects task creation without a task id', async () => {
    postMock.mockResolvedValueOnce(ok(null))
    await expect(
      lux3dAdapter.submitModel3d(provider(), 'G1', { prompt: 'a chair' })
    ).rejects.toThrow(/未返回生成任务 id/)
  })

  it('polls a succeeded task and picks the GLB output', async () => {
    getMock.mockResolvedValueOnce(
      ok({
        taskId: 1256173,
        status: 3,
        outputs: [
          { content: 'https://cos.example.com/lux3d/x/result.zip' },
          { content: 'https://cos.example.com/lux3d/x/model.glb' }
        ]
      })
    )
    const result = await lux3dAdapter.pollModel3d(provider(), {
      jobId: '1256173',
      pollingUrl: '1256173'
    })
    expect(getMock).toHaveBeenCalledWith(
      '/lux3d/v1/generate/task/get',
      expect.objectContaining({ params: { taskid: '1256173' } })
    )
    expect(result.status).toBe('completed')
    expect(result.downloadUrl).toBe('https://cos.example.com/lux3d/x/model.glb')
  })

  it('skips NOT_REQUESTED slots and matches glb before query strings', async () => {
    getMock.mockResolvedValueOnce(
      ok({
        taskId: 1,
        status: 3,
        outputs: [
          { content: 'NOT_REQUESTED' },
          { content: 'https://cos.example.com/lux3d/x/model.glb?sign=abc' }
        ]
      })
    )
    const result = await lux3dAdapter.pollModel3d(provider(), { jobId: '1', pollingUrl: '1' })
    expect(result.status).toBe('completed')
    expect(result.downloadUrl).toBe('https://cos.example.com/lux3d/x/model.glb?sign=abc')
  })

  it('reports completion without a GLB output as failed', async () => {
    getMock.mockResolvedValueOnce(
      ok({ taskId: 1, status: 3, outputs: [{ content: 'https://cos.example.com/x/result.zip' }] })
    )
    const result = await lux3dAdapter.pollModel3d(provider(), { jobId: '1', pollingUrl: '1' })
    expect(result.status).toBe('failed')
    expect(result.error).toContain('GLB')
  })

  it('maps running/failed/canceled statuses', async () => {
    getMock.mockResolvedValueOnce(ok({ taskId: 1, status: 1, outputs: [] }))
    expect(
      await lux3dAdapter.pollModel3d(provider(), { jobId: '1', pollingUrl: '1' })
    ).toMatchObject({ status: 'in_progress', progress: 55 })

    getMock.mockResolvedValueOnce(ok({ taskId: 1, status: 4, outputs: [] }))
    expect(
      await lux3dAdapter.pollModel3d(provider(), { jobId: '1', pollingUrl: '1' })
    ).toMatchObject({
      status: 'failed'
    })

    getMock.mockResolvedValueOnce(ok({ taskId: 1, status: 6, outputs: [] }))
    expect(
      await lux3dAdapter.pollModel3d(provider(), { jobId: '1', pollingUrl: '1' })
    ).toMatchObject({
      status: 'failed'
    })
  })
})
