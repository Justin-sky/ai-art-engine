import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ModelProviderInstance } from '../src/shared/modelProvider'
import { createEmptyModalityMap } from '../src/shared/modelProvider'

const getMock = vi.fn()
const postMock = vi.fn()

vi.mock('axios', () => ({
  default: {
    create: () => ({
      get: getMock,
      post: postMock
    }),
    isAxiosError: (err: unknown) =>
      Boolean(err && typeof err === 'object' && (err as { isAxiosError?: boolean }).isAxiosError)
  }
}))

vi.mock('../src/main/services/projectService', () => ({
  projectService: {
    isOpen: () => false,
    attachExternalGeneratedFile: vi.fn()
  }
}))

import { comfyUiAdapter } from '../src/main/services/modelProviders/comfyui/adapter'
import { comfyUiUserdataOrigins } from '../src/main/services/modelProviders/comfyui/http'

const workflow = {
  '6': { class_type: 'CLIPTextEncode', inputs: { text: 'old' } },
  '5': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512 } }
}

const r2vWorkflow = {
  '1': {
    class_type: 'WanImageToVideo',
    inputs: { reference_image: ['10', 0], reference_video: ['11', 0], reference_audio: ['12', 0] }
  },
  '10': { class_type: 'LoadImage', inputs: { image: 'old.png' } },
  '11': { class_type: 'VHS_LoadVideo', inputs: { video: 'old.mp4' } },
  '12': { class_type: 'VHS_LoadAudio', inputs: { audio_file: 'old.wav' } }
}

function provider(overrides?: Partial<ModelProviderInstance>): ModelProviderInstance {
  return {
    id: 'comfy-1',
    providerKind: 'comfyui',
    label: 'ComfyUI',
    apiKey: '',
    baseUrl: 'http://127.0.0.1:8189',
    enabled: true,
    modalities: createEmptyModalityMap(),
    ...overrides
  }
}

