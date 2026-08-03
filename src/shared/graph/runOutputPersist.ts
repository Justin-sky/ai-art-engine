/**
 * 图执行输出落盘：轻量值原样保留；dataUrl 图片物化为工程内相对路径后再写入 runStates。
 */

import type { AssetType, DirectorCameraShot } from '../domain'
import type { GraphDocument, GraphNode } from './types'
import type {
  GraphImageItem,
  GraphNodeRunState,
  GraphOutputValue,
  GraphValue,
  GraphVideoItem
} from './execute/types'
import { findOutputNode } from './query'

export type SaveGraphRunMediaFn = (input: {
  dataUrl: string
  key: string
  outputDir?: string
}) => Promise<string>

const DATA_URL_RE = /^data:([^;,]+)?(;base64)?,([\s\S]+)$/i

export function isDataUrl(value: string | undefined | null): boolean {
  return !!value && DATA_URL_RE.test(value)
}

function cloneImageItem(item: GraphImageItem): GraphImageItem {
  return {
    ...(item.id ? { id: item.id } : {}),
    dataUrl: item.dataUrl,
    ...(item.createdAt ? { createdAt: item.createdAt } : {}),
    ...(item.relativePath ? { relativePath: item.relativePath } : {})
  }
}

function cloneVideoItem(item: GraphVideoItem): GraphVideoItem {
  return {
    ...(item.id ? { id: item.id } : {}),
    ...(item.dataUrl ? { dataUrl: item.dataUrl } : {}),
    ...(item.createdAt ? { createdAt: item.createdAt } : {}),
    ...(item.relativePath ? { relativePath: item.relativePath } : {})
  }
}

function cloneGraphValue(value: GraphValue): GraphValue {
  switch (value.kind) {
    case 'asset':
      return { ...value }
    case 'text':
      return { ...value }
    case 'world':
    case 'beat':
    case 'shots':
      return { ...value }
    case 'texts':
      return {
        kind: 'texts',
        items: value.items.map((item) => ({
          ...(item.id ? { id: item.id } : {}),
          text: item.text
        }))
      }
    case 'camera':
      return { ...value, viewer: value.viewer ? { ...value.viewer } : undefined }
    case 'image':
      return {
        kind: 'image',
        ...(value.id ? { id: value.id } : {}),
        dataUrl: value.dataUrl,
        ...(value.createdAt ? { createdAt: value.createdAt } : {}),
        ...(value.relativePath ? { relativePath: value.relativePath } : {})
      }
    case 'images':
      return { kind: 'images', items: value.items.map(cloneImageItem) }
    case 'videos':
      return { kind: 'videos', items: value.items.map(cloneVideoItem) }
    case 'voices':
      return {
        kind: 'voices',
        items: value.items.map((item) => ({
          ...(item.id ? { id: item.id } : {}),
          ...(item.createdAt ? { createdAt: item.createdAt } : {}),
          ...(item.relativePath ? { relativePath: item.relativePath } : {})
        }))
      }
    case 'video':
      return {
        kind: 'video',
        ...(value.id ? { id: value.id } : {}),
        ...(value.dataUrl ? { dataUrl: value.dataUrl } : {}),
        ...(value.createdAt ? { createdAt: value.createdAt } : {}),
        ...(value.relativePath ? { relativePath: value.relativePath } : {})
      }
    case 'output':
      return {
        kind: 'output',
        outputKind: value.outputKind,
        items: value.items.map((item) => ({ ...item })),
        notes: value.notes.map((note) => ({ ...note })),
        params: { ...value.params },
        ...(value.images ? { images: value.images.map(cloneImageItem) } : {}),
        ...(value.videos ? { videos: value.videos.map(cloneVideoItem) } : {}),
        ...(value.texts
          ? {
              texts: value.texts.map((item) => ({
                ...(item.id ? { id: item.id } : {}),
                text: item.text,
                ...(item.createdAt ? { createdAt: item.createdAt } : {}),
                ...(item.relativePath ? { relativePath: item.relativePath } : {})
              }))
            }
          : {}),
        ...(value.voices
          ? {
              voices: value.voices.map((item) => ({
                ...(item.id ? { id: item.id } : {}),
                ...(item.createdAt ? { createdAt: item.createdAt } : {}),
                ...(item.relativePath ? { relativePath: item.relativePath } : {})
              }))
            }
          : {})
      }
    default:
      return value
  }
}

