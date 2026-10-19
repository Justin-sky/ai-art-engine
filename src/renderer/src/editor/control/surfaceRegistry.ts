import type { AssetInfo } from '@shared/domain'
import {
  introspectNodeInstance,
  type GraphDocument,
  type GraphNode,
  type NodeIntrospectedSchema,
  type NodeParamFieldSchema
} from '@shared/graph'
import { resolveDirectorStageScene } from '../../features/director/activeDirectorStageScene'
import {
  isEditorDiveAssetFrame,
  isEditorDiveViewFrame,
  type EditorDiveFrame
} from '../../features/graph/model/editorDive'
import { graphEditorHosts } from '../../features/graph/model/graphEditorHosts'
import { useProjectStore } from '../../stores/project'
import { useWorkspaceStore } from '../../stores/workspace'
import { useEditorKernel } from '../kernel'

export interface ActiveWorkspaceTargetResolution {
  /** 默认目标资产 ID（当 AI 省略 assetId 时自动兜底） */
  defaultAssetId: string
  /** 默认图编辑器宿主 ID（支持子图、世界观元素 tab、当前画布） */
  defaultHostId: string
  /** 默认目标节点 ID（当处于节点 Dive 内部或选中某节点且 AI 省略 nodeId 时自动兜底） */
  defaultNodeId: string | null
  /** 默认分组 ID（当选中某分组且 AI 省略 groupId 时自动兜底） */
  defaultGroupId: string | null
  /** 当前 Dive 栈顶关联的节点（若处于节点级 Dive 视图中） */
  divedNode: GraphNode | null
  divedNodeHostId: string | null
  divedNodeAssetId: string | null
  /** 当前画布/检查器选中的节点 */
  selectedNode: GraphNode | null
  selectedNodeHostId: string | null
  selectedNodeAssetId: string | null
}

export function resolveHostAssetIdFromHostId(hostId: string | undefined | null): string {
  if (!hostId) return ''
  const trimmed = hostId.trim()
  if (!trimmed.startsWith('asset:')) return ''
  const rest = trimmed.slice('asset:'.length)
  const colonIdx = rest.indexOf(':')
  return colonIdx >= 0 ? rest.slice(0, colonIdx) : rest
}

function readAssetGraph(asset: AssetInfo | undefined): GraphDocument | null {
  const graphJson = (asset?.genParams as Record<string, unknown> | undefined)?.graphJson as
    GraphDocument | undefined
  return graphJson && Array.isArray(graphJson.nodes) ? graphJson : null
}

function findNodeInHostOrAsset(
  hostId: string,
  nodeId: string,
  assets: AssetInfo[]
): GraphNode | null {
  const fromLive = graphEditorHosts.getNode(hostId, nodeId)
  if (fromLive) return fromLive
  const assetId = resolveHostAssetIdFromHostId(hostId)
  if (!assetId) return null
  const asset = assets.find((a) => a.id === assetId)
  const doc = graphEditorHosts.getLiveAssetDocument(assetId) ?? readAssetGraph(asset)
  return doc?.nodes.find((n) => n.id === nodeId) ?? null
}

/**
 * 解析当前工作区（左侧主窗口 + Dive 栈顶 + 右侧 Inspector）的默认操作目标。
 * 让 AI 在对话中无需记忆复杂的 assetId / hostId / nodeId 即可精准命中当前正在查看或编辑的对象。
 */
