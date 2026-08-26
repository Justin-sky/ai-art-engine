import { resolveNodeType, type GraphAddScope, type NodeTypeDefinition } from './registry'
import { isAssetRefInputHostType, isAssetRefNode, isProcessingAssetNode } from './nodeRole'
import {
  VIDEO_FIRST_FRAME_PORT_ID,
  VIDEO_LAST_FRAME_PORT_ID,
  type VideoFrameMode
} from './videoGenerateParams'
import {
  GRAPH_BOUNDARY_INPUT_TYPE_ID,
  GRAPH_BOUNDARY_OUTPUT_TYPE_ID,
  hostInterfaceToPortDefs,
  resolveNodeHostInterface
} from './hostInterface'
import {
  isBundleAcceptableDataType,
  isBundleNode,
  MEDIA_BUNDLE_TYPE_ID
} from './bundleExpand'
import {
  GraphPortType,
  toSingularGraphPortDataType,
  type GraphEdge,
  type GraphNode,
  type GraphNodeParams,
  type GraphPortDataType,
  type GraphPortDef
} from './types'

/** 生成/加工图库节点：全部历史输出口 id（默认自动连线仍走 `out`） */
export const GRAPH_OUT_ALL_PORT_ID = 'out-all'

/** assetRef 默认藏输入口；params.assetHost 时保留 */
function shouldHideAssetRefInputs(
  params?: Pick<GraphNodeParams, 'assetRef' | 'assetHost'> | null,
  node?: Pick<GraphNode, 'category' | 'params' | 'assetId'> | null
): boolean {
  const isRef = node ? isAssetRefNode(node) : params?.assetRef === true
  if (!isRef) return false
  return (node?.params ?? params)?.assetHost !== true
}

/** 同类型可连。单数与复数不互通（选择节点只收 images / videos / voices / texts 列表）。 */
export function portsCompatible(source: GraphPortDataType, target: GraphPortDataType): boolean {
  return source === target
}

function resolveVideoFrameMode(raw: unknown): VideoFrameMode {
  if (raw === 'first' || raw === 'first_last' || raw === 'none') return raw
  return 'none'
}

/** 当前帧模式下允许存在的首/尾帧端口 id */
export function allowedVideoFramePortIds(mode: VideoFrameMode): string[] {
  if (mode === 'first_last') return [VIDEO_FIRST_FRAME_PORT_ID, VIDEO_LAST_FRAME_PORT_ID]
  if (mode === 'first') return [VIDEO_FIRST_FRAME_PORT_ID]
  return []
}

/** 去掉目标节点上已失效的首/尾帧入边 */
export function pruneVideoFrameEdges(
  edges: GraphEdge[],
  nodeId: string,
  frameMode: VideoFrameMode
): GraphEdge[] {
  const allowed = new Set(allowedVideoFramePortIds(frameMode))
  return edges.filter((edge) => {
    if (edge.target !== nodeId) return true
    const port = edge.targetPort ?? 'in'
    if (port !== VIDEO_FIRST_FRAME_PORT_ID && port !== VIDEO_LAST_FRAME_PORT_ID) return true
    return allowed.has(port)
  })
}

function injectVideoFramePorts(
  ports: GraphPortDef[],
  frameMode: VideoFrameMode
): GraphPortDef[] {
  let next = ports.map((port) =>
    port.id === 'in-image' ? { ...port, label: 'Reference' } : port
  )
  // 去掉旧动态口，避免重复注入
  next = next.filter(
    (port) => port.id !== VIDEO_FIRST_FRAME_PORT_ID && port.id !== VIDEO_LAST_FRAME_PORT_ID
  )
  const framePorts: GraphPortDef[] = []
  if (frameMode === 'first' || frameMode === 'first_last') {
    framePorts.push({
      id: VIDEO_FIRST_FRAME_PORT_ID,
      direction: 'in',
      dataType: GraphPortType.image,
      multiple: false,
      label: 'First frame'
    })
  }
  if (frameMode === 'first_last') {
    framePorts.push({
      id: VIDEO_LAST_FRAME_PORT_ID,
      direction: 'in',
      dataType: GraphPortType.image,
      multiple: false,
      label: 'Last frame'
    })
  }
  if (!framePorts.length) return next
  // 首帧 / 首尾帧模式下参考图口与帧口互斥：隐藏 in-image，仅保留帧口；
  // 无帧控制（none）不注入帧口，in-image 保持为参考图口。
  const insertAt = next.findIndex((port) => port.id === 'in-image')
  if (insertAt >= 0) {
    next = next.filter((port) => port.id !== 'in-image')
  }
  const at = insertAt >= 0 ? insertAt : next.length
  return [...next.slice(0, at), ...framePorts, ...next.slice(at)]
}

