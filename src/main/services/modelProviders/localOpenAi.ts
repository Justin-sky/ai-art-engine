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
  ModelProviderInstance,
  ModelProviderKind
} from '@shared/modelProvider'
import type { ModelProviderAdapter, VideoPollResult } from './types'
import {
  createProviderHttpClient,
  formatAuthError,
  isAuthFailure,
  LONG_GENERATE_TIMEOUT_MS,
  trimBaseUrl,
  readHttpError
} from './http'
import { generateOpenAiCompatibleText } from './openaiCompat'
import {
  resolveVllmVideoDuration,
  resolveVllmVideoSize
} from '@shared/modelProviders/vllm/videoParams'
import { resolveVllmModelCapabilities } from '@shared/modelProviders/vllm/modelCapabilities'

function notSupported(displayName: string, feature: string): Promise<never> {
  return Promise.reject(
    new Error(`${displayName} 本地服务暂未接入${feature}，当前仅支持文本（多模态理解可在文本节点传图）`)
  )
}

function mediaDataUrlToBlob(ref: string): { blob: Blob; filename: string } {
  const m = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(ref.trim())
  if (!m) throw new Error('无法解析参考媒体 data URL')
  const mime = m[1] || 'image/png'
  const payload = m[3] ?? ''
  const buf = m[2]
    ? Buffer.from(payload, 'base64')
    : Buffer.from(decodeURIComponent(payload), 'utf8')
  const ext = mime.includes('jpeg') || mime.includes('jpg')
    ? 'jpg'
    : mime.includes('video')
      ? 'mp4'
      : 'png'
  return {
    blob: new Blob([new Uint8Array(buf)], { type: mime }),
    filename: `reference-${Date.now()}.${ext}`
  }
}

/**
 * 收集 vLLM-Omni 参考素材：首帧图（first_frame）与 inputReferences 中的图/视频/音频。
 * vLLM-Omni 不允许图片与视频参考同时使用；各类型取第一个。
 */
function pickVllmVideoReferences(input: GenerateVideoInput): {
  image?: string
  video?: string
  audio?: string
} {
  const refs = input.inputReferences ?? []
  let image: string | undefined
  let video: string | undefined
  let audio: string | undefined
  for (const ref of refs) {
    const url = (typeof ref === 'string' ? ref : ref.url).trim()
    if (!url) continue
    const kind = typeof ref === 'string' ? 'image_url' : ref.kind
    if (kind === 'image_url') image = image ?? url
    else if (kind === 'video_url') video = video ?? url
    else if (kind === 'audio_url') audio = audio ?? url
  }
  const firstFrame = input.firstFrameImageUrl?.trim()
  if (firstFrame) image = image ?? firstFrame
  if (image && video) {
    throw new Error('vLLM 视频生成暂不支持图片与视频参考同时使用，请只连接其中一种')
  }
  return { image, video, audio }
}

type LocalOpenAiAdapterOptions = {
  /** vLLM-Omni 支持异步视频生成（Ollama / LM Studio 不支持） */
  video?: boolean
}

/**
 * 本地 OpenAI 兼容推理服务适配器工厂（vLLM / Ollama / LM Studio）。
 * 与云端提供商不同：允许空 API Key、/models 全量返回；vLLM 额外支持视频生成。
 */
