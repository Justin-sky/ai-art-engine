import type { GraphAssetValue, GraphValue, NodeExecuteContext } from './types'
import { GRAPH_OUT_ALL_PORT_ID } from '../ports'
import { flattenAssetValues } from './gallery'
import { persistModelGeneration } from './materialize'
/**
 * 空间世界导出节点执行器（World Labs `POST /marble/v1/worlds/{world_id}:export`）
 *
 * 官方两条路，按节点参数 `spatialWorldExportMode` 分流：
 * - `mesh`（默认）：HQ 贴图网格（约 600k 面，带贴图）或顶点色网格（约 1M 面）→ GLB。
 *   上游是异步 mesh 导出服务、最长约 1 小时、限速 4 次/小时、单独计费；产物是标准模型资产，
 *   所以照模型画廊口径落盘（`out` / `out-all`），可以直接接导演台或下游 3D 加工节点。
 * - `splats`：PLY 高斯泼溅（官方同步转换）→ 落在上游世界产物的**同目录同名**文件里（`world.ply`）。
 *   PLY 在应用内没有预览通道、也没有对应的资产类型，所以不登记资产，只写回路径 + 日志，
 *   并把上游模型**透传**下去，避免这条链在画布上断掉。
 *
 * world_id 只能由「空间世界生成」节点给出（导出端点只认它），所以上游没接该节点时直接报错，
 * 不做任何猜测 —— 猜错就是拿别人的世界去导出。
 *
 * 端口类型：入 `in-world` 是 `spatialWorld`（严格同类型，只接世界生成节点）；
 * 出 `out` / `out-all` 是 `model` —— 导出后的产物就是可继续编排的网格，
 * 从这里的口去接导演台 / 3D 加工节点（世界产物本身不隐式兼容 `model`）。
 */
/**
 * 取下游要用的 world_id：先看上游出口值，再退回任务记录。
 *
 * 出口值里的 `spatialWorldId` 是正路；但它可能因为历史版本的回写缺口而丢失
 *（这类缺口已经修过若干处），此时按**产出这个模型的节点**去任务记录里找 ——
 * 世界生成任务记录里存着同一个 World.id，而生成本身已经花过积分，不该逼用户重生成。
 */
async function resolveIncomingSpatialWorldId(
  ctx: NodeExecuteContext,
  modelValues: GraphAssetValue[]
): Promise<string> {
  const fromValue = modelValues.find((value) => value.spatialWorldId?.trim())?.spatialWorldId
  const direct = fromValue?.trim()
  if (direct) return direct
  if (!ctx.lookupSpatialWorldId) return ''
  const seed = modelValues[0]
  if (!seed) return ''
  try {
    const recovered = await ctx.lookupSpatialWorldId({
      nodeId: ctx.node.id,
      assetId: seed.assetId?.trim() || undefined
    })
    return recovered?.trim() ?? ''
  } catch {
    // 找回失败不改变结论：照常按「没有 world_id」报错
    return ''
  }
}

export async function executeSpatialWorldExportNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const { node } = ctx
  const modelValues = flattenAssetValues([
    ...(ctx.inputs['in-world'] ?? []),
    ...(ctx.inputs.in ?? [])
  ]).filter((value) => value.assetType === 'model')

  const spatialWorldId = await resolveIncomingSpatialWorldId(ctx, modelValues)
  if (!spatialWorldId) {
    // 报错要能自证：导出端点只认 world_id，而上游值里没有它 ——
    // 说清「收到的是什么」比一句 NO_WORLD 好排查（多半是上游不是空间世界生成节点，
    // 或者世界是旧版本生成的、记录里从来没存过 world_id）
    const received = modelValues
      .map((value) => value.relativePath?.trim() || value.assetId?.trim() || '(no path)')
      .join(', ')
    throw new Error(
      `GRAPH_WORLD_EXPORT_NO_WORLD: the upstream model value carries no world id` +
        (received ? ` (received: ${received})` : ' (no model value on in-world)')
    )
  }

  if (!ctx.exportWorld) throw new Error('GRAPH_WORLD_EXPORT_UNAVAILABLE')
  if (ctx.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const mode = node.params.spatialWorldExportMode === 'splats' ? 'splats' : 'mesh'
  const source =
    modelValues.find((value) => value.spatialWorldId?.trim() === spatialWorldId) ??
    modelValues[0] ??
    undefined
  const sourceRelativePath = source?.relativePath?.trim() ?? ''

  if (mode === 'splats' && !sourceRelativePath) {
    throw new Error('GRAPH_WORLD_EXPORT_NO_SOURCE')
  }

  const meshVariant =
    node.params.spatialWorldExportVariant === 'vertex_colored' ? 'vertex_colored' : 'textured'
  const resolution =
    node.params.spatialWorldExportResolution === '500k' ||
    node.params.spatialWorldExportResolution === '150k' ||
    node.params.spatialWorldExportResolution === '100k'
      ? node.params.spatialWorldExportResolution
      : 'full_res'

  const result = await ctx.exportWorld({
    spatialWorldId,
    assetType: mode,
    format: mode === 'splats' ? 'ply' : 'glb',
    ...(mode === 'splats' ? { resolution } : { meshVariant }),
    providerInstanceId: node.params.generateProviderInstanceId || undefined,
    model: node.params.generateModel || undefined,
    sourceRelativePath: sourceRelativePath || undefined,
    name: node.title,
    graphBinding: {
      nodeId: node.id,
      assetId: ctx.resolveHostAssetId?.()
    }
  })

  const params = {
    spatialWorldExportRelativePath: result.relativePath,
    spatialWorldExportAssetType: mode
  } satisfies Pick<
    import('../types').GraphNodeParams,
    'spatialWorldExportRelativePath' | 'spatialWorldExportAssetType'
  >
  ctx.node.params = { ...ctx.node.params, ...params }
  ctx.patchNode?.({ params })
  ctx.log?.(
    `world export: ${mode === 'splats' ? `PLY splats (${resolution})` : `HQ mesh (${meshVariant})`} -> ${result.relativePath}`
  )

  if (mode === 'mesh' && result.assetId) {
    return persistModelGeneration(
      ctx,
      {
        relativePath: result.relativePath,
        assetId: result.assetId,
        // 世界 id 继续往下传：导出后的网格仍可再接「空间世界导出」出 PLY
        spatialWorldId
      },
      {
        kind: 'asset',
        assetId: result.assetId,
        assetType: 'model',
        relativePath: result.relativePath,
        label: node.params.label,
        weight: node.params.weight,
        title: node.title
      }
    )
  }

  // PLY：产物已在主进程登记为模型资产 —— 输出该资产值，导演台 / 3D 加工才接得上。
  // 拿不到 assetId（未登记 / 旧记录）时退回透传上游世界值，保证链不断。
  if (result.assetId) {
    const exported: GraphAssetValue = source
      ? {
          ...source,
          assetId: result.assetId,
          assetType: 'model',
          relativePath: result.relativePath
        }
      : {
          kind: 'asset',
          assetId: result.assetId,
          assetType: 'model',
          relativePath: result.relativePath
        }
    return { out: exported, [GRAPH_OUT_ALL_PORT_ID]: exported }
  }
  if (source) {
    const passthrough: GraphAssetValue = { ...source }
    return { out: passthrough, [GRAPH_OUT_ALL_PORT_ID]: passthrough }
  }
  return {}
}