/**
 * 视频生成：按模型声明上限隐藏「限额为 0」的媒体入端口。
 * 只作用于通用参考口 in-image / in-video / in-voice；首/尾帧口由帧模式独立控制，不受影响。
 */
function hideZeroLimitVideoInputPorts(
  ports: GraphPortDef[],
  maxImages: number | undefined,
  maxVideos: number | undefined,
  maxVoices: number | undefined
): GraphPortDef[] {
  if (maxImages !== 0 && maxVideos !== 0 && maxVoices !== 0) return ports
  return ports.filter((port) => {
    if (port.direction !== 'in') return true
    if (port.id === 'in-image') return maxImages !== 0
    if (port.id === 'in-video') return maxVideos !== 0
    if (port.id === 'in-voice') return maxVoices !== 0
    return true
  })
}

function readVideoInputLimit(
  params:
    | Pick<
        GraphNodeParams,
        | 'generateMaxInputImages'
        | 'generateMaxInputVideos'
        | 'generateMaxInputVoices'
      >
    | null
    | undefined,
  node:
    | Pick<GraphNode, 'category' | 'params' | 'assetId' | 'typeId' | 'assetType'>
    | null
    | undefined,
  key: 'generateMaxInputImages' | 'generateMaxInputVideos' | 'generateMaxInputVoices'
): number | undefined {
  const raw = params?.[key] ?? node?.params?.[key]
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined
}

/** 对类型定义端口应用与 getNodePorts 相同的 inputDataType 覆盖规则 */
export function resolveTypeDefPorts(
  typeDef: Pick<NodeTypeDefinition, 'ports' | 'typeId' | 'assetType'>,
  params?: Pick<
    GraphNodeParams,
    | 'inputDataType'
    | 'bundleDataType'
    | 'assetRef'
    | 'assetHost'
    | 'generateFrameMode'
    | 'generateMaxInputImages'
    | 'generateMaxInputVideos'
    | 'generateMaxInputVoices'
    | 'hostInputSlot'
    | 'hostBoundaryPort'
  > | null,
  node?: Pick<GraphNode, 'category' | 'params' | 'assetId' | 'typeId' | 'assetType'> | null
): GraphPortDef[] {
  let ports = typeDef.ports ?? []
  const hideInputs = shouldHideAssetRefInputs(params, node)
  if (hideInputs) {
    // 引用节点无图库：去掉加工节点的 out-all，只保留单条 out
    ports = ports.filter(
      (port) => port.direction !== 'in' && port.id !== GRAPH_OUT_ALL_PORT_ID
    )
  }

  // 剧本宿主：只要选中单条 out，不暴露图库「全部」口
  const isScreenplayHost =
    (typeDef.assetType === 'screenplay' || typeDef.typeId === 'asset.screenplay') &&
    ((node?.params ?? params)?.assetHost === true)
  if (isScreenplayHost) {
    ports = ports.filter((port) => port.id !== GRAPH_OUT_ALL_PORT_ID)
  }

  // 输入接口槽：输出口类型跟 hostInputSlot.dataType
  if (typeDef.typeId === 'graph.input.slot') {
    const dataType = node?.params?.hostInputSlot?.dataType ?? params?.hostInputSlot?.dataType
    if (dataType) {
      ports = [
        {
          id: 'out',
          direction: 'out',
          dataType,
          multiple: false,
          label: 'Out'
        }
      ]
    }
  }

  // 束结：按 bundleDataType 锁定 in/out；未锁定时占位 image（连接/菜单另有特例）
  if (typeDef.typeId === MEDIA_BUNDLE_TYPE_ID) {
    const locked =
      node?.params?.bundleDataType ?? params?.bundleDataType ?? GraphPortType.image
    const dataType = toSingularGraphPortDataType(locked)
    ports = [
      {
        id: 'in',
        direction: 'in',
        dataType,
        multiple: true,
        label: 'In'
      },
      {
        id: 'out',
        direction: 'out',
        dataType,
        multiple: true,
        label: 'Out'
      }
    ]
  }

  // boundary proxy：按 hostBoundaryPort 暴露单口
  if (typeDef.typeId === GRAPH_BOUNDARY_INPUT_TYPE_ID) {
    const bp = node?.params?.hostBoundaryPort ?? params?.hostBoundaryPort
    if (bp?.dataType) {
      ports = [
        {
          id: 'out',
          direction: 'out',
          dataType: bp.dataType,
          multiple: false,
          label: 'Out'
        }
      ]
    }
  }
  if (typeDef.typeId === GRAPH_BOUNDARY_OUTPUT_TYPE_ID) {
    const bp = node?.params?.hostBoundaryPort ?? params?.hostBoundaryPort
    if (bp?.dataType) {
      ports = [
        {
          id: 'in',
          direction: 'in',
          dataType: bp.dataType,
          multiple: bp.multiple === true,
          label: 'In'
        }
      ]
    }
  }
  if (params?.inputDataType) {
    const inPorts = ports.filter((port) => port.direction === 'in')
    if (inPorts.length === 1) {
      ports = ports.map((port) =>
        port.direction === 'in' ? { ...port, dataType: params.inputDataType! } : port
      )
    }
  }

  // 视频生成（加工）：按帧模式注入首/尾帧口
  const isVideoGenerateProcessing =
    typeDef.typeId === 'asset.video' &&
    !hideInputs &&
    (node ? isProcessingAssetNode(node) : params?.assetRef !== true)
  if (isVideoGenerateProcessing) {
    const mode = resolveVideoFrameMode(
      params?.generateFrameMode ?? node?.params?.generateFrameMode
    )
    ports = injectVideoFramePorts(ports, mode)
    ports = hideZeroLimitVideoInputPorts(
      ports,
      readVideoInputLimit(params, node, 'generateMaxInputImages'),
      readVideoInputLimit(params, node, 'generateMaxInputVideos'),
      readVideoInputLimit(params, node, 'generateMaxInputVoices')
    )
  }
  return ports
}

