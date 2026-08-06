/**
 * 通用宿主资产端口接口（Houdini HDA 风格）。
 * 外层实例端口、内图 boundary proxy、执行映射均以此为单一来源。
 */

import type { AssetType } from '../domain'
import type { GraphPortDataType, GraphPortDef, GraphNodeParams } from './types'
import { GraphPortType } from './types'

export const HOST_INTERFACE_FORMAT_VERSION = 1
export const HOST_INTERFACE_SCHEMA_VERSION = 1

/** 宿主边界端口（定义侧 / 快照侧共用） */
export interface HostBoundaryPort {
  id: string
  label: string
  /** 对接数据类型（连线兼容） */
  dataType: GraphPortDataType
  /** 是否允许多条入边；输出侧通常 false */
  multiple?: boolean
  /** 端口说明（文档 / tooltip） */
  description?: string
  /** 作者备注 */
  notes?: string
  /** 旁挂文件（工程相对路径） */
  fileRelativePath?: string
}

/** 持久化于资产 genParams.hostInterface */
export interface HostInterfaceDocument {
  /** 接口文档格式版本 */
  version: number
  inputs: HostBoundaryPort[]
  outputs: HostBoundaryPort[]
}

const PORT_DATA_TYPES = new Set<string>(Object.values(GraphPortType))

function isGraphPortDataType(value: unknown): value is GraphPortDataType {
  return typeof value === 'string' && PORT_DATA_TYPES.has(value)
}

function sanitizePortId(raw: unknown, fallback: string): string {
  const text = typeof raw === 'string' ? raw.trim() : ''
  if (!text) return fallback
  return text.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) || fallback
}

function sanitizeLabel(raw: unknown, fallback: string): string {
  const text = typeof raw === 'string' ? raw.trim() : ''
  return text || fallback
}

/** 规范化单个边界端口 */
export function sanitizeHostBoundaryPort(
  raw: unknown,
  index: number,
  direction: 'in' | 'out'
): HostBoundaryPort | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  const fallbackId = `${direction}-${index}`
  const id = sanitizePortId(obj.id, fallbackId)
  const dataType = isGraphPortDataType(obj.dataType) ? obj.dataType : null
  if (!dataType) return null
  const label = sanitizeLabel(obj.label, direction === 'in' ? 'In' : 'Out')
  const multiple =
    typeof obj.multiple === 'boolean' ? obj.multiple : direction === 'in'
  const description =
    typeof obj.description === 'string' ? obj.description.trim() : ''
  const notes = typeof obj.notes === 'string' ? obj.notes.trim() : ''
  const fileRelativePath =
    typeof obj.fileRelativePath === 'string'
      ? obj.fileRelativePath.trim().replace(/\\/g, '/')
      : ''
  const port: HostBoundaryPort = { id, label, dataType, multiple }
  if (description) port.description = description
  if (notes) port.notes = notes
  if (fileRelativePath) port.fileRelativePath = fileRelativePath
  return port
}

/** 规范化完整宿主接口；非法项丢弃，id 去重 */
export function sanitizeHostInterface(raw: unknown): HostInterfaceDocument {
  const empty: HostInterfaceDocument = {
    version: HOST_INTERFACE_FORMAT_VERSION,
    inputs: [],
    outputs: []
  }
  if (!raw || typeof raw !== 'object') return empty
  const obj = raw as Record<string, unknown>
  const version =
    typeof obj.version === 'number' && Number.isFinite(obj.version) && obj.version > 0
      ? Math.floor(obj.version)
      : HOST_INTERFACE_FORMAT_VERSION

  const seenIn = new Set<string>()
  const inputs: HostBoundaryPort[] = []
  const rawInputs = Array.isArray(obj.inputs) ? obj.inputs : []
  for (let i = 0; i < rawInputs.length; i++) {
    const port = sanitizeHostBoundaryPort(rawInputs[i], i, 'in')
    if (!port || seenIn.has(port.id)) continue
    seenIn.add(port.id)
    inputs.push(port)
  }

  const seenOut = new Set<string>()
  const outputs: HostBoundaryPort[] = []
  const rawOutputs = Array.isArray(obj.outputs) ? obj.outputs : []
  for (let i = 0; i < rawOutputs.length; i++) {
    const port = sanitizeHostBoundaryPort(rawOutputs[i], i, 'out')
    if (!port || seenOut.has(port.id)) continue
    seenOut.add(port.id)
    outputs.push(port)
  }

  return { version, inputs, outputs }
}

