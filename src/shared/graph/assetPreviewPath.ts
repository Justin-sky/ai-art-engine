/**
 * 资产库 Inspector 预览路径解析：自身媒体 → 落盘 outputs → 节点预览 → 图内引用资产。
 */

import type { AssetInfo } from '../domain'
import type { GraphDocument, GraphPersistedRunState } from './types'
import type { GraphValue } from './execute/types'
import { resolvePreviewMediaPath } from '../media/thumbnailPath'

function trimPath(value: string | null | undefined): string | null {
  const t = value?.trim()
  return t || null
}

function pathFromImageLike(item: {
  dataUrl?: string
  relativePath?: string
}): string | null {
  return trimPath(item.relativePath)
}

function pathFromGraphValue(value: GraphValue | undefined): string | null {
  if (!value) return null
  if (value.kind === 'image') return pathFromImageLike(value)
  if (value.kind === 'images') {
    for (const item of value.items) {
      const path = pathFromImageLike(item)
      if (path) return path
    }
    return null
  }
  if (value.kind === 'video') return pathFromImageLike(value)
  if (value.kind === 'videos') {
    for (const item of value.items) {
      const path = pathFromImageLike(item)
      if (path) return path
    }
    return null
  }
  if (value.kind === 'voices') {
    for (const item of value.items) {
      const path = trimPath(item.relativePath)
      if (path) return path
    }
    return null
  }
  if (value.kind === 'output') {
    for (const item of value.images ?? []) {
      const path = pathFromImageLike(item)
      if (path) return path
    }
    for (const item of value.videos ?? []) {
      const path = pathFromImageLike(item)
      if (path) return path
    }
    for (const item of value.voices ?? []) {
      const path = trimPath(item.relativePath)
      if (path) return path
    }
    for (const item of value.items) {
      if (item.kind !== 'asset') continue
      // 仅返回相对路径类输出；asset 引用由调用方用 assets 表解析
    }
  }
  return null
}

function readGraphDocument(raw: unknown): GraphDocument | null {
  if (!raw || typeof raw !== 'object') return null
  const doc = raw as GraphDocument
  if (!Array.isArray(doc.nodes)) return null
  return doc
}

function assetFilePath(asset: AssetInfo): string | null {
  return resolvePreviewMediaPath({
    relativePath: asset.relativePath,
    thumbnailPath: asset.thumbnailPath,
    type: asset.type
  })
}

function pathFromRunStates(
  runStates: Record<string, GraphPersistedRunState> | undefined
): string | null {
  if (!runStates) return null
  for (const state of Object.values(runStates)) {
    const outputs = state.outputs
    if (!outputs) continue
    for (const value of Object.values(outputs)) {
      const path = pathFromGraphValue(value)
      if (path) return path
    }
  }
  return null
}

function pathFromNodeParams(graph: GraphDocument): string | null {
  for (const node of graph.nodes) {
    const previewRel = trimPath(node.params?.previewRelativePath)
    if (previewRel) return previewRel
    for (const shot of node.params?.cameraShots ?? []) {
      const path = trimPath(shot.relativePath)
      if (path) return path
    }
    for (const item of node.params?.generatedImages ?? []) {
      const path = trimPath(item.relativePath)
      if (path) return path
    }
    for (const item of node.params?.generatedVoices ?? []) {
      const path = trimPath(item.relativePath)
      if (path) return path
    }
  }
  return null
}

function pathFromGraphAssetRefs(
  graph: GraphDocument,
  assets: AssetInfo[],
  selfId: string
): string | null {
  const byId = new Map(assets.map((item) => [item.id, item]))
  for (const node of graph.nodes) {
    if (!node.assetId || node.assetId === selfId) continue
    const other = byId.get(node.assetId)
    if (!other) continue
    const path = assetFilePath(other)
    if (path) return path
  }
  // 输出 runStates 里的 asset 引用
  for (const state of Object.values(graph.runStates ?? {})) {
    const out = state.outputs?.out
    if (!out) continue
    const items =
      out.kind === 'output' ? out.items : out.kind === 'asset' ? [out] : []
    for (const item of items) {
      if (item.kind !== 'asset' || item.assetId === selfId) continue
      const other = byId.get(item.assetId)
      if (!other) continue
      const path = assetFilePath(other)
      if (path) return path
    }
  }
  return null
}

/** 解析资产在 Inspector / 缩略图中应使用的媒体相对路径 */
export function resolveAssetPreviewMediaPath(
  asset: AssetInfo,
  assets: AssetInfo[] = []
): string | null {
  const own = assetFilePath(asset)
  if (own) return own

  const graph = readGraphDocument(asset.genParams?.graphJson)
  if (!graph) return null

  return (
    pathFromRunStates(graph.runStates) ||
    pathFromNodeParams(graph) ||
    pathFromGraphAssetRefs(graph, assets, asset.id)
  )
}