export function getNodePorts(node: GraphNode): GraphPortDef[] {
  const typeDef = resolveNodeType(node)
  if (!typeDef) return []

  // 宿主实例：端口一律来自 hostInterfaceSnapshot / 类型默认模板
  const useHostIface =
    !!node.params?.hostInterfaceSnapshot ||
    (node.params?.assetHost === true &&
      isAssetRefNode(node) &&
      isAssetRefInputHostType(node.assetType))

  if (useHostIface) {
    let ports = hostInterfaceToPortDefs(resolveNodeHostInterface(node))
    if (shouldHideAssetRefInputs(node.params, node)) {
      ports = ports.filter((port) => port.direction !== 'in')
    }
    return ports
  }

  return resolveTypeDefPorts(typeDef, node.params, node)
}

export function findOutPort(node: GraphNode, portId?: string): GraphPortDef | undefined {
  const ports = getNodePorts(node).filter((p) => p.direction === 'out')
  if (portId) return ports.find((p) => p.id === portId)
  return ports[0]
}

export function findInPort(node: GraphNode, portId?: string): GraphPortDef | undefined {
  const ports = getNodePorts(node).filter((p) => p.direction === 'in')
  if (portId) return ports.find((p) => p.id === portId)
  return ports[0]
}

/** 在目标节点上找与给定输出类型匹配的第一个输入口 */
export function findCompatibleInPort(
  target: GraphNode,
  outDataType: GraphPortDataType,
  preferredPortId?: string
): GraphPortDef | undefined {
  const inPorts = getNodePorts(target).filter((p) => p.direction === 'in')
  if (preferredPortId) {
    const preferred = inPorts.find((p) => p.id === preferredPortId)
    // 指定了口 id 时严格匹配，避免非法口边被 sanitize 误放行
    if (!preferred || !portsCompatible(outDataType, preferred.dataType)) return undefined
    return preferred
  }
  return inPorts.find((p) => portsCompatible(outDataType, p.dataType))
}

export interface GraphConnectOptions {
  /** 图作用域（normalize 校验连线时传入） */
  scope?: GraphAddScope
  sourcePort?: string
  targetPort?: string
  /** 直接指定端口数据类型（菜单过滤时优先用，避免重复解析） */
  dataType?: GraphPortDataType
  /** 新建节点时的 params（含 scope createParams 的 inputDataType） */
  typeParams?: Pick<
    GraphNodeParams,
    'inputDataType' | 'bundleDataType' | 'assetRef' | 'assetHost' | 'generateFrameMode'
  > | null
}

