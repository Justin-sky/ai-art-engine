import type { GraphNodeRunStatus, GraphValue } from './types'
import type { GraphImageReferenceMeta } from '../../modelProvider'

export type GraphRunLogLevel = 'info' | 'warn' | 'error'

export type GraphRunLogEventKind = 'run_start' | 'run_end' | 'node_status' | 'run_message'

export type GraphRunLogMode = 'workflow' | 'toNode' | 'nodeOnly' | 'task'

export type GraphRunLogSessionStatus = 'running' | 'done' | 'error' | 'stopped'

const LOG_TEXT_MAX = 4000

/** 日志用端口值摘要：去掉 data URL，保留可追踪字段 */
export type GraphRunLogPortSnapshot = {
  kind: string
  /** 文本预览（截断） */
  text?: string
  textLength?: number
  /** 数组条目数 */
  itemCount?: number
  assetId?: string
  assetType?: string
  relativePath?: string
  label?: string
  title?: string
  outputKind?: string
  imageCount?: number
  videoCount?: number
  voiceCount?: number
  /** 图片/视频条目摘要（不含 dataUrl） */
  items?: Array<{
    id?: string
    relativePath?: string
    createdAt?: string
  }>
}

/** 节点执行期间捕获的一次 API 调用（文本 / 图片生成等） */
export interface GraphRunLogApiCall {
  id: string
  ts: number
  kind: 'generateText' | 'generateImage' | 'generateVideo' | 'generateSpeech'
  nodeId: string
  /** 节点 params.skillId；无则省略 */
  skillId?: string
  /** 进模型文本的短哈希（仅日志，不参与跳过已完成） */
  promptHash?: string
  request: {
    prompt?: string
    /** TTS / 声音设计输入 */
    input?: string
    system?: string
    model?: string
    providerInstanceId?: string
    /** 多模态附图 / 参考图数量（不落 data URL，避免日志膨胀） */
    imageCount?: number
    aspectRatio?: string
    resolution?: string
    quality?: string
    n?: number
    /** 随机种子（固定后同参数可复现）；null 表示未设置、服务端随机 */
    seed?: number | null
    duration?: number
    generateAudio?: boolean
    inputReferenceCount?: number
    /** 图片生成：参考图清单（来源 + 相对路径/名称，不落 data URL） */
    inputReferences?: GraphImageReferenceMeta[]
    /** Seedream 图层分离 */
    layerDecomposition?: boolean
    voice?: string
    name?: string
    /** 参考视频对象存储上传摘要（不落完整签名参数） */
    uploads?: Array<{
      sourceLabel: string
      objectKey: string
      bytes: number
      urlPreview: string
    }>
  }
  response?: {
    text?: string
    model?: string
    voice?: string
    /** 生成图片张数（不落 data URL） */
    imageCount?: number
    assetId?: string
    relativePath?: string
  }
  error?: string
  durationMs?: number
}

export interface GraphRunLogEvent {
  id: string
  runId: string
  ts: number
  level: GraphRunLogLevel
  kind: GraphRunLogEventKind
  hostId?: string
  mode?: GraphRunLogMode
  nodeId?: string
  nodeTitle?: string
  typeId?: string
  status?: GraphNodeRunStatus
  message?: string
  /** node_status=done/error 时相对 running 的耗时 */
  durationMs?: number
  /** GRAPH_* 或原始错误短码 */
  errorCode?: string
  /** 仅 node_status=running：输入端口摘要（portId → 值列表） */
  inputs?: Record<string, GraphRunLogPortSnapshot[]>
  /** 仅 node_status=done/error：输出端口摘要（portId → 值） */
  outputs?: Record<string, GraphRunLogPortSnapshot>
}

export interface GraphRunLogSession {
  runId: string
  title: string
  hostId?: string
  mode: GraphRunLogMode
  targetNodeId?: string
  /** 短剧弹窗入队时的阶段（breakdown / beatboard / video 等） */
  pipelineStage?: string
  /** 短剧弹窗入队时的格键（如 3-2） */
  cellKey?: string
  startedAt: number
  endedAt?: number
  status: GraphRunLogSessionStatus
  events: GraphRunLogEvent[]
  /** 按节点关联的 API 调用明细 */
  apiCalls: GraphRunLogApiCall[]
}

export interface GraphRunLogMeta {
  pipelineStage?: string
  cellKey?: string
}

