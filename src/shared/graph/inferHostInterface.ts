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
  GraphPortType.videoEntities,
  GraphPortType.shotEntities,
  GraphPortType.worldEntities,
  GraphPortType.narrative,
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

/**
 * 从已物化内图推断 hostInterface：
 * - 输出：无下游业务边的汇节点主出口类型（右优先，同类型去重）
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
    .sort(
      (a, b) =>
        (a.position?.y ?? 0) - (b.position?.y ?? 0) ||
        (b.position?.x ?? 0) - (a.position?.x ?? 0)
    )

  // 每个汇节点各建一个出口（同类型不去重：三路立绘 → 三个图片输出）
  const outputs: HostBoundaryPort[] = []
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
