import type {
  CatalogModel,
  GenerateImageInput,
  GenerateImageResult,
  GenerateSpeechInput,
  GenerateSpeechResult,
  GenerateTextInput,
  GenerateTextResult,
  GenerateVideoInput,
  GenerateVideoJob,
  ModelModality,
  ModelProviderInstance
} from '@shared/modelProvider'
import { MINIMAX_DEFAULT_BASE_URL, normalizeVideoInputReference } from '@shared/modelProvider'
import {
  isMiniMaxTextCatalogId,
  listMiniMaxCatalogModels,
  resolveMiniMaxModelCapabilities
} from '@shared/modelProviders/minimax/modelCapabilities'
import type { ModelProviderAdapter, VideoPollResult } from '../types'
import { trimBaseUrl } from '../http'
import { generateOpenAiCompatibleText } from '../openaiCompat'
import {
  assertMiniMaxBaseResp,
  createMiniMaxHttpClient,
  readMiniMaxHttpError,
  type MiniMaxBaseResp
} from './http'
import { generateMiniMaxVoiceDesign } from './voiceDesign'

type MiniMaxSubmitResp = {
  task_id?: string
  base_resp?: MiniMaxBaseResp
}

type MiniMaxQueryResp = {
  task_id?: string
  status?: string
  file_id?: string | number
  base_resp?: MiniMaxBaseResp
}

type MiniMaxV2QueryResp = {
  task?: {
    id?: string
    status?: string
    error?: { code?: string; message?: string }
    content?: { url?: string }
  }
}

type MiniMaxFileResp = {
  file?: { download_url?: string; file_id?: string | number }
  base_resp?: MiniMaxBaseResp
}

type MiniMaxImageResp = {
  data?: {
    image_urls?: string[]
    image_base64?: string[]
  }
  base_resp?: MiniMaxBaseResp
}

type MiniMaxV2ContentItem = Record<string, unknown>
type MiniMaxV2Mode = 't2va' | 'i2va' | 'r2va'

const MINIMAX_V2_RATIOS = new Set(['21:9', '16:9', '4:3', '1:1', '3:4', '9:16'])

/** 视频/文件接口挂在主机根；若用户误填 …/v1 则去掉 */
function nativeApiBase(provider: ModelProviderInstance): string {
  return trimBaseUrl(provider.baseUrl || MINIMAX_DEFAULT_BASE_URL).replace(/\/v1$/i, '')
}

/** OpenAI 兼容文本：官方要求 base 含 /v1 */
function withOpenAiCompatBase(provider: ModelProviderInstance): ModelProviderInstance {
  const base = nativeApiBase(provider)
  return { ...provider, baseUrl: `${base}/v1` }
}

function isHailuo02(modelId: string): boolean {
  return /hailuo-02/i.test(modelId)
}

function isHailuoFast(modelId: string): boolean {
  return /hailuo.*fast|fast.*hailuo/i.test(modelId)
}

/** MiniMax-H3 及后续 H 系走视频生成 V2 */
export function isMiniMaxVideoV2(modelId: string): boolean {
  return /MiniMax-H\d/i.test(modelId.trim())
}

function isV2PollingUrl(url: string): boolean {
  return /\/v2\/query\/video_generation/i.test(url)
}

/** 贴近官方可选值 6 / 10 */
function snapDuration(seconds: number | undefined, resolution: string): number {
  const prefer1080 = /1080/i.test(resolution)
  if (prefer1080) return 6
  if (seconds == null || !Number.isFinite(seconds)) return 6
  return Math.abs(seconds - 10) < Math.abs(seconds - 6) ? 10 : 6
}

/** V2：时长 4–15 秒 */
function snapV2Duration(seconds: number | undefined): number {
  if (seconds == null || !Number.isFinite(seconds)) return 5
  return Math.min(15, Math.max(4, Math.round(seconds)))
}

function normalizeResolution(resolution: string | undefined, modelId: string): string {
  const r = (resolution ?? '').trim().toUpperCase()
  if (r.includes('1080')) return '1080P'
  if (r.includes('512') && isHailuo02(modelId)) return '512P'
  if (r.includes('720')) return '768P'
  if (r.includes('768')) return '768P'
  return '768P'
}

function normalizeV2Resolution(resolution: string | undefined): string {
  const r = (resolution ?? '').trim().toUpperCase()
  if (r === '2K' || r.includes('2K') || r.includes('2048') || r.includes('1440')) return '2K'
  return '2K'
}

