import type { AssetInfo, AssetType } from '@shared/domain'
import {
  STUDIO_ASSET_DRAG_MIME,
  STUDIO_ASSET_ID_DRAG_MIME,
  STUDIO_ASSET_IDS_DRAG_MIME
} from '@shared/studioDragMime'

/** AI 对讲支持拖入引用的工程资产类型（图片 / 视频 / 声音 / 3D 模型，与 @ 选择器一致） */
export const CHAT_DROPPABLE_ASSET_TYPES: ReadonlySet<AssetType> = new Set([
  'image',
  'video',
  'voice',
  'model',
  'model3d'
])

const VIDEO_EXT_RE = /\.(mp4|mov|webm|mkv|avi|m4v|ogv)$/i
const AUDIO_EXT_RE = /\.(mp3|wav|m4a|ogg|flac|aac|opus|wma)$/i
const MODEL_EXT_RE = /\.(glb|gltf|obj|fbx)$/i
const IMAGE_EXT_RE = /\.(png|jpe?g|gif|webp|bmp|avif|svg|ico)$/i

export interface ChatDragTransferLike {
  types?: ArrayLike<string> | Iterable<string>
  files?: ArrayLike<{ name?: string; type?: string }>
  items?: ArrayLike<{ kind?: string; type?: string }>
  getData?: (format: string) => string
}

export function normalizeChatAssetPath(raw: string | null | undefined): string {
  return (raw ?? '').replace(/\\/g, '/').trim()
}

/** 根据文件后缀推断引用资产类型（用于尚未刷入 project.assets 的刚落盘媒体） */
export function inferChatMediaAssetType(path: string): AssetType {
  const clean = normalizeChatAssetPath(path)
  if (VIDEO_EXT_RE.test(clean)) return 'video'
  if (AUDIO_EXT_RE.test(clean)) return 'voice'
  if (MODEL_EXT_RE.test(clean)) return 'model3d'
  return 'image'
}

/** 判断外部拖入的 File 属于哪类可导入对话媒体（兼容部分系统下 file.type 为空串的情况） */
export function classifyDroppedExternalMediaFile(file: {
  name?: string
  type?: string
}): 'image' | 'video' | 'voice' | null {
  const mime = (file.type ?? '').trim().toLowerCase()
  if (mime.startsWith('image/')) return 'image'
  if (mime.startsWith('video/')) return 'video'
  if (mime.startsWith('audio/')) return 'voice'
  const name = (file.name ?? '').trim()
  if (!name) return null
  if (IMAGE_EXT_RE.test(name)) return 'image'
  if (VIDEO_EXT_RE.test(name)) return 'video'
  if (AUDIO_EXT_RE.test(name)) return 'voice'
  return null
}

/** 外部文件拖入对话时的工程落盘目录 */
export function resolveChatDropOutputDir(kind: 'image' | 'video' | 'voice'): string {
  if (kind === 'video') return 'Assets/Videos/Drop'
  if (kind === 'voice') return 'Assets/Voices/Drop'
  return 'Assets/Images/Paste'
}

/** 判断单个工程资产是否支持拖入 AI 对讲作为 @ 引用 */
export function isChatDroppableAsset(
  asset: Pick<AssetInfo, 'type' | 'relativePath'> | null | undefined
): boolean {
  if (!asset) return false
  const rel = normalizeChatAssetPath(asset.relativePath)
  if (!rel) return false
  return CHAT_DROPPABLE_ASSET_TYPES.has(asset.type)
}

function readTransferTypes(transfer: ChatDragTransferLike | null | undefined): string[] {
  if (!transfer?.types) return []
  return Array.from(transfer.types)
}

/** 是否来自应用内资产窗口（AssetBrowser）的拖拽事件 */
export function isStudioAssetDragTransfer(
  transfer: ChatDragTransferLike | null | undefined,
  draggingAsset?: Pick<AssetInfo, 'id'> | null,
  draggingAssetIds?: readonly string[]
): boolean {
  if (draggingAsset) return true
  if (draggingAssetIds && draggingAssetIds.length > 0) return true
  const types = readTransferTypes(transfer)
  return (
    types.includes(STUDIO_ASSET_DRAG_MIME) ||
    types.includes(STUDIO_ASSET_ID_DRAG_MIME) ||
    types.includes(STUDIO_ASSET_IDS_DRAG_MIME)
  )
}

/**
 * dragenter / dragover 阶段判断当前拖拽是否可被 AI 对讲接收：
 * 1) 资产窗口拖拽：若已知缓存资产列表，则至少含一个可引用媒体（图片 / 视频 / 声音 / 模型）；
 *    若跨面板仅暴露 MIME 类型（getData 在 dragover 阶段按规范为空），先放行到 drop 阶段再精确过滤。
 * 2) 系统外部文件拖拽：含 Files 类型且非应用内拖拽（避免拦截编辑器内普通选中文本拖拽）。
 */