async function materializeImageItem(
  item: GraphImageItem,
  key: string,
  saveMedia: SaveGraphRunMediaFn,
  outputDir?: string
): Promise<GraphImageItem> {
  const next = cloneImageItem(item)
  if (next.relativePath?.trim()) {
    // 已物化：落盘时去掉巨大 dataUrl，预览走 relativePath
    if (isDataUrl(next.dataUrl)) next.dataUrl = ''
    return next
  }
  if (!isDataUrl(next.dataUrl)) return next
  try {
    const relativePath = await saveMedia({
      dataUrl: next.dataUrl,
      key,
      ...(outputDir ? { outputDir } : {})
    })
    next.relativePath = relativePath
    next.dataUrl = ''
  } catch {
    // 物化失败时保留原 dataUrl，由 sanitize 决定是否丢弃
  }
  return next
}

async function materializeGraphValue(
  value: GraphValue,
  keyPrefix: string,
  saveMedia: SaveGraphRunMediaFn,
  outputDir?: string
): Promise<GraphValue> {
  const cloned = cloneGraphValue(value)
  if (cloned.kind === 'image') {
    const item = await materializeImageItem(
      {
        id: cloned.id,
        dataUrl: cloned.dataUrl,
        createdAt: cloned.createdAt,
        relativePath: cloned.relativePath
      },
      `${keyPrefix}:image`,
      saveMedia,
      outputDir
    )
    return {
      kind: 'image',
      ...(item.id ? { id: item.id } : {}),
      dataUrl: item.dataUrl,
      ...(item.createdAt ? { createdAt: item.createdAt } : {}),
      ...(item.relativePath ? { relativePath: item.relativePath } : {})
    }
  }
  if (cloned.kind === 'images') {
    const items: GraphImageItem[] = []
    for (const [index, item] of cloned.items.entries()) {
      items.push(
        await materializeImageItem(item, `${keyPrefix}:img:${index}`, saveMedia, outputDir)
      )
    }
    return { kind: 'images', items }
  }
  if (cloned.kind === 'videos') {
    const items: GraphVideoItem[] = []
    for (const [index, item] of cloned.items.entries()) {
      if (item.relativePath?.trim()) {
        items.push(cloneVideoItem({ ...item, dataUrl: undefined }))
        continue
      }
      const dataUrl = item.dataUrl?.trim()
      if (dataUrl && isDataUrl(dataUrl)) {
        try {
          const relativePath = await saveMedia({
            dataUrl,
            key: `${keyPrefix}:vid:${index}`,
            ...(outputDir ? { outputDir } : {})
          })
          items.push(cloneVideoItem({ ...item, relativePath, dataUrl: undefined }))
          continue
        } catch {
          // 物化失败时保留原条目
        }
      }
      items.push(cloneVideoItem(item))
    }
    return { kind: 'videos', items }
  }
  if (cloned.kind === 'video') {
    if (cloned.relativePath?.trim()) {
      return { ...cloned, dataUrl: undefined }
    }
    const dataUrl = cloned.dataUrl?.trim()
    if (dataUrl && isDataUrl(dataUrl)) {
      try {
        const relativePath = await saveMedia({
          dataUrl,
          key: `${keyPrefix}:video`,
          ...(outputDir ? { outputDir } : {})
        })
        return { ...cloned, relativePath, dataUrl: undefined }
      } catch {
        // 物化失败时保留原值
      }
    }
    return cloned
  }
  if (cloned.kind === 'output') {
    if (cloned.images?.length) {
      const images: GraphImageItem[] = []
      for (const [index, item] of cloned.images.entries()) {
        images.push(
          await materializeImageItem(item, `${keyPrefix}:out:${index}`, saveMedia, outputDir)
        )
      }
      cloned.images = images
    }
    if (cloned.videos?.length) {
      const videos: GraphVideoItem[] = []
      for (const [index, item] of cloned.videos.entries()) {
        if (item.relativePath?.trim()) {
          videos.push(cloneVideoItem({ ...item, dataUrl: undefined }))
          continue
        }
        const dataUrl = item.dataUrl?.trim()
        if (dataUrl && isDataUrl(dataUrl)) {
          try {
            const relativePath = await saveMedia({
              dataUrl,
              key: `${keyPrefix}:out-vid:${index}`,
              ...(outputDir ? { outputDir } : {})
            })
            videos.push(cloneVideoItem({ ...item, relativePath, dataUrl: undefined }))
            continue
          } catch {
            // 物化失败时保留原条目
          }
        }
        videos.push(cloneVideoItem(item))
      }
      cloned.videos = videos
    }
    if (cloned.params.previewDataUrl && isDataUrl(cloned.params.previewDataUrl)) {
      try {
        const relativePath = await saveMedia({
          dataUrl: cloned.params.previewDataUrl,
          key: `${keyPrefix}:preview`,
          ...(outputDir ? { outputDir } : {})
        })
        cloned.params = {
          ...cloned.params,
          previewDataUrl: undefined,
          previewRelativePath: relativePath
        }
      } catch {
        /* keep */
      }
    }
    if (cloned.params.cameraShots?.length) {
      const shots: DirectorCameraShot[] = []
      for (const [index, shot] of cloned.params.cameraShots.entries()) {
        if (!isDataUrl(shot.dataUrl)) {
          shots.push(shot)
          continue
        }
        try {
          const relativePath = await saveMedia({
            dataUrl: shot.dataUrl,
            key: `${keyPrefix}:shot:${index}`,
            ...(outputDir ? { outputDir } : {})
          })
          shots.push({
            ...shot,
            dataUrl: '',
            relativePath
          })
        } catch {
          shots.push(shot)
        }
      }
      cloned.params = { ...cloned.params, cameraShots: shots }
    }
  }
  return cloned
}