export function createLocalOpenAiAdapter(
  kind: ModelProviderKind,
  displayName: string,
  options: LocalOpenAiAdapterOptions = {}
): ModelProviderAdapter {
  const videoEnabled = options.video === true
  return {
    kind,

    async assertAuth(provider) {
      const client = createProviderHttpClient(provider)
      try {
        await client.get('/models', { timeout: 15_000 })
      } catch (err) {
        const status = axios.isAxiosError(err) ? err.response?.status : undefined
        const raw = await readHttpError(err)
        if (status === 404) return
        if (isAuthFailure(status, raw)) {
          throw new Error(formatAuthError(`服务拒绝了请求（可能要求 API Key）: ${raw}`, provider))
        }
        throw new Error(
          `无法连接本地 ${displayName} 服务（${provider.baseUrl}），请确认服务已启动且地址正确`
        )
      }
    },

    async fetchCatalog(provider, modality) {
      const supportsVideo = videoEnabled && modality === 'video'
      if (modality !== 'text' && !supportsVideo) return []
      const client = createProviderHttpClient(provider)
      try {
        const { data } = await client.get<{ data?: Array<{ id?: string }> }>('/models')
        const rows = (data.data ?? [])
          .map((m) => String(m.id ?? '').trim())
          .filter(Boolean)
          .map((id) => ({
            id,
            name: id,
            modality,
            ...(supportsVideo
              ? { capabilities: resolveVllmModelCapabilities(id, 'video') ?? undefined }
              : {})
          }))
        if (supportsVideo && !rows.length) return []
        return rows
      } catch (err) {
        // vLLM-Omni 的 /models 偶尔只列对话模型；视频目录回退为空，可手动填写模型 id
        if (supportsVideo) return []
        throw new Error(`拉取 ${displayName} 模型列表失败: ${await readHttpError(err)}`)
      }
    },

    generateText(
      provider: ModelProviderInstance,
      modelId: string,
      input: GenerateTextInput
    ): Promise<GenerateTextResult> {
      return generateOpenAiCompatibleText(provider, modelId, input)
    },

    generateImage(
      _provider: ModelProviderInstance,
      _modelId: string,
      _input: GenerateImageInput
    ): Promise<GenerateImageResult> {
      return notSupported(displayName, '图片生成')
    },

    async submitVideo(
      provider: ModelProviderInstance,
      modelId: string,
      input: GenerateVideoInput
    ): Promise<GenerateVideoJob> {
      if (!videoEnabled) return notSupported(displayName, '视频生成')
      const client = createProviderHttpClient(provider, LONG_GENERATE_TIMEOUT_MS)
      const form = new FormData()
      form.append('prompt', input.prompt)
      form.append('model', modelId)
      const seconds = resolveVllmVideoDuration(input.duration)
      if (seconds) form.append('seconds', seconds)
      const size = resolveVllmVideoSize(input.resolution, input.aspectRatio)
      if (size) {
        form.append('width', String(size.width))
        form.append('height', String(size.height))
      }
      if (input.generateAudio === true) form.append('generate_sound', 'true')
      if (input.seed != null) form.append('seed', String(input.seed))

      const refs = pickVllmVideoReferences(input)
      if (refs.image) {
        if (refs.image.startsWith('data:')) {
          const { blob, filename } = mediaDataUrlToBlob(refs.image)
          form.append('input_reference', blob, filename)
        } else {
          form.append('image_reference', JSON.stringify({ image_url: refs.image }))
        }
      }
      if (refs.video) {
        form.append('video_reference', JSON.stringify({ video_url: refs.video }))
      }
      if (refs.audio) {
        form.append('audio_reference', JSON.stringify({ audio_url: refs.audio }))
      }

      try {
        const { data } = await client.post<{ id?: string; status?: string }>('/videos', form, {
          headers: { 'Content-Type': undefined }
        })
        if (!data?.id) throw new Error('vLLM 未返回视频任务 id')
        return {
          jobId: data.id,
          pollingUrl: `${trimBaseUrl(provider.baseUrl)}/videos/${data.id}`,
          status: data.status ?? 'queued',
          model: modelId
        }
      } catch (err) {
        throw new Error(`提交 vLLM 视频生成失败: ${await readHttpError(err)}`)
      }
    },

    async pollVideo(
      provider: ModelProviderInstance,
      job: { jobId: string; pollingUrl: string }
    ): Promise<VideoPollResult> {
      if (!videoEnabled) return notSupported(displayName, '视频生成')
      const client = createProviderHttpClient(provider)
      try {
        const { data } = await client.get<{
          status?: string
          error?: string | { message?: string }
        }>(job.pollingUrl.startsWith('http') ? job.pollingUrl : `/videos/${job.jobId}`)
        const raw = String(data.status ?? 'queued').toLowerCase()
        let status: VideoPollResult['status'] = 'pending'
        if (raw === 'running' || raw === 'processing' || raw === 'in_progress') {
          status = 'in_progress'
        } else if (raw === 'completed' || raw === 'succeeded' || raw === 'success') {
          status = 'completed'
        } else if (
          raw === 'failed' ||
          raw === 'cancelled' ||
          raw === 'canceled' ||
          raw === 'expired'
        ) {
          status = 'failed'
        }
        const error =
          typeof data.error === 'string'
            ? data.error
            : data.error && typeof data.error === 'object'
              ? data.error.message
              : undefined
        let progress = 15
        if (status === 'in_progress') progress = 55
        if (status === 'completed' || status === 'failed') progress = 100
        return {
          status,
          progress,
          error,
          downloadUrl: status === 'completed' ? `/videos/${job.jobId}/content` : undefined
        }
      } catch (err) {
        throw new Error(`轮询 vLLM 视频任务失败: ${await readHttpError(err)}`)
      }
    },

    generateSpeech(
      _provider: ModelProviderInstance,
      _modelId: string,
      _input: GenerateSpeechInput
    ): Promise<GenerateSpeechResult> {
      return notSupported(displayName, '语音合成')
    }
  }
}

export const vllmAdapter = createLocalOpenAiAdapter('vllm', 'vLLM', { video: true })
export const ollamaAdapter = createLocalOpenAiAdapter('ollama', 'Ollama')
export const lmStudioAdapter = createLocalOpenAiAdapter('lmstudio', 'LM Studio')
