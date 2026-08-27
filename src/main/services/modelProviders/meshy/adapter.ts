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
import { PROVIDER_ERRORS } from '../catalog'
import { fail, defErr, defErrSimple } from '@shared/errors/appError'
import { createProviderHttpClient, readHttpError } from '../http'

// ── 本文件错误条目（catalog 未覆盖的个性文案）──
const E_MESHY_NO_TEXT = defErrSimple(
  'provider.meshy.unsupportedText',
  'Meshy 不支持文本生成',
  'Meshy does not support text generation'
)
const E_MESHY_NO_TASK_ID = defErrSimple(
  'provider.meshy.noTaskId',
  'Meshy 未返回任务 id',
  'Meshy returned no task id'
)
const E_MESHY_SUBMIT_FAILED = defErr<{ detail: string }>(
  'provider.meshy.submitFailed',
  ({ detail }) => `提交 Meshy 3D 生成失败: ${detail}`,
  ({ detail }) => `Failed to submit Meshy 3D generation: ${detail}`
)
const E_MESHY_POLL_FAILED = defErr<{ detail: string }>(
  'provider.meshy.pollFailed',
  ({ detail }) => `轮询 Meshy 3D 生成失败: ${detail}`,
  ({ detail }) => `Failed to poll Meshy 3D generation: ${detail}`
)
const E_MESHY_GEN_FAILED = defErrSimple(
  'provider.meshy.generationFailed',
  'Meshy 3D 生成失败',
  'Meshy 3D generation failed'
)

/**
 * Meshy 3D 模型生成适配器
 *
 * API 文档: https://docs.meshy.ai/
 * 使用异步 submit → poll 模式：
 *   - POST /v2/text-to-3d 文生3D
 *   - POST /v2/image-to-3d 图生3D
 *   - POST /v2/multi-image-to-3d 多图生3D
 *   - GET /v2/text-to-3d/{id} 轮询状态
 *   - GET /v2/image-to-3d/{id} 轮询状态
 *   - 完成时下载 GLB 文件
 */
function mapTaskStatus(raw: string | undefined): VideoPollResult['status'] {
  const s = (raw ?? '').toLowerCase()
  if (s === 'success' || s === 'succeeded' || s === 'completed' || s === 'done') return 'completed'
  if (s === 'failed' || s === 'error' || s === 'cancelled') return 'failed'
  if (s === 'running' || s === 'processing' || s === 'in_progress' || s === 'inprogress') return 'in_progress'
  return 'pending'
}

