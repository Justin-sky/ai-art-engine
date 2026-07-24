import type { GraphDocument, GraphPersistedRunState } from './types'
import type {
  GraphImageItem,
  GraphNodeRunState,
  GraphVoiceItem,
  GraphValue,
  GraphVideoItem
} from './execute/types'
import { isDataUrl } from './runOutputPersist'

const PERSISTABLE = new Set(['idle', 'done', 'error', 'skipped'])

/** 运行中状态落盘前收敛为可展示结果，避免重开卡在 pending/running */
function normalizeStatusForPersist(
  status: GraphPersistedRunState['status']
): GraphPersistedRunState['status'] {
  if (status === 'pending' || status === 'running') return 'error'
  return status
}

function sanitizeImageItem(item: GraphImageItem): GraphImageItem | null {
  const relativePath = item.relativePath?.trim() || undefined
  const dataUrl = item.dataUrl?.trim() || ''
  if (relativePath) {
    return {
      ...(item.id ? { id: item.id } : {}),
      dataUrl: '',
      ...(item.createdAt ? { createdAt: item.createdAt } : {}),
      relativePath
    }
  }
  // 未物化的巨大 dataUrl 不落盘
  if (isDataUrl(dataUrl)) return null
  if (!dataUrl) return null
  return {
    ...(item.id ? { id: item.id } : {}),
    dataUrl,
    ...(item.createdAt ? { createdAt: item.createdAt } : {})
  }
}

function sanitizeVideoItem(item: GraphVideoItem): GraphVideoItem | null {
  const relativePath = item.relativePath?.trim() || undefined
  const dataUrl = item.dataUrl?.trim() || ''
  if (relativePath) {
    return {
      ...(item.id ? { id: item.id } : {}),
      ...(item.createdAt ? { createdAt: item.createdAt } : {}),
      relativePath
    }
  }
  if (isDataUrl(dataUrl)) return null
  if (!dataUrl) return null
  return {
    ...(item.id ? { id: item.id } : {}),
    dataUrl,
    ...(item.createdAt ? { createdAt: item.createdAt } : {})
  }
}

function sanitizeVoiceItem(item: GraphVoiceItem): GraphVoiceItem | null {
  const relativePath = item.relativePath?.trim() || undefined
  const id = item.id?.trim() || undefined
  if (!relativePath && !id) return null
  return {
    ...(id ? { id } : {}),
    ...(item.createdAt ? { createdAt: item.createdAt } : {}),
    ...(relativePath ? { relativePath } : {})
  }
}

function sanitizeGraphValue(value: GraphValue): GraphValue | undefined {
  switch (value.kind) {
    case 'asset':
    case 'text':
    case 'texts':
    case 'camera':
      return value
    case 'image': {
      const item = sanitizeImageItem({
        id: value.id,
        dataUrl: value.dataUrl,
        createdAt: value.createdAt,
        relativePath: value.relativePath
      })
      if (!item) return undefined
      return {
        kind: 'image',
        ...(item.id ? { id: item.id } : {}),
        dataUrl: item.dataUrl,
        ...(item.createdAt ? { createdAt: item.createdAt } : {}),
        ...(item.relativePath ? { relativePath: item.relativePath } : {})
      }
    }
    case 'images': {
      const items = value.items
        .map(sanitizeImageItem)
        .filter((item): item is GraphImageItem => !!item)
      if (!items.length) return undefined
      return { kind: 'images', items }
    }
    case 'videos': {
      const items = value.items
        .map(sanitizeVideoItem)
        .filter((item): item is GraphVideoItem => !!item)
      if (!items.length) return undefined
      return { kind: 'videos', items }
    }
    case 'voices': {
      const items = value.items
        .map(sanitizeVoiceItem)
        .filter((item): item is GraphVoiceItem => !!item)
      if (!items.length) return undefined
      return { kind: 'voices', items }
    }
    case 'video': {
      const item = sanitizeVideoItem({
        id: value.id,
        dataUrl: value.dataUrl,
        createdAt: value.createdAt,
        relativePath: value.relativePath
      })
      if (!item) return undefined
      return {
        kind: 'video',
        ...(item.id ? { id: item.id } : {}),
        ...(item.dataUrl ? { dataUrl: item.dataUrl } : {}),
        ...(item.createdAt ? { createdAt: item.createdAt } : {}),
        ...(item.relativePath ? { relativePath: item.relativePath } : {})
      }
    }
    case 'output': {
      const images = value.images
        ?.map(sanitizeImageItem)
        .filter((item): item is GraphImageItem => !!item)
      const videos = value.videos
        ?.map(sanitizeVideoItem)
        .filter((item): item is GraphVideoItem => !!item)
      const texts = value.texts
        ?.filter((item) => typeof item.text === 'string' && item.text.trim())
        .map((item) => ({
          ...(item.id ? { id: item.id } : {}),
          text: item.text,
          ...(item.createdAt ? { createdAt: item.createdAt } : {}),
          ...(item.relativePath?.trim() ? { relativePath: item.relativePath.trim() } : {})
        }))
      const voices = value.voices
        ?.map(sanitizeVoiceItem)
        .filter((item): item is GraphVoiceItem => !!item)
      const params = { ...value.params }
      if (isDataUrl(params.previewDataUrl)) {
        delete params.previewDataUrl
      }
      if (params.cameraShots?.length) {
        params.cameraShots = params.cameraShots.map((shot) => {
          if (shot.relativePath?.trim()) {
            return { ...shot, dataUrl: shot.dataUrl && !isDataUrl(shot.dataUrl) ? shot.dataUrl : '' }
          }
          if (isDataUrl(shot.dataUrl)) {
            return { ...shot, dataUrl: '' }
          }
          return shot
        })
      }
      return {
        kind: 'output',
        outputKind: value.outputKind,
        items: value.items.map((item) => ({ ...item })),
        notes: value.notes.map((note) => ({ ...note })),
        params,
        ...(images?.length ? { images } : {}),
        ...(videos?.length ? { videos } : {}),
        ...(texts?.length ? { texts } : {}),
        ...(voices?.length ? { voices } : {})
      }
    }
    default:
      return undefined
  }
}

