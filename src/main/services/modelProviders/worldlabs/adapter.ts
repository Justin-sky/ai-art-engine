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
  GenerateSpatialWorldInput,
  GenerateSpatialWorldJob,
  ModelModality,
  ModelProviderInstance,
  SpatialWorldExportJob,
  SpatialWorldExportRequest
} from '@shared/modelProvider'
import axios from 'axios'
import type { ModelProviderAdapter, VideoPollResult } from '../types'
import { fail, defErr, defErrSimple, isAppError } from '@shared/errors/appError'
import { createWorldlabsHttpClient, readWorldlabsHttpError } from './http'

// ── 本文件错误条目（catalog 未覆盖的个性文案）──
const E_WORLDLABS_CONNECTION_TEST_FAILED = defErr<{ detail: string }>(
  'provider.worldlabs.connectionTestFailed',
  ({ detail }) => `World Labs 连接测试失败: ${detail}`,
  ({ detail }) => `World Labs connection test failed: ${detail}`
)
const E_WORLDLABS_TEXT_UNSUPPORTED = defErrSimple(
  'provider.worldlabs.textUnsupported',
  'World Labs 不支持文本生成',
  'World Labs does not support text generation'
)
const E_WORLDLABS_IMAGE_UNSUPPORTED = defErrSimple(
  'provider.worldlabs.imageUnsupported',
  'World Labs 不支持图片生成',
  'World Labs does not support image generation'
)
const E_WORLDLABS_VIDEO_UNSUPPORTED = defErrSimple(
  'provider.worldlabs.videoUnsupported',
  'World Labs 不支持视频生成',
  'World Labs does not support video generation'
)
const E_WORLDLABS_SPEECH_UNSUPPORTED = defErrSimple(
  'provider.worldlabs.speechUnsupported',
  'World Labs 不支持语音合成',
  'World Labs does not support speech synthesis'
)
const E_WORLDLABS_MODEL3D_UNSUPPORTED = defErrSimple(
  'provider.worldlabs.model3dUnsupported',
  'World Labs 是空间世界提供商：请使用世界生成，而非 3D 模型生成节点',
  'World Labs is a world-model provider: use world generation instead of the 3D model node'
)
const E_WORLDLABS_NO_OPERATION_ID = defErrSimple(
  'provider.worldlabs.noOperationId',
  'World Labs 未返回生成任务 operation id',
  'World Labs returned no operation id'
)
/** 上游响应原文作为 detail 原样嵌入 */
const E_WORLDLABS_SUBMIT_WORLD_FAILED = defErr<{ detail: string }>(
  'provider.worldlabs.submitSpatialWorldFailed',
  ({ detail }) => `提交 World Labs 世界生成失败: ${detail}`,
  ({ detail }) => `Submitting World Labs world generation failed: ${detail}`
)
const E_WORLDLABS_NO_CREDITS = defErr<{ detail: string }>(
  'provider.worldlabs.noCredits',
  ({ detail }) =>
    `World Labs API 积分不足（${detail}）：请到 platform.worldlabs.ai/billing 充值——API 积分与 Marble 应用积分分开计费`,
  ({ detail }) =>
    `World Labs API credits are insufficient (${detail}): top up at platform.worldlabs.ai/billing — API credits are billed separately from Marble app credits`
)
const E_WORLDLABS_RATE_LIMITED = defErr<{ detail: string }>(
  'provider.worldlabs.rateLimited',
  ({ detail }) => `已触发 World Labs 限流（${detail}）：请稍后重试`,
  ({ detail }) => `World Labs rate limit hit (${detail}): retry later`
)
const E_WORLDLABS_POLL_WORLD_FAILED = defErr<{ detail: string }>(
  'provider.worldlabs.pollWorldFailed',
  ({ detail }) => `轮询 World Labs 世界生成失败: ${detail}`,
  ({ detail }) => `Polling World Labs world generation failed: ${detail}`
)
const E_WORLDLABS_GEN_FAILED = defErr<{ detail: string }>(
  'provider.worldlabs.generationFailed',
  ({ detail }) => `World Labs 世界生成失败: ${detail}`,
  ({ detail }) => `World Labs world generation failed: ${detail}`
)
const E_WORLDLABS_NO_MESH = defErrSimple(
  'provider.worldlabs.noWorldMesh',
  'World Labs 世界已生成但未返回网格资产',
  'World Labs world finished but returned no mesh asset'
)
const E_WORLDLABS_EXPORT_FAILED = defErr<{ detail: string }>(
  'provider.worldlabs.exportFailed',
  ({ detail }) => `World Labs 空间世界导出失败: ${detail}`,
  ({ detail }) => `World Labs world export failed: ${detail}`
)
const E_WORLDLABS_EXPORT_SUBMIT_FAILED = defErr<{ detail: string }>(
  'provider.worldlabs.exportSubmitFailed',
  ({ detail }) => `提交 World Labs 空间世界导出失败: ${detail}`,
  ({ detail }) => `Submitting the World Labs world export failed: ${detail}`
)
const E_WORLDLABS_EXPORT_NO_URL = defErrSimple(
  'provider.worldlabs.exportNoUrl',
  'World Labs 空间世界导出完成但未返回下载地址',
  'World Labs world export finished but returned no download URL'
)
const E_WORLDLABS_NO_WORLD_ID = defErrSimple(
  'provider.worldlabs.noWorldId',
  '空间世界导出缺少 world_id：上游接「空间世界生成」节点（导出端点只认它返回的世界 id）',
  'World export is missing the world_id: connect a world generation node upstream (the export endpoint only accepts the world id it returns)'
)
const E_WORLDLABS_NO_PROMPT = defErrSimple(
  'provider.worldlabs.noPrompt',
  '世界生成需要提示词，或一张参考图 / 一段参考视频（只给空文本会被上游拒绝）',
  'World generation needs a text prompt, or a reference image / video (an empty text-only request is rejected upstream)'
)

