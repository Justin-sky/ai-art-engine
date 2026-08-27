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
const E_TRIPO_NO_TEXT = defErrSimple(
  'provider.tripo.unsupportedText',
  'Tripo 不支持文本生成',
  'Tripo does not support text generation'
)
const E_TRIPO_NO_TASK_ID = defErrSimple(
  'provider.tripo.noTaskId',
  'Tripo 未返回任务 id',
  'Tripo returned no task id'
)
const E_TRIPO_SUBMIT_FAILED = defErr<{ detail: string }>(
  'provider.tripo.submitFailed',
  ({ detail }) => `提交 Tripo 3D 生成失败: ${detail}`,
  ({ detail }) => `Failed to submit Tripo 3D generation: ${detail}`
)
const E_TRIPO_POLL_FAILED = defErr<{ detail: string }>(
  'provider.tripo.pollFailed',
  ({ detail }) => `轮询 Tripo 3D 生成失败: ${detail}`,
  ({ detail }) => `Failed to poll Tripo 3D generation: ${detail}`
)
const E_TRIPO_GEN_FAILED = defErrSimple(
  'provider.tripo.generationFailed',
  'Tripo 3D 生成失败',
  'Tripo 3D generation failed'
)

/**
 * Tripo 3D 模型生成适配器
 *
 * API 文档: https://platform.tripo3d.ai/en/docs/api-reference
 * 使用异步 submit → poll 模式：
 *   - POST /v2/openapi/task 创建任务
 *   - GET /v2/openapi/task/{taskId} 轮询任务状态
 *   - 完成时下载 GLB 文件
 */
function mapTaskStatus(raw: string | undefined): VideoPollResult['status'] {
  const s = (raw ?? '').toLowerCase()
  if (s === 'success' || s === 'succeeded' || s === 'completed') return 'completed'
  if (s === 'failed' || s === 'error' || s === 'cancelled') return 'failed'
  if (s === 'running' || s === 'processing' || s === 'in_progress') return 'in_progress'
  return 'pending'
}

export const tripoAdapter: ModelProviderAdapter = {
  kind: 'tripo',

  async assertAuth(provider) {
    const client = createProviderHttpClient(provider)
    try {
      await client.get('/v2/openapi/user', { timeout: 15_000 })
    } catch (err) {
      throw fail(PROVIDER_ERRORS.connectionTestFailed, { detail: await readHttpError(err) })
    }
  },

  async fetchCatalog(_provider, modality: ModelModality): Promise<CatalogModel[]> {
    if (modality !== 'model3d') return []
    // Tripo 目前使用固定模型，无需拉取目录
    return [
      {
        id: 'tripo-3d-v1',
        name: 'Tripo 3D v1',
        modality: 'model3d',
        description: 'Tripo 3D 模型生成（文本/图片/多图）'
      }
    ]
  },

  generateText(
    _provider: ModelProviderInstance,
    _modelId: string,
    _input: GenerateTextInput
  ): Promise<GenerateTextResult> {
    throw fail(E_TRIPO_NO_TEXT)
  },

  generateImage(
    _provider: ModelProviderInstance,
    _modelId: string,
    _input: GenerateImageInput
  ): Promise<GenerateImageResult> {
    throw fail(PROVIDER_ERRORS.unsupportedModality, {
      kind: 'image',
      name: { zh: 'Tripo', en: 'Tripo' }
    })
  },

  async submitVideo(
    _provider: ModelProviderInstance,
    _modelId: string,
    _input: GenerateVideoInput
  ): Promise<GenerateVideoJob> {
    throw fail(PROVIDER_ERRORS.unsupportedModality, {
      kind: 'video',
      name: { zh: 'Tripo', en: 'Tripo' }
    })
  },

  async pollVideo(
    _provider: ModelProviderInstance,
    _job: { jobId: string; pollingUrl: string }
  ): Promise<VideoPollResult> {
    throw fail(PROVIDER_ERRORS.unsupportedModality, {
      kind: 'video',
      name: { zh: 'Tripo', en: 'Tripo' }
    })
  },

  generateSpeech(
    _provider: ModelProviderInstance,
    _modelId: string,
    _input: GenerateSpeechInput
  ): Promise<GenerateSpeechResult> {
    throw fail(PROVIDER_ERRORS.unsupportedModality, {
      kind: 'speech',
      name: { zh: 'Tripo', en: 'Tripo' }
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

    const body: Record<string, unknown> = {
      type: refs.length > 0 ? 'image_to_model' : 'text_to_model'
    }

    if (refs.length > 0) {
      // Tripo 支持多图：image_url 可以是数组
      body.image_url = refs.length === 1 ? refs[0] : refs
    }
    if (input.prompt?.trim()) {
      body.prompt = input.prompt.trim()
    }

    try {
      const { data } = await client.post<{ data?: { task_id?: string } }>(
        '/v2/openapi/task',
        body
      )
      const taskId = data?.data?.task_id
      if (!taskId) throw fail(E_TRIPO_NO_TASK_ID)
      return {
        jobId: taskId,
        pollingUrl: taskId,
        status: 'submitted',
        model: modelId
      }
    } catch (err) {
      throw fail(E_TRIPO_SUBMIT_FAILED, { detail: await readHttpError(err) })
    }
  },

  async pollModel3d(
    provider: ModelProviderInstance,
    job: { jobId: string; pollingUrl: string }
  ): Promise<VideoPollResult> {
    const client = createProviderHttpClient(provider)
    const taskId = job.pollingUrl || job.jobId

    try {
      const { data } = await client.get<{
        data?: {
          status?: string
          progress?: number
          model?: { draft?: string }
        }
      }>(`/v2/openapi/task/${taskId}`)

      const taskData = data?.data
      const status = mapTaskStatus(taskData?.status)

      if (status === 'completed') {
        const downloadUrl = taskData?.model?.draft?.trim()
        return {
          status: 'completed',
          progress: 100,
          downloadUrl
        }
      }

      if (status === 'failed') {
        return { status: 'failed', progress: 100, error: fail(E_TRIPO_GEN_FAILED).message }
      }

      const progress = taskData?.progress ?? (status === 'in_progress' ? 55 : 15)
      return { status, progress }
    } catch (err) {
      throw fail(E_TRIPO_POLL_FAILED, { detail: await readHttpError(err) })
    }
  }
}