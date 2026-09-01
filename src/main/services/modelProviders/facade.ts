import axios from 'axios'
import { createWriteStream, existsSync, mkdtempSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'
import type {
  CatalogModel,
  CustomApiStyle,
  GenerateImageInput,
  GenerateImageResult,
  GenerateModel3dInput,
  GenerateModel3dJob,
  GenerateModel3dResult,
  GenerateMusicAssetResult,
  GenerateMusicInput,
  GenerateMusicResult,
  GenerateSpeechInput,
  GenerateSpeechResult,
  GenerateTextInput,
  GenerateTextResult,
  GenerateVideoInput,
  GenerateVideoJob,
  GenerateVideoResult,
  ModelModality,
  ModelProviderInstance,
  ModelProviderKind,
  TranscribeAudioInput,
  TranscribeAudioResult
} from '@shared/modelProvider'
import { allowsEmptyApiKey, findProviderById } from '@shared/modelProvider'
import { createProviderHttpClient, sleep } from './http'
import { PROVIDER_ERRORS } from './catalog'
import { fail, defErrSimple, isAppError } from '@shared/errors/appError'
import { buildProviderSnapshot, resolveActiveProvider } from './resolve'
import { settingsService } from '../settingsService'
import { getProviderAdapter } from './registry'
import { prepareVideoInputReferencesForApi } from './videoRefs'
import { ensureApiImageUrl, ensureApiImageUrls } from './apiImageUrl'
import {
  deleteUploads,
  ensureRemoteMediaUrl,
  type ObjectStorageUploadResult
} from '../objectStorageUploadService'
import { projectService } from '../projectService'
import { videoJobService } from '../videoJobService'
import { resolveMediaOutputDir } from '@shared/domain'
import {
  findVoiceProfile,
  normalizeVoiceProfiles,
  resolveVoiceProfileParams,
  VOICE_PROFILES_RELATIVE_PATH,
  type VoiceProfile
} from '@shared/voiceProfiles'
import { defErr } from '@shared/errors/appError'

// ── 本文件错误条目（catalog 未覆盖的个性文案）──
const E_NO_PROJECT = defErrSimple(
  'provider.facade.project-not-open',
  '未打开工程',
  'No project is open'
)
const E_VIDEO_GEN_FAILED = defErrSimple(
  'provider.facade.video-generation-failed',
  '视频生成失败',
  'Video generation failed'
)
const E_MODEL3D_GEN_FAILED = defErrSimple(
  'provider.facade.model3d-generation-failed',
  '3D 模型生成失败',
  '3D model generation failed'
)
const E_BAD_IMAGE_DATA_URL = defErrSimple(
  'provider.common.badDataUrl',
  '无法解析图片 data URL',
  'Failed to parse image data URL'
)
const E_NO_SPEECH_FILE = defErrSimple(
  'provider.facade.speech-file-missing',
  '语音生成未返回音频文件',
  'Speech generation returned no audio file'
)
const E_NO_VOICE_PROFILE = defErr<{ character: string }>(
  'provider.facade.voice-profile-not-found',
  ({ character }) => `角色音色档案中不存在「${character}」；请先为该角色建档（voice_profile_upsert：角色名 + 音色 id 或克隆参考音频）`,
  ({ character }) =>
    `No voice profile for character "${character}"; create one first (voice_profile_upsert: character + voice id or clone reference audio)`
)
const E_MUSIC_UNSUPPORTED = defErrSimple(
  'provider.facade.music-unsupported',
  '当前模型提供商不支持音乐生成，请在设置中配置 MiniMax 或通义千问（百炼 Fun-Music）提供商并勾选音乐模型（如 music-3.0 / fun-music-v1）',
  'The selected provider does not support music generation; configure a MiniMax or DashScope (Bailian Fun-Music) provider with a music model (e.g. music-3.0 / fun-music-v1) in Settings'
)
const E_TRANSCRIBE_NO_FILE = defErrSimple(
  'provider.facade.transcribe-file-missing',
  '找不到要转写的音频文件',
  'Audio file to transcribe was not found'
)
const E_TRANSCRIBE_UNSUPPORTED = defErrSimple(
  'provider.facade.transcribe-unsupported',
  '当前模型提供商不支持音频转写（语音识别），请在设置中配置 OpenAI 提供商（whisper-1）',
  'The selected provider does not support audio transcription; configure an OpenAI provider (whisper-1) in Settings'
)
const E_TRANSCRIBE_NO_MODEL = defErrSimple(
  'provider.facade.transcribe-no-model',
  '请为音频转写指定模型（如 whisper-1）',
  'Please specify a transcription model (e.g. whisper-1)'
)

/** 支持转写的提供商 kind → 默认转写模型；未知 kind 返回空（由调用方/适配器兜底） */
function defaultTranscribeModelId(kind: ModelProviderKind): string {
  if (kind === 'openai') return 'whisper-1'
  return ''
}

/**
 * Lux3D 上游同一实例仅允许 1 个进行中的 3D 生成任务：并发提交时创建接口返回
 * 「已有进行中的生成任务」一类错误。这里不做串行排队，而是在冲突时退避等待
 * 前一个任务结束并自动重试；非冲突失败（认证、参数、余额等）原样抛出，不重试。
 */
const E_LUX3D_SUBMIT_3D_FAILED_CODE = 'provider.lux3d.submitModel3dFailed'
/** 上游并发冲突文案标记（来自 Lux3D 响应信封 m 字段，匹配其一即视为冲突） */
const LUX3D_BUSY_MARKERS = ['进行中的生成任务', '已有进行中', 'busy']
/** 冲突重试参数：退避 10s 起步翻倍，上限 5 分钟，最多 12 次（约 40 分钟覆盖窗口） */
const LUX3D_BUSY_RETRY = { maxAttempts: 12, baseDelayMs: 10_000, maxDelayMs: 5 * 60_000 }

/** 仅当 Lux3D 提交因「已有进行中的生成任务」被拒时返回 true */
function isLux3dBusyError(err: unknown): boolean {
  if (!isAppError(err) || err.code !== E_LUX3D_SUBMIT_3D_FAILED_CODE) return false
  const detail = typeof (err.params as { detail?: unknown } | undefined)?.detail === 'string'
    ? (err.params as { detail: string }).detail
    : ''
  const lower = detail.toLowerCase()
  return LUX3D_BUSY_MARKERS.some((marker) => lower.includes(marker))
}

/** 并发冲突时退避等待自动重试；非冲突失败与重试耗尽时原样抛出 */
async function retryLux3dOnBusy<T>(fn: () => Promise<T>): Promise<T> {
  let delay = LUX3D_BUSY_RETRY.baseDelayMs
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn()
    } catch (err) {
      if (attempt >= LUX3D_BUSY_RETRY.maxAttempts || !isLux3dBusyError(err)) throw err
      await sleep(delay)
      delay = Math.min(delay * 2, LUX3D_BUSY_RETRY.maxDelayMs)
    }
  }
}