/**
 * World Labs（Marble）空间世界生成适配器
 *
 * API 文档: https://docs.worldlabs.ai/api
 * 异步 submit → poll 模式（Google AIP 风格自定义方法）：
 *   - GET  /marble/v1/credits                     剩余额度（鉴权验证用，不产生费用）
 *   - POST /marble/v1/worlds:generate              发起世界生成（返回 operation_id）
 *   - GET  /marble/v1/operations/{operation_id}    轮询（done=true 时 response 为 World）
 *
 * world_prompt 四种互斥输入：text（文本）/ image（单图）/ multi-image（多图同场景，最多 4 张）/
 * video（参考视频，1 条）。三种视觉形态都可再带 text_prompt 作补充描述；
 * 参考图 / 视频都走公网 uri（本地文件与 data URL 由门面上传对象存储后替换为公网 URL）。
 * 官方 schema 要点（https://docs.worldlabs.ai/api/reference/worlds/generate）：
 *   - 请求体只有 world_prompt 必填；display_name ≤ 64 字符、seed 为 0–4294967295 的整数；
 *   - 视觉输入走 UriReference `{ source: 'uri', uri }`（另有 media_asset / data_base64 形态未接）；
 *   - 参考视频推荐 mp4 / webm / mov / avi，**单条上限 100MB**；
 *   - 未显式给 text_prompt 时上游会自动「recaption」补一段描述（text 形态则必填）。
 * 模型：marble-1.1（标准）/ marble-1.1-plus（更大世界，消耗更多积分）；另有上一代
 * marble-1.0 / marble-1.0-draft。
 * 生成耗时约 5 分钟；完成时 World.assets 里同时给出：
 *   - `mesh.collider_mesh_url`：粗网格 GLB（10–20 万三角面，物理碰撞用）→ 主产物直接落盘
 *   - `splats.spz_urls`：高斯泼溅 SPZ（约 2M splats，引擎导入首选）
 *   - `imagery.pano_url`：360 等距柱状全景图（2560×1280）
 * 后两者**随 world 一起返回、不额外扣积分**，由 videoJobService 作为「附加产物」下载到主产物旁边。
 * 需要 PLY 泼溅或 HQ 贴图网格时官方另有 `worlds/{id}:export`（PLY 同步、HQ 网格异步且最长约 1 小时、
 * 限速 4 次/小时、单独计费）：当前版本没接，按需再加。
 */

/** marble 模型 id 白名单：目录 id 即 API model 参数（官方 4 档，1.0 两档为上一代） */
const WORLDLABS_MODEL_IDS = new Set([
  'marble-1.1',
  'marble-1.1-plus',
  'marble-1.0',
  'marble-1.0-draft'
])

