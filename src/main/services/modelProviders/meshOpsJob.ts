/**
 * 网格加工任务的轮询 token 编解码。
 *
 * 新格式：`<providerKind>-<jobOp>::<taskId>`（如 `tripo-smartSegment::task_x`、
 * `meshy-rig::abc`），供应商不再写死在编排层。
 *
 * **兼容旧格式**：历史版本落盘的任务记录里存着 `tripo::x` / `tripo-seg::x` /
 * `tripo-complete::x` 等前缀，`videoJobService.resumePending` 恢复在途任务时要能
 * 继续解析——所以读取侧永远先试新格式、再回退旧前缀表；写入侧只写新格式。
 */
import type { ModelProviderKind } from '@shared/modelProvider'
import type { MeshOp } from '@shared/meshOps'

/** 轮询分发用的 job op：比 MeshOp 多一个「智能分割」变体（同一 op 的两条端点） */
export type MeshOpsJobOp = MeshOp | 'smartSegment'

/** 网格加工涉及的 job op（用于「这个 token 归谁轮询」判定） */
const MESH_OPS_JOB_OPS: readonly MeshOpsJobOp[] = [
  'rig',
  'rigCheck',
  'segment',
  'smartSegment',
  'meshComplete',
  'retopology',
  'retarget',
  'convert',
  'texture'
]

export type MeshOpsJobRef = {
  kind: ModelProviderKind
  op: MeshOpsJobOp
  taskId: string
}

/** 旧前缀 → { kind, op }（只读兼容，勿再用于写入） */
const LEGACY_PREFIXES: ReadonlyArray<{ prefix: string; kind: string; op: MeshOpsJobOp }> = [
  { prefix: 'tripo-smartseg::', kind: 'tripo', op: 'smartSegment' },
  { prefix: 'tripo-seg::', kind: 'tripo', op: 'segment' },
  { prefix: 'tripo-complete::', kind: 'tripo', op: 'meshComplete' },
  { prefix: 'tripo-decimate::', kind: 'tripo', op: 'retopology' },
  { prefix: 'tripo-retarget::', kind: 'tripo', op: 'retarget' },
  { prefix: 'tripo-convert::', kind: 'tripo', op: 'convert' },
  { prefix: 'tripo-texture::', kind: 'tripo', op: 'texture' },
  // 最早的蒙皮 token 是 `<kind>::<taskId>`（无 op）
  { prefix: 'meshy::', kind: 'meshy', op: 'rig' },
  { prefix: 'tripo::', kind: 'tripo', op: 'rig' }
]

const NEW_FORMAT_RE = /^([a-z0-9]+)-([A-Za-z]+)::(.+)$/

function isMeshOpsJobOp(value: string): value is MeshOpsJobOp {
  return (MESH_OPS_JOB_OPS as readonly string[]).includes(value)
}

/** 写侧：`<kind>-<op>::<taskId>` */
export function encodeMeshOpsJobToken(
  kind: ModelProviderKind,
  op: MeshOpsJobOp,
  taskId: string
): string {
  return `${kind}-${op}::${taskId.trim()}`
}

/** 读侧：新格式优先，其次旧前缀表；无法识别返回 undefined */
export function parseMeshOpsJobToken(raw: string | undefined): MeshOpsJobRef | undefined {
  const token = (raw ?? '').trim()
  if (!token) return undefined

  const hit = NEW_FORMAT_RE.exec(token)
  if (hit && isMeshOpsJobOp(hit[2]!)) {
    const taskId = hit[3]!.trim()
    if (taskId) return { kind: hit[1]! as ModelProviderKind, op: hit[2]!, taskId }
  }

  for (const entry of LEGACY_PREFIXES) {
    if (token.startsWith(entry.prefix)) {
      const taskId = token.slice(entry.prefix.length).trim()
      if (taskId) return { kind: entry.kind as ModelProviderKind, op: entry.op, taskId }
    }
  }
  return undefined
}

/** 该 token 是否属于网格加工（含旧格式） */
export function isMeshOpsJobToken(raw: string | undefined): boolean {
  return !!parseMeshOpsJobToken(raw)
}

/** 旧格式前缀常量（仅测试与兼容断言使用；写侧请用 encodeMeshOpsJobToken） */
export const LEGACY_MESH_OPS_TOKENS = {
  segment: 'tripo-seg::',
  smartSegment: 'tripo-smartseg::',
  meshComplete: 'tripo-complete::',
  retopology: 'tripo-decimate::',
  retarget: 'tripo-retarget::',
  convert: 'tripo-convert::',
  texture: 'tripo-texture::',
  tripoRig: 'tripo::',
  meshyRig: 'meshy::'
} as const