export function resolveActiveWorkspaceTargets(): ActiveWorkspaceTargetResolution {
  const workspaceStore = useWorkspaceStore()
  const project = useProjectStore()
  const editor = useEditorKernel()
  const curSel = editor.selection.current.value

  const hostFromSelection = resolveHostAssetIdFromHostId(workspaceStore.selectedGraphHostId)
  const lastOpenCanvas =
    workspaceStore.openCanvasEditorIds[workspaceStore.openCanvasEditorIds.length - 1] ?? null
  const lastOpenDirector =
    workspaceStore.openDirectorEditorIds[workspaceStore.openDirectorEditorIds.length - 1] ?? null
  const lastOpenWorld =
    workspaceStore.openWorldEditorIds[workspaceStore.openWorldEditorIds.length - 1] ?? null
  const lastOpenBeat =
    workspaceStore.openBeatEditorIds[workspaceStore.openBeatEditorIds.length - 1] ?? null
  const lastOpenScreenplay =
    workspaceStore.openScreenplayEditorIds[workspaceStore.openScreenplayEditorIds.length - 1] ??
    null
  const lastOpenAsset =
    workspaceStore.openAssetEditorIds[workspaceStore.openAssetEditorIds.length - 1] ?? null

  const liveEntries = graphEditorHosts.listLiveEntries()
  const lastLiveAssetId = (() => {
    for (let i = liveEntries.length - 1; i >= 0; i--) {
      const aid = resolveHostAssetIdFromHostId(liveEntries[i]?.hostId)
      if (aid) return aid
    }
    return null
  })()

  const diveRootKey = workspaceStore.activeDiveRootKey
  const parsedDiveRoot = (() => {
    if (!diveRootKey) return { kind: '', assetId: null as string | null }
    const m = diveRootKey.match(/^(canvas|asset|screenplay|world|beat|director)-editor-(.+)$/)
    if (m) return { kind: m[1] ?? '', assetId: m[2] || null }
    const parts = diveRootKey.split(':')
    return { kind: parts[0] ?? '', assetId: parts.slice(1).join(':') || null }
  })()
  const diveStack: EditorDiveFrame[] =
    (diveRootKey ? workspaceStore.editorDives[diveRootKey] : undefined) ?? []
  const diveTop = diveStack.length > 0 ? diveStack[diveStack.length - 1] : null

  const liveDirectorScene = resolveDirectorStageScene(null)

  let divedNode: GraphNode | null = null
  let divedNodeHostId: string | null = null
  let divedNodeAssetId: string | null = null
  let diveOverrideAssetId: string | null = null
  let diveOverrideHostId: string | null = null

  if (diveTop && isEditorDiveViewFrame(diveTop)) {
    const meta = diveTop.meta
    if ('hostId' in meta && 'nodeId' in meta && meta.hostId && meta.nodeId) {
      divedNodeHostId = meta.hostId
      divedNodeAssetId = resolveHostAssetIdFromHostId(meta.hostId)
      divedNode = findNodeInHostOrAsset(meta.hostId, meta.nodeId, project.assets)
      diveOverrideAssetId = divedNodeAssetId || null
      diveOverrideHostId = meta.hostId
    } else if (meta.viewId === 'director.stage' && meta.directorAssetId) {
      diveOverrideAssetId = meta.directorAssetId
    } else if (meta.viewId === 'script.timeline' && meta.scriptAssetId) {
      diveOverrideAssetId = meta.scriptAssetId
    } else if (meta.viewId === 'world.editor' && meta.worldAssetId) {
      diveOverrideAssetId = meta.worldAssetId
      const activeTab = meta.tab ?? 'characters'
      diveOverrideHostId =
        meta.worldGenNodeId?.trim() && meta.worldGenNodeId.trim() !== 'world-gen'
          ? `asset:${meta.worldAssetId}:element:${activeTab}:${meta.worldGenNodeId.trim()}`
          : `asset:${meta.worldAssetId}:element:${activeTab}`
    } else if (meta.viewId === 'gamePlay.sandbox' && meta.gamePlayAssetId) {
      diveOverrideAssetId = meta.gamePlayAssetId
    }
  } else if (diveTop && isEditorDiveAssetFrame(diveTop)) {
    diveOverrideAssetId = diveTop.assetId
    diveOverrideHostId = `asset:${diveTop.assetId}`
  }

  const defaultAssetId =
    diveOverrideAssetId ||
    parsedDiveRoot.assetId ||
    hostFromSelection ||
    liveDirectorScene?.directorAssetId ||
    lastOpenCanvas ||
    lastOpenDirector ||
    lastOpenWorld ||
    lastOpenBeat ||
    lastOpenScreenplay ||
    lastLiveAssetId ||
    (workspaceStore.selectedAssetId &&
    project.assets.some(
      (a) =>
        a.id === workspaceStore.selectedAssetId &&
        (a.type === 'canvas' || (readAssetGraph(a)?.nodes?.length ?? 0) > 0)
    )
      ? workspaceStore.selectedAssetId
      : null) ||
    lastOpenAsset ||
    project.assets.find((a) => a.type === 'canvas')?.id ||
    project.assets[0]?.id ||
    ''

  const defaultHostId =
    diveOverrideHostId ||
    workspaceStore.selectedGraphHostId ||
    (defaultAssetId ? `asset:${defaultAssetId}` : '')

  // 解析当前选中的节点
  const selNodeId =
    (curSel.kind === 'graph.node' && typeof curSel.id === 'string' ? curSel.id : null) ||
    workspaceStore.selectedGraphNodeId ||
    null
  const selHostId =
    (curSel.kind === 'graph.node' && typeof curSel.hostId === 'string' ? curSel.hostId : null) ||
    workspaceStore.selectedGraphHostId ||
    defaultHostId

  const selectedNode =
    selNodeId && selHostId ? findNodeInHostOrAsset(selHostId, selNodeId, project.assets) : null
  const selectedNodeHostId = selectedNode ? selHostId : null
  const selectedNodeAssetId = selectedNode
    ? resolveHostAssetIdFromHostId(selHostId) || defaultAssetId
    : null

  const defaultNodeId = divedNode?.id ?? selectedNode?.id ?? selNodeId ?? null
  const defaultGroupId =
    curSel.kind === 'graph.group' && typeof curSel.id === 'string' ? curSel.id : null

  return {
    defaultAssetId,
    defaultHostId,
    defaultNodeId,
    defaultGroupId,
    divedNode,
    divedNodeHostId,
    divedNodeAssetId,
    selectedNode,
    selectedNodeHostId,
    selectedNodeAssetId
  }
}

