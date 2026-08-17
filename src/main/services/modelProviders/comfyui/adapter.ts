import { randomUUID } from 'crypto'
import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
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
  ModelModality,
  ModelProviderInstance
} from '@shared/modelProvider'
import {
  inferComfyUiWorkflowModality,
  listComfyUiCatalogModels,
  resolveComfyUiModelCapabilities
} from '@shared/modelProviders/comfyui/modelCapabilities'
import {
  injectComfyWorkflow,
  sizeFromAspectRatio,
  unwrapComfyApiWorkflow,
  type ComfyApiWorkflow
} from '@shared/modelProviders/comfyui/injectWorkflow'
import type { ModelProviderAdapter, VideoPollResult } from '../types'
import { sleep } from '../http'
import { projectService } from '../../projectService'
import {
  comfyUiBaseUrl,
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

function outputUrls(job: ComfyJob, type: string): string[] {
  return (job.outputs ?? [])
    .filter((row) => (row.type ?? '').toLowerCase() === type && row.url?.trim())
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

function userdataCandidates(modelId: string): string[] {
  const id = modelId.trim().replace(/^\/+/, '')
  const withJson = id.endsWith('.json') ? id : `${id}.json`
  return [
    `/api/userdata/${encodeURIComponent(id)}`,
    `/api/userdata/${encodeURIComponent(withJson)}`,
    `/api/userdata/workflows/${encodeURIComponent(id)}`,
    `/api/userdata/workflows/${encodeURIComponent(withJson)}`,
    `/api/userdata/aiartengine/${encodeURIComponent(withJson)}`
  ]
}

async function loadWorkflow(
  provider: ModelProviderInstance,
  modelId: string
): Promise<ComfyApiWorkflow> {
  const trimmed = modelId.trim()
  if (trimmed.startsWith('{')) {
    return unwrapComfyApiWorkflow(JSON.parse(trimmed) as unknown)
  }
  const client = createComfyUiHttpClient(provider)
  let lastError = '未找到 workflow'
  for (const path of userdataCandidates(trimmed)) {
    try {
      const { data } = await client.get(path)
      return unwrapComfyApiWorkflow(data)
    } catch (err) {
      lastError = await readComfyUiError(err)
    }
  }
  throw new Error(
    `未找到 workflow「${trimmed}」。请把 API 格式 JSON 放到 ComfyUI userdata（如 userdata/${trimmed}.json），或在设置里手填已有文件名。${lastError ? `（${lastError}）` : ''}`
  )
}

async function loadMediaBuffer(
  client: ReturnType<typeof createComfyUiHttpClient>,
  source: string
): Promise<{ buffer: Buffer; filename: string; contentType: string }> {
  const dataUrl = /^data:([^;]+);base64,(.+)$/i.exec(source)
  if (dataUrl) {
    const contentType = dataUrl[1] || 'application/octet-stream'
    const ext = contentType.includes('png')
      ? 'png'
      : contentType.includes('jpeg') || contentType.includes('jpg')
        ? 'jpg'
        : contentType.includes('webp')
          ? 'webp'
          : 'bin'
    return {
      buffer: Buffer.from(dataUrl[2]!, 'base64'),
      filename: `ref-${Date.now()}.${ext}`,
      contentType
    }
  }
  const { data, headers } = await client.get<ArrayBuffer>(source, { responseType: 'arraybuffer' })
  const contentType = String(headers['content-type'] ?? 'application/octet-stream')
  const ext = contentType.includes('png') ? 'png' : contentType.includes('jpeg') ? 'jpg' : 'bin'
  return {
    buffer: Buffer.from(data),
    filename: `ref-${Date.now()}.${ext}`,
    contentType
  }
}

async function uploadReferenceImages(
  provider: ModelProviderInstance,
  urls: string[]
): Promise<string[]> {
  if (!urls.length) return []
  const client = createComfyUiLongClient(provider)
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
      const { data } = await client.post<{ name?: string }>('/upload/image', form)
      names.push(data?.name?.trim() || media.filename)
    } catch {
      const retry = new FormData()
      retry.append(
        'file',
        new Blob([new Uint8Array(media.buffer)], { type: media.contentType }),
        media.filename
      )
      const { data } = await client.post<{ id?: string; name?: string }>('/api/v2/assets', retry)
      names.push(data?.name?.trim() || data?.id?.trim() || media.filename)
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
  }
): Promise<ComfyApiWorkflow> {
  const graph = await loadWorkflow(provider, modelId)
  const size = sizeFromAspectRatio(input.aspectRatio, input.resolution)
  const imageFilenames = input.imageUrls?.length
    ? await uploadReferenceImages(provider, input.imageUrls)
    : []
  return injectComfyWorkflow(graph, {
    prompt: input.prompt,
    seed: input.seed,
    width: size.width,
    height: size.height,
    durationSec: input.duration,
    imageFilenames
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
    const local = listComfyUiCatalogModels(modality)
    const remote = await fetchRemoteCatalog(provider, modality)
    if (!remote.length) return local
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
      const refs = [
        input.firstFrameImageUrl?.trim(),
        ...(input.inputReferences ?? []).map((ref) =>
          typeof ref === 'string' ? ref.trim() : ref.url.trim()
        )
      ].filter((u): u is string => Boolean(u))
      const workflow = await prepareWorkflow(provider, modelId, {
        prompt: input.prompt,
        seed: input.seed,
        aspectRatio: input.aspectRatio,
        resolution: input.resolution,
        duration: input.duration,
        imageUrls: refs
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
  }
}
