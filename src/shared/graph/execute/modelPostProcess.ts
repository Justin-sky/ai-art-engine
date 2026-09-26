/**
 * Tripo 网格后处理 / 骨骼动画四类加工节点：
 *
 * - `model.meshComplete` 部件补全 → `POST /v3/mesh/complete`（只吃拆件任务 id）
 * - `model.retopology`   重拓扑   → `POST /v3/mesh/decimate`
 * - `model.rigCheck`     绑骨检查 → `POST /v3/animations/rig-check`（免费，透传模型）
 * - `model.retarget`     动画重定向 → `POST /v3/animations/retarget`（只吃 rig 任务 id）
 *
 * 四者共用一条 `ctx.postProcessModel3d` 通道；上游任务 id 走 `GraphAssetValue.providerTaskId`，
 * 没有 id 时主进程把本地模型上传对象存储换公网 URL（部件补全 / 重定向除外——那两个端点只认 id）。
 */
import { readIncomingModel } from './blenderDsh'
import { persistModelGeneration } from './materialize'
import type { GraphAssetValue, GraphValue, NodeExecuteContext } from './types'

/** 多行 / 逗号分隔参数 → 去空去重数组 */
export function normalizePostProcessList(raw: string[] | undefined): string[] {
  const out: string[] = []
  for (const item of raw ?? []) {
    const value = item.trim()
    if (value && !out.includes(value)) out.push(value)
  }
  return out
}

/**
 * 旧节点可能仍绑着文本模型（如 deepseek-flash）。
 * 这些端点只认 Tripo：明显是文本模型 id 时丢弃，避免 resolveActiveProvider 被脏参带偏。
 */
function sanitizePostProcessSelection(ctx: NodeExecuteContext): {
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

function readUpstreamTaskId(model: GraphAssetValue): string | undefined {
  return model.providerTaskId?.trim() || undefined
}

function requireUpstreamModel(ctx: NodeExecuteContext): GraphAssetValue {
  const model = readIncomingModel(ctx)
  if (!model?.relativePath?.trim()) throw new Error('GRAPH_MODEL_POST_NO_MODEL')
  if (!ctx.postProcessModel3d) throw new Error('GRAPH_MODEL_POST_API')
  return model
}

/** 把结果模型落进图库并输出（带新的 providerTaskId，便于继续链式调用） */
function commitPostProcessModel(
  ctx: NodeExecuteContext,
  model: GraphAssetValue,
  result: { taskId: string; assetId: string; relativePath: string },
  patched: Record<string, unknown>
): Record<string, GraphValue> {
  ctx.node.params = { ...ctx.node.params, ...patched }
  ctx.patchNode?.({ params: patched })
  const base: GraphAssetValue = {
    ...model,
    kind: 'asset',
    assetType: 'model',
    relativePath: result.relativePath,
    providerTaskId: result.taskId
  }
  return persistModelGeneration(
    ctx,
    {
      relativePath: result.relativePath,
      assetId: result.assetId || model.assetId,
      providerTaskId: result.taskId
    },
    base
  )
}

/** 部件补全：input 必须是上游 `mesh/segment` 的任务 id */
export async function executeModelMeshCompleteNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const model = requireUpstreamModel(ctx)
  const selection = sanitizePostProcessSelection(ctx)
  const partNames = normalizePostProcessList(ctx.node.params.meshCompletePartNames)

  const result = await ctx.postProcessModel3d!({
    op: 'meshComplete',
    providerTaskId: readUpstreamTaskId(model),
    modelRelativePath: model.relativePath!.trim(),
    providerInstanceId: selection.providerInstanceId,
    model: selection.model,
    ...(partNames.length ? { partNames } : {}),
    completionMode: ctx.node.params.meshCompleteMode,
    name: ctx.node.title,
    graphBinding: { nodeId: ctx.node.id, assetId: ctx.resolveHostAssetId?.() }
  })
  if (result.op === 'rigCheck') throw new Error('GRAPH_MODEL_POST_RESULT')

  return commitPostProcessModel(ctx, model, result, {
    meshCompleteTaskId: result.taskId,
    meshCompleteModelRelativePath: result.relativePath,
    meshCompletePartNames: partNames,
    generateModel: selection.model ?? '',
    generateProviderInstanceId: selection.providerInstanceId ?? ''
  })
}