export function cloneHostInterface(doc: HostInterfaceDocument): HostInterfaceDocument {
  return sanitizeHostInterface({
    version: doc.version,
    inputs: doc.inputs.map((p) => ({ ...p })),
    outputs: doc.outputs.map((p) => ({ ...p }))
  })
}

/** 端口数据类型显示名（与 graph.port.types 中文一致；封装落盘用） */
const PORT_DATA_TYPE_LABELS: Record<string, string> = {
  [GraphPortType.image]: '图片',
  [GraphPortType.images]: '图片组',
  [GraphPortType.voice]: '声音',
  [GraphPortType.voices]: '声音组',
  [GraphPortType.video]: '视频',
  [GraphPortType.videos]: '视频组',
  [GraphPortType.text]: '文本',
  [GraphPortType.texts]: '文本组',
  [GraphPortType.world]: '世界元素',
  [GraphPortType.worldEntities]: '世界元素实体',
  [GraphPortType.beat]: '场',
  [GraphPortType.model]: '模型'
}

/**
 * 边界端口默认名：如「文本输入」「图片输出」；同类型第 2 个起追加序号。
 * @param ordinal 同方向同类型中的序号，从 1 起
 */
export function hostBoundaryPortLabel(
  dataType: GraphPortDataType,
  direction: 'in' | 'out',
  ordinal = 1
): string {
  const typeLabel = PORT_DATA_TYPE_LABELS[dataType] ?? dataType
  const dirLabel = direction === 'in' ? '输入' : '输出'
  const base = `${typeLabel}${dirLabel}`
  return ordinal > 1 ? `${base} ${ordinal}` : base
}

/** 各可宿主资产类型的默认外层端口模板（与历史 listHostInputPortDefs / ProcessingPorts 对齐） */
export function defaultHostInterfaceForAssetType(
  assetType: AssetType | string | null | undefined
): HostInterfaceDocument {
  const type = typeof assetType === 'string' ? assetType : ''
  switch (type) {
    case 'screenplay':
      return {
        version: HOST_INTERFACE_FORMAT_VERSION,
        inputs: [
          { id: 'in', label: 'In', dataType: GraphPortType.text, multiple: true }
        ],
        outputs: [
          { id: 'out', label: 'Out', dataType: GraphPortType.text, multiple: false }
        ]
      }
    case 'world':
      return {
        version: HOST_INTERFACE_FORMAT_VERSION,
        inputs: [
          { id: 'in', label: 'In', dataType: GraphPortType.text, multiple: true }
        ],
        outputs: [
          {
            id: 'out',
            label: 'Out',
            dataType: GraphPortType.worldEntities,
            multiple: true
          }
        ]
      }
    case 'beat':
      return {
        version: HOST_INTERFACE_FORMAT_VERSION,
        inputs: [
          { id: 'in', label: 'In', dataType: GraphPortType.text, multiple: true }
        ],
        outputs: [
          {
            id: 'out',
            label: 'Out',
            dataType: GraphPortType.beat,
            multiple: true
          }
        ]
      }
    case 'image':
      return {
        version: HOST_INTERFACE_FORMAT_VERSION,
        inputs: [
          {
            id: 'in-text',
            label: 'Text',
            dataType: GraphPortType.text,
            multiple: true
          },
          {
            id: 'in-image',
            label: 'Image',
            dataType: GraphPortType.image,
            multiple: true
          }
        ],
        outputs: [
          { id: 'out', label: 'Out', dataType: GraphPortType.image, multiple: false }
        ]
      }
    case 'voice':
      return {
        version: HOST_INTERFACE_FORMAT_VERSION,
        inputs: [
          {
            id: 'in-text',
            label: 'Text',
            dataType: GraphPortType.text,
            multiple: true
          },
          {
            id: 'in-image',
            label: 'Image',
            dataType: GraphPortType.image,
            multiple: true
          }
        ],
        outputs: [
          { id: 'out', label: 'Out', dataType: GraphPortType.voice, multiple: false }
        ]
      }
    case 'video':
      return {
        version: HOST_INTERFACE_FORMAT_VERSION,
        inputs: [
          {
            id: 'in-text',
            label: 'Text',
            dataType: GraphPortType.text,
            multiple: true
          },
          {
            id: 'in-image',
            label: 'Image',
            dataType: GraphPortType.image,
            multiple: true
          },
          {
            id: 'in-video',
            label: 'Video',
            dataType: GraphPortType.video,
            multiple: true
          },
          {
            id: 'in-voice',
            label: 'Audio',
            dataType: GraphPortType.voice,
            multiple: true
          }
        ],
        outputs: [
          { id: 'out', label: 'Out', dataType: GraphPortType.video, multiple: false }
        ]
      }
    case 'subgraph':
      return {
        version: HOST_INTERFACE_FORMAT_VERSION,
        inputs: [
          { id: 'in', label: 'In', dataType: GraphPortType.text, multiple: true }
        ],
        outputs: [
          { id: 'out', label: 'Out', dataType: GraphPortType.text, multiple: false }
        ]
      }
    default:
      return {
        version: HOST_INTERFACE_FORMAT_VERSION,
        inputs: [],
        outputs: []
      }
  }
}