function describeFieldConstraintCompact(field: NodeParamFieldSchema): string {
  const parts: string[] = [field.type]
  if (field.enumValues && field.enumValues.length > 0) {
    parts.push(`enum=[${field.enumValues.slice(0, 12).join('|')}]`)
  }
  if (field.min !== undefined || field.max !== undefined) {
    parts.push(`range=${field.min ?? ''}..${field.max ?? ''}`)
  }
  return `${field.path} (${parts.join(', ')})`
}

/**
 * 将任意节点实例的自省 Schema 格式化为供 AI 理解的紧凑可编辑契约摘要。
 * 当代码中新增节点或新增参数时，该函数会自动输出新参数路径、范围、枚举与预设，零手工维护。
 */
export function formatNodeEditableSchemaSummary(
  node: Pick<GraphNode, 'typeId' | 'category' | 'assetType' | 'params'>,
  indent = '  '
): string[] {
  const schema: NodeIntrospectedSchema | undefined = introspectNodeInstance(node)
  if (!schema) return []

  const lines: string[] = []
  const leafDescriptors: string[] = []

  function collectLeaves(field: NodeParamFieldSchema, depth = 0): void {
    if (depth > 3) return
    if (field.children && Object.keys(field.children).length > 0) {
      if (field.type === 'json-string') {
        leafDescriptors.push(`${field.path} (json-string object, supports dot-path & deep merge)`)
      }
      for (const child of Object.values(field.children)) {
        collectLeaves(child, depth + 1)
      }
      return
    }
    if (field.itemSchema) {
      leafDescriptors.push(
        `${field.path}[] (array, supports index/filter selector e.g. ${field.path}[0].xxx)`
      )
      if (field.itemSchema.children) {
        for (const child of Object.values(field.itemSchema.children)) {
          collectLeaves(child, depth + 1)
        }
      }
      return
    }
    leafDescriptors.push(describeFieldConstraintCompact(field))
  }

  for (const field of Object.values(schema.fields)) {
    collectLeaves(field, 0)
  }

  if (leafDescriptors.length > 0) {
    lines.push(
      `${indent}Editable Params Schema (${schema.typeId}): ${leafDescriptors.slice(0, 32).join('; ')}`
    )
  }

  const shorthandKeys = Object.keys(schema.shorthandMap)
  if (shorthandKeys.length > 0) {
    lines.push(
      `${indent}Supported Top-Level Shorthand Keys (auto-routed to sub-doc): ${shorthandKeys.slice(0, 24).join(', ')}`
    )
  }

  if (schema.presets.length > 0) {
    const presetList = schema.presets
      .slice(0, 20)
      .map((p) => `${p.id} (${p.label})`)
      .join(', ')
    lines.push(
      `${indent}Supported One-Click Presets (pass \`preset: "<id>"\` in node_update or op="apply_preset"): ${presetList}`
    )
  }

  return lines
}