function resolveModelId(modelId: string): string {
  const id = modelId.trim().toLowerCase()
  return WORLDLABS_MODEL_IDS.has(id) ? id : 'marble-1.1'
}

/** axios 错误的 HTTP 状态码（非 axios 错误返回 undefined） */
function httpStatusOf(err: unknown): number | undefined {
  return axios.isAxiosError(err) ? err.response?.status : undefined
}

/**
 * 参考图统一解析为公网 URL（字符串或 image_url 引用都支持）。
 * video_url 引用在这里被排除：它走 `videoReferenceUrl` 的 video world_prompt 分支。
 */
function imageReferenceUrls(input: GenerateSpatialWorldInput): string[] {
  return (input.inputReferences ?? [])
    .map((r) => {
      if (typeof r === 'string') return r.trim()
      if (r.kind !== 'image_url') return ''
      return r.url?.trim() ?? ''
    })
    .filter((u): u is string => Boolean(u && /^https?:\/\//i.test(u)))
}

/**
 * 参考视频统一解析为公网 URL（只认 video_url 引用）。
 * World Labs 的 video world_prompt 只吃 1 条，多给也只取第一条。
 */
function videoReferenceUrl(input: GenerateSpatialWorldInput): string {
  const hit = (input.inputReferences ?? []).find(
    (r) => typeof r !== 'string' && r.kind === 'video_url'
  )
  const url = typeof hit === 'string' ? '' : (hit?.url?.trim() ?? '')
  return /^https?:\/\//i.test(url) ? url : ''
}

/** 托管媒体（media_asset）引用：官方三种引用形态之一，不依赖对象存储 */
function mediaAssetIds(input: GenerateSpatialWorldInput, kind: 'image' | 'video'): string[] {
  return (input.mediaAssets ?? [])
    .filter((item) => item.kind === kind)
    .map((item) => item.id?.trim() ?? '')
    .filter(Boolean)
}

/**
 * 单个媒体来源 → 官方 `UriReference | MediaAssetReference`。
 * uri 与 media_asset 两种形态在 world_prompt 里同构，故这里统一产出。
 */
function mediaReference(
  uri: string | undefined,
  mediaAssetId: string | undefined
): Record<string, unknown> | undefined {
  if (uri) return { source: 'uri', uri }
  if (mediaAssetId) return { source: 'media_asset', media_asset_id: mediaAssetId }
  return undefined
}

/** World 对象（GetOperationResponse.response 的 done 分支） */
type WorldlabsWorld = {
  id?: string
  /**
   * 世界 id 的另一些可能写法。同一次轮询里 `mesh.*_url` 拿得到、`id` 却拿不到，
   * 说明上游把 id 放在别的键上（官方文档未逐字段固定），所以这里都试一遍。
   * 拿不到 world_id 的后果很重：世界本身照样下载得下来，但「空间世界导出」永远用不了它。
   */
  world_id?: string
  worldId?: string
  /** 某些形态把 World 再包一层 */
  world?: { id?: string; world_id?: string }
  assets?: {
    thumbnail_url?: string
    mesh?: {
      collider_mesh_url?: string
      hq_mesh_url?: string
      full_res_mesh_url?: string
    }
    splats?: { spz_urls?: Record<string, string> }
    imagery?: { pano_url?: string }
  }
}

/** GET /marble/v1/operations/{id} 响应 */
type WorldlabsOperation = {
  operation_id?: string
  done?: boolean
  error?: { code?: number | null; message?: string | null } | null
  response?: WorldlabsWorld | null
}

/** 导出操作 done 分支的 response（ExportWorldResult） */
type WorldlabsExportResult = {
  asset_type?: 'splats' | 'mesh'
  format?: 'ply' | 'glb'
  mesh_variant?: 'textured' | 'vertex_colored' | null
  resolution?: string | null
  url?: string
}

/** 导出请求 / 提交结果类型定义在 @shared/modelProvider（门面与 IPC 共用同一份） */
export type { SpatialWorldExportJob, SpatialWorldExportRequest } from '@shared/modelProvider'

/** 请求体：官方只认 asset_type + format，其余按类型带上 */
function buildExportBody(request: SpatialWorldExportRequest): Record<string, unknown> {
  const body: Record<string, unknown> = {
    asset_type: request.assetType,
    format: request.format
  }
  if (request.assetType === 'mesh' && request.meshVariant) {
    body.mesh_variant = request.meshVariant
  }
  if (request.assetType === 'splats' && request.resolution) {
    body.resolution = request.resolution
  }
  return body
}

/** 导出 operation → 轮询结果（response.url 是下载地址） */
function parseExportOperation(operation: WorldlabsOperation | null | undefined): VideoPollResult {
  if (!operation) return { status: 'pending', progress: 10 }
  if (operation.error && (operation.error.message || operation.error.code != null)) {
    return {
      status: 'failed',
      progress: 100,
      error: fail(E_WORLDLABS_EXPORT_FAILED, {
        detail: operation.error.message || `code=${operation.error.code}`
      }).message
    }
  }
  if (!operation.done) return { status: 'in_progress', progress: 50 }
  const url = (operation.response as WorldlabsExportResult | null)?.url?.trim() ?? ''
  if (!url) {
    return { status: 'failed', progress: 100, error: fail(E_WORLDLABS_EXPORT_NO_URL).message }
  }
  return { status: 'completed', progress: 100, downloadUrl: url }
}

/**
 * 按参考输入构造 world_prompt。四种互斥形态（文本 / 单图 / 多图同场景 / 视频）：
 * - 有参考视频（uri 或 media_asset）→ `video`（视频信息量最大，与执行器「视频优先于图片」同一口径）；
 * - 无视频：0 图 → `text`，1 图 → `image`（可带 `is_pano`），2–4 图 → `multi-image`（最多 4 张）。
 * 三种视觉形态都可再带一段 `text_prompt` 作为补充描述；`disable_recaption` 四种形态通用。
 */
function buildWorldPrompt(input: GenerateSpatialWorldInput): Record<string, unknown> {
  const text = input.prompt?.trim() || ''
  const noRecaption = input.disableRecaption === true ? { disable_recaption: true } : {}

  const videoRef = mediaReference(videoReferenceUrl(input), mediaAssetIds(input, 'video')[0])
  if (videoRef) {
    return {
      type: 'video',
      video_prompt: videoRef,
      ...(text ? { text_prompt: text } : {}),
      ...noRecaption
    }
  }

  // 图片形态：uri 引用在前，托管媒体（media_asset）在后，两种都按官方上限截到 4 张
  const imageRefs: Array<Record<string, unknown>> = [
    ...imageReferenceUrls(input).map((uri) => ({ source: 'uri', uri })),
    ...mediaAssetIds(input, 'image').map((id) => ({ source: 'media_asset', media_asset_id: id }))
  ].slice(0, 4)

  if (imageRefs.length === 0) {
    // 官方 schema：text 形态的 text_prompt 是必填，空文本会被上游以 400 拒绝，
    // 这里提前给出可照做的说明（尤其是「只连了图但上传失败」之后又退回文本的情形）
    if (!text) throw fail(E_WORLDLABS_NO_PROMPT)
    return { type: 'text', text_prompt: text, ...noRecaption }
  }

  if (imageRefs.length === 1) {
    return {
      type: 'image',
      image_prompt: imageRefs[0],
      // 官方 is_pano：auto 自动识别等距柱状全景 / true 强制 / false 当普通图（仅单图形态）
      ...(input.panoMode && input.panoMode !== 'auto'
        ? { is_pano: input.panoMode === 'always' }
        : {}),
      ...(text ? { text_prompt: text } : {}),
      ...noRecaption
    }
  }

  return {
    type: 'multi-image',
    multi_image_prompt: imageRefs.map((content) => ({ content })),
    ...(text ? { text_prompt: text } : {}),
    ...noRecaption
  }
}

/**
 * 从 world 响应里挑出「附加下载」（主产物网格之外）。这两份都**随 world 一起返回**，
 * 不需要调 `worlds/{id}:export`，也不额外扣积分：
 *   - `splats.spz_urls`：高斯泼溅 SPZ（Marble 原生格式，约 2M splats；引擎导入首选）
 *   - `imagery.pano_url`：360 等距柱状全景图（2560×1280，可直接当 2D 输入复用）
 *
 * `spz_urls` 是「分辨率键 → URL」的映射（官方未在文档里固定键名），按 full_res / 2m / 500k
 * 的口径挑一份全分辨率的，认不出键就取第一个非空值。
 */
export function spatialWorldExtraDownloads(
  world: WorldlabsWorld | null | undefined
): Array<{ kind: string; url: string }> {
  const extras: Array<{ kind: string; url: string }> = []

  const spzUrls = world?.assets?.splats?.spz_urls
  const spz = pickSpzUrl(spzUrls)
  if (spz) extras.push({ kind: 'splats', url: spz })

  const pano = world?.assets?.imagery?.pano_url?.trim()
  if (pano) extras.push({ kind: 'pano', url: pano })

  return extras
}

/**
 * 从世界响应里取 world_id。
 *
 * 这是**下游能不能用这个世界**的关键字段（`worlds/{id}:export` 只认它），
 * 所以按多种可能写法依次尝试；都没有则返回空串，由调用方决定怎么报错。
 */
export function pickWorldId(world: WorldlabsWorld | null | undefined): string {
  if (!world) return ''
  const candidates = [
    world.id,
    world.world_id,
    world.worldId,
    world.world?.id,
    world.world?.world_id
  ]
  for (const value of candidates) {
    const id = value?.trim()
    if (id) return id
  }
  return ''
}

/** SPZ 分辨率键的偏好顺序：全分辨率优先，其次常见别名，最后兜底第一个非空值 */
const SPZ_KEY_PREFERENCE = ['full_res', 'fullres', 'full', '2m', '2000k', '500k']

export function pickSpzUrl(urls: Record<string, string> | null | undefined): string {
  if (!urls) return ''
  const entries = Object.entries(urls)
    .map(([key, value]) => [key.trim().toLowerCase(), value?.trim() ?? ''] as const)
    .filter(([, url]) => Boolean(url) && /^https?:\/\//i.test(url))
  if (!entries.length) return ''
  for (const want of SPZ_KEY_PREFERENCE) {
    const hit = entries.find(([key]) => key === want)
    if (hit) return hit[1]
  }
  // 键名带分辨率数字时取最大的一份（如 splat_2000000.spz）
  const withCount = entries
    .map(([key, url]) => {
      const digits = /(\d+)\s*([mk])?/.exec(key)
      const n = digits
        ? Number(digits[1]) * (digits[2] === 'm' ? 1_000_000 : digits[2] === 'k' ? 1000 : 1)
        : 0
      return { url, n }
    })
    .sort((a, b) => b.n - a.n)
  return withCount[0]!.url
}

export const worldlabsAdapter: ModelProviderAdapter = {
  kind: 'worldlabs',

  async assertAuth(provider) {
    const client = createWorldlabsHttpClient(provider)
    try {
      // 查询剩余额度即可验证鉴权（不产生费用）
      await client.get<{ remaining_credits?: number }>('/marble/v1/credits', { timeout: 15_000 })
    } catch (err) {
      throw fail(E_WORLDLABS_CONNECTION_TEST_FAILED, { detail: await readWorldlabsHttpError(err) })
    }
  },

  async fetchCatalog(_provider, modality: ModelModality): Promise<CatalogModel[]> {
    if (modality !== 'spatialWorld') return []
    return [
      {
        id: 'marble-1.1',
        name: 'Marble 1.1',
        modality: 'spatialWorld',
        description: 'World Labs Marble 1.1 世界生成（文本/单图/多图/视频，标准世界尺寸）'
      },
      {
        id: 'marble-1.1-plus',
        name: 'Marble 1.1 Plus',
        modality: 'spatialWorld',
        description:
          'World Labs Marble 1.1 Plus 世界生成（更大世界：户外或大型室内空间，消耗更多积分）'
      },
      {
        id: 'marble-1.0',
        name: 'Marble 1.0',
        modality: 'spatialWorld',
        description: 'World Labs Marble 1.0 世界生成（上一代模型；上游仍支持，后续版本会移除）'
      },
      {
        id: 'marble-1.0-draft',
        name: 'Marble 1.0 Draft',
        modality: 'spatialWorld',
        description: 'World Labs Marble 1.0 Draft 草稿档（上一代；上游仍支持，后续版本会移除）'
      }
    ]
  },

  async generateText(
    _provider: ModelProviderInstance,
    _modelId: string,
    _input: GenerateTextInput
  ): Promise<GenerateTextResult> {
    throw fail(E_WORLDLABS_TEXT_UNSUPPORTED)
  },

  async generateImage(
    _provider: ModelProviderInstance,
    _modelId: string,
    _input: GenerateImageInput
  ): Promise<GenerateImageResult> {
    throw fail(E_WORLDLABS_IMAGE_UNSUPPORTED)
  },

  async submitVideo(
    _provider: ModelProviderInstance,
    _modelId: string,
    _input: GenerateVideoInput
  ): Promise<GenerateVideoJob> {
    throw fail(E_WORLDLABS_VIDEO_UNSUPPORTED)
  },

  async pollVideo(
    _provider: ModelProviderInstance,
    _job: { jobId: string; pollingUrl: string }
  ): Promise<VideoPollResult> {
    throw fail(E_WORLDLABS_VIDEO_UNSUPPORTED)
  },

  async generateSpeech(
    _provider: ModelProviderInstance,
    _modelId: string,
    _input: GenerateSpeechInput
  ): Promise<GenerateSpeechResult> {
    throw fail(E_WORLDLABS_SPEECH_UNSUPPORTED)
  },

  async submitModel3d(
    _provider: ModelProviderInstance,
    _modelId: string,
    _input: GenerateModel3dInput
  ): Promise<GenerateModel3dJob> {
    throw fail(E_WORLDLABS_MODEL3D_UNSUPPORTED)
  },

  async pollModel3d(
    _provider: ModelProviderInstance,
    _job: { jobId: string; pollingUrl: string }
  ): Promise<VideoPollResult> {
    throw fail(E_WORLDLABS_MODEL3D_UNSUPPORTED)
  },

  async submitSpatialWorld(
    provider: ModelProviderInstance,
    modelId: string,
    input: GenerateSpatialWorldInput
  ): Promise<GenerateSpatialWorldJob> {
    const client = createWorldlabsHttpClient(provider)
    const model = resolveModelId(modelId)
    const body: Record<string, unknown> = {
      model,
      world_prompt: buildWorldPrompt(input)
    }
    const displayName = input.displayName?.trim()
    if (displayName) body.display_name = displayName.slice(0, 64)
    if (typeof input.seed === 'number' && Number.isFinite(input.seed)) {
      body.seed = Math.max(0, Math.min(4294967295, Math.trunc(input.seed)))
    }
    // 官方 tags：最多 10 个、每个 ≤32 字符（超限上游会 422，这里按官方上限裁剪）
    const tags = (input.tags ?? [])
      .map((tag) => tag.trim().slice(0, 32))
      .filter(Boolean)
      .slice(0, 10)
    if (tags.length) body.tags = tags
    if (input.publicWorld === true) body.permission = { public: true }

    try {
      const { data } = await client.post<{ operation_id?: string | null }>(
        '/marble/v1/worlds:generate',
        body
      )
      const operationId = typeof data?.operation_id === 'string' ? data.operation_id.trim() : ''
      if (!operationId) throw fail(E_WORLDLABS_NO_OPERATION_ID)
      return {
        jobId: operationId,
        pollingUrl: operationId,
        status: 'submitted',
        model
      }
    } catch (err) {
      // fail() 抛出的 AppError 原样透传，避免二次包装
      if (isAppError(err)) throw err
      // 402 / 429 是「照做就能过」的两类失败，单独给可执行的说明（其余按原文透传）
      const status = httpStatusOf(err)
      if (status === 402) {
        throw fail(E_WORLDLABS_NO_CREDITS, { detail: await readWorldlabsHttpError(err) })
      }
      if (status === 429) {
        throw fail(E_WORLDLABS_RATE_LIMITED, { detail: await readWorldlabsHttpError(err) })
      }
      throw fail(E_WORLDLABS_SUBMIT_WORLD_FAILED, { detail: await readWorldlabsHttpError(err) })
    }
  },

  async pollWorld(
    provider: ModelProviderInstance,
    job: { jobId: string; pollingUrl: string }
  ): Promise<VideoPollResult> {
    const client = createWorldlabsHttpClient(provider)
    const operationId = job.pollingUrl || job.jobId

    try {
      const { data } = await client.get<WorldlabsOperation>(
        `/marble/v1/operations/${encodeURIComponent(operationId)}`
      )
      if (!data) return { status: 'pending', progress: 10 }

      if (data.error && (data.error.message || data.error.code != null)) {
        return {
          status: 'failed',
          progress: 100,
          error: fail(E_WORLDLABS_GEN_FAILED, {
            detail: data.error.message || `code=${data.error.code}`
          }).message
        }
      }

      if (!data.done) {
        // 上游无精确进度百分比；metadata.progress 可能带数值，缺省按经验给 50
        return { status: 'in_progress', progress: 50 }
      }

      const meshUrl =
        data.response?.assets?.mesh?.collider_mesh_url?.trim() ||
        data.response?.assets?.mesh?.full_res_mesh_url?.trim() ||
        data.response?.assets?.mesh?.hq_mesh_url?.trim()
      if (!meshUrl) {
        return { status: 'failed', progress: 100, error: fail(E_WORLDLABS_NO_MESH).message }
      }
      const resourceId = pickWorldId(data.response)
      if (!resourceId) {
        // 网格拿到了、id 没拿到：产物可用但下游导出用不了，留一条可排查的痕迹
        console.warn(
          `[worldlabs] world finished without a usable world id; keys=${Object.keys(data.response ?? {}).join(',')}`
        )
      }
      return {
        status: 'completed',
        progress: 100,
        downloadUrl: meshUrl,
        resourceId: resourceId || undefined,
        extraDownloads: spatialWorldExtraDownloads(data.response)
      }
    } catch (err) {
      throw fail(E_WORLDLABS_POLL_WORLD_FAILED, { detail: await readWorldlabsHttpError(err) })
    }
  },

  /**
   * 空间世界导出（官方 `POST /marble/v1/worlds/{world_id}:export`）。
   * PLY 泼溅是同步转换、提交即返回 completed（可直接取 downloadUrl）；
   * HQ 网格走异步 mesh 服务，返回进行中的 operation 交给轮询。
   */
  async submitSpatialWorldExport(
    provider: ModelProviderInstance,
    spatialWorldId: string,
    request: SpatialWorldExportRequest
  ): Promise<SpatialWorldExportJob> {
    const id = spatialWorldId.trim()
    if (!id) throw fail(E_WORLDLABS_NO_WORLD_ID)
    const client = createWorldlabsHttpClient(provider)

    try {
      const { data } = await client.post<WorldlabsOperation>(
        `/marble/v1/worlds/${encodeURIComponent(id)}:export`,
        buildExportBody(request)
      )
      const operationId = data?.operation_id?.trim() ?? ''
      if (!operationId) throw fail(E_WORLDLABS_NO_OPERATION_ID)
      const settled = parseExportOperation(data)
      return {
        jobId: operationId,
        pollingUrl: operationId,
        status: settled.status,
        ...(settled.status === 'completed' && settled.downloadUrl
          ? { downloadUrl: settled.downloadUrl }
          : {})
      }
    } catch (err) {
      if (isAppError(err)) throw err
      const status = httpStatusOf(err)
      if (status === 402) {
        throw fail(E_WORLDLABS_NO_CREDITS, { detail: await readWorldlabsHttpError(err) })
      }
      if (status === 429) {
        throw fail(E_WORLDLABS_RATE_LIMITED, { detail: await readWorldlabsHttpError(err) })
      }
      throw fail(E_WORLDLABS_EXPORT_SUBMIT_FAILED, {
        detail: await readWorldlabsHttpError(err)
      })
    }
  },

  /** 轮询导出 operation；done 时 response.url 即下载地址 */
  async pollSpatialWorldExport(
    provider: ModelProviderInstance,
    job: { jobId: string; pollingUrl: string }
  ): Promise<VideoPollResult> {
    const client = createWorldlabsHttpClient(provider)
    const operationId = job.pollingUrl || job.jobId

    try {
      const { data } = await client.get<WorldlabsOperation>(
        `/marble/v1/operations/${encodeURIComponent(operationId)}`
      )
      return parseExportOperation(data)
    } catch (err) {
      throw fail(E_WORLDLABS_EXPORT_FAILED, { detail: await readWorldlabsHttpError(err) })
    }
  }
}
