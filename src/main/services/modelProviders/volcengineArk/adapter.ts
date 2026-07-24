import axios from 'axios'
import type {
  GenerateImageInput,
  GenerateImageResult,
  GenerateSpeechInput,
  GenerateSpeechResult,
  GenerateTextInput,
  GenerateTextResult,
  GenerateVideoInput,
  GenerateVideoJob,
  ModelProviderInstance
} from '@shared/openrouter'
import {
  classifyVolcengineArkModelModality,
  normalizeVideoInputReference
} from '@shared/openrouter'
import { resolveVolcengineArkModelCapabilities } from '@shared/modelProviders/volcengineArk/modelCapabilities'
import { rewriteAtMentionsForVolcengineArkImagePrompt } from '@shared/modelProviders/volcengineArk/imagePromptMentions'
import { rewriteAtMentionsForVolcengineArkVideoPrompt } from '@shared/modelProviders/volcengineArk/videoPromptMentions'
import type { ModelProviderAdapter, VideoPollResult } from '../types'
import {
  createProviderHttpClient,
  formatAuthError,
  isAuthFailure,
  LONG_GENERATE_TIMEOUT_MS,
  readHttpError,
  trimBaseUrl
} from '../http'
import {
  generateOpenAiCompatibleText
} from '../openaiCompat'
import { generateVolcengineOpenspeechSpeech } from './openspeech'

/** 组装方舟视频 content：图片/视频/音频项必须带 role */
export function buildVolcengineArkVideoContent(
  input: GenerateVideoInput
): Array<Record<string, unknown>> {
  const hasFirstFrame = Boolean(input.firstFrameImageUrl?.trim())
  const hasLastFrame = Boolean(input.lastFrameImageUrl?.trim())
  const mentionRefs: Array<{ kind: 'image_url' | 'video_url' | 'audio_url'; url: string }> = []
  const content: Array<Record<string, unknown>> = []

  if (hasFirstFrame) {
    content.push({
      type: 'image_url',
      image_url: { url: input.firstFrameImageUrl!.trim() },
      role: 'first_frame'
    })
  }
  if (hasLastFrame) {
    content.push({
      type: 'image_url',
      image_url: { url: input.lastFrameImageUrl!.trim() },
      role: 'last_frame'
    })
  }
  for (const ref of input.inputReferences ?? []) {
    const normalized = normalizeVideoInputReference(ref)
    const url = normalized.url.trim()
    if (!url) continue
    // 方舟：last_frame 不可与 reference_image / draft_task 混用
    if (normalized.kind === 'image_url') {
      if (hasLastFrame) continue
      mentionRefs.push({ kind: 'image_url', url })
      content.push({
        type: 'image_url',
        image_url: { url },
        role: 'reference_image'
      })
    } else if (normalized.kind === 'video_url') {
      mentionRefs.push({ kind: 'video_url', url })
      content.push({
        type: 'video_url',
        video_url: { url },
        role: 'reference_video'
      })
    } else if (normalized.kind === 'audio_url') {
      mentionRefs.push({ kind: 'audio_url', url })
      content.push({
        type: 'audio_url',
        audio_url: { url },
        role: 'reference_audio'
      })
    }
  }

  content.unshift({
    type: 'text',
    text: rewriteAtMentionsForVolcengineArkVideoPrompt(input.prompt, {
      inputReferences: mentionRefs,
      hasFirstFrame,
      hasLastFrame
    })
  })
  return content
}

