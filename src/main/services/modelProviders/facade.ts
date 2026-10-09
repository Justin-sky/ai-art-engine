import axios from 'axios'
import {
  copyFileSync,
  createWriteStream,
  existsSync,
  mkdtempSync,
  readFileSync,
  writeFileSync
} from 'fs'
import { basename, join } from 'path'
import { tmpdir } from 'os'
import { pipeline } from 'stream/promises'
import { Readable } from 'stream'
import type {
  CatalogModel,
  CustomApiStyle,
  GenerateDecisionsInput,
  GenerateDecisionsResult,
  GenerateImageInput,
  GenerateImageResult,
  GenerateModel3dInput,
  GenerateModel3dJob,
  GenerateModel3dResult,
  GenerateMusicAssetResult,
  GenerateMusicInput,
  GenerateSoundEffectInput,
  GenerateMusicResult,
  GenerateSpeechInput,
  GenerateSpeechResult,
  GenerateTextInput,
  GenerateTextResult,
  GenerateVideoInput,
  GenerateVideoJob,
  GenerateVideoResult,
  GenerateSpatialWorldInput,
  GenerateSpatialWorldJob,
  GenerateSpatialWorldResult,
  ExportWorldInput,
  ExportWorldResult,
  SpatialWorldExportRequest,
  Model3dSegmentMode,
  Model3dPostProcessInput,
  Model3dPostProcessResult,
  ListModel3dAnimationsInput,
  Model3dAnimationAction,
  ModelModality,
  ModelProviderInstance,
  ModelProviderKind,
  RigModel3dInput,
  RigModel3dResult,
  SegmentModel3dInput,
  SegmentModel3dResult,
  TranscribeAudioInput,
  TranscribeAudioResult
} from '@shared/modelProvider'
import {
  allowsEmptyApiKey,
  findProviderById,
  normalizeVideoInputReference,
  resolveDefaultVoice,
  supportsModel3dRig,
  supportsModel3dSegment
} from '@shared/modelProvider'
import { describeDecisionVerdicts, resolveDecisionVerdicts } from '@shared/decisionQuestion'
import { pickSpatialWorldJobs } from '@shared/videoJob'
import { buildDecisionsRequest } from './decisions'
import { meshOpSupported } from '@shared/meshOps'
import { createProviderHttpClient, sleep } from './http'
import { PROVIDER_ERRORS } from './catalog'
import { fail, defErrSimple, isAppError } from '@shared/errors/appError'
import {
  buildProviderSnapshot,
  resolveActiveMusicProvider,
  resolveActiveProvider,
  resolveActiveSoundEffectProvider
} from './resolve'
import { settingsService } from '../settingsService'
import { getProviderAdapter } from './registry'
import { prepareVideoInputReferencesForApi } from './videoRefs'
import { ensureApiImageUrl, ensureApiImageUrls, ensureApiImageUrlsWithNotes } from './apiImageUrl'
import {
  deleteUploads,
  ensureRemoteMediaUrl,
  type ObjectStorageUploadResult
} from '../objectStorageUploadService'
import { projectService } from '../projectService'
import { siblingOutputPath, videoJobService } from '../videoJobService'
import { videoJobRepository } from '../../repositories/videoJobRepository'
import { resolveMediaOutputDir } from '@shared/domain'
import { pollCloudModel3dRig, submitCloudModel3dRig } from './model3dRig'
import {
  fetchCloudModel3dSegmentExtras,
  pollCloudModel3dSegment,
  submitCloudModel3dSegment
} from './model3dSegment'
import { readGlbPartNames } from './glbParts'
import { parseMeshOpsJobToken } from './meshOpsJob'
import { uploadWorldlabsMediaAsset } from './worldlabs/mediaAssets'
import { meshOpsDialectFor, requireMeshOpsDialect } from './meshOpsDialect'
import type { MeshOpsDialect } from './types'
import {
  pollCloudModel3dPostProcess,
  pollCloudRigCheck,
  submitCloudModel3dPostProcess,
  submitCloudRigCheck
} from './model3dPostProcess'
import {
  findVoiceProfile,
  normalizeVoiceProfiles,
  resolveVoiceProfileParams,
  VOICE_PROFILES_RELATIVE_PATH,
  type VoiceProfile
} from '@shared/voiceProfiles'
import { defErr } from '@shared/errors/appError'
import { soundEffectPromptNeedsEnglish } from '@shared/modelProviders/elevenlabs/voice'

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
const E_WORLD_GEN_FAILED = defErrSimple(
  'provider.facade.world-generation-failed',
  '世界生成失败',
  'World generation failed'
)
const E_WORLD_UNSUPPORTED = defErrSimple(
  'provider.facade.world-unsupported',
  '该提供商暂不支持空间世界生成',
  'This provider does not support world generation yet'
)
const E_WORLD_REF_NOT_FOUND = defErr<{ path: string }>(
  'provider.facade.worldRefNotFound',
  ({ path }) => `世界生成的参考文件不存在: ${path}`,
  ({ path }) => `The world generation reference file does not exist: ${path}`
)
const E_WORLD_REF_BAD_DATA_URL = defErrSimple(
  'provider.facade.worldRefBadDataUrl',
  '无法解析参考媒体的 data URL',
  'Could not parse the reference media data URL'
)
const E_WORLD_REF_UPLOAD_FAILED = defErr<{ media: string; storage: string }>(
  'provider.facade.worldRefUploadFailed',
  ({ media, storage }) =>
    `参考媒体上传失败。World Labs 托管媒体：${media}；对象存储回退：${storage}`,
  ({ media, storage }) =>
    `Uploading the reference media failed. World Labs media asset: ${media}; object storage fallback: ${storage}`
)
const E_WORLD_EXPORT_NO_SOURCE = defErrSimple(
  'provider.facade.spatialWorldExportNoSource',
  'PLY 泼溅导出需要上游世界产物的路径（它们要落在世界 GLB 旁边）；图节点请把「空间世界生成」的模型口接进来，MCP 调用请给 spatialWorldAssetId / sourceRelativePath',
  'Exporting PLY splats needs the upstream world artifact path (they land next to the world GLB); connect the model port of a world generation node, or pass spatialWorldAssetId / sourceRelativePath from MCP'
)
const E_WORLD_EXPORT_TIMEOUT = defErrSimple(
  'provider.facade.spatialWorldExportTimeout',
  '空间世界导出超时：任务仍未完成（HQ 网格最长约 1 小时，请稍后重试）',
  'World export timed out: the job is still unfinished (an HQ mesh can take up to an hour; retry later)'
)

