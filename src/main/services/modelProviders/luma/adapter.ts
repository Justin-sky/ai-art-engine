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
import type { ModelProviderAdapter, VideoPollResult } from '../types'
import { createProviderHttpClient, isAuthFailure, readHttpError } from '../http'

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
      throw new Error(`Luma AI 连接测试失败: ${await readHttpError(err)}`)
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
    throw new Error('Luma AI 不支持文本生成')
  },

  generateImage(
    _provider: ModelProviderInstance,
    _modelId: string,
    _input: GenerateImageInput
  ): Promise<GenerateImageResult> {
    throw new Error('Luma AI 不支持图片生成')
  },

  async submitVideo(
    _provider: ModelProviderInstance,
    _modelId: string,
    _input: GenerateVideoInput
  ): Promise<GenerateVideoJob> {
    throw new Error('Luma AI 不支持视频生成')
  },

  async pollVideo(
    _provider: ModelProviderInstance,
    _job: { jobId: string; pollingUrl: string }
  ): Promise<VideoPollResult> {
    throw new Error('Luma AI 不支持视频生成')
  },

  generateSpeech(
    _provider: ModelProviderInstance,
    _modelId: string,
    _input: GenerateSpeechInput
  ): Promise<GenerateSpeechResult> {
    throw new Error('Luma AI 不支持语音合成')
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

    if (!refs.length && !prompt) throw new Error('Luma AI 需要文本提示或参考图')

    const body: Record<string, unknown> = { prompt, format: 'glb' }
    // 图生3D：按官方语义尽力传递首图 URL（是否需先上传图片取 artifact id 待联调确认）
    if (refs.length) body.sourceArtifactId = refs[0]

    try {
      const { data } = await client.post<{ id?: string; state?: string }>('/generations', body)
      const taskId = data?.id
      if (!taskId) throw new Error('Luma AI 未返回生成任务 id')
      return {
        jobId: taskId,
        pollingUrl: taskId,
        status: 'submitted',
        model: modelId
      }
    } catch (err) {
      throw new Error(`提交 Luma AI 3D 生成失败: ${await readHttpError(err)}`)
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
          error: data?.failure_reason || 'Luma AI 3D 生成失败'
        }
      }

      const progress = status === 'in_progress' ? 55 : 15
      return { status, progress }
    } catch (err) {
      throw new Error(`轮询 Luma AI 3D 生成失败: ${await readHttpError(err)}`)
    }
  }
}
