import { createNodeFromType } from './create'
import { autoLayoutNodes } from './layout'
import { normalizeScopedGraph } from './normalize'
import { canConnectNodes, getNodePorts } from './ports'
import { listAddableNodeTypes } from './registry'
import type { GraphAddScope } from './scopes'
import type {
  GraphDocument,
  GraphEdge,
  GraphNode,
  GraphNodeParams,
  GraphNodeTypeId
} from './types'

export interface GraphPlanNodeSpec {
  key: string
  typeId: string
  title?: string
  params?: Record<string, unknown>
}

export interface GraphPlanEdgeSpec {
  from: string
  to: string
  fromPort?: string
  toPort?: string
}

/** LLM 输出的受约束构图计划（非完整 GraphDocument） */
export interface GraphPlan {
  title?: string
  nodes: GraphPlanNodeSpec[]
  edges: GraphPlanEdgeSpec[]
}

export interface MaterializeGraphPlanOptions {
  scope?: GraphAddScope
  assetType?: string | null
  hostAssetId?: string | null
}

export interface MaterializeGraphPlanResult {
  ok: boolean
  document: GraphDocument | null
  title: string
  warnings: string[]
  error?: string
}

/** 供 LLM 注入的节点目录摘要 */
export interface GraphPlanCatalogEntry {
  typeId: string
  label: string
  ports: Array<{ id: string; direction: 'in' | 'out'; dataType: string }>
}

const ALLOWED_PARAM_KEYS = new Set<keyof GraphNodeParams | string>([
  'text',
  'generateInstruction',
  'generateSystemPrompt',
  'skillId',
  'generateModel',
  'generateProviderInstanceId',
  'generateAspectRatio',
  'generateResolution',
  'generateQuality',
  'generateDuration',
  'generateCount',
  'generateSeed',
  'generateSeedUseGlobal',
  'generateFrameMode',
  'generateAudio',
  'notes',
  'label',
  'inputDataType',
  'episodeStep',
  'episodeReviewTarget',
  'episodeReviewVariant',
  'episodeReviewPending',
  'anchorIndex',
  'cellGroupIndex',
  'cellIndex',
  'episodeScopeKey',
  'imageGridSplit',
  'imageLayerSplit'
])

export interface GraphPlanMediaModelDefaults {
  imageModel?: string
  imageProviderInstanceId?: string
  videoModel?: string
  videoProviderInstanceId?: string
  /** 一键工作流统一宽高比：注入到图片/视频生成及高清放大节点 */
  generateAspectRatio?: string
}

export interface GraphPlanPreview {
  title: string
  nodes: Array<{ key: string; typeId: string; title: string }>
  edges: Array<{ from: string; to: string; fromPort?: string; toPort?: string }>
}

/**
 * 将默认图/视频模型写入计划中尚未指定模型的生成节点，
 * 并在指定统一宽高比时覆盖图片/视频生成及高清放大节点。
 */
export function applyDefaultGenerateModels(
  plan: GraphPlan,
  defaults: GraphPlanMediaModelDefaults
): GraphPlan {
  const aspectRatio = defaults.generateAspectRatio?.trim() || ''
  const nodes = plan.nodes.map((node) => {
    const params = { ...(node.params ?? {}) }
    if (node.typeId === 'asset.image' || node.typeId === 'image.upscale') {
      if (defaults.imageModel && !params.generateModel) {
        params.generateModel = defaults.imageModel
      }
      if (defaults.imageProviderInstanceId && !params.generateProviderInstanceId) {
        params.generateProviderInstanceId = defaults.imageProviderInstanceId
      }
      if (aspectRatio) params.generateAspectRatio = aspectRatio
    } else if (node.typeId === 'asset.video') {
      if (defaults.videoModel && !params.generateModel) {
        params.generateModel = defaults.videoModel
      }
      if (defaults.videoProviderInstanceId && !params.generateProviderInstanceId) {
        params.generateProviderInstanceId = defaults.videoProviderInstanceId
      }
      if (aspectRatio) params.generateAspectRatio = aspectRatio
    } else {
      return node
    }
    return { ...node, params }
  })
  return { ...plan, nodes }
}

