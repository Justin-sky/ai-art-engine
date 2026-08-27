import axios from 'axios'
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
import { resolveAppErrorLocale, fail, defErr, defErrSimple } from '@shared/errors/appError'
import type { ModelProviderAdapter, VideoPollResult } from '../types'
import { createProviderHttpClient, isAuthFailure, readHttpError } from '../http'

// —— 本地双语文案（中文保持原文不变，英文为新增映射）——
const E_LUMA_CONNECTION_TEST_FAILED = defErr<{ detail: string }>(
  'provider.luma.connectionTestFailed',
  ({ detail }) => `Luma AI 连接测试失败: ${detail}`,
  ({ detail }) => `Luma AI connection test failed: ${detail}`
)
const E_LUMA_TEXT_UNSUPPORTED = defErrSimple(
  'provider.luma.textUnsupported',
  'Luma AI 不支持文本生成',
  'Luma AI does not support text generation'
)
const E_LUMA_IMAGE_UNSUPPORTED = defErrSimple(
  'provider.luma.imageUnsupported',
  'Luma AI 不支持图片生成',
  'Luma AI does not support image generation'
)
const E_LUMA_VIDEO_UNSUPPORTED = defErrSimple(
  'provider.luma.videoUnsupported',
  'Luma AI 不支持视频生成',
  'Luma AI does not support video generation'
)
const E_LUMA_SPEECH_UNSUPPORTED = defErrSimple(
  'provider.luma.speechUnsupported',
  'Luma AI 不支持语音合成',
  'Luma AI does not support speech synthesis'
)
const E_LUMA_PROMPT_OR_REF_REQUIRED = defErrSimple(
  'provider.luma.promptOrReferenceRequired',
  'Luma AI 需要文本提示或参考图',
  'Luma AI requires a text prompt or a reference image'
)
const E_LUMA_NO_TASK_ID = defErrSimple(
  'provider.luma.noTaskId',
  'Luma AI 未返回生成任务 id',
  'Luma AI returned no generation task id'
)
/** 上游响应原文作为 detail 原样嵌入 */
const E_LUMA_SUBMIT_3D_FAILED = defErr<{ detail: string }>(
  'provider.luma.submitModel3dFailed',
  ({ detail }) => `提交 Luma AI 3D 生成失败: ${detail}`,
  ({ detail }) => `Submitting Luma AI 3D generation failed: ${detail}`
)
const E_LUMA_POLL_3D_FAILED = defErr<{ detail: string }>(
  'provider.luma.pollModel3dFailed',
  ({ detail }) => `轮询 Luma AI 3D 生成失败: ${detail}`,
  ({ detail }) => `Polling Luma AI 3D generation failed: ${detail}`
)

/** 非 throw 场景（结果对象的 error 字段）按当前语言取文案 */
function pickLumaBi(zh: string, en: string): string {
  return resolveAppErrorLocale() === 'en-US' ? en : zh
}

/**
 * Luma Genie（Dream Machine）3D 模型生成适配器
 *
 * API 文档: https://docs.lumalabs.ai/
 * 异步 submit → poll 模式：
 *   - POST /generations           文生3D / 图生3D（JSON：prompt + format=glb + sourceArtifactId?）
 *   - GET  /generations/{id}      轮询状态 → { state, assets: { mesh: { glb } } }
 */
function mapLumaState(raw: string | undefined): VideoPollResult['status'] {
  const s = (raw ?? '').toLowerCase()
  if (s === 'completed' || s === 'succeeded' || s === 'done') return 'completed'
  if (s === 'failed' || s === 'error' || s === 'cancelled') return 'failed'
  if (s === 'processing' || s === 'in_progress' || s === 'generating') return 'in_progress'
  return 'pending'
}

export const lumaAdapter: ModelProviderAdapter = {
  kind: 'luma',

  async assertAuth(provider) {
    const client = createProviderHttpClient(provider)
    try {
      // 列历史生成记录即可验证鉴权（不产生费用）
      await client.get('/generations', { params: { limit: 1 }, timeout: 15_000 })
    } catch (err) {
      if (axios.isAxiosError(err) && !isAuthFailure(err.response?.status, err.message)) {
        return
      }
      throw fail(E_LUMA_CONNECTION_TEST_FAILED, { detail: await readHttpError(err) })
    }
  },

  async fetchCatalog(_provider, modality: ModelModality): Promise<CatalogModel[]> {
    if (modality !== 'model3d') return []
    // Luma Genie 目前使用固定模型
    return [
      {
        id: 'luma-genie',
        name: 'Luma Genie',
        modality: 'model3d',
        description: 'Luma Genie 3D 模型生成（文本/图片）'
      }
    ]
  },

  generateText(
    _provider: ModelProviderInstance,
    _modelId: string,
    _input: GenerateTextInput
  ): Promise<GenerateTextResult> {
    throw fail(E_LUMA_TEXT_UNSUPPORTED)
  },

  generateImage(
    _provider: ModelProviderInstance,
    _modelId: string,
    _input: GenerateImageInput
  ): Promise<GenerateImageResult> {
    throw fail(E_LUMA_IMAGE_UNSUPPORTED)
  },

  async submitVideo(
    _provider: ModelProviderInstance,
    _modelId: string,
    _input: GenerateVideoInput
  ): Promise<GenerateVideoJob> {
    throw fail(E_LUMA_VIDEO_UNSUPPORTED)
  },

  async pollVideo(
    _provider: ModelProviderInstance,
    _job: { jobId: string; pollingUrl: string }
  ): Promise<VideoPollResult> {
    throw fail(E_LUMA_VIDEO_UNSUPPORTED)
  },

  generateSpeech(
    _provider: ModelProviderInstance,
    _modelId: string,
    _input: GenerateSpeechInput
  ): Promise<GenerateSpeechResult> {
    throw fail(E_LUMA_SPEECH_UNSUPPORTED)
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
    const prompt = input.prompt?.trim() || ''

    if (!refs.length && !prompt) throw fail(E_LUMA_PROMPT_OR_REF_REQUIRED)

    const body: Record<string, unknown> = { prompt, format: 'glb' }
    // 图生3D：按官方语义尽力传递首图 URL（是否需先上传图片取 artifact id 待联调确认）
    if (refs.length) body.sourceArtifactId = refs[0]

    try {
      const { data } = await client.post<{ id?: string; state?: string }>('/generations', body)
      const taskId = data?.id
      if (!taskId) throw fail(E_LUMA_NO_TASK_ID)
      return {
        jobId: taskId,
        pollingUrl: taskId,
        status: 'submitted',
        model: modelId
      }
    } catch (err) {
      throw fail(E_LUMA_SUBMIT_3D_FAILED, { detail: await readHttpError(err) })
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
        state?: string
        failure_reason?: string
        assets?: { mesh?: { glb?: string } }
      }>(`/generations/${taskId}`)

      const status = mapLumaState(data?.state)

      if (status === 'completed') {
        return {
          status: 'completed',
          progress: 100,
          downloadUrl: data?.assets?.mesh?.glb?.trim()
        }
      }

      if (status === 'failed') {
        return {
          status: 'failed',
          progress: 100,
          error:
            data?.failure_reason ||
            pickLumaBi('Luma AI 3D 生成失败', 'Luma AI 3D generation failed')
        }
      }

      const progress = status === 'in_progress' ? 55 : 15
      return { status, progress }
    } catch (err) {
      throw fail(E_LUMA_POLL_3D_FAILED, { detail: await readHttpError(err) })
    }
  }
}
