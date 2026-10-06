import type { StageVec3 } from '@shared/domain'
import { flattenAssetValues } from '@shared/graph/execute/gallery'
import type { GraphAssetValue, GraphValue } from '@shared/graph/execute/types'

export interface DirectorIncomingModelInfo {
  assetId: string
  relativePath?: string
  name?: string
  bonePose?: Record<string, StageVec3>
  clip?: { name: string; fps: number; frameRange: [number, number] }
  sourceTypeId?: string
}

const SOURCE_TYPE_RANK: Record<string, number> = {
  'model.animation': 4,
  'model.pose': 3,
  'model.rigSkin': 2,
  'model.segment': 2,
  'model.meshComplete': 2,
  'model.retopology': 2,
  'model.retarget': 2,
  'model.convert': 2,
  'model.texture': 2,
  'model.rigCheck': 1,
  'asset.model3d': 1,
  // 空间世界生成的产物同样是可直接实例化的 GLB，与 3D 生成节点同级
  'asset.spatialWorld': 1,
  'asset.model': 1
}

export function rankDirectorIncomingModel(info: DirectorIncomingModelInfo): number {
  const typeRank = SOURCE_TYPE_RANK[info.sourceTypeId ?? ''] ?? 0
  const overlay =
    (info.clip ? 8 : 0) +
    (info.bonePose && Object.keys(info.bonePose).length ? 4 : 0) +
    (info.relativePath?.trim() ? 1 : 0)
  return typeRank * 10 + overlay
}

/**
 * 导演台 `in-model` 可挂多条线。同一 assetId 只留加工最深的一条
 *（动画 > 姿势 > 蒙皮 > 原模型），避免原模和蒙皮各实例化一次。
 */
export function pickDirectorIncomingModels(
  candidates: DirectorIncomingModelInfo[]
): DirectorIncomingModelInfo[] {
  const byAsset = new Map<string, DirectorIncomingModelInfo>()
  for (const item of candidates) {
    const id = item.assetId.trim()
    if (!id) continue
    const prev = byAsset.get(id)
    if (!prev || rankDirectorIncomingModel(item) > rankDirectorIncomingModel(prev)) {
      byAsset.set(id, item)
    }
  }
  return [...byAsset.values()]
}

/** `in-model` 端口的 id（与 `motionProcessingPorts()` 里的声明必须一致） */
export const DIRECTOR_MODEL_IN_PORT = 'in-model'

/**
 * 视作「可实例化 3D 模型」的节点 `assetType`。
 *
 * **必须同时包含 `model3d`**：3D 生成节点的 `assetType` 是 `model3d`
 *（`builtins.ts` 里 `assetType: meta.type`，而 meta.type 就是 `'model3d'`），
 * 只有加工节点才是 `model`。早先这里只写 `model`，于是**生成后未运行 / 运行态被清空**
 * 的节点取不到候选 —— 表现就是「接了 GLB，dive 进去什么都没有」。
 */
const PLACEABLE_SOURCE_ASSET_TYPES: ReadonlySet<string> = new Set(['model', 'model3d'])

export interface DirectorIncomingEdge {
  source: string
  target?: string
  targetPort?: string | null
}

export interface DirectorIncomingNode {
  id: string
  typeId?: string
  assetId?: string
  assetType?: string
}

export interface DirectorIncomingGraph {
  nodes?: DirectorIncomingNode[]
  edges?: DirectorIncomingEdge[]
  runStates?: Record<string, { outputs?: Record<string, GraphValue> } | undefined>
}

/** 把一次运行输出里的资产值收成候选；非模型类返回 null */
export function directorIncomingFromValue(
  value: GraphValue | undefined | null,
  sourceTypeId?: string
): DirectorIncomingModelInfo | null {
  if (!value || value.kind !== 'asset') return null
  const assetValue = value as GraphAssetValue
  if (assetValue.assetType !== 'model' && assetValue.assetType !== 'model3d') return null
  if (!assetValue.assetId) return null
  return {
    assetId: assetValue.assetId,
    sourceTypeId,
    ...(assetValue.relativePath?.trim() ? { relativePath: assetValue.relativePath.trim() } : {}),
    ...(assetValue.title?.trim() ? { name: assetValue.title.trim() } : {}),
    ...(assetValue.bonePose && Object.keys(assetValue.bonePose).length
      ? { bonePose: assetValue.bonePose }
      : {}),
    ...(assetValue.clip?.name?.trim()
      ? {
          clip: {
            name: assetValue.clip.name.trim(),
            fps: assetValue.clip.fps,
            frameRange: assetValue.clip.frameRange
          }
        }
      : {})
  }
}

/**
 * 从图文档解析导演台 `in-model` 上挂的全部上游 3D 模型。
 *
 * 三条取候选的路径，缺一不可：
 * 1. 上游节点的**运行输出** `runStates[id].outputs.out`（常规路径，带 relativePath）
 * 2. 输出里嵌套的图库资产（`flattenAssetValues`，多产物节点）
 * 3. 节点**自身就挂着模型资产**（`alpha`）—— 覆盖「生成过、但运行态没留住」
 *    （重开工程、运行态被清）这种情况：此时拿不到 relativePath，但仍能用 assetId
 *    去资产库/缓存里找到文件，好过什么都不显示
 *
 * 抽成纯函数是为了**可测**：这段逻辑原先内联在 `useDirectorStageScene.ts` 里，
 * 而该文件依赖 three.js / Electron，测试跑不起来，上面那个 `model3d` 口径不一致
 * 因此一直没被发现。
 */
export function resolveDirectorIncomingModels(
  graph: DirectorIncomingGraph | null | undefined,
  targetNodeId: string | null | undefined,
  port: string = DIRECTOR_MODEL_IN_PORT
): DirectorIncomingModelInfo[] {
  if (!graph || !targetNodeId) return []
  const nodes = Array.isArray(graph.nodes) ? graph.nodes : []
  const edges = (Array.isArray(graph.edges) ? graph.edges : []).filter(
    (edge) => edge.target === targetNodeId && (edge.targetPort ?? 'in') === port
  )
  if (!edges.length) return []

  const candidates: DirectorIncomingModelInfo[] = []
  for (const edge of edges) {
    const source = nodes.find((node) => node.id === edge.source)
    if (!source) continue
    const runOut = graph.runStates?.[source.id]?.outputs?.out

    const direct = directorIncomingFromValue(runOut, source.typeId)
    if (direct) {
      candidates.push(direct)
      continue
    }

    let found = false
    for (const item of flattenAssetValues(runOut ? [runOut] : [])) {
      const info = directorIncomingFromValue(item, source.typeId)
      if (info) {
        candidates.push(info)
        found = true
        break
      }
    }

    // 兜底：节点自身挂着的模型资产（无运行态时也能实例化）
    if (!found && source.assetId && PLACEABLE_SOURCE_ASSET_TYPES.has(source.assetType ?? '')) {
      candidates.push({ assetId: source.assetId, sourceTypeId: source.typeId })
    }
  }
  return pickDirectorIncomingModels(candidates)
}