/** 从资产 genParams 读取宿主接口；缺省时按类型回退默认模板 */
export function readHostInterfaceFromGenParams(
  genParams: Record<string, unknown> | null | undefined,
  assetType?: AssetType | string | null
): HostInterfaceDocument {
  const raw = genParams?.hostInterface
  if (raw && typeof raw === 'object') {
    const sanitized = sanitizeHostInterface(raw)
    if (sanitized.inputs.length || sanitized.outputs.length) return sanitized
  }
  return defaultHostInterfaceForAssetType(assetType)
}

/** 读取 genParams.schemaVersion（接口编辑代数） */
export function readHostSchemaVersion(
  genParams: Record<string, unknown> | null | undefined
): number {
  const raw = genParams?.schemaVersion
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) {
    return Math.floor(raw)
  }
  return HOST_INTERFACE_SCHEMA_VERSION
}

/** 接口 → GraphPortDef 列表（供 getNodePorts） */
export function hostInterfaceToPortDefs(iface: HostInterfaceDocument): GraphPortDef[] {
  const doc = sanitizeHostInterface(iface)
  return [
    ...doc.inputs.map(
      (port): GraphPortDef => ({
        id: port.id,
        direction: 'in',
        dataType: port.dataType,
        multiple: port.multiple !== false,
        label: port.label
      })
    ),
    ...doc.outputs.map(
      (port): GraphPortDef => ({
        id: port.id,
        direction: 'out',
        dataType: port.dataType,
        multiple: port.multiple === true,
        label: port.label
      })
    )
  ]
}

/** 从节点 params 快照解析宿主接口 */
export function readHostInterfaceSnapshot(
  params: Pick<GraphNodeParams, 'hostInterfaceSnapshot'> | null | undefined
): HostInterfaceDocument | null {
  const raw = params?.hostInterfaceSnapshot
  if (!raw || typeof raw !== 'object') return null
  return sanitizeHostInterface(raw)
}

/**
 * 解析实例应使用的宿主接口：
 * 1. params.hostInterfaceSnapshot
 * 2. 按 assetType 默认模板
 */
export function resolveNodeHostInterface(
  node: {
    assetType?: AssetType | string | null
    params?: Pick<GraphNodeParams, 'hostInterfaceSnapshot'> | null
  }
): HostInterfaceDocument {
  const fromSnap = readHostInterfaceSnapshot(node.params)
  if (fromSnap && (fromSnap.inputs.length || fromSnap.outputs.length)) {
    return fromSnap
  }
  return defaultHostInterfaceForAssetType(node.assetType)
}

/** 稳定 boundary 输入节点 id */
export function boundaryInputNodeId(portId: string): string {
  const safe = portId.replace(/[^a-zA-Z0-9_-]/g, '_')
  return `graph-boundary-in-${safe}`
}

/** 稳定 boundary 输出节点 id */
export function boundaryOutputNodeId(portId: string): string {
  const safe = portId.replace(/[^a-zA-Z0-9_-]/g, '_')
  return `graph-boundary-out-${safe}`
}

export const GRAPH_BOUNDARY_INPUT_TYPE_ID = 'graph.boundary.input' as const
export const GRAPH_BOUNDARY_OUTPUT_TYPE_ID = 'graph.boundary.output' as const

export function isBoundaryInputNode(node: { typeId?: string }): boolean {
  return node.typeId === GRAPH_BOUNDARY_INPUT_TYPE_ID
}

export function isBoundaryOutputNode(node: { typeId?: string }): boolean {
  return node.typeId === GRAPH_BOUNDARY_OUTPUT_TYPE_ID
}

export function isBoundaryProxyNode(node: { typeId?: string }): boolean {
  return isBoundaryInputNode(node) || isBoundaryOutputNode(node)
}