function resolveV2Ratio(aspectRatio: string | undefined, mode: MiniMaxV2Mode): string {
  const r = (aspectRatio ?? '').trim()
  if (mode === 'i2va') return 'adaptive'
  if (mode === 't2va') {
    if (r && MINIMAX_V2_RATIOS.has(r)) return r
    return '16:9'
  }
  if (!r || r === 'adaptive') return 'adaptive'
  if (MINIMAX_V2_RATIOS.has(r)) return r
  return 'adaptive'
}

/**
 * 组装 MiniMax 视频 V2 content（文生 / 首尾帧 / 多模态参考）。
 * 图生视频与多模态参考互斥：有参考视频/音频或非帧参考图时走 r2va。
 */
export function buildMiniMaxV2VideoContent(input: GenerateVideoInput): {
  content: MiniMaxV2ContentItem[]
  mode: MiniMaxV2Mode
} {
  const prompt = input.prompt?.trim()
  if (!prompt) throw new Error('视频提示词不能为空')

  const firstFrame = input.firstFrameImageUrl?.trim()
  const lastFrame = input.lastFrameImageUrl?.trim()
  const refs = (input.inputReferences ?? [])
    .map((ref) => normalizeVideoInputReference(ref))
    .filter((ref) => ref.url.trim())

  const refImages = refs.filter((r) => r.kind === 'image_url').map((r) => r.url.trim())
  const refVideos = refs.filter((r) => r.kind === 'video_url').map((r) => r.url.trim())
  const refAudios = refs.filter((r) => r.kind === 'audio_url').map((r) => r.url.trim())
  const hasFrames = Boolean(firstFrame || lastFrame)
  const hasMultimodalRefs = refVideos.length > 0 || refAudios.length > 0 || (!hasFrames && refImages.length > 0)

  if (hasFrames && (refVideos.length > 0 || refAudios.length > 0)) {
    throw new Error('海螺 H3：首尾帧图生视频与多模态参考（视频/音频）不可混用')
  }
  if (refAudios.length > 0 && refVideos.length === 0 && refImages.length === 0 && !hasFrames) {
    throw new Error('海螺 H3：不可仅输入参考音频，须至少包含 1 个参考视频或图片')
  }

  const content: MiniMaxV2ContentItem[] = [{ type: 'text', text: prompt }]

  if (hasMultimodalRefs) {
    for (const url of refImages.slice(0, 9)) {
      content.push({ type: 'image_url', image_url: { url }, role: 'reference_image' })
    }
    for (const url of refVideos.slice(0, 3)) {
      content.push({ type: 'video_url', video_url: { url }, role: 'reference_video' })
    }
    for (const url of refAudios.slice(0, 3)) {
      content.push({ type: 'audio_url', audio_url: { url }, role: 'reference_audio' })
    }
    return { content, mode: 'r2va' }
  }

  if (firstFrame) {
    content.push({ type: 'image_url', image_url: { url: firstFrame }, role: 'first_frame' })
  }
  if (lastFrame) {
    content.push({ type: 'image_url', image_url: { url: lastFrame }, role: 'last_frame' })
  }
  if (firstFrame || lastFrame) {
    return { content, mode: 'i2va' }
  }
  return { content, mode: 't2va' }
}

function mapTaskStatus(raw: string | undefined): VideoPollResult['status'] {
  const s = (raw ?? '').toLowerCase()
  if (s === 'success' || s === 'succeed' || s === 'succeeded' || s === 'completed') {
    return 'completed'
  }
  if (s === 'fail' || s === 'failed' || s === 'error' || s === 'cancelled' || s === 'expired') {
    return 'failed'
  }
  if (s === 'processing' || s === 'running' || s === 'in_progress') return 'in_progress'
  // Preparing / Queueing / queued
  return 'pending'
}

async function resolveDownloadUrl(
  provider: ModelProviderInstance,
  fileId: string | number
): Promise<string> {
  const client = createMiniMaxHttpClient({
    ...provider,
    baseUrl: nativeApiBase(provider)
  })
  const { data } = await client.get<MiniMaxFileResp>('/v1/files/retrieve', {
    params: { file_id: fileId }
  })
  assertMiniMaxBaseResp(data.base_resp, '获取视频文件')
  const url = data.file?.download_url?.trim()
  if (!url) throw new Error('视频任务已完成但未返回下载地址')
  return url
}