/** 重拓扑（减面 / 智能低模）：task_id 或公网 URL 都行 */
export async function executeModelRetopologyNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const model = requireUpstreamModel(ctx)
  const selection = sanitizePostProcessSelection(ctx)
  const partNames = normalizePostProcessList(ctx.node.params.retopologyPartNames)
  const faceLimit = ctx.node.params.retopologyFaceLimit

  const result = await ctx.postProcessModel3d!({
    op: 'retopology',
    providerTaskId: readUpstreamTaskId(model),
    modelRelativePath: model.relativePath!.trim(),
    providerInstanceId: selection.providerInstanceId,
    model: selection.model,
    retopologyMode: ctx.node.params.retopologyMode === 'basic' ? 'basic' : 'smart',
    ...(typeof faceLimit === 'number' && faceLimit > 0 ? { faceLimit } : {}),
    quad: ctx.node.params.retopologyQuad === true,
    bake: ctx.node.params.retopologyBake !== false,
    ...(partNames.length ? { partNames } : {}),
    name: ctx.node.title,
    graphBinding: { nodeId: ctx.node.id, assetId: ctx.resolveHostAssetId?.() }
  })
  if (result.op === 'rigCheck') throw new Error('GRAPH_MODEL_POST_RESULT')

  return commitPostProcessModel(ctx, model, result, {
    retopologyTaskId: result.taskId,
    retopologyModelRelativePath: result.relativePath,
    retopologyPartNames: partNames,
    generateModel: selection.model ?? '',
    generateProviderInstanceId: selection.providerInstanceId ?? ''
  })
}

/** 绑骨检查：免费，无模型产物——把上游模型原样透传，结论写进节点参数 */
export async function executeModelRigCheckNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const model = requireUpstreamModel(ctx)
  const selection = sanitizePostProcessSelection(ctx)

  const result = await ctx.postProcessModel3d!({
    op: 'rigCheck',
    providerTaskId: readUpstreamTaskId(model),
    modelRelativePath: model.relativePath!.trim(),
    providerInstanceId: selection.providerInstanceId,
    model: selection.model,
    name: ctx.node.title,
    graphBinding: { nodeId: ctx.node.id, assetId: ctx.resolveHostAssetId?.() }
  })
  if (result.op !== 'rigCheck') throw new Error('GRAPH_MODEL_POST_RESULT')

  const patched = {
    rigCheckRiggable: result.riggable,
    rigCheckRigType: result.rigType,
    rigCheckTaskId: result.taskId,
    rigCheckModelRelativePath: model.relativePath!.trim(),
    generateModel: selection.model ?? '',
    generateProviderInstanceId: selection.providerInstanceId ?? ''
  }
  ctx.node.params = { ...ctx.node.params, ...patched }
  ctx.patchNode?.({ params: patched })

  // 与 dualModelGalleryOutputs 同口径：out / out-all 都是当前选中的这一个值
  const value = { ...model, providerTaskId: readUpstreamTaskId(model) } as GraphValue
  return { out: value, 'out-all': value }
}

/** 动画重定向：Tripo 吃预设动画 id、Meshy 吃动作库 action_id（两套体系各取所需） */
export async function executeModelRetargetNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const model = requireUpstreamModel(ctx)
  const selection = sanitizePostProcessSelection(ctx)
  const animations = normalizePostProcessList(ctx.node.params.retargetAnimations)
  const actionIds = (ctx.node.params.retargetActionIds ?? [])
    .map((id) => Math.round(Number(id)))
    .filter((id) => Number.isFinite(id) && id > 0)

  const result = await ctx.postProcessModel3d!({
    op: 'retarget',
    providerTaskId: readUpstreamTaskId(model),
    modelRelativePath: model.relativePath!.trim(),
    providerInstanceId: selection.providerInstanceId,
    model: selection.model,
    ...(animations.length > 1 ? { animations } : { animation: animations[0] }),
    ...(actionIds.length ? { actionIds } : {}),
    outFormat: ctx.node.params.retargetOutFormat === 'fbx' ? 'fbx' : 'glb',
    bakeAnimation: ctx.node.params.retargetBakeAnimation !== false,
    exportWithGeometry: ctx.node.params.retargetExportWithGeometry !== false,
    animateInPlace: ctx.node.params.retargetAnimateInPlace === true,
    name: ctx.node.title,
    graphBinding: { nodeId: ctx.node.id, assetId: ctx.resolveHostAssetId?.() }
  })
  if (result.op === 'rigCheck') throw new Error('GRAPH_MODEL_POST_RESULT')

  return commitPostProcessModel(ctx, model, result, {
    retargetTaskId: result.taskId,
    retargetModelRelativePath: result.relativePath,
    retargetAnimations: animations,
    retargetActionIds: actionIds,
    generateModel: selection.model ?? '',
    generateProviderInstanceId: selection.providerInstanceId ?? ''
  })
}