export function canConnectNodes(
  source: GraphNode,
  target: GraphNode,
  options: GraphConnectOptions = {}
): boolean {
  if (source.id === target.id) return false
  const outPort = findOutPort(source, options.sourcePort)
  if (!outPort) return false
  // 未锁定束结：接受任意可束类型（不依赖占位 image 口）
  if (isBundleNode(target) && !target.params.bundleDataType) {
    return isBundleAcceptableDataType(outPort.dataType)
  }
  if (isBundleNode(target) && target.params.bundleDataType) {
    const locked = toSingularGraphPortDataType(target.params.bundleDataType)
    if (
      !portsCompatible(outPort.dataType, locked) &&
      toSingularGraphPortDataType(outPort.dataType) !== locked
    ) {
      return false
    }
  }
  const inPort = findCompatibleInPort(target, outPort.dataType, options.targetPort)
  if (!inPort) {
    // 未锁定束结占位口可能与源类型不一致，仍允许落到 in
    if (isBundleNode(target) && isBundleAcceptableDataType(outPort.dataType)) {
      const bundleIn = findInPort(target, options.targetPort ?? 'in')
      return !!bundleIn
    }
    return false
  }
  return true
}

type NodeTypeConnectMeta = Pick<NodeTypeDefinition, 'ports' | 'typeId' | 'category' | 'assetType'>

function typeDefInPorts(typeDef: NodeTypeConnectMeta, options: GraphConnectOptions): GraphPortDef[] {
  return resolveTypeDefPorts(typeDef, options.typeParams).filter((p) => p.direction === 'in')
}

function typeDefOutPorts(typeDef: NodeTypeConnectMeta, options: GraphConnectOptions): GraphPortDef[] {
  return resolveTypeDefPorts(typeDef, options.typeParams).filter((p) => p.direction === 'out')
}

/** 某类型定义是否接受给定输出数据类型（用于「从输出端口拖出」的添加菜单） */
export function typeDefAcceptsDataType(
  typeDef: NodeTypeConnectMeta,
  dataType: GraphPortDataType,
  options: GraphConnectOptions = {}
): boolean {
  if (typeDef.typeId === MEDIA_BUNDLE_TYPE_ID) {
    const locked = options.typeParams?.bundleDataType
    if (!locked) return isBundleAcceptableDataType(dataType)
    const singular = toSingularGraphPortDataType(locked)
    return (
      portsCompatible(dataType, singular) ||
      toSingularGraphPortDataType(dataType) === singular
    )
  }
  const inPorts = typeDefInPorts(typeDef, options)
  if (options.targetPort) {
    const inPort = inPorts.find((p) => p.id === options.targetPort)
    return !!inPort && portsCompatible(dataType, inPort.dataType)
  }
  return inPorts.some((p) => portsCompatible(dataType, p.dataType))
}

/** 某类型定义是否能产出给定输入数据类型（用于「从输入端口拖出」的添加菜单） */
export function typeDefProvidesDataType(
  typeDef: NodeTypeConnectMeta,
  dataType: GraphPortDataType,
  options: GraphConnectOptions = {}
): boolean {
  if (typeDef.typeId === MEDIA_BUNDLE_TYPE_ID) {
    const locked = options.typeParams?.bundleDataType
    if (!locked) return isBundleAcceptableDataType(dataType)
    const singular = toSingularGraphPortDataType(locked)
    return (
      portsCompatible(singular, dataType) ||
      singular === toSingularGraphPortDataType(dataType)
    )
  }
  const outPorts = typeDefOutPorts(typeDef, options)
  if (options.sourcePort) {
    const outPort = outPorts.find((p) => p.id === options.sourcePort)
    return !!outPort && portsCompatible(outPort.dataType, dataType)
  }
  return outPorts.some((p) => portsCompatible(p.dataType, dataType))
}

/** 判断从 source 拖出的连线能否连到某类新节点（用于输出端口松手后的添加菜单过滤）。 */
export function canConnectToNodeType(
  source: GraphNode,
  typeDef: NodeTypeConnectMeta,
  options: GraphConnectOptions = {}
): boolean {
  const dataType = options.dataType ?? findOutPort(source, options.sourcePort)?.dataType
  if (!dataType) return false
  return typeDefAcceptsDataType(typeDef, dataType, options)
}

/** 判断从 target 的输入端口反拖连线时，某类新节点能否作为 source（用于输入端口松手后的添加菜单过滤）。 */
export function canConnectFromNodeType(
  target: GraphNode,
  typeDef: NodeTypeConnectMeta,
  options: GraphConnectOptions = {}
): boolean {
  const dataType = options.dataType ?? findInPort(target, options.targetPort)?.dataType
  if (!dataType) return false
  return typeDefProvidesDataType(typeDef, dataType, options)
}