export function canAcceptChatDropTransfer(input: {
  transfer: ChatDragTransferLike | null | undefined
  draggingAsset?: AssetInfo | null
  draggingAssetIds?: readonly string[]
  projectAssets?: readonly AssetInfo[]
}): boolean {
  const { transfer, draggingAsset = null, draggingAssetIds = [], projectAssets = [] } = input
  if (isStudioAssetDragTransfer(transfer, draggingAsset, draggingAssetIds)) {
    const knownAssets: AssetInfo[] = []
    if (draggingAssetIds.length > 0 && projectAssets.length > 0) {
      const byId = new Map(projectAssets.map((a) => [a.id, a]))
      for (const id of draggingAssetIds) {
        const hit = byId.get(id)
        if (hit) knownAssets.push(hit)
      }
    }
    if (knownAssets.length === 0 && draggingAsset) {
      knownAssets.push(draggingAsset)
    }
    if (knownAssets.length > 0) {
      return knownAssets.some((asset) => isChatDroppableAsset(asset))
    }
    return true
  }

  const types = readTransferTypes(transfer)
  if (!types.includes('Files')) return false
  if (transfer?.items && transfer.items.length > 0) {
    const fileItems = Array.from(transfer.items).filter((item) => item.kind === 'file')
    if (fileItems.length > 0) {
      const allExplicitlyUnsupported = fileItems.every((item) => {
        const mime = (item.type ?? '').trim().toLowerCase()
        return (
          mime !== '' &&
          !mime.startsWith('image/') &&
          !mime.startsWith('video/') &&
          !mime.startsWith('audio/')
        )
      })
      if (allExplicitlyUnsupported) return false
    }
  }
  return true
}

/**
 * drop 阶段解析从资产窗口拖入的全部媒体相对路径（支持多选拖入、单资产 JSON、单 ID 及跨面板 store 兜底）。
 */
export function resolveDroppedChatAssetPaths(input: {
  transfer: ChatDragTransferLike | null | undefined
  draggingAsset?: AssetInfo | null
  draggingAssetIds?: readonly string[]
  projectAssets: readonly AssetInfo[]
}): string[] {
  const { transfer, draggingAsset = null, draggingAssetIds = [], projectAssets } = input
  const byId = new Map(projectAssets.map((asset) => [asset.id, asset]))
  const candidates: AssetInfo[] = []

  const pushById = (id: unknown): void => {
    if (typeof id !== 'string') return
    const trimmed = id.trim()
    if (!trimmed) return
    const found = byId.get(trimmed)
    if (found) candidates.push(found)
  }

  // 1) 多选资产 ID 列表（AssetBrowser 多选拖出优先）
  const rawIds = transfer?.getData?.(STUDIO_ASSET_IDS_DRAG_MIME) ?? ''
  if (rawIds) {
    try {
      const parsed = JSON.parse(rawIds) as unknown
      if (Array.isArray(parsed)) {
        for (const id of parsed) pushById(id)
      }
    } catch {
      /* ignore malformed payload */
    }
  }

  // 2) 跨面板拖拽时 dataTransfer 可能读不到自定义 MIME，用 workspace 缓存的多选 ID 兜底
  if (candidates.length === 0 && draggingAssetIds.length > 0) {
    for (const id of draggingAssetIds) pushById(id)
  }

  // 3) 单资产完整序列化 JSON（优先用工程最新记录，回退序列化快照）
  if (candidates.length === 0) {
    const rawAsset = transfer?.getData?.(STUDIO_ASSET_DRAG_MIME) ?? ''
    if (rawAsset) {
      try {
        const parsed = JSON.parse(rawAsset) as AssetInfo
        if (parsed && typeof parsed === 'object') {
          candidates.push((parsed.id && byId.get(parsed.id)) || parsed)
        }
      } catch {
        /* ignore malformed payload */
      }
    }
  }

  // 4) 单资产 ID MIME
  if (candidates.length === 0) {
    const singleId = transfer?.getData?.(STUDIO_ASSET_ID_DRAG_MIME) ?? ''
    if (singleId) pushById(singleId)
  }

  // 5) workspace.draggingAsset 最终兜底
  if (candidates.length === 0 && draggingAsset) {
    candidates.push(byId.get(draggingAsset.id) ?? draggingAsset)
  }

  const seen = new Set<string>()
  const paths: string[] = []
  for (const asset of candidates) {
    if (!isChatDroppableAsset(asset)) continue
    const rel = normalizeChatAssetPath(asset.relativePath)
    if (!rel || seen.has(rel)) continue
    seen.add(rel)
    paths.push(rel)
  }
  return paths
}
