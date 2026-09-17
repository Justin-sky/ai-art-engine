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
 * Tripo 3D 模型生成适配器（v3 API）
 *
 * API 文档: https://developers.tripo3d.ai/en/docs/migration-v2-to-v3
 * v3 变化：Base URL 换为 openapi.tripo3d.ai/v3；专用端点替代 type 字段；
 * 响应字段 create_time→created_at、consumed_credit→credits_consumed；output 为 *_url 键名。
 * 使用异步 submit → poll 模式：
 *   - POST /v3/generation/text-to-model       文生 3D
 *   - POST /v3/generation/image-to-model      单图生 3D
 *   - POST /v3/generation/multiview-to-model  多图生 3D
 *   - GET  /v3/tasks/{task_id}                轮询任务状态
 *   - GET  /v3/account/balance                连接测试 / 余额
 */

/** v3 生成的默认模型版本（最新最佳） */
const TRIPO_MODEL_VERSION = 'v3.1-20260211'

/** 老配置 / 自定义地址归一化为 v3 Base URL（不含 /v3 前缀） */
function resolveTripoV3BaseUrl(raw: string | undefined): string {
  let url = (raw || '').trim().replace(/\/+$/, '')
  // 兼容用户直接粘贴的 v2 完整前缀
  url = url.replace(/\/v2\/openapi$/i, '').replace(/\/v3$/i, '')
  // v2 旧域名 → v3 新域名（API Key 两版共用，仅域名不同）
  url = url.replace(/^https?:\/\/api\.tripo3d\.(ai|com)/i, (_m, tld: string) =>
    `https://openapi.tripo3d.${tld.toLowerCase()}`
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
  return 'pending' // queued / unknown
}

export const tripoAdapter: ModelProviderAdapter = {
  kind: 'tripo',

  async assertAuth(provider) {
    const client = createTripoClient(provider)
    try {
      // v3 余额查询：Key 无效返回 401，域名错误返回 404 "Cannot GET ..."
      await client.get('/v3/account/balance', { timeout: 15_000 })
    } catch (err) {
      throw fail(PROVIDER_ERRORS.connectionTestFailed, { detail: await readHttpError(err) })
    }
  },

  async fetchCatalog(_provider, modality: ModelModality): Promise<CatalogModel[]> {
    if (modality !== 'model3d') return []
    // Tripo 使用固定模型版本（TRIPO_MODEL_VERSION），无需拉取目录
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

    // v3 拆分为专用端点，不再使用 type 字段
    let path: string
    const body: Record<string, unknown> = { model: TRIPO_MODEL_VERSION }

    if (refs.length > 1) {
      // 多图 → multiview-to-model：inputs 数组按 front/left/back/right 顺序映射（front 必填，至少 2 张）
      const views = ['front', 'left', 'back', 'right'] as const
      body.inputs = refs.slice(0, 4).map((url, i) => ({ [views[i]]: url }))
      path = '/v3/generation/multiview-to-model'
    } else if (refs.length === 1) {
      // 单图 → image-to-model：input 只接受单个 URL / file_token / task_id
      body.input = refs[0]
      path = '/v3/generation/image-to-model'
    } else {
      // prompt 为 v3 text-to-model 必填字段；为空时由 API 返回明确错误
      body.prompt = input.prompt?.trim() ?? ''
      path = '/v3/generation/text-to-model'
    }
    // rig 骨骼蒙皮透传（上游 6.3.0 新增）：v3 文档未列出的内联字段，Tripo 提交端点对未知参数宽容
    if (input.rig === true) {
      body.rig = true
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
      // v3 任务查询：status / progress / output.model_url（v2 的 create_time→created_at）
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
        // 优先 PBR 模型，其次最终模型 / 白模
        const downloadUrl =
          output?.pbr_model_url?.trim() || output?.model_url?.trim() || output?.base_model_url?.trim()
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