/** FNV-1a 32-bit hex；仅用于 RunLog 对账，不参与跳过已完成 */
export function hashPromptForLog(...parts: Array<string | undefined | null>): string {
  const text = parts.filter((part) => part != null && part !== '').join('\n')
  let hash = 2166136261
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

function truncateText(text: string, max = LOG_TEXT_MAX): { text: string; textLength: number } {
  const textLength = text.length
  if (textLength <= max) return { text, textLength }
  return { text: `${text.slice(0, max)}\n…(truncated ${textLength} chars)`, textLength }
}

function summarizeMediaItems(
  items: Array<{ id?: string; relativePath?: string; createdAt?: string; dataUrl?: string }>
): Array<{ id?: string; relativePath?: string; createdAt?: string }> {
  return items.slice(0, 50).map((item) => ({
    ...(item.id ? { id: item.id } : {}),
    ...(item.relativePath?.trim() ? { relativePath: item.relativePath.trim() } : {}),
    ...(item.createdAt ? { createdAt: item.createdAt } : {})
  }))
}

/** 将运行时 GraphValue 压成可落日志的端口摘要 */
export function summarizeGraphValueForLog(value: GraphValue): GraphRunLogPortSnapshot {
  switch (value.kind) {
    case 'text': {
      const body = value.text ?? ''
      return { kind: 'text', ...truncateText(body) }
    }
    case 'world':
    case 'beat': {
      const body = value.text ?? ''
      return { kind: value.kind, ...truncateText(body) }
    }
    case 'texts': {
      const joined = value.items.map((item) => item.text ?? '').join('\n---\n')
      return {
        kind: 'texts',
        itemCount: value.items.length,
        ...truncateText(joined),
        items: value.items.slice(0, 50).map((item) => ({
          id: item.id,
          relativePath: item.relativePath
        }))
      }
    }
    case 'image':
      return {
        kind: 'image',
        ...(value.id ? { assetId: value.id } : {}),
        ...(value.relativePath ? { relativePath: value.relativePath } : {})
      }
    case 'images':
      return {
        kind: 'images',
        itemCount: value.items.length,
        imageCount: value.items.length,
        items: summarizeMediaItems(value.items)
      }
    case 'video':
      return {
        kind: 'video',
        ...(value.id ? { assetId: value.id } : {}),
        ...(value.relativePath ? { relativePath: value.relativePath } : {})
      }
    case 'videos':
      return {
        kind: 'videos',
        itemCount: value.items.length,
        videoCount: value.items.length,
        items: summarizeMediaItems(value.items)
      }
    case 'voices':
      return {
        kind: 'voices',
        itemCount: value.items.length,
        voiceCount: value.items.length,
        items: value.items.slice(0, 50).map((item) => ({
          id: item.id,
          relativePath: item.relativePath
        }))
      }
    case 'asset':
      return {
        kind: 'asset',
        assetId: value.assetId,
        assetType: value.assetType,
        relativePath: value.relativePath,
        label: value.label,
        title: value.title
      }
    case 'output':
      return {
        kind: 'output',
        outputKind: value.outputKind,
        itemCount: value.items.length,
        imageCount: value.images?.length,
        videoCount: value.videos?.length,
        voiceCount: value.voices?.length,
        ...(value.texts?.length
          ? truncateText(value.texts.map((t) => t.text ?? '').join('\n---\n'))
          : value.notes?.length
            ? truncateText(value.notes.map((n) => n.text ?? '').join('\n'))
            : {}),
        items: [
          ...summarizeMediaItems(value.images ?? []),
          ...summarizeMediaItems(value.videos ?? []),
          ...(value.voices ?? []).slice(0, 20).map((item) => ({
            id: item.id,
            relativePath: item.relativePath
          }))
        ]
      }
    case 'camera':
      return { kind: 'camera', label: 'camera' }
    default: {
      const kind =
        value && typeof value === 'object' && 'kind' in value
          ? String((value as { kind: unknown }).kind)
          : 'unknown'
      return { kind }
    }
  }
}

export function summarizeInputPortsForLog(
  inputs: Record<string, GraphValue[]> | null | undefined
): Record<string, GraphRunLogPortSnapshot[]> | undefined {
  if (inputs == null) return undefined
  const out: Record<string, GraphRunLogPortSnapshot[]> = {}
  for (const [portId, values] of Object.entries(inputs)) {
    // 空数组也保留，便于区分「未收到输入」与「未声明端口」
    out[portId] = (values ?? []).map(summarizeGraphValueForLog)
  }
  return out
}

export function summarizeOutputPortsForLog(
  outputs: Record<string, GraphValue> | null | undefined
): Record<string, GraphRunLogPortSnapshot> | undefined {
  if (!outputs) return undefined
  const out: Record<string, GraphRunLogPortSnapshot> = {}
  for (const [portId, value] of Object.entries(outputs)) {
    if (!value) continue
    out[portId] = summarizeGraphValueForLog(value)
  }
  return Object.keys(out).length ? out : undefined
}
