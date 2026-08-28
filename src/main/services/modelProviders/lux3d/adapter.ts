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
import { fail, defErr, defErrSimple } from '@shared/errors/appError'
import {
  createLux3dHttpClient,
  lux3dPathPrefix,
  readLux3dHttpError,
  type Lux3dEnvelope
} from './http'

// ── 本文件错误条目（catalog 未覆盖的个性文案）──
const E_LUX3D_CONNECTION_TEST_FAILED = defErr<{ detail: string }>(
  'provider.lux3d.connectionTestFailed',
  ({ detail }) => `Lux3D 连接测试失败: ${detail}`,
  ({ detail }) => `Lux3D connection test failed: ${detail}`
)
const E_LUX3D_TEXT_UNSUPPORTED = defErrSimple(
  'provider.lux3d.textUnsupported',
  'Lux3D 不支持文本生成',
  'Lux3D does not support text generation'
)
const E_LUX3D_IMAGE_UNSUPPORTED = defErrSimple(
  'provider.lux3d.imageUnsupported',
  'Lux3D 不支持图片生成',
  'Lux3D does not support image generation'
)
const E_LUX3D_VIDEO_UNSUPPORTED = defErrSimple(
  'provider.lux3d.videoUnsupported',
  'Lux3D 不支持视频生成',
  'Lux3D does not support video generation'
)
const E_LUX3D_SPEECH_UNSUPPORTED = defErrSimple(
  'provider.lux3d.speechUnsupported',
  'Lux3D 不支持语音合成',
  'Lux3D does not support speech synthesis'
)
const E_LUX3D_NO_TASK_ID = defErrSimple(
  'provider.lux3d.noTaskId',
  'Lux3D 未返回生成任务 id',
  'Lux3D returned no generation task id'
)
/** 上游响应原文作为 detail 原样嵌入 */
const E_LUX3D_SUBMIT_3D_FAILED = defErr<{ detail: string }>(
  'provider.lux3d.submitModel3dFailed',
  ({ detail }) => `提交 Lux3D 3D 生成失败: ${detail}`,
  ({ detail }) => `Submitting Lux3D 3D generation failed: ${detail}`
)
const E_LUX3D_POLL_3D_FAILED = defErr<{ detail: string }>(
  'provider.lux3d.pollModel3dFailed',
  ({ detail }) => `轮询 Lux3D 3D 生成失败: ${detail}`,
  ({ detail }) => `Polling Lux3D 3D generation failed: ${detail}`
)
const E_LUX3D_GEN_FAILED = defErrSimple(
  'provider.lux3d.generationFailed',
  'Lux3D 3D 生成失败',
  'Lux3D 3D generation failed'
)
const E_LUX3D_NO_GLB = defErrSimple(
  'provider.lux3d.noGlbOutput',
  'Lux3D 任务已完成但未返回 GLB 模型',
  'Lux3D task finished but returned no GLB model'
)

/**
 * Lux3D（AHOLO 开放平台）3D 模型生成适配器
 *
 * SDK 文档: https://labs.aholo3d.cn/api-docs/sdk/typescript
 * 异步 submit → poll 模式（响应信封 `{ f, c, m, d }`，成功 c === "0"）：
 *   - POST /lux3d/v1/generate/text-to-3d/task/create  文生3D
 *   - POST /lux3d/v1/generate/img-to-3d/task/create   图生3D（img 单图 / imgs 多图，二选一）
 *   - GET  /lux3d/v1/generate/task/get?taskid={id}    轮询状态
 *   - 完成时从 outputs 中取 GLB 下载地址（约 2 小时有效）
 * 任务状态：0-初始化，1-运行中，3-成功，4-失败，6-已取消
 */

/** Lux3dTaskQueryData（OpenAPI TaskQueryData） */
type Lux3dTaskQueryData = {
  taskId?: number
  bizId?: string
  status?: 0 | 1 | 3 | 4 | 6
  outputs?: Array<{ content?: string | null }>
}

