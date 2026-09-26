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
import { tripoMeshOps } from './meshOps'

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

/** v3 生成的默认模型版本 */
const TRIPO_MODEL_VERSION = 'v3.1-20260211'

function resolveTripoV3BaseUrl(raw: string | undefined): string {
  let url = (raw || '').trim().replace(/\/+$/, '')
  url = url.replace(/\/v2\/openapi$/i, '').replace(/\/v3$/i, '')
  url = url.replace(
    /^https?:\/\/api\.tripo3d\.(ai|com)/i,
    (_m, tld: string) => `https://openapi.tripo3d.${tld.toLowerCase()}`
  )
  return url || 'https://openapi.tripo3d.ai'
}

function createTripoClient(provider: ModelProviderInstance, timeoutMs = 120_000) {
  return createProviderHttpClient(
    { ...provider, baseUrl: resolveTripoV3BaseUrl(provider.baseUrl) },
    timeoutMs
  )
}

function mapTaskStatus(raw: string | undefined): VideoPollResult['status'] {
  const s = (raw ?? '').toLowerCase()
  if (s === 'success' || s === 'succeeded' || s === 'completed') return 'completed'
  if (
    s === 'failed' ||
    s === 'error' ||
    s === 'cancelled' ||
    s === 'canceled' ||
    s === 'banned' ||
    s === 'expired'
  ) {
    return 'failed'
  }
  if (s === 'running' || s === 'processing' || s === 'in_progress') return 'in_progress'
  return 'pending'
}

/**
 * Tripo 3D 模型生成（仅几何）。骨骼蒙皮请用 `model.rigSkin` → `/v3/animations/rig`。
 * 网格加工（拆分 / 补全 / 重拓扑 / 绑骨检查 / 重定向 / 转换 / 贴图）的协议在 `./meshOps`。
 */
export const tripoAdapter: ModelProviderAdapter = {
  kind: 'tripo',
  meshOps: tripoMeshOps,

  async assertAuth(provider) {
    const client = createTripoClient(provider)
    try {
      await client.get('/v3/account/balance', { timeout: 15_000 })
    } catch (err) {
      throw fail(PROVIDER_ERRORS.connectionTestFailed, { detail: await readHttpError(err) })
    }
  },

  async fetchCatalog(_provider, modality: ModelModality): Promise<CatalogModel[]> {
    if (modality !== 'model3d') return []
    return [
      {
        id: 'tripo-3d-v1',
        name: 'Tripo 3D',
        modality: 'model3d',
        description: 'Tripo 3D 模型生成 v3.1（文本/图片/多图）'
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
    const client = createTripoClient(provider)
    const refs = (input.inputReferences ?? [])
      .map((r) => (typeof r === 'string' ? r.trim() : r.url?.trim()))
      .filter(Boolean)

    let path: string
    const body: Record<string, unknown> = { model: TRIPO_MODEL_VERSION }

    if (refs.length > 1) {
      const views = ['front', 'left', 'back', 'right'] as const
      body.inputs = refs.slice(0, 4).map((url, i) => ({ [views[i]]: url }))
      path = '/v3/generation/multiview-to-model'
    } else if (refs.length === 1) {
      body.input = refs[0]
      path = '/v3/generation/image-to-model'
    } else {
      body.prompt = input.prompt?.trim() ?? ''
      path = '/v3/generation/text-to-model'
    }

    try {
      const { data } = await client.post<{ data?: { task_id?: string } }>(path, body)
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
    const client = createTripoClient(provider)
    const taskId = job.pollingUrl || job.jobId

    try {
      const { data } = await client.get<{
        data?: {
          status?: string
          progress?: number
          output?: { model_url?: string; base_model_url?: string; pbr_model_url?: string }
        }
      }>(`/v3/tasks/${taskId}`)

      const taskData = data?.data
      const status = mapTaskStatus(taskData?.status)

      if (status === 'completed') {
        const output = taskData?.output
        const downloadUrl =
          output?.pbr_model_url?.trim() ||
          output?.model_url?.trim() ||
          output?.base_model_url?.trim()
        return { status: 'completed', progress: 100, downloadUrl }
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
