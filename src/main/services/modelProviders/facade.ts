import axios from 'axios'
import { createWriteStream, existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'
import type {
  CatalogModel,
  GenerateImageInput,
  GenerateImageResult,
  GenerateSpeechInput,
  GenerateSpeechResult,
  GenerateTextInput,
  GenerateTextResult,
  GenerateVideoInput,
  GenerateVideoJob,
  GenerateVideoResult,
  ModelModality,
  ModelProviderInstance,
  ModelProviderKind
} from '@shared/openrouter'
import { createProviderHttpClient } from './http'
import { buildProviderSnapshot, resolveActiveProvider } from './resolve'
import { getProviderAdapter } from './registry'
import { prepareVideoInputReferencesForApi } from './videoRefs'
import { ensureApiImageUrl, ensureApiImageUrls } from './apiImageUrl'
import { deleteTosUploads, type TosUploadResult } from '../tosUploadService'
import { projectService } from '../projectService'
import { videoJobService } from '../videoJobService'

/**
 * 模型生成门面：选型 → 派发到对应 ModelProviderAdapter → 编排落盘/TOS。
 * IPC / 图执行继续依赖本类公开方法，勿在调用方感知适配器细节。
 */
class ModelProviderFacade {
  listModelsForProvider(
    provider: ModelProviderInstance,
    modality: ModelModality
  ): Promise<CatalogModel[]> {
    return getProviderAdapter(provider.providerKind).fetchCatalog(provider, modality)
  }

  async listModels(
    modality: ModelModality,
    providerInstanceId: string,
    overrides?: {
      apiKey?: string
      baseUrl?: string
      providerKind?: ModelProviderKind
    }
  ): Promise<CatalogModel[]> {
    const provider = buildProviderSnapshot({
      providerInstanceId,
      apiKey: overrides?.apiKey,
      baseUrl: overrides?.baseUrl,
      providerKind: overrides?.providerKind
    })
    if (!provider.apiKey.trim()) {
      throw new Error('请先填写 API Key')
    }
    const adapter = getProviderAdapter(provider.providerKind)
    await adapter.assertAuth(provider)
    return adapter.fetchCatalog(provider, modality)
  }

  async testConnection(input: {
    providerInstanceId: string
    modality?: ModelModality
    apiKey?: string
    baseUrl?: string
    providerKind?: ModelProviderKind
  }): Promise<{ ok: true }> {
    const provider = buildProviderSnapshot({
      providerInstanceId: input.providerInstanceId,
      apiKey: input.apiKey,
      baseUrl: input.baseUrl,
      providerKind: input.providerKind
    })
    await getProviderAdapter(provider.providerKind).assertAuth(provider)
    return { ok: true }
  }

  async generateText(input: GenerateTextInput): Promise<GenerateTextResult> {
    const { provider, modelId } = resolveActiveProvider(
      'text',
      input.providerInstanceId,
      input.model
    )
    const images = input.images?.length ? ensureApiImageUrls(input.images) : input.images
    return getProviderAdapter(provider.providerKind).generateText(provider, modelId, {
      ...input,
      images
    })
  }

  async generateImage(input: GenerateImageInput): Promise<GenerateImageResult> {
    const { provider, modelId } = resolveActiveProvider(
      'image',
      input.providerInstanceId,
      input.model
    )
    const inputReferences = ensureApiImageUrls(input.inputReferences)
    return getProviderAdapter(provider.providerKind).generateImage(provider, modelId, {
      ...input,
      inputReferences
    })
  }

  async submitVideo(input: GenerateVideoInput): Promise<GenerateVideoJob> {
    const { provider, modelId } = resolveActiveProvider(
      'video',
      input.providerInstanceId,
      input.model
    )
    const firstFrameImageUrl = input.firstFrameImageUrl?.trim()
      ? ensureApiImageUrl(input.firstFrameImageUrl)
      : input.firstFrameImageUrl
    const lastFrameImageUrl = input.lastFrameImageUrl?.trim()
      ? ensureApiImageUrl(input.lastFrameImageUrl)
      : input.lastFrameImageUrl
    // 裸字符串按约定视为 image_url；video_url / audio_url 保持原样（视频由 TOS 上传处理）
    const inputReferences = input.inputReferences?.map((ref) => {
      if (typeof ref === 'string') {
        return ensureApiImageUrl(ref)
      }
      if (ref.kind === 'image_url' && ref.url?.trim()) {
        return { ...ref, url: ensureApiImageUrl(ref.url) }
      }
      return ref
    })
    return getProviderAdapter(provider.providerKind).submitVideo(provider, modelId, {
      ...input,
      firstFrameImageUrl,
      lastFrameImageUrl,
      inputReferences
    })
  }

  async pollVideo(
    provider: ModelProviderInstance,
    job: { jobId: string; pollingUrl: string }
  ): Promise<{
    status: 'pending' | 'in_progress' | 'completed' | 'failed'
    progress: number
    error?: string
    downloadUrl?: string
  }> {
    return getProviderAdapter(provider.providerKind).pollVideo(provider, job)
  }

  /**
   * 图节点视频生成：参考视频先上传 TOS → 提交 → 持久化 job → 轮询 → 下载 → 登记资产。
   * 结束后删除 TOS 临时对象。关软件后可由 videoJobService.resumePending 续取结果。
   */
  async generateVideo(
    input: GenerateVideoInput & { name?: string }
  ): Promise<GenerateVideoResult> {
    if (!projectService.isOpen()) throw new Error('未打开工程')

    let tosUploads: TosUploadResult[] = []

    try {
      const prepared = await prepareVideoInputReferencesForApi(input)
      tosUploads = prepared.tosUploads
      const job = await this.submitVideo(prepared.input)
      const { provider } = resolveActiveProvider('video', input.providerInstanceId, input.model)

      const persisted = videoJobService.create({
        providerJobId: job.jobId,
        pollingUrl: job.pollingUrl,
        providerInstanceId: provider.id,
        model: job.model,
        prompt: input.prompt,
        name: input.name,
        source: 'graph',
        outputDir: input.outputDir,
        tosUploads: tosUploads.map((item) => ({
          objectKey: item.objectKey,
          url: item.url,
          bytes: item.bytes,
          bucket: item.bucket,
          providerId: item.providerId,
          providerLabel: item.providerLabel,
          sourceLabel: item.sourceLabel
        }))
      })

      // 已移交 videoJobService 管理 TOS 清理，避免双重删除
      tosUploads = []

      const settled = await videoJobService.waitUntilSettled(persisted.localJobId)
      if (settled.status !== 'succeeded' || !settled.assetId || !settled.relativePath) {
        throw new Error(settled.error ?? '视频生成失败')
      }

      return {
        assetId: settled.assetId,
        relativePath: settled.relativePath,
        model: settled.model,
        tosUploads: persisted.tosUploads?.map((item) => ({
          objectKey: item.objectKey,
          url: item.url,
          bytes: item.bytes,
          sourceLabel: item.sourceLabel,
          logs: []
        }))
      }
    } catch (err) {
      if (tosUploads.length) await deleteTosUploads(tosUploads)
      throw err
    }
  }

  async downloadVideoToFile(
    provider: ModelProviderInstance,
    downloadUrl: string,
    destPath: string
  ): Promise<void> {
    const absolute = /^https?:\/\//i.test(downloadUrl)
    const client = absolute
      ? axios.create({ timeout: 300_000, responseType: 'stream' })
      : createProviderHttpClient(provider)
    const response = absolute
      ? await client.get(downloadUrl)
      : await client.get(downloadUrl, { responseType: 'stream', timeout: 300_000 })
    await pipeline(response.data as Readable, createWriteStream(destPath))
  }

  async generateImageAsset(input: GenerateImageInput & { name?: string }): Promise<{
    assetId: string
    model: string
    relativePath: string
  }> {
    if (!projectService.isOpen()) throw new Error('未打开工程')
    const result = await this.generateImage(input)
    const first = result.images[0]
    const root = projectService.getRoot()
    const dir = join(root, 'assets', 'generated', 'images')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

    const stamp = Date.now()
    let absPath: string
    if (first.startsWith('data:')) {
      const m = first.match(/^data:([^;]+);base64,(.+)$/)
      if (!m) throw new Error('无法解析图片 data URL')
      const ext = m[1].includes('jpeg') || m[1].includes('jpg') ? 'jpg' : 'png'
      absPath = join(dir, `img-${stamp}.${ext}`)
      writeFileSync(absPath, Buffer.from(m[2], 'base64'))
    } else {
      absPath = join(dir, `img-${stamp}.png`)
      const client = axios.create({ timeout: 120_000, responseType: 'arraybuffer' })
      const { data } = await client.get(first)
      writeFileSync(absPath, Buffer.from(data))
    }

    const asset = projectService.attachExternalGeneratedFile({
      type: 'image',
      sourceFilePath: absPath,
      name: input.name ?? `生成图片 ${new Date().toLocaleString()}`,
      prompt: input.prompt
    })
    return { assetId: asset.id, model: result.model, relativePath: asset.relativePath }
  }

  async generateSpeech(input: GenerateSpeechInput): Promise<GenerateSpeechResult> {
    const { provider, modelId } = resolveActiveProvider(
      'audio',
      input.providerInstanceId,
      input.model
    )
    return getProviderAdapter(provider.providerKind).generateSpeech(provider, modelId, input)
  }
}

export const modelProviderFacade = new ModelProviderFacade()

/** @deprecated 兼容旧名；新代码请用 modelProviderFacade */
export const openRouterClient = modelProviderFacade