function sanitizeOutputs(
  outputs: Record<string, GraphValue> | undefined
): Record<string, GraphValue> | undefined {
  if (!outputs) return undefined
  const next: Record<string, GraphValue> = {}
  for (const [portId, value] of Object.entries(outputs)) {
    const cleaned = sanitizeGraphValue(value)
    if (cleaned) next[portId] = cleaned
  }
  return Object.keys(next).length ? next : undefined
}

export function sanitizePersistedRunStates(
  runStates: Record<string, GraphPersistedRunState | GraphNodeRunState> | null | undefined,
  nodeIds: Iterable<string>
): Record<string, GraphPersistedRunState> | undefined {
  if (!runStates) return undefined
  const valid = new Set(nodeIds)
  const next: Record<string, GraphPersistedRunState> = {}
  for (const [id, state] of Object.entries(runStates)) {
    if (!valid.has(id) || !state?.status) continue
    const status = normalizeStatusForPersist(state.status as GraphPersistedRunState['status'])
    if (!PERSISTABLE.has(status) && status !== 'error') continue
    if (status === 'idle') continue
    const outputs = sanitizeOutputs(state.outputs)
    next[id] = {
      status,
      ...(state.error && status === 'error' ? { error: state.error } : {}),
      ...(status === 'error' &&
      !state.error &&
      (state.status === 'pending' || state.status === 'running')
        ? { error: 'Interrupted' }
        : {}),
      ...(outputs ? { outputs } : {})
    }
  }
  return Object.keys(next).length ? next : undefined
}

/** 从 runtime runStates 导出可落盘快照（应先 materializeRunStateOutputs） */
export function exportPersistedRunStates(
  runStates: Record<string, GraphNodeRunState>,
  nodeIds: Iterable<string>
): Record<string, GraphPersistedRunState> | undefined {
  return sanitizePersistedRunStates(runStates, nodeIds)
}

/** 将落盘快照灌入 runtime reactive map（先清空） */
export function importPersistedRunStates(
  target: Record<string, GraphNodeRunState>,
  snapshot: Record<string, GraphPersistedRunState> | null | undefined,
  nodeIds: Iterable<string>
): void {
  for (const key of Object.keys(target)) delete target[key]
  const cleaned = sanitizePersistedRunStates(snapshot, nodeIds)
  if (!cleaned) return
  for (const [id, state] of Object.entries(cleaned)) {
    target[id] = {
      status: state.status,
      ...(state.error ? { error: state.error } : {}),
      ...(state.outputs ? { outputs: state.outputs } : {})
    }
  }
}

export function copyDocumentRunStates(document: GraphDocument): GraphDocument['runStates'] {
  if (!document.runStates) return undefined
  return sanitizePersistedRunStates(document.runStates, Object.keys(document.runStates))
}
