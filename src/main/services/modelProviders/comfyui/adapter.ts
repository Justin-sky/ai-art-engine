import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
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
import {
  inferComfyUiMediaInputs,
  inferComfyUiWorkflowModality,
  resolveComfyUiModelCapabilities
} from '@shared/modelProviders/comfyui/modelCapabilities'
import {
  collectComfyNodeClassTypes,
  injectComfyWorkflow,
  minimaxH3NativeSize,
  sizeFromAspectRatio,
  unwrapComfyApiWorkflow,
  type ComfyApiWorkflow
} from '@shared/modelProviders/comfyui/injectWorkflow'
import type { ModelProviderAdapter, VideoPollResult } from '../types'
import { sleep } from '../http'
import { projectService } from '../../projectService'
import {
  comfyUiBaseUrl,
  createComfyUiFormClient,
  comfyUiUserdataOrigins,
  createComfyUiHttpClient,
  createComfyUiLongClient,
  readComfyUiError
} from './http'

type ComfyJobStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'canceling'
  | 'canceled'
  | 'failed'
  | 'expired'

type ComfyJobOutput = {
  type?: string
  url?: string
  name?: string
  content_type?: string
}

type ComfyJob = {
  id?: string
  status?: ComfyJobStatus | string
  progress?: { value?: number }
  outputs?: ComfyJobOutput[]
  error?: { message?: string; code?: string } | null
  urls?: { self?: string }
}

const IMAGE_POLL_INTERVAL_MS = 3_000
const IMAGE_POLL_MAX_ATTEMPTS = 360

function mapJobStatus(raw: string | undefined): VideoPollResult['status'] {
  const s = (raw ?? '').toLowerCase()
  if (s === 'succeeded' || s === 'success' || s === 'completed') return 'completed'
  if (s === 'failed' || s === 'canceled' || s === 'cancelled' || s === 'expired') return 'failed'
  if (s === 'running' || s === 'canceling' || s === 'in_progress') return 'in_progress'
  return 'pending'
}

function jobProgress(job: ComfyJob, status: VideoPollResult['status']): number {
  const value = job.progress?.value
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.min(100, Math.round(value * 100)))
  }
  if (status === 'completed' || status === 'failed') return 100
  if (status === 'in_progress') return 45
  return 10
}

