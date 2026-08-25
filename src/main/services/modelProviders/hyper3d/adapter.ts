import axios, { type AxiosInstance } from 'axios'
import type {
  CatalogModel,
  GenerateImageInput,
  GenerateImageResult,
  GenerateModel3dInput,
  GenerateModel3dJob,
  GenerateSpeechInput,
  GenerateSpeechResult,
  GenerateTextInput,
  GenerateTextResult,
  GenerateVideoInput,
  GenerateVideoJob,
  ModelModality,
  ModelProviderInstance
} from '@shared/modelProvider'
import type { ModelProviderAdapter, VideoPollResult } from '../types'
import {
  LONG_GENERATE_TIMEOUT_MS,
  createProviderHttpClient,
  isAuthFailure,
  readHttpError,
  trimBaseUrl
} from '../http'
import { resolveMediaBytesFromUrl } from '../../resolveMediaBytesFromUrl'

/**
 * Rodin（Hyper3D）3D 模型生成适配器
 *
 * API 文档: https://hyper3d.ai/docs（API 网关 https://api.hyper3d.com/api/v2）
 * 异步 submit → poll 模式：
 *   - POST /rodin        文生3D（prompt）或 图生3D（images 文件，multipart/form-data）
 *   - POST /download     轮询/取回结果，body { task_uuid } → { list: [{ url, name }] }
 *   - list[0].url 即 GLB 下载地址
 */
function extFromMime(mime: string): string {
  if (mime.includes('png')) return 'png'
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg'
  if (mime.includes('webp')) return 'webp'
  return 'png'
}

/** multipart 上传用客户端：不预设 JSON Content-Type，交由 axios/undici 生成 boundary */
function createHyper3dFormClient(provider: ModelProviderInstance): AxiosInstance {
  const key = provider.apiKey.trim()
  const headers: Record<string, string> = {}
  if (key) headers.Authorization = `Bearer ${key}`
  return axios.create({
    baseURL: trimBaseUrl(provider.baseUrl),
    timeout: LONG_GENERATE_TIMEOUT_MS,
    headers
  })
}

export const hyper3dAdapter: ModelProviderAdapter = {
  kind: 'hyper3d',

  async assertAuth(provider) {
    const client = createProviderHttpClient(provider)
    try {
      // 无专用健康端点；用 download 以空 task_uuid 探测鉴权。
      // 鉴权失败会返回 401/403；其它响应（如任务不存在）说明密钥已通过网关校验。
      await client.post('/download', { task_uuid: '__auth_check__' }, { timeout: 15_000 })
    } catch (err) {
      if (axios.isAxiosError(err) && !isAuthFailure(err.response?.status, err.message)) {
        return
      }
      throw new Error(`Rodin（Hyper3D）连接测试失败: ${await readHttpError(err)}`)
    }
  },

  async fetchCatalog(_provider, modality: ModelModality): Promise<CatalogModel[]> {
    if (modality !== 'model3d') return []
    // Rodin 目前使用固定模型
    return [
      {
        id: 'rodin-gen-2.5',
        name: 'Rodin Gen 2.5',
        modality: 'model3d',
        description: 'Rodin（Hyper3D）3D 模型生成（文本/图片）'
      }
    ]
  },

  generateText(
    _provider: ModelProviderInstance,
    _modelId: string,
    _input: GenerateTextInput
  ): Promise<GenerateTextResult> {
    throw new Error('Rodin（Hyper3D）不支持文本生成')
  },

  generateImage(
    _provider: ModelProviderInstance,
    _modelId: string,
    _input: GenerateImageInput
  ): Promise<GenerateImageResult> {
    throw new Error('Rodin（Hyper3D）不支持图片生成')
  },

  async submitVideo(
    _provider: ModelProviderInstance,
    _modelId: string,
    _input: GenerateVideoInput
  ): Promise<GenerateVideoJob> {
    throw new Error('Rodin（Hyper3D）不支持视频生成')
  },

  async pollVideo(
    _provider: ModelProviderInstance,
    _job: { jobId: string; pollingUrl: string }
  ): Promise<VideoPollResult> {
    throw new Error('Rodin（Hyper3D）不支持视频生成')
  },

  generateSpeech(
    _provider: ModelProviderInstance,
    _modelId: string,
    _input: GenerateSpeechInput
  ): Promise<GenerateSpeechResult> {
    throw new Error('Rodin（Hyper3D）不支持语音合成')
  },

  async submitModel3d(
    provider: ModelProviderInstance,
    modelId: string,
    input: GenerateModel3dInput
  ): Promise<GenerateModel3dJob> {
    const refs = (input.inputReferences ?? [])
      .map((r) => (typeof r === 'string' ? r.trim() : r.url?.trim()))
      .filter(Boolean)
    const prompt = input.prompt?.trim() || ''

    if (!refs.length && !prompt) throw new Error('Rodin（Hyper3D）需要文本提示或参考图')

    const form = new FormData()
    if (prompt) form.append('prompt', prompt)

    try {
      if (refs.length) {
        // 图生3D：把参考图下载回字节，以 multipart images 文件上传
        for (let i = 0; i < refs.length; i++) {
          const media = await resolveMediaBytesFromUrl(refs[i]!)
          const filename = `ref-${i}.${extFromMime(media.mime)}`
          form.append('images', new Blob([new Uint8Array(media.buf)]), filename)
        }
      }

      const client = createHyper3dFormClient(provider)
      const { data } = await client.post<{ uuid?: string }>('/rodin', form)
      const taskId = data?.uuid
      if (!taskId) throw new Error('Rodin（Hyper3D）未返回任务 uuid')
      return {
        jobId: taskId,
        pollingUrl: taskId,
        status: 'submitted',
        model: modelId
      }
    } catch (err) {
      throw new Error(`提交 Rodin（Hyper3D）3D 生成失败: ${await readHttpError(err)}`)
    }
  },

  async pollModel3d(
    provider: ModelProviderInstance,
    job: { jobId: string; pollingUrl: string }
  ): Promise<VideoPollResult> {
    const client = createProviderHttpClient(provider)
    const taskUuid = job.pollingUrl || job.jobId

    try {
      const { data } = await client.post<{
        status?: string
        list?: Array<{ url?: string; name?: string }>
      }>('/download', { task_uuid: taskUuid })

      const first = data?.list?.[0]
      if (first?.url?.trim()) {
        return { status: 'completed', progress: 100, downloadUrl: first.url.trim() }
      }

      const s = (data?.status ?? '').toLowerCase()
      if (s === 'failed' || s === 'error' || s === 'cancelled') {
        return { status: 'failed', progress: 100, error: 'Rodin（Hyper3D）3D 生成失败' }
      }
      if (s === 'running' || s === 'processing' || s === 'in_progress') {
        return { status: 'in_progress', progress: 55 }
      }
      return { status: 'pending', progress: 20 }
    } catch (err) {
      throw new Error(`轮询 Rodin（Hyper3D）3D 生成失败: ${await readHttpError(err)}`)
    }
  }
}
