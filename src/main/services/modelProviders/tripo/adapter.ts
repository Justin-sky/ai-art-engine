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
import { createProviderHttpClient, readHttpError } from '../http'

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
      throw new Error(`Tripo 连接测试失败: ${await readHttpError(err)}`)
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
    throw new Error('Tripo 不支持文本生成')
  },

  generateImage(
    _provider: ModelProviderInstance,
    _modelId: string,
    _input: GenerateImageInput
  ): Promise<GenerateImageResult> {
    throw new Error('Tripo 不支持图片生成')
  },

  async submitVideo(
    _provider: ModelProviderInstance,
    _modelId: string,
    _input: GenerateVideoInput
  ): Promise<GenerateVideoJob> {
    throw new Error('Tripo 不支持视频生成')
  },

  async pollVideo(
    _provider: ModelProviderInstance,
    _job: { jobId: string; pollingUrl: string }
  ): Promise<VideoPollResult> {
    throw new Error('Tripo 不支持视频生成')
  },

  generateSpeech(
    _provider: ModelProviderInstance,
    _modelId: string,
    _input: GenerateSpeechInput
  ): Promise<GenerateSpeechResult> {
    throw new Error('Tripo 不支持语音合成')
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
      if (!taskId) throw new Error('Tripo 未返回任务 id')
      return {
        jobId: taskId,
        pollingUrl: taskId,
        status: 'submitted',
        model: modelId
      }
    } catch (err) {
      throw new Error(`提交 Tripo 3D 生成失败: ${await readHttpError(err)}`)
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
        return { status: 'failed', progress: 100, error: 'Tripo 3D 生成失败' }
      }

      const progress = taskData?.progress ?? (status === 'in_progress' ? 55 : 15)
      return { status, progress }
    } catch (err) {
      throw new Error(`轮询 Tripo 3D 生成失败: ${await readHttpError(err)}`)
    }
  }
}