export const meshyAdapter: ModelProviderAdapter = {
  kind: 'meshy',

  async assertAuth(provider) {
    const client = createProviderHttpClient(provider)
    try {
      await client.get('/v2/text-to-3d', {
        params: { page_num: 1, page_size: 1 },
        timeout: 15_000
      })
    } catch (err) {
      throw fail(PROVIDER_ERRORS.connectionTestFailed, { detail: await readHttpError(err) })
    }
  },

  async fetchCatalog(_provider, modality: ModelModality): Promise<CatalogModel[]> {
    if (modality !== 'model3d') return []
    // Meshy 目前使用固定模型
    return [
      {
        id: 'meshy-3d-v2',
        name: 'Meshy 3D v2',
        modality: 'model3d',
        description: 'Meshy 3D 模型生成（文本/图片/多图）'
      }
    ]
  },

  generateText(
    _provider: ModelProviderInstance,
    _modelId: string,
    _input: GenerateTextInput
  ): Promise<GenerateTextResult> {
    throw fail(E_MESHY_NO_TEXT)
  },

  generateImage(
    _provider: ModelProviderInstance,
    _modelId: string,
    _input: GenerateImageInput
  ): Promise<GenerateImageResult> {
    throw fail(PROVIDER_ERRORS.unsupportedModality, {
      kind: 'image',
      name: { zh: 'Meshy', en: 'Meshy' }
    })
  },

  async submitVideo(
    _provider: ModelProviderInstance,
    _modelId: string,
    _input: GenerateVideoInput
  ): Promise<GenerateVideoJob> {
    throw fail(PROVIDER_ERRORS.unsupportedModality, {
      kind: 'video',
      name: { zh: 'Meshy', en: 'Meshy' }
    })
  },

  async pollVideo(
    _provider: ModelProviderInstance,
    _job: { jobId: string; pollingUrl: string }
  ): Promise<VideoPollResult> {
    throw fail(PROVIDER_ERRORS.unsupportedModality, {
      kind: 'video',
      name: { zh: 'Meshy', en: 'Meshy' }
    })
  },

  generateSpeech(
    _provider: ModelProviderInstance,
    _modelId: string,
    _input: GenerateSpeechInput
  ): Promise<GenerateSpeechResult> {
    throw fail(PROVIDER_ERRORS.unsupportedModality, {
      kind: 'speech',
      name: { zh: 'Meshy', en: 'Meshy' }
    })
  },

  async submitModel3d(
    provider: ModelProviderInstance,
    modelId: string,
    input: GenerateModel3dInput
  ): Promise<GenerateModel3dJob> {
    const client = createProviderHttpClient(provider)
    const refs = (input.inputReferences ?? [])
      .map((r) => (typeof r === 'string' ? r.trim() : r.url?.trim()))
      .filter(Boolean)

    const hasImages = refs.length > 0

    try {
      if (hasImages && refs.length > 1) {
        // 多图生3D
        const { data } = await client.post<{ result?: { id?: string } }>(
          '/v2/multi-image-to-3d',
          { images: refs }
        )
        const taskId = data?.result?.id
        if (!taskId) throw fail(E_MESHY_NO_TASK_ID)
        return {
          jobId: taskId,
          pollingUrl: `multi-image-to-3d::${taskId}`,
          status: 'submitted',
          model: modelId
        }
      }

      if (hasImages) {
        // 图生3D
        const { data } = await client.post<{ result?: { id?: string } }>(
          '/v2/image-to-3d',
          {
            image_url: refs[0],
            prompt: input.prompt?.trim() || undefined
          }
        )
        const taskId = data?.result?.id
        if (!taskId) throw fail(E_MESHY_NO_TASK_ID)
        return {
          jobId: taskId,
          pollingUrl: `image-to-3d::${taskId}`,
          status: 'submitted',
          model: modelId
        }
      }

      // 文生3D
      const { data } = await client.post<{ result?: { id?: string } }>(
        '/v2/text-to-3d',
        {
          prompt: input.prompt?.trim() || '',
          ...(input.name ? { name: input.name } : {})
        }
      )
      const taskId = data?.result?.id
      if (!taskId) throw fail(E_MESHY_NO_TASK_ID)
      return {
        jobId: taskId,
        pollingUrl: `text-to-3d::${taskId}`,
        status: 'submitted',
        model: modelId
      }
    } catch (err) {
      throw fail(E_MESHY_SUBMIT_FAILED, { detail: await readHttpError(err) })
    }
  },

  async pollModel3d(
    provider: ModelProviderInstance,
    job: { jobId: string; pollingUrl: string }
  ): Promise<VideoPollResult> {
    const client = createProviderHttpClient(provider)
    // pollingUrl 携带任务类型前缀，避免轮询时在多个端点间猜测
    const raw = job.pollingUrl || job.jobId
    const [endpoint, taskId] = raw.includes('::')
      ? (raw.split('::') as [string, string])
      : ['text-to-3d', raw]

    try {
      const { data } = await client.get<{
        status?: string
        progress?: number
        model_urls?: { glb?: string }
        error?: { message?: string }
      }>(`/v2/${endpoint}/${taskId}`)

      const status = mapTaskStatus(data.status)

      if (status === 'completed') {
        return {
          status: 'completed',
          progress: 100,
          downloadUrl: data.model_urls?.glb?.trim()
        }
      }

      if (status === 'failed') {
        return {
          status: 'failed',
          progress: 100,
          error: data.error?.message || fail(E_MESHY_GEN_FAILED).message
        }
      }

      const progress = data.progress ?? (status === 'in_progress' ? 55 : 15)
      return { status, progress }
    } catch (err) {
      throw fail(E_MESHY_POLL_FAILED, { detail: await readHttpError(err) })
    }
  }
}