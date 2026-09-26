/**
 * 3D 网格加工能力矩阵 —— 「哪家供应商能做哪些 op」的唯一真相。
 *
 * 渲染层（节点卡片过滤供应商）与主进程（facade 门禁、方言分发）都读这张表，
 * 不再各自维护一份白名单数组或硬编码 Set。
 *
 * 注意：这里只声明**已经真正实现**的 op。协议细节（端点路径、请求体、响应字段）
 * 在各供应商自己的方言里：`src/main/services/modelProviders/<kind>/meshOps.ts`。
 */
import type { ModelProviderKind } from './modelProvider'

/** 3D 网格加工能力（生成之外的所有模型加工动作） */
export type MeshOp =
  | 'rig'
  | 'rigCheck'
  | 'segment'
  | 'meshComplete'
  | 'retopology'
  | 'retarget'
  | 'convert'
  | 'texture'

/** 端点接受的输入种类：task=上游任务 id，url=公网模型直链，fileToken=上传换取的 token */
export type MeshOpsInputKind = 'task' | 'url' | 'fileToken'

export interface MeshOpCaps {
  /** 已实现且可用的 op */
  ops: readonly MeshOp[]
  /** 端点接受哪些输入（决定没有 task id 时能否退回「上传换公网 URL」） */
  inputKinds: readonly MeshOpsInputKind[]
  /** 能否按部件处理（part_names） */
  partNames: boolean
  /** 贴图：可指定贴图模型版本（Tripo 的 v3.x / v2.5 系列） */
  textureModelVersion: boolean
  /** 贴图：支持随机种子（同种子可复现） */
  textureSeed: boolean
  /** 重拓扑：支持算法档位（Tripo 智能 v2.0 / 基础减面 v1.0） */
  retopologyTier: boolean
  /** 重拓扑：支持把贴图烘焙到低模 */
  retopologyBake: boolean
  /** 重定向的动画标识体系：preset=字符串预设（Tripo） / library=动作库 id（Meshy） / none=不支持 */
  retargetIds: 'preset' | 'library' | 'none'
  /**
   * 格式转换是否支持高级参数（FBX 预设 / pivot 归底 / UV 打包 / 贴图尺寸与格式 /
   * 四边面 / 面数上限 / 烘焙 / 保留动画 / 部件子集）。为 false 时转换面板只留「目标格式」。
   */
  convertAdvanced: boolean
}

/** 键顺序即默认供应商优先级（派生数组沿用该顺序） */
export const MESH_OPS_CAPS: Record<string, MeshOpCaps> = {
  meshy: {
    // 已接入：独立蒙皮、动画重定向（animations + 动作库）、重拓扑（remesh）、贴图（retexture）、格式转换（convert）
    ops: ['rig', 'retarget', 'retopology', 'texture', 'convert'],
    inputKinds: ['task', 'url'],
    partNames: false,
    textureModelVersion: false,
    textureSeed: false,
    retopologyTier: false,
    retopologyBake: false,
    retargetIds: 'library',
    // Meshy convert 只吃 target_formats，没有 FBX 预设 / pivot / UV / 贴图尺寸等高级参数
    convertAdvanced: false
  },
  tripo: {
    ops: [
      'rig',
      'rigCheck',
      'segment',
      'meshComplete',
      'retopology',
      'retarget',
      'convert',
      'texture'
    ],
    inputKinds: ['task', 'url', 'fileToken'],
    partNames: true,
    textureModelVersion: true,
    textureSeed: true,
    retopologyTier: true,
    retopologyBake: true,
    retargetIds: 'preset',
    convertAdvanced: true
  }
}

export function meshOpCaps(kind: string): MeshOpCaps | undefined {
  return MESH_OPS_CAPS[kind]
}

/** 该供应商已实现的 op 列表（未登记返回空数组） */
export function meshOpsFor(kind: string): readonly MeshOp[] {
  return meshOpCaps(kind)?.ops ?? []
}

/** 该供应商是否支持某个 op */
export function meshOpSupported(kind: string, op: MeshOp): boolean {
  return meshOpsFor(kind).includes(op)
}

/** 支持其中任一 op 的供应商（用于派生既有的 *_PROVIDER_KINDS 白名单） */
export function meshOpsProvidersFor(...ops: MeshOp[]): ModelProviderKind[] {
  return Object.entries(MESH_OPS_CAPS)
    .filter(([, caps]) => ops.some((op) => caps.ops.includes(op)))
    .map(([kind]) => kind as ModelProviderKind)
}