describe('comfyUiAdapter', () => {
  beforeEach(() => {
    getMock.mockReset()
    postMock.mockReset()
  })

  it('allows empty api key on auth when v2 jobs responds', async () => {
    getMock.mockResolvedValueOnce({ data: { jobs: [] } })
    await expect(comfyUiAdapter.assertAuth(provider())).resolves.toBeUndefined()
    expect(getMock).toHaveBeenCalledWith('/api/v2/jobs', { params: { limit: 1 } })
  })

  it('returns no models when userdata has no workflows and remote fails', async () => {
    getMock.mockRejectedValue(new Error('no templates'))
    expect(await comfyUiAdapter.fetchCatalog(provider(), 'image')).toEqual([])
    expect(await comfyUiAdapter.fetchCatalog(provider(), 'video')).toEqual([])
    expect(await comfyUiAdapter.fetchCatalog(provider(), 'audio')).toEqual([])
    expect(await comfyUiAdapter.fetchCatalog(provider(), 'text')).toEqual([])
  })

  it('throws for text chat', async () => {
    await expect(comfyUiAdapter.generateText(provider(), 'x', { prompt: 'hi' })).rejects.toThrow(
      /不支持文本/
    )
  })

  it('submits an image job through /api/v2/jobs', async () => {
    getMock.mockImplementation((url: string) => {
      if (String(url).includes('/api/userdata')) {
        return Promise.resolve({ data: workflow })
      }
      return Promise.reject(new Error(`unexpected GET ${url}`))
    })
    postMock.mockResolvedValueOnce({
      data: {
        id: 'job-1',
        status: 'succeeded',
        outputs: [{ type: 'image', url: 'http://127.0.0.1:8189/view?f=a.png' }],
        urls: { self: '/api/v2/jobs/job-1' }
      }
    })
    const result = await comfyUiAdapter.generateImage(provider(), 'txt2img', {
      prompt: 'a cat',
      aspectRatio: '16:9'
    })
    expect(result.images[0]).toContain('a.png')
    expect(postMock).toHaveBeenCalledWith(
      '/api/v2/jobs',
      expect.objectContaining({
        workflow: expect.objectContaining({
          '6': expect.objectContaining({
            inputs: expect.objectContaining({ text: 'a cat' })
          })
        })
      }),
      expect.objectContaining({
        headers: expect.objectContaining({ 'Idempotency-Key': expect.any(String) })
      })
    )
  })

  it('submits video and polls status', async () => {
    getMock.mockImplementation((url: string) => {
      if (String(url).includes('/api/userdata')) {
        return Promise.resolve({ data: workflow })
      }
      if (String(url).includes('/api/v2/jobs')) {
        return Promise.resolve({
          data: {
            id: 'v1',
            status: 'succeeded',
            outputs: [{ type: 'video', url: 'http://x/out.mp4' }],
            progress: { value: 1 }
          }
        })
      }
      return Promise.reject(new Error(`unexpected GET ${url}`))
    })
    postMock.mockResolvedValueOnce({
      data: { id: 'v1', status: 'queued', urls: { self: '/api/v2/jobs/v1' } }
    })
    const job = await comfyUiAdapter.submitVideo(provider(), 'txt2vid', { prompt: 'run' })
    expect(job.jobId).toBe('v1')
    const poll = await comfyUiAdapter.pollVideo(provider(), {
      jobId: 'v1',
      pollingUrl: job.pollingUrl
    })
    expect(poll.status).toBe('completed')
    expect(poll.downloadUrl).toBe('http://x/out.mp4')
  })

  it('treats an image-typed mp4 output as a video download', async () => {
    getMock.mockImplementation((url: string) => {
      if (String(url).includes('/api/v2/jobs')) {
        return Promise.resolve({
          data: {
            id: 'v-mp4',
            status: 'succeeded',
            outputs: [
              {
                node_id: '92',
                name: 'MiniMax_H3_00004_.mp4',
                type: 'image',
                content_type: 'video/mp4',
                url: 'http://x/out-as-image.mp4'
              }
            ],
            progress: { value: 1 }
          }
        })
      }
      return Promise.reject(new Error(`unexpected GET ${url}`))
    })
    const poll = await comfyUiAdapter.pollVideo(provider(), {
      jobId: 'v-mp4',
      pollingUrl: '/api/v2/jobs/v-mp4'
    })
    expect(poll.status).toBe('completed')
    expect(poll.downloadUrl).toBe('http://x/out-as-image.mp4')
  })

  it('loads a workflow listed as a basename under dir=workflows', async () => {
    const encoded = `/api/userdata/${encodeURIComponent('workflows/video_minimax_h3_t2v.json')}`
    getMock.mockImplementation((url: string, config?: { params?: { dir?: string; file?: string } }) => {
      if (url === '/api/userdata' && config?.params?.dir === 'workflows') {
        return Promise.resolve({ data: ['video_minimax_h3_t2v.json'] })
      }
      if (config?.params?.file === 'workflows/video_minimax_h3_t2v.json') {
        return Promise.resolve({ data: workflow })
      }
      if (url === encoded || String(url).endsWith(encoded)) {
        return Promise.resolve({ data: workflow })
      }
      if (String(url).includes('/api/workflow_templates') || String(url).includes('/userdata')) {
        return Promise.reject(
          Object.assign(new Error('Request failed with status code 404'), {
            isAxiosError: true,
            response: { status: 404, data: { message: 'not found' } }
          })
        )
      }
      return Promise.reject(new Error(`unexpected GET ${url}`))
    })
    postMock.mockResolvedValueOnce({
      data: {
        id: 'job-v',
        status: 'queued',
        urls: { self: '/api/v2/jobs/job-v' }
      }
    })
    const job = await comfyUiAdapter.submitVideo(provider(), 'video_minimax_h3_t2v', {
      prompt: 'run'
    })
    expect(job.jobId).toBe('job-v')
  })

  it('sends file_path and content_type when uploading references to /api/v2/assets', async () => {
    const encoded = `/api/userdata/${encodeURIComponent('workflows/txt2img.json')}`
    getMock.mockImplementation((url: string, config?: { params?: { dir?: string } }) => {
      if (url === '/api/userdata' && config?.params?.dir === 'workflows') {
        return Promise.resolve({ data: ['workflows/txt2img.json'] })
      }
      if (url === encoded || String(url).endsWith(encoded)) {
        return Promise.resolve({ data: workflow })
      }
      if (String(url).includes('/api/userdata') || String(url).includes('/userdata')) {
        return Promise.reject(
          Object.assign(new Error('Request failed with status code 404'), {
            isAxiosError: true,
            response: { status: 404, data: { message: 'not found' } }
          })
        )
      }
      return Promise.reject(new Error(`unexpected GET ${url}`))
    })
    postMock
      .mockRejectedValueOnce(new Error('upload/image unsupported'))
      .mockResolvedValueOnce({ data: { id: 'asset-1', file_path: 'ref-upload.png' } })
      .mockResolvedValueOnce({
        data: { id: 'job-ref', status: 'queued', urls: { self: '/api/v2/jobs/job-ref' } }
      })

    const job = await comfyUiAdapter.submitVideo(provider(), 'txt2img', {
      prompt: 'run',
      inputReferences: ['data:image/png;base64,AA==']
    })

    const upload = postMock.mock.calls.find((call) => call[0] === '/api/v2/assets')
    expect(upload).toBeTruthy()
    const form = upload?.[1] as FormData
    expect(form.get('content_type')).toBe('image/png')
    expect(String(form.get('file_path') ?? '')).toMatch(/^ref-\d+\.png$/)
    expect(job.jobId).toBe('job-ref')
  })

  it('loads a workflow from encoded workflows/ userdata path', async () => {
    const encoded = `/api/userdata/${encodeURIComponent('workflows/txt2img.json')}`
    getMock.mockImplementation((url: string) => {
      if (url === encoded || String(url).endsWith(encoded)) return Promise.resolve({ data: workflow })
      if (String(url).includes('/api/userdata') || String(url).includes('/userdata')) {
        return Promise.reject(
          Object.assign(new Error('Request failed with status code 404'), {
            isAxiosError: true,
            response: { status: 404, data: { message: 'not found' } }
          })
        )
      }
      return Promise.reject(new Error(`unexpected GET ${url}`))
    })
    postMock.mockResolvedValueOnce({
      data: {
        id: 'job-2',
        status: 'succeeded',
        outputs: [{ type: 'image', url: 'http://127.0.0.1:8189/view?f=b.png' }]
      }
    })
    const result = await comfyUiAdapter.generateImage(provider(), 'txt2img', { prompt: 'a cat' })
    expect(result.images[0]).toContain('b.png')
  })

  it('lists userdata workflows instead of txt2img placeholders', async () => {
    getMock.mockImplementation((url: string, config?: { params?: { dir?: string } }) => {
      if (url === '/api/userdata' && config?.params?.dir === 'workflows') {
        return Promise.resolve({
          data: [
            'workflows/千问文生图zimage.json',
            'workflows/wan22文生视频.json',
            'workflows/wan22_animate.json'
          ]
        })
      }
      const path = decodeURIComponent(String(url))
      if (path.includes('千问文生图zimage.json')) {
        return Promise.resolve({
          data: {
            '1': { class_type: 'EmptyLatentImage' },
            '2': { class_type: 'SaveImage' }
          }
        })
      }
      if (path.includes('wan22文生视频.json') || path.includes('wan22_animate.json')) {
        return Promise.resolve({
          data: {
            '1': { class_type: 'WanImageToVideo' },
            '2': { class_type: 'VHS_VideoCombine' }
          }
        })
      }
      if (String(url).includes('/api/workflow_templates')) {
        return Promise.reject(new Error('no templates'))
      }
      if (String(url).includes('/api/userdata')) {
        return Promise.reject(new Error('skip'))
      }
      return Promise.reject(new Error(`unexpected GET ${url}`))
    })
    const images = await comfyUiAdapter.fetchCatalog(provider(), 'image')
    const videos = await comfyUiAdapter.fetchCatalog(provider(), 'video')
    expect(images.map((m) => m.id)).toContain('千问文生图zimage')
    expect(images.map((m) => m.id)).not.toContain('txt2img')
    expect(images.map((m) => m.id)).not.toContain('wan22文生视频')
    expect(images.map((m) => m.id)).not.toContain('wan22_animate')
    expect(videos.map((m) => m.id)).toContain('wan22文生视频')
    expect(videos.map((m) => m.id)).toContain('wan22_animate')
  })

  it('classifies a generically named workflow by its node types', async () => {
    const encoded = `/api/userdata/${encodeURIComponent('workflows/my-flow.json')}`
    getMock.mockImplementation((url: string, config?: { params?: { dir?: string } }) => {
      if (url === '/api/userdata' && config?.params?.dir === 'workflows') {
        return Promise.resolve({ data: ['workflows/my-flow.json'] })
      }
      if (url === encoded) {
        return Promise.resolve({
          data: {
            '1': { class_type: 'EmptyHunyuanLatentVideo' },
            '2': { class_type: 'VHS_VideoCombine' }
          }
        })
      }
      if (String(url).includes('/api/workflow_templates')) {
        return Promise.reject(new Error('no templates'))
      }
      if (String(url).includes('/api/userdata')) {
        return Promise.reject(new Error('skip'))
      }
      return Promise.reject(new Error(`unexpected GET ${url}`))
    })
    const images = await comfyUiAdapter.fetchCatalog(provider(), 'image')
    const videos = await comfyUiAdapter.fetchCatalog(provider(), 'video')
    expect(images.map((m) => m.id)).not.toContain('my-flow')
    expect(videos.map((m) => m.id)).toContain('my-flow')
  })

  it('keeps a video-named workflow in the image catalog when nodes only save images', async () => {
    const encoded = `/api/userdata/${encodeURIComponent('workflows/wan22文生视频.json')}`
    getMock.mockImplementation((url: string, config?: { params?: { dir?: string } }) => {
      if (url === '/api/userdata' && config?.params?.dir === 'workflows') {
        return Promise.resolve({ data: ['workflows/wan22文生视频.json'] })
      }
      if (url === encoded) {
        return Promise.resolve({
          data: {
            '1': { class_type: 'EmptyLatentImage' },
            '2': { class_type: 'SaveImage' }
          }
        })
      }
      if (String(url).includes('/api/workflow_templates')) {
        return Promise.reject(new Error('no templates'))
      }
      if (String(url).includes('/api/userdata')) {
        return Promise.reject(new Error('skip'))
      }
      return Promise.reject(new Error(`unexpected GET ${url}`))
    })
    const images = await comfyUiAdapter.fetchCatalog(provider(), 'image')
    const videos = await comfyUiAdapter.fetchCatalog(provider(), 'video')
    expect(images.map((m) => m.id)).toContain('wan22文生视频')
    expect(videos.map((m) => m.id)).not.toContain('wan22文生视频')
  })

  it('lists userdata json names when the selected workflow is missing', async () => {
    getMock.mockImplementation((url: string, config?: { params?: { dir?: string } }) => {
      if (url === '/api/userdata' && config?.params?.dir === 'workflows') {
        return Promise.resolve({ data: ['workflows/my-flow.json'] })
      }
      if (String(url).includes('/api/userdata')) {
        return Promise.reject(
          Object.assign(new Error('Request failed with status code 404'), {
            isAxiosError: true,
            response: { status: 404, data: { message: 'not found' } }
          })
        )
      }
      return Promise.reject(new Error(`unexpected GET ${url}`))
    })
    await expect(
      comfyUiAdapter.generateImage(provider(), 'txt2img', { prompt: 'a cat' })
    ).rejects.toThrow(/my-flow/)
  })

  it('reports an API-format error instead of a misleading 404 for UI workflows', async () => {
    const encoded = `/api/userdata/${encodeURIComponent('workflows/my-flow.json')}`
    const uiWorkflow = {
      nodes: [{ id: 1, type: 'MarkdownNote', widgets_values: ['no executable nodes'] }],
      links: []
    }
    getMock.mockImplementation((url: string, config?: { params?: { dir?: string } }) => {
      if (url === '/api/userdata' && config?.params?.dir === 'workflows') {
        return Promise.resolve({ data: ['workflows/my-flow.json'] })
      }
      if (url === encoded) {
        return Promise.resolve({ data: uiWorkflow })
      }
      if (String(url).includes('/api/userdata')) {
        return Promise.reject(
          Object.assign(new Error('Request failed with status code 404'), {
            isAxiosError: true,
            response: { status: 404, data: { message: 'not found' } }
          })
        )
      }
      return Promise.reject(new Error(`unexpected GET ${url}`))
    })
    await expect(
      comfyUiAdapter.generateImage(provider(), 'my-flow', { prompt: 'a cat' })
    ).rejects.toThrow(/API 格式|Save \(API Format\)/)
  })

  it('infers media input capabilities from generate node sockets in fetchCatalog', async () => {
    const encoded = `/api/userdata/${encodeURIComponent('workflows/r2v.json')}`
    getMock.mockImplementation((url: string, config?: { params?: { dir?: string } }) => {
      if (url === '/api/userdata' && config?.params?.dir === 'workflows') {
        return Promise.resolve({ data: ['workflows/r2v.json'] })
      }
      if (url === encoded || String(url).endsWith(encoded)) {
        return Promise.resolve({ data: r2vWorkflow })
      }
      if (String(url).includes('/api/workflow_templates')) {
        return Promise.reject(new Error('no templates'))
      }
      if (
        String(url).includes('/api/userdata') ||
        String(url).includes('/v2/userdata') ||
        String(url).includes('/userdata')
      ) {
        return Promise.reject(new Error('skip'))
      }
      return Promise.reject(new Error(`unexpected GET ${url}`))
    })
    const videos = await comfyUiAdapter.fetchCatalog(provider(), 'video')
    const r2v = videos.find((m) => m.id === 'r2v')
    expect(r2v).toBeTruthy()
    expect(r2v?.capabilities).toMatchObject({
      max_input_images: 1,
      max_input_videos: 1,
      max_input_audios: 1
    })
  })

  it('keeps r2v video/audio ports when graph inference only detects image', async () => {
    const encoded = `/api/userdata/${encodeURIComponent('workflows/r2v-partial.json')}`
    // 生成节点只暴露了图片 socket，视频/音频参考经由未识别的负载节点注入，
    // 推断只会命中 image —— 但 r2v profile 声明的 video/audio 口不应被误隐藏。
    const partialWorkflow = {
      '1': { class_type: 'WanImageToVideo', inputs: { reference_image: ['10', 0], prompt: 'x' } },
      '10': { class_type: 'LoadImage', inputs: { image: 'old.png' } }
    }
    getMock.mockImplementation((url: string, config?: { params?: { dir?: string } }) => {
      if (url === '/api/userdata' && config?.params?.dir === 'workflows') {
        return Promise.resolve({ data: ['workflows/r2v-partial.json'] })
      }
      if (url === encoded || String(url).endsWith(encoded)) {
        return Promise.resolve({ data: partialWorkflow })
      }
      if (String(url).includes('/api/workflow_templates')) {
        return Promise.reject(new Error('no templates'))
      }
      if (
        String(url).includes('/api/userdata') ||
        String(url).includes('/v2/userdata') ||
        String(url).includes('/userdata')
      ) {
        return Promise.reject(new Error('skip'))
      }
      return Promise.reject(new Error(`unexpected GET ${url}`))
    })
    const videos = await comfyUiAdapter.fetchCatalog(provider(), 'video')
    const r2v = videos.find((m) => m.id === 'r2v-partial')
    expect(r2v).toBeTruthy()
    expect(r2v?.capabilities).toMatchObject({
      max_input_images: 1,
      max_input_videos: 1,
      max_input_audios: 1
    })
  })

  it('splits submitVideo references by kind and injects into image/video/audio load nodes', async () => {
    const encoded = `/api/userdata/${encodeURIComponent('workflows/r2v.json')}`
    getMock.mockImplementation((url: string, config?: { params?: { dir?: string } }) => {
      if (url === '/api/userdata' && config?.params?.dir === 'workflows') {
        return Promise.resolve({ data: ['workflows/r2v.json'] })
      }
      if (url === encoded || String(url).endsWith(encoded)) {
        return Promise.resolve({ data: r2vWorkflow })
      }
      if (
        String(url).includes('/api/userdata') ||
        String(url).includes('/v2/userdata') ||
        String(url).includes('/userdata')
      ) {
        return Promise.reject(new Error('skip'))
      }
      return Promise.reject(new Error(`unexpected GET ${url}`))
    })
    postMock.mockImplementation((url: string, body?: unknown) => {
      if (url === '/upload/image') return Promise.reject(new Error('fallback'))
      if (url === '/api/v2/assets') {
        const form = body as FormData
        const contentType = String(form.get('content_type') ?? '')
        const name = contentType.includes('video')
          ? 'ref-video.mp4'
          : contentType.includes('audio')
            ? 'ref-audio.wav'
            : 'ref-image.png'
        return Promise.resolve({ data: { file_path: name } })
      }
      if (url === '/api/v2/jobs') {
        return Promise.resolve({
          data: { id: 'job-r2v', status: 'queued', urls: { self: '/api/v2/jobs/job-r2v' } }
        })
      }
      return Promise.reject(new Error(`unexpected POST ${url}`))
    })

    await comfyUiAdapter.submitVideo(provider(), 'r2v', {
      prompt: 'run',
      inputReferences: [
        'data:image/png;base64,AA==',
        { kind: 'video_url', url: 'data:video/mp4;base64,AA==' },
        { kind: 'audio_url', url: 'data:audio/wav;base64,AA==' }
      ]
    })

    const submit = postMock.mock.calls.find((call) => call[0] === '/api/v2/jobs')
    expect(submit).toBeTruthy()
    const body = submit?.[1] as { workflow: Record<string, { inputs: Record<string, unknown> }> }
    expect(body.workflow['10']?.inputs.image).toBe('ref-image.png')
    expect(body.workflow['11']?.inputs.video).toBe('ref-video.mp4')
    expect(body.workflow['12']?.inputs.audio_file).toBe('ref-audio.wav')
  })

  it('submits i2v with first/last frame into MiniMax H3 socket LoadImage nodes', async () => {
    const fl2vWorkflow = {
      '104': {
        class_type: 'MiniMaxH3ImageToVideo',
        inputs: { clip: ['13', 0], vae: ['11', 0], first_frame: ['10', 0], last_frame: ['12', 0] }
      },
      '10': { class_type: 'LoadImage', inputs: { image: 'old-first.png' } },
      '12': { class_type: 'LoadImage', inputs: { image: 'old-last.png' } }
    }
    const encoded = `/api/userdata/${encodeURIComponent('workflows/fl2v.json')}`
    getMock.mockImplementation((url: string, config?: { params?: { dir?: string } }) => {
      if (url === '/api/userdata' && config?.params?.dir === 'workflows') {
        return Promise.resolve({ data: ['workflows/fl2v.json'] })
      }
      if (url === encoded || String(url).endsWith(encoded)) {
        return Promise.resolve({ data: fl2vWorkflow })
      }
      if (
        String(url).includes('/api/userdata') ||
        String(url).includes('/v2/userdata') ||
        String(url).includes('/userdata')
      ) {
        return Promise.reject(new Error('skip'))
      }
      return Promise.reject(new Error(`unexpected GET ${url}`))
    })
    let uploadCount = 0
    postMock.mockImplementation((url: string, _body?: unknown) => {
      if (url === '/upload/image') {
        uploadCount += 1
        // 首帧先上传、尾帧后上传
        return Promise.resolve({ data: { name: uploadCount === 1 ? 'first.png' : 'last.png' } })
      }
      if (url === '/api/v2/jobs') {
        return Promise.resolve({
          data: { id: 'job-fl2v', status: 'queued', urls: { self: '/api/v2/jobs/job-fl2v' } }
        })
      }
      return Promise.reject(new Error(`unexpected POST ${url}`))
    })

    await comfyUiAdapter.submitVideo(provider(), 'fl2v', {
      prompt: 'run',
      firstFrameImageUrl: 'data:image/png;base64,AA==',
      lastFrameImageUrl: 'data:image/png;base64,BB=='
    })

    const submit = postMock.mock.calls.find((call) => call[0] === '/api/v2/jobs')
    expect(submit).toBeTruthy()
    const body = submit?.[1] as { workflow: Record<string, { inputs: Record<string, unknown> }> }
    expect(body.workflow['10']?.inputs.image).toBe('first.png')
    expect(body.workflow['12']?.inputs.image).toBe('last.png')
  })

  it('falls back to ComfyUI :8188 for userdata when Base URL is the proxy', () => {
    expect(comfyUiUserdataOrigins(provider())).toEqual([
      'http://127.0.0.1:8189',
      'http://127.0.0.1:8188'
    ])
  })

  it('prefers a configured native ComfyUI URL for userdata', () => {
    expect(
      comfyUiUserdataOrigins(provider({ nativeBaseUrl: 'http://127.0.0.1:8190/' }))
    ).toEqual(['http://127.0.0.1:8190'])
  })

})
