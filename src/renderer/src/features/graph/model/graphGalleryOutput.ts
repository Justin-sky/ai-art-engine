/**
 * 累计图库（generatedImages / Videos / Voices / Texts）的输出写回：
 * 「设为当前输出」与「删除单条」共用一套逻辑，同时同步运行态 out / out-all 与节点 params，
 * 保证 Inspector 预览、节点卡片与下游取值一致。
 */
import type { GraphNode, GraphNodeParams, GraphValue } from '@shared/graph'
import { graphEditorHosts } from './graphEditorHosts'
import { graphRunHosts } from './graphRunHosts'

export type GalleryOutputKind = 'image' | 'video' | 'voice' | 'text'

export type GalleryDeleteResult = {
  /** 是否命中图库条目（未命中时调用方可回退整体清空） */
  removed: boolean
  /** 删除后图库是否已空 */
  emptied: boolean
  /** 被删条目的落盘路径，供调用方清理文件与缓存 */
  relativePath?: string
}

type ImageList = NonNullable<GraphNodeParams['generatedImages']>
type VideoList = NonNullable<GraphNodeParams['generatedVideos']>
type VoiceList = NonNullable<GraphNodeParams['generatedVoices']>
type TextList = NonNullable<GraphNodeParams['generatedTexts']>

function writeRunOutputs(
  hostId: string,
  nodeId: string,
  out: GraphValue,
  outAll: GraphValue
): void {
  const host = graphRunHosts.get(hostId)
  if (!host) return
  const prev = host.runStates[nodeId] ?? { status: 'done' as const }
  host.runStates[nodeId] = {
    ...prev,
    status: prev.status === 'idle' ? 'done' : prev.status,
    outputs: { ...(prev.outputs ?? {}), out, 'out-all': outAll }
  }
}

/** 图库清空后运行态不应再留旧 out，否则预览与下游仍拿到已删条目 */
function dropRunState(hostId: string, nodeId: string): void {
  const host = graphRunHosts.get(hostId)
  if (!host || host.isRunning.value) return
  delete host.runStates[nodeId]
}

function pickEntry<T extends { id?: string }>(list: T[], selectedId: string): T | undefined {
  return list.find((entry) => entry.id === selectedId) ?? list[list.length - 1]
}

/** 删除后仍沿用原选中项；原选中项被删或已不存在时回退最新一条 */
function nextSelectedId(
  current: string | undefined,
  removedId: string,
  list: Array<{ id?: string }>
): string {
  const keep = current?.trim() ?? ''
  if (keep && keep !== removedId && list.some((entry) => entry.id === keep)) return keep
  return list[list.length - 1]?.id ?? ''
}

function commitImages(
  hostId: string,
  node: GraphNode,
  list: ImageList,
  selectedId: string
): void {
  const picked = pickEntry(list, selectedId)
  if (picked?.id) {
    writeRunOutputs(
      hostId,
      node.id,
      {
        kind: 'image',
        id: picked.id,
        dataUrl: picked.dataUrl || '',
        createdAt: picked.createdAt,
        ...(picked.relativePath ? { relativePath: picked.relativePath } : {})
      },
      { kind: 'images', items: list }
    )
  } else {
    dropRunState(hostId, node.id)
  }
  graphEditorHosts.updateNode(hostId, node.id, {
    generatedImages: list,
    selectedImageId: picked?.id ?? '',
    previewDataUrl: picked?.dataUrl?.trim() ? picked.dataUrl : '',
    previewRelativePath: picked?.relativePath?.trim() ? picked.relativePath : ''
  })
}

function commitVideos(
  hostId: string,
  node: GraphNode,
  list: VideoList,
  selectedId: string
): void {
  const picked = pickEntry(list, selectedId)
  if (picked?.id) {
    writeRunOutputs(
      hostId,
      node.id,
      {
        kind: 'video',
        id: picked.id,
        dataUrl: picked.dataUrl || '',
        createdAt: picked.createdAt,
        ...(picked.relativePath ? { relativePath: picked.relativePath } : {})
      },
      { kind: 'videos', items: list }
    )
  } else {
    dropRunState(hostId, node.id)
  }
  graphEditorHosts.updateNode(hostId, node.id, {
    generatedVideos: list,
    selectedVideoId: picked?.id ?? '',
    previewDataUrl: picked?.dataUrl?.trim() ? picked.dataUrl : '',
    previewRelativePath: picked?.relativePath?.trim() ? picked.relativePath : ''
  })
}

function commitVoices(
  hostId: string,
  node: GraphNode,
  list: VoiceList,
  selectedId: string
): void {
  const picked = pickEntry(list, selectedId)
  if (picked?.id) {
    writeRunOutputs(
      hostId,
      node.id,
      {
        kind: 'voice',
        id: picked.id,
        createdAt: picked.createdAt,
        ...(picked.relativePath ? { relativePath: picked.relativePath } : {})
      },
      { kind: 'voices', items: list }
    )
  } else {
    dropRunState(hostId, node.id)
  }
  graphEditorHosts.updateNode(hostId, node.id, {
    generatedVoices: list,
    selectedVoiceId: picked?.id ?? '',
    previewRelativePath: picked?.relativePath?.trim() ? picked.relativePath : ''
  })
}