/** 将 runStates 中的 dataUrl 物化为 relativePath，返回可落盘副本 */
export async function materializeRunStateOutputs(
  runStates: Record<string, GraphNodeRunState>,
  saveMedia: SaveGraphRunMediaFn,
  resolveOutputDir?: (nodeId: string) => string | undefined
): Promise<Record<string, GraphNodeRunState>> {
  const next: Record<string, GraphNodeRunState> = {}
  for (const [nodeId, state] of Object.entries(runStates)) {
    if (!state?.outputs) {
      next[nodeId] = { status: state.status, ...(state.error ? { error: state.error } : {}) }
      continue
    }
    const outputDir = resolveOutputDir?.(nodeId)
    const outputs: Record<string, GraphValue> = {}
    for (const [portId, value] of Object.entries(state.outputs)) {
      outputs[portId] = await materializeGraphValue(
        value,
        `${nodeId}:${portId}`,
        saveMedia,
        outputDir
      )
    }
    next[nodeId] = {
      status: state.status,
      ...(state.error ? { error: state.error } : {}),
      outputs
    }
  }
  return next
}

/** 物化节点 params 上的预览图（director / select image 等） */
export async function materializeNodePreviewParams(
  nodes: GraphNode[],
  saveMedia: SaveGraphRunMediaFn,
  resolveOutputDir?: (node: GraphNode) => string | undefined
): Promise<GraphNode[]> {
  const result: GraphNode[] = []
  for (const node of nodes) {
    const params = { ...node.params }
    let changed = false
    const outputDir = resolveOutputDir?.(node)

    if (isDataUrl(params.previewDataUrl)) {
      try {
        const relativePath = await saveMedia({
          dataUrl: params.previewDataUrl!,
          key: `${node.id}:param-preview`,
          ...(outputDir ? { outputDir } : {})
        })
        params.previewDataUrl = undefined
        params.previewRelativePath = relativePath
        changed = true
      } catch {
        /* keep */
      }
    }

    if (params.cameraShots?.length) {
      const shots: DirectorCameraShot[] = []
      for (const [index, shot] of params.cameraShots.entries()) {
        if (!isDataUrl(shot.dataUrl)) {
          shots.push(shot)
          continue
        }
        try {
          const relativePath = await saveMedia({
            dataUrl: shot.dataUrl,
            key: `${node.id}:param-shot:${index}`,
            ...(outputDir ? { outputDir } : {})
          })
          shots.push({ ...shot, dataUrl: '', relativePath })
          changed = true
        } catch {
          shots.push(shot)
        }
      }
      if (changed) params.cameraShots = shots
    }

    if (params.generatedImages?.length) {
      const generated: NonNullable<GraphNode['params']['generatedImages']> = []
      for (const [index, item] of params.generatedImages.entries()) {
        if (!isDataUrl(item.dataUrl)) {
          generated.push(item)
          continue
        }
        try {
          const relativePath = await saveMedia({
            dataUrl: item.dataUrl,
            key: `${node.id}:param-gen:${item.id || index}`,
            ...(outputDir ? { outputDir } : {})
          })
          generated.push({ ...item, dataUrl: '', relativePath })
          changed = true
        } catch {
          generated.push(item)
        }
      }
      if (changed) params.generatedImages = generated
    }

    if (params.generatedVideos?.length) {
      const generated: NonNullable<GraphNode['params']['generatedVideos']> = []
      for (const [index, item] of params.generatedVideos.entries()) {
        if (!isDataUrl(item.dataUrl)) {
          generated.push(item)
          continue
        }
        try {
          const relativePath = await saveMedia({
            dataUrl: item.dataUrl!,
            key: `${node.id}:param-gen-video:${item.id || index}`,
            ...(outputDir ? { outputDir } : {})
          })
          generated.push({ ...item, dataUrl: '', relativePath })
          changed = true
        } catch {
          generated.push(item)
        }
      }
      if (changed) params.generatedVideos = generated
    }

    result.push(changed ? { ...node, params } : node)
  }
  return result
}