export const volcengineArkAdapter: ModelProviderAdapter = {
  kind: 'volcengine-ark',

  async assertAuth(provider) {
    if (!provider.apiKey.trim()) throw new Error('请先填写 API Key')
    const client = createProviderHttpClient(provider)
    try {
      await client.get('/models', { timeout: 20_000 })
    } catch (err) {
      const status = axios.isAxiosError(err) ? err.response?.status : undefined
      const raw = await readHttpError(err)
      if (isAuthFailure(status, raw)) {
        throw new Error(formatAuthError(`API Key 无效，已禁止拉取模型：${raw}`, provider))
      }
      throw new Error(`连接测试失败：${formatAuthError(raw, provider)}`)
    }
  },

  async fetchCatalog(provider, modality) {
    // 声音：不拉取模型，仅设置页手填已购 speaker_id
    if (modality === 'audio') {
      return []
    }

    const client = createProviderHttpClient(provider)
    try {
      const { data } = await client.get<{
        data?: Array<{ id?: string; name?: string; object?: string; owned_by?: string }>
      }>('/models')
      const rows = data.data ?? []
      return rows
        .filter((m) => m.id)
        .map((m) => {
          const id = String(m.id)
          const name = (m.name && String(m.name)) || id
          const capabilities =
            resolveVolcengineArkModelCapabilities(id, name, modality) ?? undefined
          return {
            id,
            name,
            description: m.owned_by ? `owned_by: ${m.owned_by}` : undefined,
            modality: classifyVolcengineArkModelModality({ id, name }),
            ...(capabilities ? { capabilities } : {})
          }
        })
        .filter((m) => m.modality === modality)
    } catch (err) {
      throw new Error(`拉取火山方舟模型列表失败: ${await readHttpError(err)}`)
    }
  },

  generateText(
    provider: ModelProviderInstance,
    modelId: string,
    input: GenerateTextInput
  ): Promise<GenerateTextResult> {
    return generateOpenAiCompatibleText(provider, modelId, input)
  },

  async generateImage(
    provider: ModelProviderInstance,
    modelId: string,
    input: GenerateImageInput
  ): Promise<GenerateImageResult> {
    const client = createProviderHttpClient(provider, LONG_GENERATE_TIMEOUT_MS)
    const body: Record<string, unknown> = {
      model: modelId,
      // Seedream 用「图n」对齐 image[]；应用内统一 @n，此处转换
      prompt: rewriteAtMentionsForVolcengineArkImagePrompt(input.prompt),
      response_format: 'url',
      watermark: false
    }
    if (input.n && input.n >= 1) body.n = Math.floor(input.n)
    if (input.resolution?.trim()) body.size = input.resolution.trim()
    else if (input.aspectRatio?.trim()) body.size = input.aspectRatio.trim()
    if (input.inputReferences?.length) {
      const refs = input.inputReferences.map((url) => url.trim()).filter(Boolean)
      body.image = refs.length === 1 ? refs[0] : refs
    }

    try {
      const { data } = await client.post<{
        data?: Array<{ b64_json?: string; url?: string }>
        model?: string
      }>('/images/generations', body)

      const images = (data.data ?? [])
        .map((row) => {
          if (row.b64_json) return `data:image/png;base64,${row.b64_json}`
          if (row.url) return row.url
          return ''
        })
        .filter(Boolean)

      if (!images.length) throw new Error('模型未返回图片')
      return { images, model: data.model ?? modelId }
    } catch (err) {
      throw new Error(`图片生成失败: ${formatAuthError(await readHttpError(err), provider)}`)
    }
  },

  async submitVideo(
    provider: ModelProviderInstance,
    modelId: string,
    input: GenerateVideoInput
  ): Promise<GenerateVideoJob> {
    const client = createProviderHttpClient(provider)
    const content = buildVolcengineArkVideoContent(input)

    const body: Record<string, unknown> = {
      model: modelId,
      content,
      watermark: false
    }
    if (input.duration != null) body.duration = Math.round(input.duration)
    if (input.resolution) body.resolution = input.resolution
    if (input.aspectRatio) body.ratio = input.aspectRatio
    if (input.generateAudio != null) body.generate_audio = input.generateAudio
    if (input.seed != null) body.seed = input.seed

    try {
      const { data } = await client.post<{ id?: string; status?: string }>(
        '/contents/generations/tasks',
        body
      )
      if (!data?.id) throw new Error('未返回视频任务 id')
      return {
        jobId: data.id,
        pollingUrl: `${trimBaseUrl(provider.baseUrl)}/contents/generations/tasks/${data.id}`,
        status: data.status ?? 'queued',
        model: modelId
      }
    } catch (err) {
      throw new Error(`提交视频生成失败: ${formatAuthError(await readHttpError(err), provider)}`)
    }
  },

  async pollVideo(
    provider: ModelProviderInstance,
    job: { jobId: string; pollingUrl: string }
  ): Promise<VideoPollResult> {
    const client = createProviderHttpClient(provider)
    try {
      const path = job.pollingUrl.startsWith('http')
        ? job.pollingUrl
        : `/contents/generations/tasks/${job.jobId}`
      const { data } = await client.get<{
        status?: string
        error?: string | { message?: string; code?: string }
        content?: { video_url?: string } | Array<{ type?: string; video_url?: string }>
      }>(path)

      const raw = (data.status ?? 'queued').toLowerCase()
      let status: VideoPollResult['status'] = 'pending'
      if (raw === 'running' || raw === 'processing' || raw === 'in_progress') status = 'in_progress'
      else if (raw === 'succeeded' || raw === 'success' || raw === 'completed') status = 'completed'
      else if (raw === 'failed' || raw === 'expired' || raw === 'cancelled' || raw === 'canceled') {
        status = 'failed'
      } else if (raw === 'queued' || raw === 'pending') status = 'pending'

      const error =
        typeof data.error === 'string'
          ? data.error
          : data.error && typeof data.error === 'object'
            ? data.error.message
            : undefined

      let downloadUrl: string | undefined
      if (data.content && !Array.isArray(data.content)) {
        downloadUrl = data.content.video_url
      } else if (Array.isArray(data.content)) {
        downloadUrl = data.content.find((item) => item.video_url)?.video_url
      }

      let progress = 15
      if (status === 'in_progress') progress = 55
      if (status === 'completed' || status === 'failed') progress = 100

      return { status, progress, error, downloadUrl }
    } catch (err) {
      throw new Error(`轮询视频任务失败: ${formatAuthError(await readHttpError(err), provider)}`)
    }
  },

  /**
   * 豆包 openspeech 声音设计（voice_design）；speaker_id 为设置中手填的已购声音。
   */
  generateSpeech(
    provider: ModelProviderInstance,
    modelId: string,
    input: GenerateSpeechInput
  ): Promise<GenerateSpeechResult> {
    return generateVolcengineOpenspeechSpeech(provider, modelId, input)
  }
}
