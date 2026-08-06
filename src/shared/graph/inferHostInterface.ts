/**
 * 根据内图拓扑推断宿主 I/O：供 AI 构图 / 封装落盘时避免一律套「文本入出」。
 */
import { ensureBuiltinNodeTypes } from './builtinState'
import {
  defaultHostInterfaceForAssetType,
  hostBoundaryPortLabel,
  HOST_INTERFACE_FORMAT_VERSION,
  isBoundaryProxyNode,
  type HostBoundaryPort,
  type HostInterfaceDocument
} from './hostInterface'
import { getNodePorts } from './ports'
import {
  GraphPortType,
  isPluralGraphPortDataType,
  toPluralGraphPortDataType,
  toSingularGraphPortDataType,
  type GraphDocument,
  type GraphNode,
  type GraphPortDataType
} from './types'

const OUT_TYPE_PRIORITY: GraphPortDataType[] = [
  GraphPortType.video,
  GraphPortType.videos,
  GraphPortType.image,
  GraphPortType.images,
  GraphPortType.voice,
  GraphPortType.voices,
  GraphPortType.text,
  GraphPortType.texts,
  GraphPortType.worldEntities,
  GraphPortType.beat,
  GraphPortType.model
]

function isBusinessNode(node: GraphNode): boolean {
  if (isBoundaryProxyNode(node)) return false
  if (node.category === 'output') return false
  return getNodePorts(node).length > 0
}

function toBoundaryDataType(dataType: GraphPortDataType): GraphPortDataType {
  return toSingularGraphPortDataType(dataType)
}

function pickPrimaryOutType(node: GraphNode): GraphPortDataType | null {
  const outs = getNodePorts(node).filter((p) => p.direction === 'out')
  if (!outs.length) return null
  for (const preferred of OUT_TYPE_PRIORITY) {
    const hit = outs.find((p) => p.dataType === preferred)
    if (hit) return toBoundaryDataType(hit.dataType)
  }
  return toBoundaryDataType(outs[0]!.dataType)
}

function sortSinks(a: GraphNode, b: GraphNode): number {
  return (
    (a.position?.y ?? 0) - (b.position?.y ?? 0) ||
    (b.position?.x ?? 0) - (a.position?.x ?? 0)
  )
}

function canAggregatePortType(dataType: GraphPortDataType): boolean {
  const plural = toPluralGraphPortDataType(dataType)
  return isPluralGraphPortDataType(plural) && plural !== dataType
}

/**
 * 短剧分镜等大图：同类多汇点 → 一个复数方形口（图片组/视频组…）。
 * 角色设定等小图（总汇点 ≤3）：保持 1:1 命名出口（三路立绘）。
 */
function shouldAggregateOutputsByCategory(
  sinksByType: Map<GraphPortDataType, GraphNode[]>
): boolean {
  let total = 0
  let hasParallel = false
  for (const [dataType, list] of sinksByType) {
    total += list.length
    if (list.length >= 2 && canAggregatePortType(dataType)) {
      hasParallel = true
    }
  }
  return total > 3 && hasParallel
}

function outputPortId(index: number, dataType: GraphPortDataType): string {
  if (index === 0) return 'out'
  return `out-${dataType}`
}

/**
 * 从已物化内图推断 hostInterface：
 * - 输出：无下游业务边的汇节点主出口类型
 *   - 大图并行汇点：按类别收成复数口（方形，数组）
 *   - 小图：每个汇节点各建一个出口（同类型不去重：三路立绘 → 三个图片输出）
 * - 输入：无上游业务边的源节点上尚未接线的入端口
 * 若无法推断则回退 subgraph 默认模板。
 */
export function inferHostInterfaceFromGraph(document: GraphDocument): HostInterfaceDocument {
  ensureBuiltinNodeTypes()
  const business = document.nodes.filter(isBusinessNode)
  const businessIds = new Set(business.map((n) => n.id))

  const sinks = business
    .filter((n) => {
      // 备注便签不当作宿主出口
      if (n.typeId === 'note.text') return false
      return !document.edges.some((e) => e.source === n.id && businessIds.has(e.target))
    })
    .sort(sortSinks)

  const sinksByType = new Map<GraphPortDataType, GraphNode[]>()
  for (const sink of sinks) {
    const dataType = pickPrimaryOutType(sink)
    if (!dataType) continue
    const list = sinksByType.get(dataType) ?? []
    list.push(sink)
    sinksByType.set(dataType, list)
  }

  const aggregate = shouldAggregateOutputsByCategory(sinksByType)
  const outputs: HostBoundaryPort[] = []

  if (aggregate) {
    const seen = new Set<GraphPortDataType>()
    const orderedTypes: GraphPortDataType[] = []
    for (const t of OUT_TYPE_PRIORITY) {
      const singular = toSingularGraphPortDataType(t)
      if (seen.has(singular) || !sinksByType.has(singular)) continue
      seen.add(singular)
      orderedTypes.push(singular)
    }
    for (const key of sinksByType.keys()) {
      if (!seen.has(key)) orderedTypes.push(key)
    }
    for (const singular of orderedTypes) {
      const list = sinksByType.get(singular)
      if (!list?.length) continue
      const usePlural = list.length >= 2 && canAggregatePortType(singular)
      const dataType = usePlural ? toPluralGraphPortDataType(singular) : singular
      outputs.push({
        id: outputPortId(outputs.length, dataType),
        label: hostBoundaryPortLabel(dataType, 'out', 1),
        dataType,
        multiple: usePlural
      })
    }
  } else {
    const outTypeOrdinal = new Map<string, number>()
    for (const sink of sinks) {
      const dataType = pickPrimaryOutType(sink)
      if (!dataType) continue
      const next = (outTypeOrdinal.get(dataType) ?? 0) + 1
      outTypeOrdinal.set(dataType, next)
      const title = typeof sink.title === 'string' ? sink.title.trim() : ''
      outputs.push({
        id: outputs.length === 0 ? 'out' : `out-${outputs.length}`,
        label: title || hostBoundaryPortLabel(dataType, 'out', next),
        dataType,
        multiple: false
      })
    }
  }

  const sources = business
    .filter(
      (n) => !document.edges.some((e) => e.target === n.id && businessIds.has(e.source))
    )
    .sort(
      (a, b) =>
        (a.position?.x ?? 0) - (b.position?.x ?? 0) ||
        (a.position?.y ?? 0) - (b.position?.y ?? 0)
    )

  const inputs: HostBoundaryPort[] = []
  const typeOrdinal = new Map<string, number>()
  for (const source of sources) {
    const ins = getNodePorts(source).filter((p) => p.direction === 'in')
    for (const port of ins) {
      const wired = document.edges.some(
        (e) => e.target === source.id && (e.targetPort ?? 'in') === port.id
      )
      if (wired) continue
      const dataType = toBoundaryDataType(port.dataType)
      const next = (typeOrdinal.get(dataType) ?? 0) + 1
      typeOrdinal.set(dataType, next)
      inputs.push({
        id: inputs.length === 0 ? 'in' : `in-${inputs.length}`,
        label: hostBoundaryPortLabel(dataType, 'in', next),
        dataType,
        multiple: port.multiple !== false
      })
    }
  }

  if (!outputs.length && !inputs.length) {
    return defaultHostInterfaceForAssetType('subgraph')
  }
  if (!outputs.length) {
    return {
      version: HOST_INTERFACE_FORMAT_VERSION,
      inputs,
      outputs: defaultHostInterfaceForAssetType('subgraph').outputs
    }
  }

  return {
    version: HOST_INTERFACE_FORMAT_VERSION,
    inputs,
    outputs
  }
}