function mapLux3dStatus(raw: number | undefined): VideoPollResult['status'] {
  if (raw === 3) return 'completed'
  if (raw === 4 || raw === 6) return 'failed'
  if (raw === 1) return 'in_progress'
  return 'pending'
}

/** 目录模型 id 即 API version：G1（质量优先）/ G1-Turbo（速度优先） */
function resolveVersion(modelId: string): 'G1' | 'G1-Turbo' {
  return modelId.trim().toLowerCase() === 'g1' ? 'G1' : 'G1-Turbo'
}

/** 文生3D 风格枚举（OpenAPI TextTo3dRequest.style，缺省 photorealistic）；图生3D 无该参数 */
const LUX3D_TEXT_TO_3D_STYLES = new Set([
  'photorealistic',
  'cartoon',
  'anime',
  'hand_painted',
  'cyberpunk',
  'fantasy',
  'glass'
])

/** 仅接受合法风格值；未知值忽略走服务端缺省（photorealistic） */
function resolveTextStyle(style: string | undefined): string | undefined {
  const key = style?.trim().toLowerCase()
  return key && LUX3D_TEXT_TO_3D_STYLES.has(key) ? key : undefined
}

/** outputs 中未请求的槽位返回 NOT_REQUESTED；仅认 http(s) 且以 .glb 结尾的结果 */
function pickGlbOutputUrl(outputs: Lux3dTaskQueryData['outputs']): string | undefined {
  const urls = (outputs ?? [])
    .map((o) => (typeof o?.content === 'string' ? o.content.trim() : ''))
    .filter((c) => c && c !== 'NOT_REQUESTED' && /^https?:\/\//i.test(c))
  return urls.find((u) => /\.glb(\?|#|$)/i.test(u))
}

/** 信封失败（c !== "0"）时抛出业务错误；成功时返回 d */
function unwrapLux3dEnvelope<T>(body: Lux3dEnvelope<T>, context: string): T {
  if (body.c !== '0') {
    throw new Error(body.m || `${context} failed (c=${body.c ?? 'unknown'})`)
  }
  if (body.d === undefined || body.d === null) {
    throw new Error(`${context} succeeded but response data is empty`)
  }
  return body.d
}

export const lux3dAdapter: ModelProviderAdapter = {
  kind: 'lux3d',

  async assertAuth(provider) {
    const client = createLux3dHttpClient(provider)
    try {
      // 拉一页任务记录即可验证鉴权（不产生费用）
      const { data } = await client.get<Lux3dEnvelope<unknown>>(
        `${lux3dPathPrefix(provider)}/generate/task/list`,
        { params: { page: 1, pagesize: 1 }, timeout: 15_000 }
      )
      unwrapLux3dEnvelope(data, 'tasks.list')
    } catch (err) {
      throw fail(E_LUX3D_CONNECTION_TEST_FAILED, { detail: await readLux3dHttpError(err) })
    }
  },

  async fetchCatalog(_provider, modality: ModelModality): Promise<CatalogModel[]> {
    if (modality !== 'model3d') return []
    return [
      {
        id: 'G1',
        name: 'Lux3D G1',
        modality: 'model3d',
        description: 'Lux3D G1 3D 模型生成（文本/图片/多图，质量优先）'
      },
      {
        id: 'G1-Turbo',
        name: 'Lux3D G1-Turbo',
        modality: 'model3d',
        description: 'Lux3D G1-Turbo 3D 模型生成（文本/图片，速度优先）'
      }
    ]
  },

  async generateText(
    _provider: ModelProviderInstance,
    _modelId: string,
    _input: GenerateTextInput
  ): Promise<GenerateTextResult> {
    throw fail(E_LUX3D_TEXT_UNSUPPORTED)
  },

  async generateImage(
    _provider: ModelProviderInstance,
    _modelId: string,
    _input: GenerateImageInput
  ): Promise<GenerateImageResult> {
    throw fail(E_LUX3D_IMAGE_UNSUPPORTED)
  },

  async submitVideo(
    _provider: ModelProviderInstance,
    _modelId: string,
    _input: GenerateVideoInput
  ): Promise<GenerateVideoJob> {
    throw fail(E_LUX3D_VIDEO_UNSUPPORTED)
  },

  async pollVideo(
    _provider: ModelProviderInstance,
    _job: { jobId: string; pollingUrl: string }
  ): Promise<VideoPollResult> {
    throw fail(E_LUX3D_VIDEO_UNSUPPORTED)
  },

  async generateSpeech(
    _provider: ModelProviderInstance,
    _modelId: string,
    _input: GenerateSpeechInput
  ): Promise<GenerateSpeechResult> {
    throw fail(E_LUX3D_SPEECH_UNSUPPORTED)
  },

  async submitModel3d(
    provider: ModelProviderInstance,
    modelId: string,
    input: GenerateModel3dInput
  ): Promise<GenerateModel3dJob> {
    const client = createLux3dHttpClient(provider)
    const refs = (input.inputReferences ?? [])
      .map((r) => (typeof r === 'string' ? r.trim() : r.url?.trim()))
      .filter(Boolean)

    const version = resolveVersion(modelId)
    // G1 固定返回 ZIP+GLB；G1-Turbo 按请求返回（缺省仅 ZIP），显式请求 GLB
    const base = { version, outputFormat: ['glb'] as Array<'glb'> }
    // img / imgs 互斥：无参考图走文生3D，单图用 img，多图按顺序用 imgs（首图为主参考）
    const hasRefs = refs.length > 0
    const endpoint = hasRefs
      ? '/generate/img-to-3d/task/create'
      : '/generate/text-to-3d/task/create'
    const body: Record<string, unknown> = hasRefs
      ? refs.length > 1
        ? { ...base, imgs: refs }
        : { ...base, img: refs[0] }
      : { ...base, prompt: input.prompt?.trim() || '', style: resolveTextStyle(input.style) }

    try {
      const { data } = await client.post<Lux3dEnvelope<number>>(
        `${lux3dPathPrefix(provider)}${endpoint}`,
        body
      )
      if (data.c !== '0') {
        throw new Error(data.m || `lux3d.create failed (c=${data.c ?? 'unknown'})`)
      }
      const taskid = data.d
      const taskId = typeof taskid === 'number' || typeof taskid === 'string' ? String(taskid) : ''
      if (!taskId) throw fail(E_LUX3D_NO_TASK_ID)
      return {
        jobId: taskId,
        pollingUrl: taskId,
        status: 'submitted',
        model: modelId
      }
    } catch (err) {
      throw fail(E_LUX3D_SUBMIT_3D_FAILED, { detail: await readLux3dHttpError(err) })
    }
  },

  async pollModel3d(
    provider: ModelProviderInstance,
    job: { jobId: string; pollingUrl: string }
  ): Promise<VideoPollResult> {
    const client = createLux3dHttpClient(provider)
    const taskId = job.pollingUrl || job.jobId

    try {
      const { data } = await client.get<Lux3dEnvelope<Lux3dTaskQueryData>>(
        `${lux3dPathPrefix(provider)}/generate/task/get`,
        { params: { taskid: taskId } }
      )
      const task = unwrapLux3dEnvelope(data, 'tasks.get')
      const status = mapLux3dStatus(task.status)

      if (status === 'completed') {
        const downloadUrl = pickGlbOutputUrl(task.outputs)
        if (!downloadUrl) {
          return { status: 'failed', progress: 100, error: fail(E_LUX3D_NO_GLB).message }
        }
        return { status: 'completed', progress: 100, downloadUrl }
      }

      if (status === 'failed') {
        return {
          status: 'failed',
          progress: 100,
          error: fail(E_LUX3D_GEN_FAILED).message
        }
      }

      const progress = status === 'in_progress' ? 55 : 15
      return { status, progress }
    } catch (err) {
      throw fail(E_LUX3D_POLL_3D_FAILED, { detail: await readLux3dHttpError(err) })
    }
  }
}
