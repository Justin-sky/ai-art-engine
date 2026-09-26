/**
 * `model.segment`：上传上游模型 → 调用 Tripo 拆分 API（网格分割 / 智能分割）→ 下载拆分后 GLB。
 *
 * 拆分出来的部件名不在 API 响应里，等于输出 GLB 的各 node 名（主进程解析后回传），
 * 写进节点 params 供 Inspector 展示与下游按部件操作（补全 / 重拓扑 / 贴图 / 导出）。
 */
import type {
  Model3dSegmentGranularity,
  Model3dSegmentMode,
  Model3dSmartSegmentGranularity
} from '../../modelProvider'
import { readIncomingModel } from './blenderDsh'
import { persistModelGeneration } from './materialize'
import type { GraphValue, NodeExecuteContext } from './types'

const MESH_GRANULARITIES = new Set<string>(['simple', 'balanced', 'detailed'])
const SMART_GRANULARITIES = new Set<string>(['coarse', 'medium', 'fine'])

/** 节点参数 → 拆分模式（缺省网格分割） */
export function resolveSegmentMode(ctx: NodeExecuteContext): Model3dSegmentMode {
  return ctx.node.params.segmentMode === 'smart' ? 'smart' : 'mesh'
}

function resolveSegmentGranularity(raw: string | undefined): Model3dSegmentGranularity | undefined {
  const key = raw?.trim().toLowerCase() ?? ''
  return MESH_GRANULARITIES.has(key) ? (key as Model3dSegmentGranularity) : undefined
}

function resolveSmartGranularity(
  raw: string | undefined
): Model3dSmartSegmentGranularity | undefined {
  const key = raw?.trim().toLowerCase() ?? ''
  return SMART_GRANULARITIES.has(key) ? (key as Model3dSmartSegmentGranularity) : undefined
}

/**
 * 旧节点可能仍绑着文本模型（如 deepseek-flash）。
 * 拆件只认 Tripo：明显是文本模型 id 时丢弃，避免 resolveActiveProvider('model3d', …) 被脏参带偏。
 */
function sanitizeSegmentSelection(ctx: NodeExecuteContext): {
  providerInstanceId?: string
  model?: string
} {
  const providerInstanceId = ctx.node.params.generateProviderInstanceId?.trim() || undefined
  const model = ctx.node.params.generateModel?.trim() || undefined
  if (model && /deepseek|gpt|claude|moonshot|qwen|flash|chat|instruct/i.test(model)) {
    return {}
  }
  return { providerInstanceId, model }
}

export async function executeModelSegmentNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const model = readIncomingModel(ctx)
  if (!model?.relativePath?.trim()) throw new Error('GRAPH_MODEL_SEG_NO_MODEL')
  if (!ctx.segmentModel3d) throw new Error('GRAPH_MODEL_SEG_API')

  const mode = resolveSegmentMode(ctx)
  const selection = sanitizeSegmentSelection(ctx)

  const result = await ctx.segmentModel3d({
    modelRelativePath: model.relativePath.trim(),
    providerInstanceId: selection.providerInstanceId,
    model: selection.model,
    mode,
    granularity: resolveSegmentGranularity(ctx.node.params.segmentGranularity),
    splitByConnectivity: ctx.node.params.segmentSplitByConnectivity,
    smartGranularity: resolveSmartGranularity(ctx.node.params.segmentSmartGranularity),
    hint: ctx.node.params.segmentHint?.trim() || undefined,
    name: ctx.node.title,
    graphBinding: {
      nodeId: ctx.node.id,
      assetId: ctx.resolveHostAssetId?.()
    }
  })

  const patched = {
    segmentMode: mode,
    segmentModelRelativePath: result.relativePath,
    segmentParts: result.parts ?? [],
    segmentDescription: result.description ?? '',
    segmentMaskUrl: result.maskUrl ?? '',
    // 部件补全只吃 mesh/segment 任务 id，必须随节点与输出值一起传下去
    segmentTaskId: result.taskId ?? '',
    generateModel: selection.model ?? '',
    generateProviderInstanceId: selection.providerInstanceId ?? ''
  }
  ctx.node.params = { ...ctx.node.params, ...patched }
  ctx.patchNode?.({ params: patched })

  return persistModelGeneration(
    ctx,
    {
      relativePath: result.relativePath,
      assetId: model.assetId,
      ...(result.taskId ? { providerTaskId: result.taskId } : {})
    },
    {
      ...model,
      kind: 'asset',
      assetType: 'model',
      relativePath: result.relativePath,
      ...(result.taskId ? { providerTaskId: result.taskId } : {})
    }
  )
}