function comfyOutputKind(row: ComfyJobOutput): 'image' | 'video' | 'audio' {
  const type = (row.type ?? '').toLowerCase()
  const contentType = (row.content_type ?? '').toLowerCase()
  const name = (row.name ?? '').toLowerCase()
  const url = (row.url ?? '').toLowerCase()

  if (
    contentType.startsWith('video/') ||
    /\.(mp4|webm|mov|avi|mkv|m4v)(?:[?#]|$)/.test(name) ||
    /\.(mp4|webm|mov|avi|mkv|m4v)(?:[?#]|$)/.test(url)
  ) {
    return 'video'
  }
  if (
    contentType.startsWith('audio/') ||
    /\.(mp3|wav|ogg|flac|m4a|pcm)(?:[?#]|$)/.test(name) ||
    /\.(mp3|wav|ogg|flac|m4a)(?:[?#]|$)/.test(url)
  ) {
    return 'audio'
  }
  if (type === 'video' || type === 'audio') return type
  return 'image'
}

function outputUrls(job: ComfyJob, type: 'image' | 'video' | 'audio'): string[] {
  return (job.outputs ?? [])
    .filter((row) => comfyOutputKind(row) === type && row.url?.trim())
    .map((row) => row.url!.trim())
}

function collectRemoteTemplates(raw: unknown, modality: ModelModality): CatalogModel[] {
  const rows: unknown[] = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object'
      ? Object.entries(raw as Record<string, unknown>).map(([id, value]) =>
          value && typeof value === 'object' ? { id, ...(value as object) } : { id, name: id }
        )
      : []
  const out: CatalogModel[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue
    const rec = row as Record<string, unknown>
    const id = String(rec.id ?? rec.name ?? rec.filename ?? '').trim()
    if (!id || seen.has(id)) continue
    const name = String(rec.name ?? rec.title ?? id).trim() || id
    const inferred = inferComfyUiWorkflowModality(id, name)
    if (inferred !== modality) continue
    seen.add(id)
    out.push({
      id,
      name,
      modality,
      capabilities: resolveComfyUiModelCapabilities(id, modality) ?? undefined
    })
  }
  return out
}

async function fetchRemoteCatalog(
  provider: ModelProviderInstance,
  modality: ModelModality
): Promise<CatalogModel[]> {
  const client = createComfyUiHttpClient(provider)
  try {
    const { data } = await client.get('/api/workflow_templates')
    return collectRemoteTemplates(data, modality)
  } catch {
    return []
  }
}

function joinUserdataRel(dir: string, rel: string): string {
  const base = dir.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')
  const path = rel.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!path) return base
  if (!base || base === '.') return path
  if (path === base || path.startsWith(`${base}/`)) return path
  return `${base}/${path}`
}

function userdataFileRequests(rel: string, origin: string): Array<{ url: string }> {
  const encoded = encodeURIComponent(rel)
  const originTrim = origin.replace(/\/$/, '')
  return [
    { url: `${originTrim}/api/userdata/${encoded}` },
    { url: `${originTrim}/userdata/${encoded}` },
    { url: `/api/userdata/${encoded}` },
    { url: `/userdata/${encoded}` },
    { url: `/api/userdata/${rel}` },
    { url: `/userdata/${rel}` }
  ]
}

function userdataCandidates(modelId: string): string[] {
  const id = modelId.trim().replace(/^\/+/, '')
  const withJson = id.endsWith('.json') ? id : `${id}.json`
  return [...new Set([withJson, id, `workflows/${withJson}`, `workflows/${id}`, `aiartengine/${withJson}`])]
}

function isUsableWorkflowId(id: string): boolean {
  if (!id) return false
  if (/^comfy\.settings$/i.test(id)) return false
  if (/^user\.css$/i.test(id)) return false
  return true
}

type UserdataWorkflowRel = { id: string; rel: string }
type UserdataWorkflowFile = UserdataWorkflowRel & { origin: string }

function collectUserdataJsonFiles(raw: unknown, dirPrefix = ''): UserdataWorkflowRel[] {
  const rows = Array.isArray(raw)
    ? raw
    : raw && typeof raw === 'object' && Array.isArray((raw as { files?: unknown }).files)
      ? ((raw as { files: unknown[] }).files ?? [])
      : []
  const files: UserdataWorkflowRel[] = []
  const seen = new Set<string>()
  for (const row of rows) {
    if (row && typeof row === 'object' && (row as { type?: unknown }).type === 'directory') {
      continue
    }
    const path =
      typeof row === 'string'
        ? row
        : row && typeof row === 'object'
          ? String(
              (row as { path?: unknown; name?: unknown }).path ??
                (row as { name?: unknown }).name ??
                ''
            )
          : ''
    const rel = joinUserdataRel(dirPrefix, path)
    if (!rel.toLowerCase().endsWith('.json')) continue
    const id = rel.replace(/\.json$/i, '').split('/').pop() ?? ''
    if (!isUsableWorkflowId(id) || seen.has(id)) continue
    seen.add(id)
    files.push({ id, rel })
  }
  return files
}

async function listUserdataWorkflowFiles(
  provider: ModelProviderInstance
): Promise<UserdataWorkflowFile[]> {
  const files: UserdataWorkflowFile[] = []
  const seen = new Set<string>()
  for (const origin of comfyUiUserdataOrigins(provider)) {
    const client = createComfyUiHttpClient(provider, 60_000, origin)
    const before = files.length
    const add = (batch: UserdataWorkflowRel[]) => {
      for (const file of batch) {
        if (seen.has(file.id)) continue
        seen.add(file.id)
        files.push({ ...file, origin })
      }
    }
    for (const url of ['/api/v2/userdata', '/v2/userdata']) {
      try {
        const { data } = await client.get(url, { params: { path: '' } })
        add(collectUserdataJsonFiles(data))
      } catch {
        /* 旧版没有 v2 列表 */
      }
    }
    for (const dir of ['.', 'workflows', 'aiartengine']) {
      try {
        const { data } = await client.get('/api/userdata', {
          params: { dir, recurse: 'true' }
        })
        add(collectUserdataJsonFiles(data, dir))
      } catch {
        /* 旧版 ComfyUI 可能没有列表接口 */
      }
    }
    if (files.length > before) break
  }
  return files
}

function parseWorkflowBody(data: unknown): unknown {
  if (typeof data === 'string') {
    try {
      return JSON.parse(data) as unknown
    } catch {
      return data
    }
  }
  return data
}

async function tryReadUserdataFile(
  provider: ModelProviderInstance,
  file: UserdataWorkflowFile
): Promise<unknown | null> {
  const client = createComfyUiHttpClient(provider, 15_000, file.origin)
  for (const req of userdataFileRequests(file.rel, file.origin)) {
    try {
      const { data } = await client.get(req.url)
      return parseWorkflowBody(data)
    } catch {
      /* 路径编码 / 新旧接口不同时换下一种 */
    }
  }
  return null
}

async function loadWorkflow(
  provider: ModelProviderInstance,
  modelId: string
): Promise<ComfyApiWorkflow> {
  const trimmed = modelId.trim()
  if (trimmed.startsWith('{')) {
    return unwrapComfyApiWorkflow(JSON.parse(trimmed) as unknown)
  }
  const listed = await listUserdataWorkflowFiles(provider)
  const withJson = trimmed.endsWith('.json') ? trimmed : `${trimmed}.json`
  const matched = listed.filter(
    (file) =>
      file.id === trimmed ||
      file.rel === trimmed ||
      file.rel === withJson ||
      file.rel.endsWith(`/${withJson}`)
  )
  let lastError = '未找到 workflow'
  let contentError = ''
  let readContent = false
  const tryUnwrap = (raw: unknown): ComfyApiWorkflow | null => {
    try {
      return unwrapComfyApiWorkflow(parseWorkflowBody(raw))
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      lastError = message
      contentError = message
      return null
    }
  }
  for (const file of matched) {
    const raw = await tryReadUserdataFile(provider, file)
    if (raw == null) {
      lastError = `Request failed with status code 404`
      continue
    }
    readContent = true
    const graph = tryUnwrap(raw)
    if (graph) return graph
  }
  const origins = [
    ...new Set([...matched.map((file) => file.origin), ...comfyUiUserdataOrigins(provider)])
  ]
  for (const origin of origins) {
    const client = createComfyUiHttpClient(provider, 60_000, origin)
    for (const rel of userdataCandidates(trimmed)) {
      for (const req of userdataFileRequests(rel, origin)) {
        try {
          const { data } = await client.get(req.url)
          readContent = true
          const graph = tryUnwrap(data)
          if (graph) return graph
        } catch (err) {
          lastError = await readComfyUiError(err)
        }
      }
    }
  }
  if (readContent && contentError) {
    throw new Error(
      `workflow「${trimmed}」已找到，但无法作为 ComfyUI API 使用：${contentError}。请在 ComfyUI 里用 Save (API Format) 导出后覆盖同名 userdata 文件。`
    )
  }
  const available = listed.map((file) => file.id)
  const found = available.length ? ` 当前 userdata 可见：${available.join('、')}。` : ''
  const originHint = comfyUiUserdataOrigins(provider).join('、')
  throw new Error(
    `未找到 workflow「${trimmed}」。请在设置里「拉取可用模型」后勾选本机已有的 workflow 名（不要用占位的 txt2img）。本机 userdata 在 ${originHint}。${found}（${lastError}）`
  )
}

function extFromContentType(contentType: string): string {
  const ct = contentType.toLowerCase()
  if (ct.includes('png')) return 'png'
  if (ct.includes('jpeg') || ct.includes('jpg')) return 'jpg'
  if (ct.includes('webp')) return 'webp'
  if (ct.includes('quicktime')) return 'mov'
  if (ct.includes('webm')) return 'webm'
  if (ct.includes('x-matroska')) return 'mkv'
  if (ct.includes('avi')) return 'avi'
  if (ct.includes('wav') || ct.includes('wave')) return 'wav'
  if (ct.includes('mpeg') || ct.includes('mp3')) return 'mp3'
  if (ct.includes('m4a') || ct.includes('aac') || ct.includes('mp4a')) return 'm4a'
  if (ct.includes('ogg') || ct.includes('opus')) return 'ogg'
  if (ct.includes('flac')) return 'flac'
  if (ct.includes('mp4')) return 'mp4'
  return 'bin'
}

async function loadMediaBuffer(
  client: ReturnType<typeof createComfyUiHttpClient>,
  source: string
): Promise<{ buffer: Buffer; filename: string; contentType: string }> {
  const dataUrl = /^data:([^;]+);base64,(.+)$/i.exec(source)
  if (dataUrl) {
    const contentType = dataUrl[1] || 'application/octet-stream'
    return {
      buffer: Buffer.from(dataUrl[2]!, 'base64'),
      filename: `ref-${Date.now()}.${extFromContentType(contentType)}`,
      contentType
    }
  }
  const { data, headers } = await client.get<ArrayBuffer>(source, { responseType: 'arraybuffer' })
  const contentType = String(headers['content-type'] ?? 'application/octet-stream')
  return {
    buffer: Buffer.from(data),
    filename: `ref-${Date.now()}.${extFromContentType(contentType)}`,
    contentType
  }
}

type ComfyUiUploadKind = 'image' | 'video' | 'audio'

/**
 * 上传参考媒体到 ComfyUI。图片/视频/音频统一走 `/upload/image`（ComfyUI 不校验内容类型，
 * 文件落到 input/ 目录，VHS_LoadVideo / VHS_LoadAudio 按文件名引用）；失败回退 API 2 通用资产接口。
 * `kind` 仅用于语义标注，当前不区分上传端点。
 */
async function uploadReferenceMedia(
  provider: ModelProviderInstance,
  urls: string[],
  _kind: ComfyUiUploadKind
): Promise<string[]> {
  if (!urls.length) return []
  const client = createComfyUiLongClient(provider)
  const formClient = createComfyUiFormClient(provider)
  const names: string[] = []
  for (const url of urls) {
    const media = await loadMediaBuffer(client, url)
    const form = new FormData()
    form.append(
      'image',
      new Blob([new Uint8Array(media.buffer)], { type: media.contentType }),
      media.filename
    )
    try {
      const { data } = await formClient.post<{ name?: string }>('/upload/image', form)
      names.push(data?.name?.trim() || media.filename)
    } catch {
      const retry = new FormData()
      retry.append(
        'file',
        new Blob([new Uint8Array(media.buffer)], { type: media.contentType }),
        media.filename
      )
      retry.append('content_type', media.contentType)
      retry.append('file_path', media.filename)
      const { data } = await formClient.post<{ id?: string; name?: string; file_path?: string }>(
        '/api/v2/assets',
        retry
      )
      names.push(data?.file_path?.trim() || data?.name?.trim() || data?.id?.trim() || media.filename)
    }
  }
  return names
}

async function submitJob(
  provider: ModelProviderInstance,
  workflow: ComfyApiWorkflow
): Promise<ComfyJob> {
  const client = createComfyUiLongClient(provider)
  const key = provider.apiKey.trim()
  const body: Record<string, unknown> = { workflow }
  if (key) body.extra_data = { api_key_comfy_org: key }
  const { data } = await client.post<ComfyJob>('/api/v2/jobs', body, {
    headers: { 'Idempotency-Key': randomUUID() }
  })
  if (!data?.id) throw new Error('未返回 job id')
  return data
}

function pollingPath(job: ComfyJob): string {
  return job.urls?.self?.trim() || `/api/v2/jobs/${job.id}`
}

async function getJob(
  provider: ModelProviderInstance,
  path: string
): Promise<ComfyJob> {
  const client = createComfyUiHttpClient(provider)
  const { data } = await client.get<ComfyJob>(path)
  return data
}

async function waitForJob(
  provider: ModelProviderInstance,
  job: ComfyJob
): Promise<ComfyJob> {
  let current = job
  const path = pollingPath(current)
  for (let i = 0; i < IMAGE_POLL_MAX_ATTEMPTS; i++) {
    const status = mapJobStatus(current.status)
    if (status === 'completed') return current
    if (status === 'failed') {
      throw new Error(current.error?.message || 'ComfyUI 任务失败')
    }
    await sleep(IMAGE_POLL_INTERVAL_MS)
    current = await getJob(provider, path)
  }
  throw new Error('ComfyUI 任务超时：仍未完成')
}

function roundToMultiple(value: number, multiple: number): number {
  return Math.max(multiple, Math.round(value / multiple) * multiple)
}

async function prepareWorkflow(
  provider: ModelProviderInstance,
  modelId: string,
  input: {
    prompt: string
    seed?: number
    aspectRatio?: string
    resolution?: string
    duration?: number
    imageUrls?: string[]
    firstFrameUrls?: string[]
    lastFrameUrls?: string[]
    videoUrls?: string[]
    audioUrls?: string[]
  }
): Promise<ComfyApiWorkflow> {
  const graph = await loadWorkflow(provider, modelId)
  const size = sizeFromAspectRatio(input.aspectRatio, input.resolution)
  // MiniMax H3 等视频模型的 latent 采用 1x2x2 分块，要求 width/height 为 32 的整数倍
  //（否则 patchify 会因奇数 latent 维度报 shape 不匹配）。视频任务就近对齐到 32，
  // MiniMax H3 再压到原生画布量级（768 短边 / 768*1344 面积上限），避免 1080p 撑爆显存。
  const isVideo = input.duration != null
  let width = size.width
  let height = size.height
  if (isVideo) {
    width = roundToMultiple(width, 32)
    height = roundToMultiple(height, 32)
    const isMiniMaxH3 = collectComfyNodeClassTypes(graph).some((t) => /minimaxh3/i.test(t))
    if (isMiniMaxH3) {
      const native = minimaxH3NativeSize(width, height)
      width = Math.min(width, native.width)
      height = Math.min(height, native.height)
    }
  }
  const imageFilenames = input.imageUrls?.length
    ? await uploadReferenceMedia(provider, input.imageUrls, 'image')
    : []
  const firstFrameFilenames = input.firstFrameUrls?.length
    ? await uploadReferenceMedia(provider, input.firstFrameUrls, 'image')
    : []
  const lastFrameFilenames = input.lastFrameUrls?.length
    ? await uploadReferenceMedia(provider, input.lastFrameUrls, 'image')
    : []
  const videoFilenames = input.videoUrls?.length
    ? await uploadReferenceMedia(provider, input.videoUrls, 'video')
    : []
  const audioFilenames = input.audioUrls?.length
    ? await uploadReferenceMedia(provider, input.audioUrls, 'audio')
    : []
  return injectComfyWorkflow(graph, {
    prompt: input.prompt,
    seed: input.seed,
    width,
    height,
    durationSec: input.duration,
    imageFilenames,
    firstFrameFilenames,
    lastFrameFilenames,
    videoFilenames,
    audioFilenames
  })
}

export const comfyUiAdapter: ModelProviderAdapter = {
  kind: 'comfyui',

  async assertAuth(provider) {
    const client = createComfyUiHttpClient(provider)
    try {
      await client.get('/api/v2/jobs', { params: { limit: 1 } })
    } catch (err) {
      const message = await readComfyUiError(err)
      throw new Error(
        `连接测试失败：${message}。本机请先启动 comfy-api-proxy（默认 ${comfyUiBaseUrl(provider)}），云端填 https://cloud.comfy.org 并填写 API Key。`
      )
    }
  },

  async fetchCatalog(provider, modality: ModelModality): Promise<CatalogModel[]> {
    const discovered = await listUserdataWorkflowFiles(provider)
    const fromDisk = (
      await Promise.all(
        discovered.map(async (file) => {
          const raw = await tryReadUserdataFile(provider, file)
          const classTypes = raw ? collectComfyNodeClassTypes(raw) : []
          const inferred = inferComfyUiWorkflowModality(file.id, file.rel, classTypes)
          let graph: ComfyApiWorkflow | null = null
          if (raw) {
            try {
              graph = unwrapComfyApiWorkflow(raw)
            } catch {
              graph = null
            }
          }
          let capabilities = resolveComfyUiModelCapabilities(file.id, inferred) ?? undefined
          const mediaInputs = inferComfyUiMediaInputs(graph)
          if (mediaInputs) {
            const base = (capabilities ?? {}) as Record<string, unknown>
            const allZero =
              mediaInputs.maxImages === 0 &&
              mediaInputs.maxVideos === 0 &&
              mediaInputs.maxAudios === 0
            // 纯文生视频（生成节点存在但无任何媒体信号）：以推断为准，全部隐藏端口。
            // 部分媒体：推断命中(1)可补充端口；推断未命中(0)不覆盖 profile 声明——
            // 避免漏识别负载节点（如 VHS_LoadVideo）把 r2v 的视频参考口误隐藏。
            const resolve = (
              key: 'max_input_images' | 'max_input_videos' | 'max_input_audios',
              inferred: number
            ): number => {
              if (allZero) return 0
              const declared = typeof base[key] === 'number' ? (base[key] as number) : 0
              return Math.max(declared, inferred)
            }
            capabilities = {
              ...base,
              max_input_images: resolve('max_input_images', mediaInputs.maxImages),
              max_input_videos: resolve('max_input_videos', mediaInputs.maxVideos),
              max_input_audios: resolve('max_input_audios', mediaInputs.maxAudios)
            }
          } else if (capabilities) {
            // 无法从节点推断时，删除文件名猜出的 0，避免误隐藏端口（下游视为「未声明」）
            delete capabilities.max_input_images
            delete capabilities.max_input_videos
            delete capabilities.max_input_audios
          }
          return {
            id: file.id,
            name: file.id,
            modality: inferred,
            capabilities
          }
        })
      )
    ).filter((row) => row.modality === modality)
    const remote = await fetchRemoteCatalog(provider, modality)
    const local = fromDisk
    const seen = new Set(local.map((m) => m.id))
    return [...local, ...remote.filter((m) => !seen.has(m.id))]
  },

  async generateText(
    _provider: ModelProviderInstance,
    _modelId: string,
    _input: GenerateTextInput
  ): Promise<GenerateTextResult> {
    throw new Error('ComfyUI 不支持文本对话；请用图片 / 视频 / 声音节点')
  },

  async generateImage(
    provider: ModelProviderInstance,
    modelId: string,
    input: GenerateImageInput
  ): Promise<GenerateImageResult> {
    try {
      const refs = (input.inputReferences ?? []).map((u) => u.trim()).filter(Boolean)
      const workflow = await prepareWorkflow(provider, modelId, {
        prompt: input.prompt,
        seed: input.seed,
        aspectRatio: input.aspectRatio,
        resolution: input.resolution,
        imageUrls: refs
      })
      const submitted = await submitJob(provider, workflow)
      const done = await waitForJob(provider, submitted)
      const images = outputUrls(done, 'image')
      if (!images.length) throw new Error('任务已完成但未返回图片')
      return { images, model: modelId }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('未找到 workflow')) throw err
      throw new Error(`ComfyUI 图片生成失败: ${await readComfyUiError(err)}`)
    }
  },

  async submitVideo(
    provider: ModelProviderInstance,
    modelId: string,
    input: GenerateVideoInput
  ): Promise<GenerateVideoJob> {
    try {
      // 按参考类型分流：首/尾帧注入 first_frame / last_frame 对应 LoadImage，
      // 参考图注入其余 LoadImage，视频/音频分别注入 VHS_LoadVideo / VHS_LoadAudio
      const firstFrameUrls: string[] = []
      const lastFrameUrls: string[] = []
      const imageRefs: string[] = []
      const videoRefs: string[] = []
      const audioRefs: string[] = []
      if (input.firstFrameImageUrl?.trim()) firstFrameUrls.push(input.firstFrameImageUrl.trim())
      if (input.lastFrameImageUrl?.trim()) lastFrameUrls.push(input.lastFrameImageUrl.trim())
      for (const ref of input.inputReferences ?? []) {
        const url = typeof ref === 'string' ? ref.trim() : ref.url?.trim()
        if (!url) continue
        if (typeof ref !== 'string' && ref.kind === 'video_url') videoRefs.push(url)
        else if (typeof ref !== 'string' && ref.kind === 'audio_url') audioRefs.push(url)
        else imageRefs.push(url)
      }
      const workflow = await prepareWorkflow(provider, modelId, {
        prompt: input.prompt,
        seed: input.seed,
        aspectRatio: input.aspectRatio,
        resolution: input.resolution,
        duration: input.duration,
        imageUrls: imageRefs.length ? imageRefs : undefined,
        firstFrameUrls: firstFrameUrls.length ? firstFrameUrls : undefined,
        lastFrameUrls: lastFrameUrls.length ? lastFrameUrls : undefined,
        videoUrls: videoRefs.length ? videoRefs : undefined,
        audioUrls: audioRefs.length ? audioRefs : undefined
      })
      const job = await submitJob(provider, workflow)
      return {
        jobId: job.id!,
        pollingUrl: pollingPath(job),
        status: job.status ?? 'queued',
        model: modelId
      }
    } catch (err) {
      throw new Error(`提交 ComfyUI 视频失败: ${await readComfyUiError(err)}`)
    }
  },

  async pollVideo(
    provider: ModelProviderInstance,
    job: { jobId: string; pollingUrl: string }
  ): Promise<VideoPollResult> {
    try {
      const path = job.pollingUrl?.trim() || `/api/v2/jobs/${job.jobId}`
      const current = await getJob(provider, path)
      const status = mapJobStatus(current.status)
      const downloadUrl = outputUrls(current, 'video')[0]
      const error = status === 'failed' ? current.error?.message || '视频生成失败' : undefined
      return { status, progress: jobProgress(current, status), error, downloadUrl }
    } catch (err) {
      throw new Error(`轮询 ComfyUI 视频失败: ${await readComfyUiError(err)}`)
    }
  },

  async generateSpeech(
    provider: ModelProviderInstance,
    modelId: string,
    input: GenerateSpeechInput
  ): Promise<GenerateSpeechResult> {
    try {
      const workflow = await prepareWorkflow(provider, modelId, {
        prompt: input.input,
        seed: undefined
      })
      const submitted = await submitJob(provider, workflow)
      const done = await waitForJob(provider, submitted)
      const url = outputUrls(done, 'audio')[0]
      if (!url) throw new Error('任务已完成但未返回音频')

      const client = createComfyUiLongClient(provider)
      const { data, headers } = await client.get<ArrayBuffer>(url, { responseType: 'arraybuffer' })
      const contentType = String(headers['content-type'] ?? '')
      const format: 'mp3' | 'pcm' = contentType.includes('wav') || contentType.includes('pcm')
        ? 'pcm'
        : 'mp3'
      const ext = format === 'pcm' ? 'wav' : 'mp3'
      const tmpDir = join(process.cwd(), '.aiartengine-tmp', 'tts')
      if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true })
      const tmpPath = join(tmpDir, `audio-${Date.now()}.${ext}`)
      writeFileSync(tmpPath, Buffer.from(data))

      if (projectService.isOpen()) {
        const asset = projectService.attachExternalGeneratedFile({
          type: 'voice',
          sourceFilePath: tmpPath,
          name: input.name ?? `声音 ${new Date().toLocaleString()}`,
          prompt: input.input,
          outputDir: input.outputDir?.trim() || undefined
        })
        return {
          model: modelId,
          voice: input.voice || modelId,
          format,
          filePath: tmpPath,
          assetId: asset.id,
          relativePath: asset.relativePath
        }
      }
      return { model: modelId, voice: input.voice || modelId, format, filePath: tmpPath }
    } catch (err) {
      throw new Error(`ComfyUI 声音生成失败: ${await readComfyUiError(err)}`)
    }
  },

  submitModel3d(
    _provider: ModelProviderInstance,
    _modelId: string,
    _input: GenerateModel3dInput
  ): Promise<GenerateModel3dJob> {
    throw new Error('该提供商暂不支持 3D 模型生成')
  },

  pollModel3d(
    _provider: ModelProviderInstance,
    _job: { jobId: string; pollingUrl: string }
  ): Promise<VideoPollResult> {
    throw new Error('该提供商暂不支持 3D 模型生成')
  }
}