export function buildGraphPlanPreview(plan: GraphPlan): GraphPlanPreview {
  return {
    title: plan.title?.trim() || 'AI Workflow',
    nodes: plan.nodes.map((n) => ({
      key: n.key,
      typeId: n.typeId,
      title: (n.title?.trim() || n.key).trim()
    })),
    edges: plan.edges.map((e) => ({
      from: e.from,
      to: e.to,
      fromPort: e.fromPort,
      toPort: e.toPort
    }))
  }
}

export function buildGraphPlanCatalog(scope: GraphAddScope = 'subgraphAsset'): GraphPlanCatalogEntry[] {
  return listAddableNodeTypes(scope)
    .filter((def) => def.typeId !== 'graph.boundary.input' && def.typeId !== 'graph.boundary.output')
    .map((def) => ({
      typeId: def.typeId,
      label: def.label,
      ports: def.ports.map((port) => ({
        id: port.id,
        direction: port.direction,
        dataType: String(port.dataType)
      }))
    }))
}

function pickAllowedParams(raw: Record<string, unknown> | undefined): Partial<GraphNodeParams> {
  if (!raw || typeof raw !== 'object') return {}
  const next: Partial<GraphNodeParams> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (!ALLOWED_PARAM_KEYS.has(key)) continue
    if (value === undefined) continue
    ;(next as Record<string, unknown>)[key] = value
  }
  return next
}

function stripCodeFence(text: string): string {
  const trimmed = text.trim()
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i)
  return fenced?.[1]?.trim() || trimmed
}

/** 从模型文本中解析 GraphPlan；失败抛错 */
export function parseGraphPlanJson(text: string): GraphPlan {
  const raw = stripCodeFence(text)
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    if (start < 0 || end <= start) throw new Error('模型未返回合法 JSON')
    parsed = JSON.parse(raw.slice(start, end + 1))
  }
  if (!parsed || typeof parsed !== 'object') throw new Error('GraphPlan 必须是对象')
  const obj = parsed as Record<string, unknown>
  const nodesRaw = Array.isArray(obj.nodes) ? obj.nodes : null
  const edgesRaw = Array.isArray(obj.edges) ? obj.edges : null
  if (!nodesRaw) throw new Error('GraphPlan.nodes 必须是数组')
  if (!edgesRaw) throw new Error('GraphPlan.edges 必须是数组')

  const nodes: GraphPlanNodeSpec[] = []
  for (const item of nodesRaw) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const key = typeof row.key === 'string' ? row.key.trim() : ''
    const typeId = typeof row.typeId === 'string' ? row.typeId.trim() : ''
    if (!key || !typeId) continue
    nodes.push({
      key,
      typeId,
      title: typeof row.title === 'string' ? row.title.trim() : undefined,
      params:
        row.params && typeof row.params === 'object'
          ? (row.params as Record<string, unknown>)
          : undefined
    })
  }

  const edges: GraphPlanEdgeSpec[] = []
  for (const item of edgesRaw) {
    if (!item || typeof item !== 'object') continue
    const row = item as Record<string, unknown>
    const from = typeof row.from === 'string' ? row.from.trim() : ''
    const to = typeof row.to === 'string' ? row.to.trim() : ''
    if (!from || !to) continue
    edges.push({
      from,
      to,
      fromPort: typeof row.fromPort === 'string' ? row.fromPort.trim() : undefined,
      toPort: typeof row.toPort === 'string' ? row.toPort.trim() : undefined
    })
  }

  return {
    title: typeof obj.title === 'string' ? obj.title.trim() : undefined,
    nodes,
    edges
  }
}