function commitTexts(hostId: string, node: GraphNode, list: TextList, selectedId: string): void {
  const picked = pickEntry(list, selectedId)
  const body = picked?.text ?? ''
  if (picked?.id) {
    const out: GraphValue =
      node.typeId === 'world.extract'
        ? {
            kind: 'world',
            text: body,
            ...(picked.relativePath ? { relativePath: picked.relativePath } : {})
          }
        : node.typeId === 'beat.split'
          ? {
              kind: 'beat',
              text: body,
              ...(picked.relativePath ? { relativePath: picked.relativePath } : {})
            }
          : {
              kind: 'text',
              text: body,
              id: picked.id,
              ...(picked.relativePath ? { relativePath: picked.relativePath } : {})
            }
    writeRunOutputs(hostId, node.id, out, { kind: 'texts', items: list })
  } else {
    dropRunState(hostId, node.id)
  }
  graphEditorHosts.updateNode(hostId, node.id, {
    generatedTexts: list,
    selectedTextId: picked?.id ?? '',
    text: body.trim() ? body : node.params.text,
    previewRelativePath: picked?.relativePath?.trim() ? picked.relativePath : ''
  })
}

/** 图库中是否存在该 id（可单独选中 / 删除） */
export function hasGalleryEntry(
  node: GraphNode,
  kind: GalleryOutputKind,
  entryId: string
): boolean {
  const id = entryId.trim()
  if (!id) return false
  return galleryList(node, kind).some((entry) => entry.id === id)
}

function galleryList(node: GraphNode, kind: GalleryOutputKind): Array<{ id?: string }> {
  if (kind === 'image') return node.params.generatedImages ?? []
  if (kind === 'video') return node.params.generatedVideos ?? []
  if (kind === 'voice') return node.params.generatedVoices ?? []
  return node.params.generatedTexts ?? []
}

/** 把图库中某条设为当前输出（out）；未命中返回 false */
export function selectGalleryOutput(
  hostId: string,
  node: GraphNode,
  kind: GalleryOutputKind,
  entryId: string
): boolean {
  const id = entryId.trim()
  if (!hostId || !id || !hasGalleryEntry(node, kind, id)) return false
  if (kind === 'image') {
    commitImages(hostId, node, node.params.generatedImages ?? [], id)
    return true
  }
  if (kind === 'video') {
    commitVideos(hostId, node, node.params.generatedVideos ?? [], id)
    return true
  }
  if (kind === 'voice') {
    commitVoices(hostId, node, node.params.generatedVoices ?? [], id)
    return true
  }
  commitTexts(hostId, node, node.params.generatedTexts ?? [], id)
  return true
}

/** 删除图库中某条；删空时清掉运行态与预览参数 */
export function deleteGalleryOutput(
  hostId: string,
  node: GraphNode,
  kind: GalleryOutputKind,
  entryId: string
): GalleryDeleteResult {
  const id = entryId.trim()
  if (!hostId || !id) return { removed: false, emptied: false }

  if (kind === 'image') {
    const list = node.params.generatedImages ?? []
    const target = list.find((entry) => entry.id === id)
    if (!target) return { removed: false, emptied: false }
    const next = list.filter((entry) => entry.id !== id)
    commitImages(hostId, node, next, nextSelectedId(node.params.selectedImageId, id, next))
    return { removed: true, emptied: !next.length, relativePath: target.relativePath }
  }
  if (kind === 'video') {
    const list = node.params.generatedVideos ?? []
    const target = list.find((entry) => entry.id === id)
    if (!target) return { removed: false, emptied: false }
    const next = list.filter((entry) => entry.id !== id)
    commitVideos(hostId, node, next, nextSelectedId(node.params.selectedVideoId, id, next))
    return { removed: true, emptied: !next.length, relativePath: target.relativePath }
  }
  if (kind === 'voice') {
    const list = node.params.generatedVoices ?? []
    const target = list.find((entry) => entry.id === id)
    if (!target) return { removed: false, emptied: false }
    const next = list.filter((entry) => entry.id !== id)
    commitVoices(hostId, node, next, nextSelectedId(node.params.selectedVoiceId, id, next))
    return { removed: true, emptied: !next.length, relativePath: target.relativePath }
  }
  const list = node.params.generatedTexts ?? []
  const target = list.find((entry) => entry.id === id)
  if (!target) return { removed: false, emptied: false }
  const next = list.filter((entry) => entry.id !== id)
  commitTexts(hostId, node, next, nextSelectedId(node.params.selectedTextId, id, next))
  return { removed: true, emptied: !next.length, relativePath: target.relativePath }
}