/** 格式转换：task_id 或公网 URL 都行；quad 会强制回 FBX */
export async function executeModelConvertNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const model = requireUpstreamModel(ctx)
  const selection = sanitizePostProcessSelection(ctx)
  const partNames = normalizePostProcessList(ctx.node.params.convertPartNames)
  const faceLimit = ctx.node.params.convertFaceLimit
  const textureSize = ctx.node.params.convertTextureSize

  const result = await ctx.postProcessModel3d!({
    op: 'convert',
    providerTaskId: readUpstreamTaskId(model),
    modelRelativePath: model.relativePath!.trim(),
    providerInstanceId: selection.providerInstanceId,
    model: selection.model,
    format: ctx.node.params.convertFormat ?? 'FBX',
    quad: ctx.node.params.convertQuad === true,
    ...(typeof faceLimit === 'number' && faceLimit > 0 ? { faceLimit } : {}),
    ...(typeof textureSize === 'number' && textureSize > 0 ? { textureSize } : {}),
    ...(ctx.node.params.convertTextureFormat
      ? { textureFormat: ctx.node.params.convertTextureFormat as never }
      : {}),
    ...(ctx.node.params.convertFbxPreset
      ? { fbxPreset: ctx.node.params.convertFbxPreset as never }
      : {}),
    pivotToCenterBottom: ctx.node.params.convertPivotToCenterBottom === true,
    packUv: ctx.node.params.convertPackUv === true,
    bake: ctx.node.params.convertBake !== false,
    withAnimation: ctx.node.params.convertWithAnimation !== false,
    ...(partNames.length ? { partNames } : {}),
    name: ctx.node.title,
    graphBinding: { nodeId: ctx.node.id, assetId: ctx.resolveHostAssetId?.() }
  })
  if (result.op === 'rigCheck') throw new Error('GRAPH_MODEL_POST_RESULT')

  return commitPostProcessModel(ctx, model, result, {
    convertTaskId: result.taskId,
    convertModelRelativePath: result.relativePath,
    convertPartNames: partNames,
    generateModel: selection.model ?? '',
    generateProviderInstanceId: selection.providerInstanceId ?? ''
  })
}

/** 贴图（重绘贴图 / 换材质）：task_id 或公网 URL 都行 */
export async function executeModelTextureNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const model = requireUpstreamModel(ctx)
  const selection = sanitizePostProcessSelection(ctx)
  const partNames = normalizePostProcessList(ctx.node.params.texturePartNames)
  const promptText =
    ctx.node.params.generateInstruction?.trim() || ctx.node.params.texturePromptText?.trim() || ''

  const result = await ctx.postProcessModel3d!({
    op: 'texture',
    providerTaskId: readUpstreamTaskId(model),
    modelRelativePath: model.relativePath!.trim(),
    providerInstanceId: selection.providerInstanceId,
    model: selection.model,
    ...(ctx.node.params.textureVersion ? { textureVersion: ctx.node.params.textureVersion } : {}),
    ...(promptText ? { texturePromptText: promptText } : {}),
    ...(ctx.node.params.textureQuality
      ? { textureQuality: ctx.node.params.textureQuality as never }
      : {}),
    ...(ctx.node.params.textureAlignment
      ? { textureAlignment: ctx.node.params.textureAlignment as never }
      : {}),
    pbr: ctx.node.params.texturePbr !== false,
    // 未设置就不发，保留各家默认（Tripo delight 默认开、Meshy remove_lighting 默认不动）
    ...(ctx.node.params.textureDelight === undefined
      ? {}
      : { delight: ctx.node.params.textureDelight }),
    ...(typeof ctx.node.params.textureSeed === 'number'
      ? { textureSeed: ctx.node.params.textureSeed }
      : {}),
    ...(partNames.length ? { partNames } : {}),
    name: ctx.node.title,
    graphBinding: { nodeId: ctx.node.id, assetId: ctx.resolveHostAssetId?.() }
  })
  if (result.op === 'rigCheck') throw new Error('GRAPH_MODEL_POST_RESULT')

  return commitPostProcessModel(ctx, model, result, {
    textureTaskId: result.taskId,
    textureModelRelativePath: result.relativePath,
    texturePartNames: partNames,
    texturePromptText: promptText,
    generateModel: selection.model ?? '',
    generateProviderInstanceId: selection.providerInstanceId ?? ''
  })
}