export const miniMaxAdapter: ModelProviderAdapter = {
  kind: 'minimax',

  async assertAuth(provider) {
    const client = createMiniMaxHttpClient({
      ...provider,
      baseUrl: nativeApiBase(provider)
    })
    try {
      // OpenAI 兼容模型列表：校验 Key / Base URL
      const { data } = await client.get<{ base_resp?: MiniMaxBaseResp }>('/v1/models')
      assertMiniMaxBaseResp(data?.base_resp, '连接测试')
    } catch (err) {
      throw new Error(`连接测试失败：${await readMiniMaxHttpError(err)}`)
    }
  },

  async fetchCatalog(provider, modality: ModelModality): Promise<CatalogModel[]> {
    if (modality === 'video' || modality === 'image' || modality === 'audio') {
      return listMiniMaxCatalogModels(modality)
    }
    if (modality !== 'text') return []

    const client = createMiniMaxHttpClient({
      ...provider,
      baseUrl: nativeApiBase(provider)
    })
    try {
      const { data } = await client.get<{
        data?: Array<{ id?: string; name?: string; owned_by?: string }>
        base_resp?: MiniMaxBaseResp
      }>('/v1/models')
      assertMiniMaxBaseResp(data?.base_resp, '拉取模型')
      const rows = (data.data ?? [])
        .filter((m) => m.id && isMiniMaxTextCatalogId(String(m.id)))
        .map((m) => {
          const id = String(m.id)
          return {
            id,
            name: (m.name && String(m.name)) || id,
            modality: 'text' as const,
            capabilities: resolveMiniMaxModelCapabilities(id, 'text') ?? undefined
          }
        })
      if (rows.length) return rows
    } catch {
      // fall through to static
    }
    return listMiniMaxCatalogModels('text')
  },

  generateText(
    provider: ModelProviderInstance,
    modelId: string,
    input: GenerateTextInput
  ): Promise<GenerateTextResult> {
    return generateOpenAiCompatibleText(withOpenAiCompatBase(provider), modelId, input)
  },

  async generateImage(
    provider: ModelProviderInstance,
    modelId: string,
    input: GenerateImageInput
  ): Promise<GenerateImageResult> {
    const client = createMiniMaxHttpClient({
      ...provider,
      baseUrl: nativeApiBase(provider)
    })
    const body: Record<string, unknown> = {
      model: modelId,
      prompt: input.prompt,
      response_format: 'url',
      aigc_watermark: false
    }
    if (input.aspectRatio?.trim()) body.aspect_ratio = input.aspectRatio.trim()
    if (input.n && input.n >= 1) body.n = Math.min(9, Math.floor(input.n))
    const ref = (input.inputReferences ?? []).map((u) => u.trim()).find(Boolean)
    if (ref) {
      body.subject_reference = [{ type: 'character', image_file: ref }]
    }

    try {
      const { data } = await client.post<MiniMaxImageResp>('/v1/image_generation', body)
      assertMiniMaxBaseResp(data.base_resp, '图片生成')
      const urls = (data.data?.image_urls ?? []).map((u) => u.trim()).filter(Boolean)
      const b64 = (data.data?.image_base64 ?? [])
        .map((raw) => raw.trim())
        .filter(Boolean)
        .map((raw) =>
          raw.startsWith('data:') ? raw : `data:image/jpeg;base64,${raw}`
        )
      const images = urls.length ? urls : b64
      if (!images.length) throw new Error('模型未返回图片')
      return { images, model: modelId }
    } catch (err) {
      if (err instanceof Error && /未返回图片|图片生成失败/.test(err.message)) throw err
      throw new Error(`图片生成失败: ${await readMiniMaxHttpError(err)}`)
    }
  },

  async submitVideo(
    provider: ModelProviderInstance,
    modelId: string,
    input: GenerateVideoInput
  ): Promise<GenerateVideoJob> {
    const base = nativeApiBase(provider)
    const client = createMiniMaxHttpClient({ ...provider, baseUrl: base })

    if (isMiniMaxVideoV2(modelId)) {
      try {
        const { content, mode } = buildMiniMaxV2VideoContent(input)
        const body: Record<string, unknown> = {
          model: modelId,
          content,
          resolution: normalizeV2Resolution(input.resolution),
          duration: snapV2Duration(input.duration),
          ratio: resolveV2Ratio(input.aspectRatio, mode),
          aigc_watermark: false
        }
        const { data } = await client.post<MiniMaxSubmitResp>('/v2/video_generation', body)
        assertMiniMaxBaseResp(data.base_resp, '提交视频生成')
        const taskId = data.task_id?.trim()
        if (!taskId) throw new Error('未返回视频任务 id')
        return {
          jobId: taskId,
          pollingUrl: `${base}/v2/query/video_generation/${encodeURIComponent(taskId)}`,
          status: 'submitted',
          model: modelId
        }
      } catch (err) {
        if (err instanceof Error && /海螺 H3|提示词不能为空|提交视频生成失败/.test(err.message)) {
          throw err
        }
        throw new Error(`提交视频生成失败: ${await readMiniMaxHttpError(err)}`)
      }
    }

    const firstFrame = input.firstFrameImageUrl?.trim()
    const lastFrame = input.lastFrameImageUrl?.trim()

    if (isHailuoFast(modelId) && !firstFrame) {
      throw new Error('海螺 2.3 Fast 仅支持图生视频，请提供首帧图片')
    }
    if (lastFrame && !firstFrame) {
      throw new Error('首尾帧生成需要同时提供首帧与尾帧')
    }
    if (lastFrame && !isHailuo02(modelId)) {
      throw new Error('首尾帧生成目前仅支持 MiniMax-Hailuo-02')
    }

    const resolution = normalizeResolution(input.resolution, modelId)
    const duration = snapDuration(input.duration, resolution)

    const body: Record<string, unknown> = {
      model: modelId,
      prompt: input.prompt,
      duration,
      resolution,
      aigc_watermark: false
    }
    if (firstFrame) body.first_frame_image = firstFrame
    if (lastFrame) body.last_frame_image = lastFrame

    try {
      const { data } = await client.post<MiniMaxSubmitResp>('/v1/video_generation', body)
      assertMiniMaxBaseResp(data.base_resp, '提交视频生成')
      const taskId = data.task_id?.trim()
      if (!taskId) throw new Error('未返回视频任务 id')
      return {
        jobId: taskId,
        pollingUrl: `${base}/v1/query/video_generation?task_id=${encodeURIComponent(taskId)}`,
        status: 'submitted',
        model: modelId
      }
    } catch (err) {
      if (err instanceof Error && /海螺|首尾帧|图生视频|提交视频生成失败/.test(err.message)) {
        throw err
      }
      throw new Error(`提交视频生成失败: ${await readMiniMaxHttpError(err)}`)
    }
  },

  async pollVideo(
    provider: ModelProviderInstance,
    job: { jobId: string; pollingUrl: string }
  ): Promise<VideoPollResult> {
    const client = createMiniMaxHttpClient({
      ...provider,
      baseUrl: nativeApiBase(provider)
    })

    if (isV2PollingUrl(job.pollingUrl)) {
      try {
        const { data } = await client.get<MiniMaxV2QueryResp>(
          `/v2/query/video_generation/${encodeURIComponent(job.jobId)}`
        )
        const task = data.task
        const status = mapTaskStatus(task?.status)
        const error =
          status === 'failed'
            ? task?.error?.message?.trim() || '视频生成失败'
            : undefined

        let progress = 15
        if (status === 'in_progress') progress = 55
        if (status === 'pending' && /queue/i.test(task?.status ?? '')) progress = 25
        if (status === 'completed' || status === 'failed') progress = 100

        let downloadUrl: string | undefined
        if (status === 'completed') {
          downloadUrl = task?.content?.url?.trim()
          if (!downloadUrl) throw new Error('视频任务已完成但未返回下载地址')
        }

        return { status, progress, error, downloadUrl }
      } catch (err) {
        if (err instanceof Error && err.message.includes('下载地址')) throw err
        throw new Error(`轮询视频任务失败: ${await readMiniMaxHttpError(err)}`)
      }
    }

    try {
      const { data } = await client.get<MiniMaxQueryResp>('/v1/query/video_generation', {
        params: { task_id: job.jobId }
      })
      assertMiniMaxBaseResp(data.base_resp, '轮询视频任务')
      const status = mapTaskStatus(data.status)
      const error =
        status === 'failed'
          ? data.base_resp?.status_msg || '视频生成失败'
          : undefined

      let progress = 15
      if (status === 'in_progress') progress = 55
      if (status === 'pending' && /queue/i.test(data.status ?? '')) progress = 25
      if (status === 'completed' || status === 'failed') progress = 100

      let downloadUrl: string | undefined
      if (status === 'completed') {
        const fileId = data.file_id
        if (fileId == null || fileId === '') {
          throw new Error('视频任务已完成但未返回 file_id')
        }
        downloadUrl = await resolveDownloadUrl(provider, fileId)
      }

      return { status, progress, error, downloadUrl }
    } catch (err) {
      if (err instanceof Error && err.message.includes('file_id')) throw err
      throw new Error(`轮询视频任务失败: ${await readMiniMaxHttpError(err)}`)
    }
  },

  async generateSpeech(
    provider: ModelProviderInstance,
    _modelId: string,
    input: GenerateSpeechInput
  ): Promise<GenerateSpeechResult> {
    return generateMiniMaxVoiceDesign(provider, nativeApiBase(provider), input)
  }
}