export type HostMediaSyncSource =
  | { kind: 'relativePath'; relativePath: string }
  | { kind: 'asset'; assetId: string }

/**
 * 从已物化的输出中，为「尚无媒体文件」的宿主媒体资产解析可写入的文件来源。
 */
export function resolveHostMediaSyncSource(
  graph: GraphDocument,
  runStates: Record<string, GraphNodeRunState>,
  hostAssetId: string,
  hostType: AssetType
): HostMediaSyncSource | null {
  const outputNode = findOutputNode(graph)
  if (!outputNode) return null
  const out = runStates[outputNode.id]?.outputs?.out
  if (!out) return null

  /** 全量数组时取末条有路径的项（对齐图库「最新 / 当前选中」语义） */
  const fromImages = (items: GraphImageItem[] | undefined): HostMediaSyncSource | null => {
    const list = items ?? []
    for (let i = list.length - 1; i >= 0; i--) {
      const path = list[i]?.relativePath?.trim()
      if (path) return { kind: 'relativePath', relativePath: path }
    }
    return null
  }

  if (out.kind === 'image') {
    if (out.relativePath?.trim()) {
      return { kind: 'relativePath', relativePath: out.relativePath }
    }
    return null
  }
  if (out.kind === 'images') return fromImages(out.items)
  if (out.kind === 'videos') {
    for (let i = out.items.length - 1; i >= 0; i--) {
      const path = out.items[i]?.relativePath?.trim()
      if (path) return { kind: 'relativePath', relativePath: path }
    }
    return null
  }
  if (out.kind === 'voices') {
    for (let i = out.items.length - 1; i >= 0; i--) {
      const item = out.items[i]
      if (item?.relativePath?.trim()) {
        return { kind: 'relativePath', relativePath: item.relativePath }
      }
      if (item?.id?.trim()) return { kind: 'asset', assetId: item.id }
    }
    return null
  }
  if (out.kind === 'voice') {
    if (out.relativePath?.trim()) {
      return { kind: 'relativePath', relativePath: out.relativePath }
    }
    if (out.id?.trim()) return { kind: 'asset', assetId: out.id }
    return null
  }
  if (out.kind === 'video') {
    if (out.relativePath?.trim()) {
      return { kind: 'relativePath', relativePath: out.relativePath }
    }
    return null
  }
  if (out.kind === 'output') {
    if (hostType === 'image' || hostType === 'canvas' || hostType === 'world') {
      const fromOutImages = fromImages(out.images)
      if (fromOutImages) return fromOutImages
    }
    if (hostType === 'script' || hostType === 'video') {
      for (const item of out.videos ?? []) {
        if (item.relativePath?.trim()) {
          return { kind: 'relativePath', relativePath: item.relativePath }
        }
      }
    }
    if (hostType === 'voice') {
      for (const item of out.voices ?? []) {
        if (item.relativePath?.trim()) {
          return { kind: 'relativePath', relativePath: item.relativePath }
        }
        if (item.id?.trim() && item.id !== hostAssetId) {
          return { kind: 'asset', assetId: item.id }
        }
      }
    }
    for (const item of out.items) {
      if (item.assetType !== hostType) continue
      if (item.assetId === hostAssetId) return null
      return { kind: 'asset', assetId: item.assetId }
    }
  }
  if (out.kind === 'asset' && out.assetType === hostType && out.assetId !== hostAssetId) {
    return { kind: 'asset', assetId: out.assetId }
  }
  return null
}

export function previewSrcFromImageItem(item: {
  dataUrl?: string
  relativePath?: string
}): string {
  if (item.relativePath?.trim()) return `rel:${item.relativePath}`
  if (item.dataUrl?.trim()) return item.dataUrl
  return ''
}

export function isGraphOutputValue(value: GraphValue | undefined): value is GraphOutputValue {
  return value?.kind === 'output'
}