/** PLY 泼溅官方为同步转换；万一上游给了进行中的 operation，就地轮询的兜底上限 */
const WORLD_EXPORT_POLL_TIMEOUT_MS = 10 * 60 * 1000

/** 扩展名 → MIME（World Labs 只认常规图 / 视频类型，缺省按二进制流） */
const EXT_TO_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  bmp: 'image/bmp',
  mp4: 'video/mp4',
  mov: 'video/quicktime',
  webm: 'video/webm',
  avi: 'video/x-msvideo',
  mkv: 'video/x-matroska'
}

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'video/x-msvideo': 'avi',
  'video/x-matroska': 'mkv'
}

/**
 * 读取参考媒体原始字节（供托管媒体上传用）。
 * data URL 直接解码；其余按「工程相对路径 / 本地绝对路径」解析后读盘——
 * 与 `ensureRemoteMediaUrl` 同一套路径口径（非绝对路径一律视为工程相对）。
 */
function readWorldReferenceMedia(
  rawUrl: string,
  projectRoot?: string
): { bytes: Buffer; extension: string; contentType: string; fileName: string } {
  const trimmed = rawUrl.trim()
  if (trimmed.startsWith('data:')) {
    const match = /^data:([^;,]*)(;base64)?,([\s\S]*)$/.exec(trimmed)
    if (!match) throw fail(E_WORLD_REF_BAD_DATA_URL)
    const contentType = match[1]?.trim() || 'application/octet-stream'
    const payload = match[3] ?? ''
    const bytes = match[2]
      ? Buffer.from(payload, 'base64')
      : Buffer.from(decodeURIComponent(payload), 'utf8')
    const extension = MIME_TO_EXT[contentType] ?? 'bin'
    return { bytes, extension, contentType, fileName: `reference.${extension}` }
  }

  const abs =
    projectRoot && !/^[A-Za-z]:[\\/]/.test(trimmed) && !trimmed.startsWith('/')
      ? join(projectRoot, trimmed)
      : trimmed
  if (!existsSync(abs)) throw fail(E_WORLD_REF_NOT_FOUND, { path: abs })
  const extension = (abs.toLowerCase().split('.').pop() ?? '').replace(/[^a-z0-9]/g, '')
  return {
    bytes: readFileSync(abs),
    extension,
    contentType: EXT_TO_MIME[extension] ?? 'application/octet-stream',
    fileName: basename(abs)
  }
}
/** 绑骨检查（免费、无产物）就地轮询上限 */
const RIG_CHECK_TIMEOUT_MS = 180_000
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
  ({ character }) =>
    `角色音色档案中不存在「${character}」；请先为该角色建档（voice_profile_upsert：角色名 + 音色 id 或克隆参考音频）`,
  ({ character }) =>
    `No voice profile for character "${character}"; create one first (voice_profile_upsert: character + voice id or clone reference audio)`
)
const E_MUSIC_UNSUPPORTED = defErrSimple(
  'provider.facade.music-unsupported',
  '当前模型提供商不支持音乐生成，请在设置中配置 MiniMax / 通义千问（百炼 Fun-Music）/ ElevenLabs 提供商并勾选音乐模型（如 music-3.0 / fun-music-v1 / music_v2_5）',
  'The selected provider does not support music generation; configure a MiniMax / DashScope (Bailian Fun-Music) / ElevenLabs provider with a music model (e.g. music-3.0 / fun-music-v1 / music_v2_5) in Settings'
)
/** 上游既没给下载地址也没给本地文件：两种取回方式都落空，没法登记资产 */
const E_MUSIC_NO_AUDIO = defErrSimple(
  'provider.facade.music-no-audio',
  '音乐生成未返回音频（既没有下载地址也没有本地文件）',
  'Music generation returned no audio (neither a download URL nor a local file)'
)
const E_SOUND_EFFECT_UNSUPPORTED = defErrSimple(
  'provider.facade.sound-effect-unsupported',
  '当前模型提供商不支持音效生成，请在设置 → 模型里配置 ElevenLabs 并在「音效」页签勾选模型',
  'The selected provider does not support sound effect generation; add ElevenLabs under Settings → Models and enable a model on the Sound effects tab'
)
const E_SOUND_EFFECT_PROMPT_TRANSLATE_FAILED = defErrSimple(
  'provider.facade.sound-effect-prompt-translate-failed',
  'ElevenLabs 音效模型对中文等描述会念出文字而不是生成音效；自动译成英文失败。请改用英文描述，或先在设置里配置可用的文本模型。',
  'ElevenLabs sound-generation speaks non-English descriptions aloud instead of making SFX; auto-translate to English failed. Use an English prompt, or configure a text model in Settings first.'
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
const E_DECISIONS_UNSUPPORTED = defErr<{ provider: string }>(
  'provider.facade.decisions-unsupported',
  ({ provider }) =>
    `${provider} 暂不支持决策判定：请在设置中添加 OpenRouter 或 TypeSafe 提供商，并在「决策」页签勾选决策模型（如 typesafe/jev-1.13、jev-latest）`,
  ({ provider }) =>
    `${provider} does not support decision requests yet: add an OpenRouter or TypeSafe provider in Settings and pick a decisions model (e.g. typesafe/jev-1.13, jev-latest) on the Decisions tab`
)

/** 支持转写的提供商 kind → 默认转写模型；未知 kind 返回空（由调用方/适配器兜底） */
function defaultTranscribeModelId(kind: ModelProviderKind): string {
  if (kind === 'openai') return 'whisper-1'
  // ElevenLabs Scribe：当前基线是 v2（规范里 model_id 的取值之一）
  if (kind === 'elevenlabs') return 'scribe_v2'
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
  const detail =
    typeof (err.params as { detail?: unknown } | undefined)?.detail === 'string'
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

  /**
   * 音频模态的**全量**模型（不按类别过滤），供设置页把 TTS / 转写 / 音乐的能力
   * 一并写进目录快照。适配器没实现时退回 `fetchCatalog`（单一类别的供应商行为不变）。
   */
  async listAllAudioModels(
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
    const adapter = getProviderAdapter(provider.providerKind)
    if (typeof adapter.listAllAudioModels !== 'function') {
      return adapter.fetchCatalog(provider, 'audio')
    }
    return adapter.listAllAudioModels(provider)
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

  /**
   * 音色 id → 展示名（设置页拉目录时一并取回，落进 provider 的 voiceLabels）。
   *
   * 适配器没实现该能力时返回空对象 —— 调用方据此保留原有行为（音色名即 id），
   * 不用区分「不支持」与「暂时取不到」。
   */
  async listSpeechVoiceLabels(
    providerInstanceId: string,
    overrides?: {
      apiKey?: string
      baseUrl?: string
      nativeBaseUrl?: string
      providerKind?: ModelProviderKind
      apiStyle?: CustomApiStyle
    }
  ): Promise<Record<string, string>> {
    const provider = buildProviderSnapshot({
      providerInstanceId,
      apiKey: overrides?.apiKey,
      baseUrl: overrides?.baseUrl,
      nativeBaseUrl: overrides?.nativeBaseUrl,
      providerKind: overrides?.providerKind,
      apiStyle: overrides?.apiStyle
    })
    const adapter = getProviderAdapter(provider.providerKind)
    if (typeof adapter.fetchVoiceLabels !== 'function') return {}
    return adapter.fetchVoiceLabels(provider)
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

  /**
   * 决策判定（OpenRouter Decisions API）。
   * 走 `decisions` 模态选型；适配器只负责 HTTP，结论与摘要在这里统一算好，
   * 便于图节点 / MCP 工具直接分支，不用各自解析答案形状。
   */
  async generateDecisions(input: GenerateDecisionsInput): Promise<GenerateDecisionsResult> {
    const { provider, modelId } = resolveActiveProvider(
      'decisions',
      input.providerInstanceId,
      input.model
    )
    const adapter = getProviderAdapter(provider.providerKind)
    if (typeof adapter.generateDecisions !== 'function') {
      throw fail(E_DECISIONS_UNSUPPORTED, { provider: provider.label })
    }
    const request = buildDecisionsRequest(input, modelId)
    const response = await adapter.generateDecisions(provider, modelId, {
      state: request.state,
      questions: request.questions,
      sessionId: request.sessionId,
      user: request.user
    })
    const verdicts = resolveDecisionVerdicts(response.answers, input.thresholds)
    return { ...response, verdicts, summary: describeDecisionVerdicts(verdicts) }
  }

  async generateImage(input: GenerateImageInput): Promise<GenerateImageResult> {
    const { provider, modelId } = resolveActiveProvider(
      'image',
      input.providerInstanceId,
      input.model
    )
    // 参考图统一在这里落地为 API 可用形态，并顺手压掉超限的大图（相机原图动辄 20MB，
    // 会被上游按「文件不符合要求」拒掉）；压缩说明与适配器自己的说明（如某模型只收 1 张
    // 参考图、其余未发送）合并后回传给运行日志，两者不能互相覆盖。
    const { urls: inputReferences, notes: shrinkNotes } = ensureApiImageUrlsWithNotes(
      input.inputReferences
    )
    const result = await getProviderAdapter(provider.providerKind).generateImage(
      provider,
      modelId,
      {
        ...input,
        inputReferences
      }
    )
    const referenceNotes = [...shrinkNotes, ...(result.referenceNotes ?? [])]
    return referenceNotes.length ? { ...result, referenceNotes } : result
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
  ): Promise<import('./types').VideoPollResult> {
    return getProviderAdapter(provider.providerKind).pollVideo(provider, job)
  }

  /**
   * 图节点视频生成：参考视频先上传对象存储 → 提交 → 持久化 job → 轮询 → 下载 → 登记资产。
   * 结束后删除临时对象。关软件后可由 videoJobService.resumePending 续取结果。
   */
  async generateVideo(input: GenerateVideoInput): Promise<GenerateVideoResult> {
    // 图节点绑定只用于任务服务回写，不进入供应商提交载荷
    const { graphBinding, ...genInput } = input
    if (!projectService.isOpen()) throw fail(E_NO_PROJECT)

    let uploads: ObjectStorageUploadResult[] = []

    try {
      const prepared = await prepareVideoInputReferencesForApi(genInput)
      uploads = prepared.uploads
      const job = await this.submitVideo(prepared.input)
      const { provider } = resolveActiveProvider(
        'video',
        genInput.providerInstanceId,
        genInput.model
      )

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
    // 绝对 / 相对 URL 都走供应商客户端：OpenRouter 的 `/videos/{id}/content` 与
    // unsigned_urls（同域 content 链）需要 Bearer；旧实现对绝对地址用裸 axios，
    // 完成后 401，再被 videoJob 误计成「轮询连续失败」。
    // World Labs（Marble）的产物地址是自签名 CDN 直链（世界网格 GLB / 高斯泼溅 SPZ / PLY 都走它），
    // 且鉴权是自定义头 WLT-Api-Key 而非 Bearer：带上通用客户端的 Bearer 头会被 CDN 判 401
    // （实测报错「视频已生成但下载失败：Request failed with status code 401」）。
    // 因此对 worldlabs 用裸客户端直连，不附加任何鉴权头 —— 直链自带签名。
    const client =
      provider.providerKind === 'worldlabs'
        ? axios.create({ timeout: 300_000 })
        : createProviderHttpClient(provider, 300_000)
    const response = await client.get(downloadUrl, {
      responseType: 'stream',
      timeout: 300_000
    })
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
  ): Promise<import('./types').VideoPollResult> {
    const token = job.pollingUrl || ''
    // 网格加工任务按 token 里的 op 分发（新旧 token 格式都由 parseMeshOpsJobToken 归一）
    const meshOp = parseMeshOpsJobToken(token)
    if (meshOp) {
      if (meshOp.op === 'rig') return pollCloudModel3dRig(provider, job)
      if (meshOp.op === 'segment' || meshOp.op === 'smartSegment') {
        return pollCloudModel3dSegment(provider, job)
      }
      return pollCloudModel3dPostProcess(provider, job)
    }
    return getProviderAdapter(provider.providerKind).pollModel3d(provider, job)
  }

  /**
   * 对已有 GLB 做独立骨骼蒙皮（Meshy / Tripo Rigging API）。
   * 本地路径会先上传对象存储得到公网 URL。
   */
  async rigModel3d(input: RigModel3dInput): Promise<RigModel3dResult> {
    const { graphBinding, ...rigInput } = input
    if (!projectService.isOpen()) throw fail(E_NO_PROJECT)

    const { provider, modelId } = resolveActiveProvider(
      'model3d',
      rigInput.providerInstanceId,
      rigInput.model
    )
    if (!supportsModel3dRig(provider.providerKind)) {
      throw new Error('GRAPH_MODEL_RIG_PROVIDER')
    }

    let uploads: ObjectStorageUploadResult[] = []
    try {
      let modelUrl = rigInput.modelUrl?.trim() || ''
      if (!modelUrl) {
        const rel = rigInput.modelRelativePath?.trim()
        if (!rel) throw new Error('GRAPH_MODEL_RIG_NO_MODEL')
        const root = projectService.getRoot()
        const { url, uploaded } = await ensureRemoteMediaUrl(rel, {
          sourceLabel: 'model3d-rig-source',
          projectRoot: root
        })
        modelUrl = url
        if (uploaded) uploads.push(uploaded)
      }

      const job = await submitCloudModel3dRig(provider, {
        modelUrl,
        rigType: rigInput.rigType,
        spec: rigInput.spec,
        outFormat: rigInput.outFormat
      })

      const persisted = videoJobService.create({
        kind: 'model3d',
        providerJobId: job.jobId,
        pollingUrl: job.pollingUrl,
        providerInstanceId: provider.id,
        model: modelId || job.model,
        prompt: `rig:${rigInput.rigType || 'humanoid'}`,
        name: rigInput.name,
        source: 'graph',
        outputDir: rigInput.outputDir,
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
      uploads = []

      const settled = await videoJobService.waitUntilSettled(persisted.localJobId)
      if (settled.status !== 'succeeded' || !settled.assetId || !settled.relativePath) {
        throw new Error(settled.error ?? fail(E_MODEL3D_GEN_FAILED).message)
      }
      return {
        assetId: settled.assetId,
        relativePath: settled.relativePath,
        model: settled.model,
        // 下游重定向要用 rig 任务 id（Tripo /v3/animations/retarget 只吃 task_id）
        taskId: job.jobId
      }
    } catch (err) {
      if (uploads.length) await deleteUploads(uploads)
      throw err
    }
  }

  /**
   * 拉取 3D 重定向的可选动画列表（Meshy 动作库；Tripo 用固定 preset 字符串，返回空）。
   */
  async listModel3dAnimations(
    input: ListModel3dAnimationsInput
  ): Promise<Model3dAnimationAction[]> {
    const { provider } = resolveActiveProvider('model3d', input.providerInstanceId)
    const dialect = meshOpsDialectFor(provider.providerKind)
    if (!dialect?.listAnimations) return []
    return dialect.listAnimations(provider, { search: input.search })
  }

  /**
   * 需要上游 task_id 或公网 URL 的后处理：解析输入源。
   *
   * 上游带来的 task id 可能是**别家**的（Tripo 拆分 → 选 Meshy 的贴图节点），
   * 是否可直接用由方言的 `acceptsTaskId` 判定；不认就退回「上传模型换公网 URL」。
   */
  async #resolvePostProcessSource(
    input: Model3dPostProcessInput,
    dialect: MeshOpsDialect
  ): Promise<{ source: string; uploads: ObjectStorageUploadResult[] }> {
    const taskId = input.providerTaskId?.trim()
    if (taskId && dialect.acceptsTaskId(taskId)) return { source: taskId, uploads: [] }
    const url = input.modelUrl?.trim()
    if (url) return { source: url, uploads: [] }
    const rel = input.modelRelativePath?.trim()
    if (!rel) return { source: '', uploads: [] }
    const { url: remote, uploaded } = await ensureRemoteMediaUrl(rel, {
      sourceLabel: `model3d-${input.op}`,
      projectRoot: projectService.getRoot()
    })
    return { source: remote, uploads: uploaded ? [uploaded] : [] }
  }

  /**
   * Tripo 网格后处理 / 骨骼动画：部件补全、重拓扑、绑骨检查、动画重定向。
   * 前两者与重定向走 videoJobService 落盘登记；绑骨检查无产物，就地轮询返回分析结论。
   */
  async postProcessModel3d(input: Model3dPostProcessInput): Promise<Model3dPostProcessResult> {
    const { graphBinding, ...rest } = input
    if (!projectService.isOpen()) throw fail(E_NO_PROJECT)

    const { provider, modelId } = resolveActiveProvider(
      'model3d',
      rest.providerInstanceId,
      rest.model
    )
    // 按 op 逐个校验能力（Meshy 已支持重拓扑 / 贴图，但不支持补全 / 转换 / 重定向）
    if (!meshOpSupported(provider.providerKind, rest.op)) {
      throw new Error('GRAPH_MODEL_POST_PROVIDER')
    }
    const dialect = requireMeshOpsDialect(provider.providerKind)

    if (rest.op === 'rigCheck') {
      const { source } = await this.#resolvePostProcessSource(rest, dialect)
      if (!source) throw new Error('GRAPH_MODEL_POST_NO_MODEL')
      const taskId = await submitCloudRigCheck(provider, {
        providerTaskId: rest.providerTaskId,
        modelUrl: dialect.acceptsTaskId(source) ? undefined : source
      })
      const deadline = Date.now() + RIG_CHECK_TIMEOUT_MS
      for (;;) {
        const poll = await pollCloudRigCheck(provider, taskId)
        if (poll.status === 'completed') {
          return {
            op: 'rigCheck',
            taskId,
            riggable: poll.riggable === true,
            rigType: poll.rigType ?? ''
          }
        }
        if (poll.status === 'failed') {
          throw new Error(poll.error ?? fail(E_MODEL3D_GEN_FAILED).message)
        }
        if (Date.now() > deadline) throw new Error('GRAPH_MODEL_POST_TIMEOUT')
        await sleep(2000)
      }
    }

    let uploads: ObjectStorageUploadResult[] = []
    try {
      const { source, uploads: uploaded } = await this.#resolvePostProcessSource(rest, dialect)
      uploads = uploaded
      const op = rest.op
      const job = await submitCloudModel3dPostProcess(provider, {
        ...rest,
        op,
        ...(dialect.acceptsTaskId(source)
          ? { providerTaskId: source, modelUrl: undefined }
          : { providerTaskId: undefined, modelUrl: source })
      })

      const persisted = videoJobService.create({
        kind: 'model3d',
        providerJobId: job.jobId,
        pollingUrl: job.pollingUrl,
        providerInstanceId: provider.id,
        model: modelId || job.model,
        prompt: `post:${op}`,
        name: rest.name,
        source: 'graph',
        outputDir: rest.outputDir,
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
      uploads = []

      const settled = await videoJobService.waitUntilSettled(persisted.localJobId)
      if (settled.status !== 'succeeded' || !settled.assetId || !settled.relativePath) {
        throw new Error(settled.error ?? fail(E_MODEL3D_GEN_FAILED).message)
      }
      return {
        op,
        taskId: job.jobId,
        assetId: settled.assetId,
        relativePath: settled.relativePath,
        model: settled.model
      }
    } catch (err) {
      if (uploads.length) await deleteUploads(uploads)
      throw err
    }
  }

  /**
   * 对已有 GLB 做拆分（Tripo 网格分割 / 智能分割）。
   * 本地路径会先上传对象存储得到公网 URL；结果按拆分后 GLB 的 node 名解析出部件列表。
   */
  async segmentModel3d(input: SegmentModel3dInput): Promise<SegmentModel3dResult> {
    const { graphBinding, ...segInput } = input
    if (!projectService.isOpen()) throw fail(E_NO_PROJECT)

    const { provider, modelId } = resolveActiveProvider(
      'model3d',
      segInput.providerInstanceId,
      segInput.model
    )
    if (!supportsModel3dSegment(provider.providerKind)) {
      throw new Error('GRAPH_MODEL_SEG_PROVIDER')
    }

    let uploads: ObjectStorageUploadResult[] = []
    try {
      let modelUrl = segInput.modelUrl?.trim() || ''
      if (!modelUrl) {
        const rel = segInput.modelRelativePath?.trim()
        if (!rel) throw new Error('GRAPH_MODEL_SEG_NO_MODEL')
        const root = projectService.getRoot()
        const { url, uploaded } = await ensureRemoteMediaUrl(rel, {
          sourceLabel: 'model3d-segment-source',
          projectRoot: root
        })
        modelUrl = url
        if (uploaded) uploads.push(uploaded)
      }

      const mode: Model3dSegmentMode = segInput.mode === 'smart' ? 'smart' : 'mesh'
      const job = await submitCloudModel3dSegment(provider, {
        modelUrl,
        mode,
        granularity: segInput.granularity,
        splitByConnectivity: segInput.splitByConnectivity,
        smartGranularity: segInput.smartGranularity,
        hint: segInput.hint
      })

      const persisted = videoJobService.create({
        kind: 'model3d',
        providerJobId: job.jobId,
        pollingUrl: job.pollingUrl,
        providerInstanceId: provider.id,
        model: modelId || job.model,
        prompt: `segment:${mode}`,
        name: segInput.name,
        source: 'graph',
        outputDir: segInput.outputDir,
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
      uploads = []

      const settled = await videoJobService.waitUntilSettled(persisted.localJobId)
      if (settled.status !== 'succeeded' || !settled.assetId || !settled.relativePath) {
        throw new Error(settled.error ?? fail(E_MODEL3D_GEN_FAILED).message)
      }

      const parts = readGlbPartNames(join(projectService.getRoot(), settled.relativePath))
      const extras = await fetchCloudModel3dSegmentExtras(provider, job)
      return {
        assetId: settled.assetId,
        relativePath: settled.relativePath,
        model: settled.model,
        mode,
        parts,
        // 部件补全只吃 mesh/segment 的任务 id：智能分割取其中的子任务 id
        taskId: extras.segTaskId ?? job.jobId,
        ...extras
      }
    } catch (err) {
      if (uploads.length) await deleteUploads(uploads)
      throw err
    }
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
      const { provider } = resolveActiveProvider(
        'model3d',
        genInput.providerInstanceId,
        genInput.model
      )
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

  /**
   * 提交世界生成（World Labs Marble）。未实现 submitSpatialWorld 的适配器直接给出「不支持」错误，
   * 避免落到「未配置提供商」这种误导性提示（用户其实配了别的模态的提供商）。
   */
  async submitSpatialWorld(input: GenerateSpatialWorldInput): Promise<GenerateSpatialWorldJob> {
    const { provider, modelId } = resolveActiveProvider(
      'spatialWorld',
      input.providerInstanceId,
      input.model
    )
    const adapter = getProviderAdapter(provider.providerKind)
    if (!adapter.submitSpatialWorld) throw fail(E_WORLD_UNSUPPORTED)
    return adapter.submitSpatialWorld(provider, modelId, input)
  }

  async pollWorld(
    provider: ModelProviderInstance,
    job: { jobId: string; pollingUrl: string }
  ): Promise<import('./types').VideoPollResult> {
    const adapter = getProviderAdapter(provider.providerKind)
    if (!adapter.pollWorld) throw fail(E_WORLD_UNSUPPORTED)
    return adapter.pollWorld(provider, job)
  }

  /** 轮询空间世界导出 operation（HQ 网格导出走 videoJobService，这里只做分发） */
  async pollSpatialWorldExport(
    provider: ModelProviderInstance,
    job: { jobId: string; pollingUrl: string }
  ): Promise<import('./types').VideoPollResult> {
    const adapter = getProviderAdapter(provider.providerKind)
    if (!adapter.pollSpatialWorldExport) throw fail(E_WORLD_UNSUPPORTED)
    return adapter.pollSpatialWorldExport(provider, job)
  }

  /**
   * 参考媒体准备（图 / 视频通用）：
   * - 已是公网 http(s) → 原样保留为 `uri` 形态（上游自行抓取；注意上游抓取不带 cookie / referer，
   *   防盗链地址会 400，此时应改用本地文件走托管上传）；
   * - data URL / 工程相对路径 / 本地绝对路径 → **优先**走官方托管媒体（`media-assets:prepare_upload`
   *   + 签名地址 PUT），这样**不需要用户配置对象存储**；
   * - 托管媒体失败时退回对象存储公网 URL（老路径），两条都失败则把两条原因一起抛出，
   *   不留「只报一条、另一条猜」的坑。
   */
  async prepareWorldInputReferencesForApi(
    provider: ModelProviderInstance,
    input: GenerateSpatialWorldInput
  ): Promise<{
    input: GenerateSpatialWorldInput
    uploads: ObjectStorageUploadResult[]
    notes: string[]
  }> {
    const refs = input.inputReferences ?? []
    const seeded = input.mediaAssets ?? []
    if (!refs.length) return { input, uploads: [], notes: [] }

    const uploads: ObjectStorageUploadResult[] = []
    const notes: string[] = []
    const nextRefs: NonNullable<GenerateSpatialWorldInput['inputReferences']> = []
    const mediaAssets = [...seeded]
    const root = projectService.isOpen() ? projectService.getRoot() : undefined
    let hostedCount = 0

    try {
      for (let i = 0; i < refs.length; i++) {
        const normalized = normalizeVideoInputReference(refs[i]!)
        const rawUrl = normalized.url.trim()
        if (!rawUrl) continue
        if (/^https?:\/\//i.test(rawUrl)) {
          nextRefs.push({ kind: normalized.kind, url: rawUrl })
          continue
        }

        const kind = normalized.kind === 'video_url' ? 'video' : 'image'
        const media = readWorldReferenceMedia(rawUrl, root)
        try {
          mediaAssets.push(
            await uploadWorldlabsMediaAsset({
              provider,
              bytes: media.bytes,
              kind,
              fileName: media.fileName,
              extension: media.extension,
              contentType: media.contentType
            })
          )
          hostedCount++
        } catch (mediaErr) {
          const mediaDetail = mediaErr instanceof Error ? mediaErr.message : String(mediaErr)
          notes.push(
            `world reference: World Labs media asset upload failed (${mediaDetail}); falling back to object storage`
          )
          try {
            const { url, uploaded } = await ensureRemoteMediaUrl(rawUrl, {
              sourceLabel: `world-ref-${i + 1}`,
              projectRoot: root
            })
            if (uploaded) uploads.push(uploaded)
            nextRefs.push({ kind: normalized.kind, url })
          } catch (storageErr) {
            throw fail(E_WORLD_REF_UPLOAD_FAILED, {
              media: mediaDetail,
              storage: storageErr instanceof Error ? storageErr.message : String(storageErr)
            })
          }
        }
      }
    } catch (err) {
      await deleteUploads(uploads)
      throw err
    }

    if (hostedCount > 0) {
      notes.push(
        `world reference: uploaded ${hostedCount} file(s) to World Labs media assets (no object storage needed)`
      )
    }

    return { input: { ...input, inputReferences: nextRefs, mediaAssets }, uploads, notes }
  }

  /**
   * 找回某个节点产出的空间世界的 world_id。
   *
   * `world_id` 只活在节点出口值与任务记录（`resourceId`）两处，两边都可能在旧版本里缺；
   * 而世界生成的积分**已经花过**，不能因为一个字段没存住就逼用户重新生成一次世界。
   * 两条通道，都不猜：
   * 1. 任务记录里已经存了 `resourceId` → 直接用（含「修好之后再问一次」的情况）；
   * 2. 记录里有 **operation id**（`providerJobId` / `pollingUrl`）→ 重新 GET 一次
   *    `/operations/{id}`：operation 的响应里带 World 对象，顺手把 id 补写回记录，
   *    以后就不用再问上游了。
   *
   * 只有「同一条世界生成任务」才认（按生成节点 / 模型资产匹配），找不到返回 undefined。
   */
  async recoverSpatialWorldId(input: {
    nodeId?: string
    assetId?: string
  }): Promise<string | undefined> {
    if (!projectService.isOpen()) return undefined

    // 候选记录的挑选规则与渲染端同一份实现（先按生成节点、再按模型资产）
    const candidates = pickSpatialWorldJobs(videoJobService.list(), input)
    if (!candidates.length) return undefined

    const stored = candidates.find((job) => job.resourceId?.trim())
    if (stored) return stored.resourceId!.trim()

    // 记录里没存住：拿 operation id 再问上游一次
    for (const job of candidates) {
      const operationId = job.providerJobId?.trim() || job.pollingUrl?.trim()
      if (!operationId) continue
      const provider = findProviderById(
        settingsService.get().models.providers,
        job.providerInstanceId
      )
      if (!provider) continue
      try {
        const result = await this.pollWorld(provider, {
          jobId: operationId,
          pollingUrl: job.pollingUrl?.trim() || operationId
        })
        const recovered = result.resourceId?.trim()
        if (!recovered) continue
        try {
          videoJobRepository.patch(projectService.getRoot(), job.localJobId, {
            resourceId: recovered
          })
        } catch (err) {
          // 补写只是省下一次上游往返，失败不影响本次结果
          console.warn('[worldlabs] failed to persist the recovered world id:', err)
        }
        return recovered
      } catch (err) {
        console.warn('[worldlabs] re-polling the operation for a world id failed:', err)
      }
    }
    return undefined
  }

  /**
   * 图节点空间世界生成：参考媒体上传（World Labs 托管媒体优先，对象存储兜底）→ 提交 → 持久化 job
   * → 轮询 → 下载 GLB → 登记资产。结束后删除对象存储临时对象；
   * 与 3D 模型同一套 videoJobService 续跑机制（关软件后可恢复轮询）。
   */
  async generateSpatialWorld(
    input: GenerateSpatialWorldInput
  ): Promise<GenerateSpatialWorldResult> {
    // 图节点绑定只用于任务服务回写，不进入供应商提交载荷
    const { graphBinding, ...genInput } = input
    if (!projectService.isOpen()) throw fail(E_NO_PROJECT)

    let uploads: ObjectStorageUploadResult[] = []

    try {
      // 参考媒体的托管上传需要 provider（鉴权头与 baseURL），所以先解析提供商
      const { provider } = resolveActiveProvider(
        'spatialWorld',
        genInput.providerInstanceId,
        genInput.model
      )
      const prepared = await this.prepareWorldInputReferencesForApi(provider, genInput)
      uploads = prepared.uploads
      const job = await this.submitSpatialWorld(prepared.input)

      const persisted = videoJobService.create({
        kind: 'spatialWorld',
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
        throw new Error(settled.error ?? fail(E_WORLD_GEN_FAILED).message)
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
        })),
        referenceNotes: prepared.notes.length ? prepared.notes : undefined,
        extras: settled.extras?.length
          ? settled.extras.map((item) => ({ kind: item.kind, relativePath: item.relativePath }))
          : undefined,
        // 世界 id 透给下游「空间世界导出」节点（导出端点只认它）
        spatialWorldId: settled.resourceId?.trim() || undefined
      }
    } catch (err) {
      if (uploads.length) await deleteUploads(uploads)
      throw err
    }
  }

  /**
   * 空间世界导出（官方 `worlds/{id}:export`），按官方两种资产族分成两条路：
   * - `mesh`（HQ 贴图 / 顶点色网格，GLB）：异步、最长约 1 小时 → 走 videoJobService
   *   （持久化任务、可续拉、进度与取消都在任务列表里），产物**登记为模型资产**；
   * - `splats`（PLY 泼溅）：官方同步转换、提交即完成 → 就地轮询兜底，直接落到上游世界的
   *   同目录同名文件（`world.glb` → `world.ply`），**不登记资产**（PLY 在应用内没有预览通道）。
   */
  async exportWorld(input: ExportWorldInput): Promise<ExportWorldResult> {
    const { graphBinding, ...exportInput } = input
    if (!projectService.isOpen()) throw fail(E_NO_PROJECT)

    const { provider, modelId } = resolveActiveProvider(
      'spatialWorld',
      exportInput.providerInstanceId,
      exportInput.model
    )
    const adapter = getProviderAdapter(provider.providerKind)
    if (!adapter.submitSpatialWorldExport || !adapter.pollSpatialWorldExport)
      throw fail(E_WORLD_UNSUPPORTED)

    const request: SpatialWorldExportRequest = {
      spatialWorldId: exportInput.spatialWorldId,
      assetType: exportInput.assetType,
      format: exportInput.format,
      ...(exportInput.assetType === 'mesh' && exportInput.meshVariant
        ? { meshVariant: exportInput.meshVariant }
        : {}),
      ...(exportInput.assetType === 'splats' && exportInput.resolution
        ? { resolution: exportInput.resolution }
        : {})
    }

    if (exportInput.assetType === 'splats') {
      return this.#exportWorldSplats(provider, request, exportInput)
    }

    const job = await adapter.submitSpatialWorldExport(provider, request.spatialWorldId, request)
    const persisted = videoJobService.create({
      kind: 'spatialWorldExport',
      providerJobId: job.jobId,
      pollingUrl: job.pollingUrl,
      providerInstanceId: provider.id,
      model: modelId || 'marble-1.1',
      prompt: `export:mesh:${request.meshVariant ?? 'textured'}`,
      name: exportInput.name,
      source: 'graph',
      outputDir: exportInput.outputDir,
      graphBinding
    })

    const settled = await videoJobService.waitUntilSettled(persisted.localJobId)
    if (settled.status !== 'succeeded' || !settled.assetId || !settled.relativePath) {
      throw new Error(settled.error ?? fail(E_WORLD_GEN_FAILED).message)
    }
    return {
      assetId: settled.assetId,
      relativePath: settled.relativePath,
      model: settled.model,
      assetType: 'mesh',
      format: 'glb'
    }
  }

  /** PLY 泼溅导出：同步转换 → 落到上游世界旁边（没有可注册的资产类型） */
  async #exportWorldSplats(
    provider: ModelProviderInstance,
    request: SpatialWorldExportRequest,
    input: Omit<ExportWorldInput, 'graphBinding'>
  ): Promise<ExportWorldResult> {
    const adapter = getProviderAdapter(provider.providerKind)
    if (!adapter.submitSpatialWorldExport || !adapter.pollSpatialWorldExport)
      throw fail(E_WORLD_UNSUPPORTED)

    const source = input.sourceRelativePath?.trim() ?? ''
    if (!source) throw fail(E_WORLD_EXPORT_NO_SOURCE)

    const job = await adapter.submitSpatialWorldExport(provider, request.spatialWorldId, request)
    let downloadUrl = job.downloadUrl?.trim() ?? ''
    if (!downloadUrl) {
      // 官方文档说 PLY 是同步转换；万一上游仍给进行中的 operation，就在就地轮询里等它
      const deadline = Date.now() + WORLD_EXPORT_POLL_TIMEOUT_MS
      for (;;) {
        const poll = await adapter.pollSpatialWorldExport(provider, job)
        if (poll.status === 'failed') {
          throw new Error(poll.error ?? fail(E_WORLD_GEN_FAILED).message)
        }
        if (poll.status === 'completed' && poll.downloadUrl) {
          downloadUrl = poll.downloadUrl
          break
        }
        if (Date.now() > deadline) throw fail(E_WORLD_EXPORT_TIMEOUT)
        await sleep(3000)
      }
    }

    const relativePath = siblingOutputPath(source, '.ply')
    const root = projectService.getRoot()
    const absPath = join(root, relativePath)
    await this.downloadVideoToFile(provider, downloadUrl, absPath)
    // 与模型 / 网格导出同一口径：泼溅也要进资产库，否则导演台的 in-model 口接不到
    const asset = projectService.attachExternalGeneratedFile({
      type: 'model',
      sourceFilePath: absPath,
      name: input.name ?? `空间世界泼溅 ${new Date().toLocaleString()}`,
      prompt: `export:splats:${request.resolution ?? 'full_res'}`,
      outputDir: input.outputDir
    })
    return {
      assetId: asset.id,
      relativePath: asset.relativePath ?? relativePath,
      model: input.model?.trim() || 'marble-1.1',
      assetType: 'splats',
      format: 'ply'
    }
  }

  async generateImageAsset(
    input: GenerateImageInput & { name?: string; outputDir?: string }
  ): Promise<{
    assetId: string
    model: string
    relativePath: string
    /** 参考图处理说明（如超限自动压缩），随结果回传给运行日志 */
    referenceNotes?: string[]
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
      outputDir: resolveMediaOutputDir({
        mediaOutputDir: input.outputDir,
        cacheOutputDir: projectService.getConfig().cacheOutputDir,
        kind: 'image'
      })
    })
    return {
      assetId: asset.id,
      model: result.model,
      relativePath: asset.relativePath,
      referenceNotes: result.referenceNotes
    }
  }

  async generateSpeech(input: GenerateSpeechInput): Promise<GenerateSpeechResult> {
    const resolved = await this.applyVoiceProfile(input)
    const { provider, modelId } = resolveActiveProvider(
      'audio',
      resolved.providerInstanceId,
      resolved.model
    )
    // 声音没显式给：用设置里 audio 页签选定的默认声音，再退回模型目录里声明的第一个
    const voice = resolved.voice?.trim() || resolveDefaultVoice(provider, modelId)
    return getProviderAdapter(provider.providerKind).generateSpeech(provider, modelId, {
      ...resolved,
      ...(voice ? { voice } : {})
    })
  }

  /** 按角色音色档案解析语音参数：角色已建档 → 未显式传的 voice / referenceAudio 取自档案 */
  private async applyVoiceProfile(input: GenerateSpeechInput): Promise<GenerateSpeechInput> {
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
      outputDir: resolveMediaOutputDir({
        mediaOutputDir: input.outputDir,
        cacheOutputDir: projectService.getConfig().cacheOutputDir,
        kind: 'voice'
      })
    })
    return { ...result, assetId: asset.id, relativePath: asset.relativePath }
  }

  /**
   * 音效生成 → 工程声音资产（ElevenLabs `/v1/sound-generation`）。
   * 与音乐同一条落盘模式，但目录类型是 `sfx`（Cache/Sfx），便于时间线音效轨直接取用。
   *
   * **中文等非拉丁描述会先译成英文**：上游对中文会念出描述（像 TTS），
   * 对话面板之所以正常是因为 LLM 先改写成了英文；节点路径在这里对齐。
   */
  async generateSoundEffectAsset(
    input: GenerateSoundEffectInput & { outputDir?: string }
  ): Promise<GenerateMusicAssetResult> {
    if (!projectService.isOpen()) throw fail(E_NO_PROJECT)
    // 按**能力**解析（不是按 audio 模态）：音效只有 ElevenLabs 实现了该端点，
    // 用 resolveActiveProvider('audio', …) 会选中一家只会 TTS 的（OpenAI / MiniMax /
    // 方舟都算），然后在下一行报「不支持」—— 用户看到的是「我配了 ElevenLabs 却说不支持」
    const { provider, modelId } = resolveActiveSoundEffectProvider(input.providerInstanceId)
    const adapter = getProviderAdapter(provider.providerKind)
    if (!adapter.generateSoundEffect) throw fail(E_SOUND_EFFECT_UNSUPPORTED)

    const resolvedPrompt = await this.resolveSoundEffectPromptForUpstream(input.prompt)
    const result = await adapter.generateSoundEffect(provider, modelId, {
      ...input,
      prompt: resolvedPrompt
    })

    // 与音乐同形：两种取回方式（本地临时文件 / 下载地址）
    const dir = mkdtempSync(join(tmpdir(), 'aiae-sfx-'))
    const dest = join(dir, `sfx-${Date.now()}.mp3`)
    if (result.filePath?.trim()) {
      copyFileSync(result.filePath.trim(), dest)
    } else if (result.downloadUrl?.trim()) {
      await this.downloadVideoToFile(provider, result.downloadUrl.trim(), dest)
    } else {
      throw fail(E_MUSIC_NO_AUDIO)
    }

    const outputDir = resolveMediaOutputDir({
      mediaOutputDir: input.outputDir,
      cacheOutputDir: projectService.getConfig().cacheOutputDir,
      kind: 'sfx'
    })
    const asset = projectService.attachExternalGeneratedFile({
      type: 'voice',
      sourceFilePath: dest,
      // 资产卡仍保留用户原文，便于回看；真正发给上游的是 resolvedPrompt
      name: input.name ?? `生成音效 ${new Date().toLocaleString()}`,
      prompt: input.prompt,
      outputDir
    })
    return {
      assetId: asset.id,
      relativePath: asset.relativePath,
      model: result.model,
      durationMs: result.durationMs,
      ...(resolvedPrompt !== input.prompt.trim() ? { resolvedPrompt } : {})
    }
  }

  /**
   * 音效描述规范化：含中日韩等文字时译成英文音效提示词。
   * 英文 / 纯拟声可直接上送，避免多余一次文本调用。
   */
  private async resolveSoundEffectPromptForUpstream(raw: string): Promise<string> {
    const prompt = raw.trim()
    if (!prompt || !soundEffectPromptNeedsEnglish(prompt)) return prompt
    try {
      const translated = await this.generateText({
        system:
          'You translate sound-effect descriptions into concise English for ElevenLabs text-to-sound. ' +
          'Output ONLY the English audio description. Keep audio terms (whoosh, braam, rumble, reverb, ambient, impact). ' +
          'Do not add quotes, labels, or explanation. Never write dialogue to be spoken.',
        prompt
      })
      const text = translated.text?.trim() ?? ''
      // 去掉模型可能包的引号；译完仍全是非拉丁就当失败
      const cleaned = text.replace(/^["「『]+|["」』]+$/g, '').trim()
      if (!cleaned || soundEffectPromptNeedsEnglish(cleaned)) {
        throw fail(E_SOUND_EFFECT_PROMPT_TRANSLATE_FAILED)
      }
      return cleaned
    } catch (err) {
      if (isAppError(err) && err.code === E_SOUND_EFFECT_PROMPT_TRANSLATE_FAILED.code) throw err
      throw fail(E_SOUND_EFFECT_PROMPT_TRANSLATE_FAILED)
    }
  }

  /**
   * BGM / 音乐生成（同步）：选型 → 派发到适配器 → 返回音频下载地址。
   * 未配置支持音乐的提供商/模型时给出引导文案。
   */
  async generateMusic(input: GenerateMusicInput): Promise<GenerateMusicResult> {
    const { provider, modelId } = resolveActiveMusicProvider(input.providerInstanceId, input.model)
    const adapter = getProviderAdapter(provider.providerKind)
    if (!adapter.generateMusic) throw fail(E_MUSIC_UNSUPPORTED)
    return adapter.generateMusic(provider, modelId, input)
  }

  /** BGM 生成 → 工程声音资产：下载 → 落盘 Cache/Music（不自动进资产库，可手动入库） */
  async generateMusicAsset(
    input: GenerateMusicInput & { outputDir?: string }
  ): Promise<GenerateMusicAssetResult> {
    if (!projectService.isOpen()) throw fail(E_NO_PROJECT)
    const { provider } = resolveActiveMusicProvider(input.providerInstanceId, input.model)
    const result = await this.generateMusic(input)

    // 中间文件始终写系统临时目录，由 attachExternalGeneratedFile 统一拷入最终目录
    const dir = mkdtempSync(join(tmpdir(), 'aiae-music-'))
    const dest = join(dir, `music-${Date.now()}.mp3`)
    if (result.filePath?.trim()) {
      // 上游直接回音频字节（ElevenLabs /v1/music）：它已落在临时目录，拷进本轮中间目录即可
      copyFileSync(result.filePath.trim(), dest)
    } else if (result.downloadUrl?.trim()) {
      await this.downloadVideoToFile(provider, result.downloadUrl.trim(), dest)
    } else {
      throw fail(E_MUSIC_NO_AUDIO)
    }

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
      p.enabled &&
      (p.apiKey.trim().length > 0 || allowsEmptyApiKey(p)) &&
      Boolean(getProviderAdapter(p.providerKind).transcribeAudio)

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