/**
 * 模型生成门面：选型 → 派发到对应 ModelProviderAdapter → 编排落盘/对象存储。
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
      nativeBaseUrl?: string
      providerKind?: ModelProviderKind
      apiStyle?: CustomApiStyle
    }
  ): Promise<CatalogModel[]> {
    const provider = buildProviderSnapshot({
      providerInstanceId,
      apiKey: overrides?.apiKey,
      baseUrl: overrides?.baseUrl,
      nativeBaseUrl: overrides?.nativeBaseUrl,
      providerKind: overrides?.providerKind,
      apiStyle: overrides?.apiStyle
    })
    // 本地服务（vLLM / Ollama / LM Studio / ComfyUI）无需 API Key
    if (!provider.apiKey.trim() && !allowsEmptyApiKey(provider)) {
      throw fail(PROVIDER_ERRORS.missingApiKey)
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
    nativeBaseUrl?: string
    providerKind?: ModelProviderKind
    apiStyle?: CustomApiStyle
  }): Promise<{ ok: true }> {
    const provider = buildProviderSnapshot({
      providerInstanceId: input.providerInstanceId,
      apiKey: input.apiKey,
      baseUrl: input.baseUrl,
      nativeBaseUrl: input.nativeBaseUrl,
      providerKind: input.providerKind,
      apiStyle: input.apiStyle
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
   * 图节点视频生成：参考视频先上传对象存储 → 提交 → 持久化 job → 轮询 → 下载 → 登记资产。
   * 结束后删除临时对象。关软件后可由 videoJobService.resumePending 续取结果。
   */
  async generateVideo(
    input: GenerateVideoInput
  ): Promise<GenerateVideoResult> {
    // 图节点绑定只用于任务服务回写，不进入供应商提交载荷
    const { graphBinding, ...genInput } = input
    if (!projectService.isOpen()) throw fail(E_NO_PROJECT)

    let uploads: ObjectStorageUploadResult[] = []

    try {
      const prepared = await prepareVideoInputReferencesForApi(genInput)
      uploads = prepared.uploads
      const job = await this.submitVideo(prepared.input)
      const { provider } = resolveActiveProvider('video', genInput.providerInstanceId, genInput.model)

      const persisted = videoJobService.create({
        kind: 'video',
        providerJobId: job.jobId,
        pollingUrl: job.pollingUrl,
        providerInstanceId: provider.id,
        model: job.model,
        prompt: genInput.prompt,
        name: genInput.name,
        source: 'graph',
        outputDir: genInput.outputDir,
        graphBinding,
        uploads: uploads.map((item) => ({
          objectKey: item.objectKey,
          url: item.url,
          bytes: item.bytes,
          bucket: item.bucket,
          providerId: item.providerId,
          providerLabel: item.providerLabel,
          sourceLabel: item.sourceLabel
        }))
      })

      // 已移交 videoJobService 管理对象清理，避免双重删除
      uploads = []

      const settled = await videoJobService.waitUntilSettled(persisted.localJobId)
      if (settled.status !== 'succeeded' || !settled.assetId || !settled.relativePath) {
        throw new Error(settled.error ?? fail(E_VIDEO_GEN_FAILED).message)
      }

      return {
        assetId: settled.assetId,
        relativePath: settled.relativePath,
        model: settled.model,
        uploads: persisted.uploads?.map((item) => ({
          objectKey: item.objectKey,
          url: item.url,
          bytes: item.bytes,
          sourceLabel: item.sourceLabel,
          logs: []
        }))
      }
    } catch (err) {
      if (uploads.length) await deleteUploads(uploads)
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

  async submitModel3d(input: GenerateModel3dInput): Promise<GenerateModel3dJob> {
    const { provider, modelId } = resolveActiveProvider(
      'model3d',
      input.providerInstanceId,
      input.model
    )
    return getProviderAdapter(provider.providerKind).submitModel3d(provider, modelId, input)
  }

  /**
   * 参考图：data URL / 本地路径 → 对象存储公网 URL（Meshy / Tripo 仅接受 http(s) 图片）。
   */
  async prepareModel3dInputReferencesForApi(
    input: GenerateModel3dInput
  ): Promise<{ input: GenerateModel3dInput; uploads: ObjectStorageUploadResult[] }> {
    const refs = input.inputReferences ?? []
    if (!refs.length) return { input, uploads: [] }

    const uploads: ObjectStorageUploadResult[] = []
    const nextRefs: GenerateModel3dInput['inputReferences'] = []
    const root = projectService.isOpen() ? projectService.getRoot() : undefined

    try {
      for (let i = 0; i < refs.length; i++) {
        const ref = refs[i]!
        const rawUrl = (typeof ref === 'string' ? ref : ref.url).trim()
        if (!rawUrl) continue
        const { url, uploaded } = await ensureRemoteMediaUrl(rawUrl, {
          sourceLabel: `model3d-ref-${i + 1}`,
          projectRoot: root
        })
        if (uploaded) uploads.push(uploaded)
        nextRefs.push({ kind: 'image_url', url })
      }
    } catch (err) {
      await deleteUploads(uploads)
      throw err
    }

    return { input: { ...input, inputReferences: nextRefs }, uploads }
  }

  async pollModel3d(
    provider: ModelProviderInstance,
    job: { jobId: string; pollingUrl: string }
  ): Promise<{
    status: 'pending' | 'in_progress' | 'completed' | 'failed'
    progress: number
    error?: string
    downloadUrl?: string
  }> {
    return getProviderAdapter(provider.providerKind).pollModel3d(provider, job)
  }

  /**
   * 图节点 3D 模型生成：参考图上传对象存储 → 提交 → 持久化 job → 轮询 → 下载 GLB → 登记资产。
   * 结束后删除临时对象。关软件后可由 videoJobService.resumePending 续取结果。
   */
  async generateModel3d(input: GenerateModel3dInput): Promise<GenerateModel3dResult> {
    // 图节点绑定只用于任务服务回写，不进入供应商提交载荷
    const { graphBinding, ...genInput } = input
    if (!projectService.isOpen()) throw fail(E_NO_PROJECT)

    let uploads: ObjectStorageUploadResult[] = []

    try {
      const prepared = await this.prepareModel3dInputReferencesForApi(genInput)
      uploads = prepared.uploads
      const { provider } = resolveActiveProvider('model3d', genInput.providerInstanceId, genInput.model)
      const run = (): Promise<GenerateModel3dResult> =>
        this.submitModel3dAndSettle(provider, prepared.input, genInput, graphBinding, uploads)
      // Lux3D 单并发：冲突时退避自动重试，其余失败原样抛出
      return provider.providerKind === 'lux3d' ? retryLux3dOnBusy(run) : run()
    } catch (err) {
      if (uploads.length) await deleteUploads(uploads)
      throw err
    }
  }

  /** 提交 3D 任务 → 持久化 job → 阻塞轮询到终态 → 返回资产（供 generateModel3d 调用） */
  private async submitModel3dAndSettle(
    provider: ModelProviderInstance,
    submitInput: GenerateModel3dInput,
    genInput: GenerateModel3dInput,
    graphBinding: GenerateModel3dInput['graphBinding'],
    uploads: ObjectStorageUploadResult[]
  ): Promise<GenerateModel3dResult> {
    const job = await this.submitModel3d(submitInput)

    const persisted = videoJobService.create({
      kind: 'model3d',
      providerJobId: job.jobId,
      pollingUrl: job.pollingUrl,
      providerInstanceId: provider.id,
      model: job.model,
      prompt: genInput.prompt,
      name: genInput.name,
      source: 'graph',
      outputDir: genInput.outputDir,
      graphBinding,
      uploads: uploads.map((item) => ({
        objectKey: item.objectKey,
        url: item.url,
        bytes: item.bytes,
        bucket: item.bucket,
        providerId: item.providerId,
        providerLabel: item.providerLabel,
        sourceLabel: item.sourceLabel
      }))
    })

    // 已移交 videoJobService 管理对象清理，避免双重删除
    uploads = []

    const settled = await videoJobService.waitUntilSettled(persisted.localJobId)
    if (settled.status !== 'succeeded' || !settled.assetId || !settled.relativePath) {
      throw new Error(settled.error ?? fail(E_MODEL3D_GEN_FAILED).message)
    }

    return {
      assetId: settled.assetId,
      relativePath: settled.relativePath,
      model: settled.model,
      uploads: persisted.uploads?.map((item) => ({
        objectKey: item.objectKey,
        url: item.url,
        bytes: item.bytes,
        sourceLabel: item.sourceLabel,
        logs: []
      }))
    }
  }

  async generateImageAsset(
    input: GenerateImageInput & { name?: string; outputDir?: string }
  ): Promise<{
    assetId: string
    model: string
    relativePath: string
  }> {
    if (!projectService.isOpen()) throw fail(E_NO_PROJECT)
    const result = await this.generateImage(input)
    const first = result.images[0]
    // 中间文件始终写系统临时目录，由 attachExternalGeneratedFile 统一拷入最终目录
    // （未指定 outputDir 时缺省落 Cache/Images，不自动进资产库），避免未登记产物残留在资产库目录
    const dir = mkdtempSync(join(tmpdir(), 'aiae-img-'))

    const stamp = Date.now()
    let absPath: string
    if (first.startsWith('data:')) {
      const m = first.match(/^data:([^;]+);base64,(.+)$/)
      if (!m) throw fail(E_BAD_IMAGE_DATA_URL)
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
      prompt: input.prompt,
      outputDir: input.outputDir
    })
    return { assetId: asset.id, model: result.model, relativePath: asset.relativePath }
  }

  async generateSpeech(input: GenerateSpeechInput): Promise<GenerateSpeechResult> {
    const resolved = await this.applyVoiceProfile(input)
    const { provider, modelId } = resolveActiveProvider(
      'audio',
      resolved.providerInstanceId,
      resolved.model
    )
    return getProviderAdapter(provider.providerKind).generateSpeech(provider, modelId, resolved)
  }

  /** 按角色音色档案解析语音参数：角色已建档 → 未显式传的 voice / referenceAudio 取自档案 */
  private async applyVoiceProfile(
    input: GenerateSpeechInput
  ): Promise<GenerateSpeechInput> {
    const character = input.voiceProfile?.trim()
    if (!character) return input
    if (!projectService.isOpen()) throw fail(E_NO_PROJECT)
    const profiles = await this.readVoiceProfiles()
    const profile = findVoiceProfile(profiles, character)
    if (!profile) throw fail(E_NO_VOICE_PROFILE, { character })
    const params = resolveVoiceProfileParams(profile, {
      voice: input.voice,
      referenceAudio: input.referenceAudio
    })
    return { ...input, ...params }
  }

  private async readVoiceProfiles(): Promise<VoiceProfile[]> {
    try {
      const raw = await projectService.readProjectFile(VOICE_PROFILES_RELATIVE_PATH)
      if (!raw) return []
      return normalizeVoiceProfiles(JSON.parse(raw))
    } catch {
      return []
    }
  }

  /** 语音生成 → 工程声音资产（与 generateImageAsset 同一落盘模式） */
  async generateSpeechAsset(
    input: GenerateSpeechInput & { outputDir?: string }
  ): Promise<GenerateSpeechResult> {
    if (!projectService.isOpen()) throw fail(E_NO_PROJECT)
    const result = await this.generateSpeech(input)
    if (!result.filePath) throw fail(E_NO_SPEECH_FILE)
    const asset = projectService.attachExternalGeneratedFile({
      type: 'voice',
      sourceFilePath: result.filePath,
      name: input.name ?? `生成语音 ${new Date().toLocaleString()}`,
      prompt: input.input,
      outputDir: input.outputDir
    })
    return { ...result, assetId: asset.id, relativePath: asset.relativePath }
  }

  /**
   * BGM / 音乐生成（同步）：选型 → 派发到适配器 → 返回音频下载地址。
   * 未配置支持音乐的提供商/模型时给出引导文案。
   */
  async generateMusic(input: GenerateMusicInput): Promise<GenerateMusicResult> {
    const { provider, modelId } = resolveActiveProvider(
      'audio',
      input.providerInstanceId,
      input.model
    )
    const adapter = getProviderAdapter(provider.providerKind)
    if (!adapter.generateMusic) throw fail(E_MUSIC_UNSUPPORTED)
    return adapter.generateMusic(provider, modelId, input)
  }

  /** BGM 生成 → 工程声音资产：下载 → 落盘 Cache/Music（不自动进资产库，可手动入库） */
  async generateMusicAsset(
    input: GenerateMusicInput & { outputDir?: string }
  ): Promise<GenerateMusicAssetResult> {
    if (!projectService.isOpen()) throw fail(E_NO_PROJECT)
    const { provider } = resolveActiveProvider('audio', input.providerInstanceId, input.model)
    const result = await this.generateMusic(input)

    // 中间文件始终写系统临时目录，由 attachExternalGeneratedFile 统一拷入最终目录
    const dir = mkdtempSync(join(tmpdir(), 'aiae-music-'))
    const dest = join(dir, `music-${Date.now()}.mp3`)
    await this.downloadVideoToFile(provider, result.downloadUrl, dest)

    const outputDir = resolveMediaOutputDir({
      mediaOutputDir: input.outputDir,
      cacheOutputDir: projectService.getConfig().cacheOutputDir,
      kind: 'music'
    })
    const asset = projectService.attachExternalGeneratedFile({
      type: 'voice',
      sourceFilePath: dest,
      name: input.name ?? `生成音乐 ${new Date().toLocaleString()}`,
      prompt: input.prompt,
      outputDir
    })
    return {
      assetId: asset.id,
      relativePath: asset.relativePath,
      model: result.model,
      durationMs: result.durationMs
    }
  }

  /**
   * 音频转写（语音识别）：把本地音频文件转成带时间戳文本。
   * 提供商不依赖「音频」模态勾选（如 OpenAI 目录无 audio 模态），
   * 自动选择首个支持转写的已配置提供商。
   */
  private resolveTranscribeProvider(input: TranscribeAudioInput): {
    provider: ModelProviderInstance
    modelId: string
  } {
    const providers = settingsService.get().models.providers
    const usable = (p: ModelProviderInstance): boolean =>
      p.enabled && (p.apiKey.trim().length > 0 || allowsEmptyApiKey(p)) && Boolean(
        getProviderAdapter(p.providerKind).transcribeAudio
      )

    let provider: ModelProviderInstance | undefined
    const preferredId = input.providerInstanceId?.trim()
    if (preferredId) {
      const found = findProviderById(providers, preferredId)
      if (found && usable(found)) provider = found
    }
    if (!provider) provider = providers.find(usable)
    if (!provider) throw fail(PROVIDER_ERRORS.noActiveProvider, { modality: 'audio transcription' })

    const modelId = input.model?.trim() || defaultTranscribeModelId(provider.providerKind)
    if (!modelId) throw fail(E_TRANSCRIBE_NO_MODEL)
    return { provider, modelId }
  }

  async transcribeAudio(input: TranscribeAudioInput): Promise<TranscribeAudioResult> {
    if (!projectService.isOpen()) throw fail(E_NO_PROJECT)
    const absPath =
      input.absPath?.trim() ||
      (input.relativePath?.trim() ? join(projectService.getRoot(), input.relativePath.trim()) : '')
    if (!absPath || !existsSync(absPath)) throw fail(E_TRANSCRIBE_NO_FILE)

    const { provider, modelId } = this.resolveTranscribeProvider(input)
    const adapter = getProviderAdapter(provider.providerKind)
    if (!adapter.transcribeAudio) throw fail(E_TRANSCRIBE_UNSUPPORTED)
    return adapter.transcribeAudio(provider, modelId, { ...input, absPath })
  }
}

export const modelProviderFacade = new ModelProviderFacade()