function resolveEdgePorts(
  source: GraphNode,
  target: GraphNode,
  fromPort?: string,
  toPort?: string
): { sourcePort: string; targetPort: string } | null {
  if (fromPort || toPort) {
    const sourcePort = fromPort || 'out'
    const targetPort = toPort || 'in'
    if (canConnectNodes(source, target, { sourcePort, targetPort })) {
      return { sourcePort, targetPort }
    }
    return null
  }
  const outs = getNodePorts(source).filter((p) => p.direction === 'out')
  const ins = getNodePorts(target).filter((p) => p.direction === 'in')
  for (const out of outs) {
    for (const inp of ins) {
      if (canConnectNodes(source, target, { sourcePort: out.id, targetPort: inp.id })) {
        return { sourcePort: out.id, targetPort: inp.id }
      }
    }
  }
  return null
}

/**
 * 将 GraphPlan 物化为可落盘 GraphDocument。
 * 非法 typeId / 非法边会被丢弃并记入 warnings。
 */
export function materializeGraphPlan(
  plan: GraphPlan,
  options: MaterializeGraphPlanOptions = {}
): MaterializeGraphPlanResult {
  const scope = options.scope ?? 'subgraphAsset'
  const warnings: string[] = []
  const addable = new Map(
    listAddableNodeTypes(scope).map((def) => [def.typeId, def] as const)
  )

  const keyToId = new Map<string, string>()
  const nodes: GraphNode[] = []
  let col = 0
  for (const spec of plan.nodes) {
    const key = spec.key.trim()
    if (!key) {
      warnings.push('跳过空 key 节点')
      continue
    }
    if (keyToId.has(key)) {
      warnings.push(`重复节点 key「${key}」已跳过`)
      continue
    }
    if (!addable.has(spec.typeId)) {
      warnings.push(`未知或不可添加类型「${spec.typeId}」（key=${key}）`)
      continue
    }
    const node = createNodeFromType(spec.typeId as GraphNodeTypeId, {
      x: col * 280,
      y: 80
    }, {
      title: spec.title?.trim() || undefined,
      params: pickAllowedParams(spec.params)
    })
    keyToId.set(key, node.id)
    nodes.push(node)
    col += 1
  }

  if (nodes.length < 1) {
    return {
      ok: false,
      document: null,
      title: plan.title?.trim() || 'AI Workflow',
      warnings,
      error: '没有可用节点，无法物化工作流'
    }
  }

  const byId = new Map(nodes.map((n) => [n.id, n]))
  const edges: GraphEdge[] = []
  let edgeIndex = 0
  for (const spec of plan.edges) {
    const sourceId = keyToId.get(spec.from)
    const targetId = keyToId.get(spec.to)
    if (!sourceId || !targetId) {
      warnings.push(`边 ${spec.from}→${spec.to} 引用了不存在的节点`)
      continue
    }
    const source = byId.get(sourceId)!
    const target = byId.get(targetId)!
    const ports = resolveEdgePorts(source, target, spec.fromPort, spec.toPort)
    if (!ports) {
      warnings.push(
        `边 ${spec.from}→${spec.to} 端口不兼容` +
          (spec.fromPort || spec.toPort
            ? `（${spec.fromPort ?? 'out'}→${spec.toPort ?? 'in'}）`
            : '')
      )
      continue
    }
    edges.push({
      id: `edge-ai-${edgeIndex++}`,
      source: sourceId,
      target: targetId,
      sourcePort: ports.sourcePort,
      targetPort: ports.targetPort
    })
  }

  autoLayoutNodes(nodes, edges)

  let document = normalizeScopedGraph(
    scope,
    {
      nodes,
      edges,
      viewport: { x: 0, y: 0, zoom: 1 }
    },
    {
      assetType: options.assetType ?? 'subgraph',
      hostAssetId: options.hostAssetId
    }
  )

  // normalize 可能增删节点；再布局一次业务节点（边界节点也参与拓扑）
  autoLayoutNodes(document.nodes, document.edges)
  document = {
    ...document,
    viewport: document.viewport ?? { x: 0, y: 0, zoom: 1 }
  }

  return {
    ok: true,
    document,
    title: plan.title?.trim() || 'AI Workflow',
    warnings
  }
}
