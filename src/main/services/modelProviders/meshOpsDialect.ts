/**
 * 供应商方言注册表：按 providerKind 取网格加工方言。
 *
 * 编排层只认这一个入口，不出现 `if (kind === 'xxx')` 分支；
 * 能力是否可用仍由 `@shared/meshOps` 的能力矩阵判定（声明即实现）。
 */
import { meshyMeshOps } from './meshy/meshOps'
import { tripoMeshOps } from './tripo/meshOps'
import type { MeshOpsDialect } from './types'

const DIALECTS: Record<string, MeshOpsDialect> = {
  meshy: meshyMeshOps,
  tripo: tripoMeshOps
}

export function meshOpsDialectFor(kind: string): MeshOpsDialect | undefined {
  return DIALECTS[kind]
}

/** 取方言；未实现抛错（调用前应先过能力矩阵，这里只是兜底） */
export function requireMeshOpsDialect(kind: string): MeshOpsDialect {
  const dialect = meshOpsDialectFor(kind)
  if (!dialect) throw new Error(`GRAPH_MODEL_MESH_OPS_NO_DIALECT:${kind}`)
  return dialect
}
