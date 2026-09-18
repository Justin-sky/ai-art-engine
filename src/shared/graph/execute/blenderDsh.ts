/**
 * 三个 3D 加工节点共用：读上游模型 / 指令，跑 dsh→Blender 作业，输出新 GLB + overlay。
 */
import {
  BLENDER_DSH_SKILL_ID,
  BLENDER_DSH_TIMEOUT_MS,
  blenderDshError,
  type BlenderDshJobKind,
  type BlenderJobResult
} from '../../blenderDshJob'
import { persistModelGeneration } from './materialize'
import { collectIncomingValues } from './incoming'
import { flattenAssetValues, flattenTextValues } from './gallery'
import type { GraphAssetValue, GraphValue, NodeExecuteContext } from './types'

export function readIncomingModel(ctx: NodeExecuteContext): GraphAssetValue | null {
  const values = [
    ...(ctx.inputs['in-model'] ?? []),
    ...(ctx.inputs.in ?? []),
    ...collectIncomingValues(ctx.inputs)
  ]
  for (const item of flattenAssetValues(values)) {
    if (item.assetType === 'model' || item.assetType === 'model3d') return item
  }
  return null
}

export function readModelInstruction(ctx: NodeExecuteContext): string {
  const fromParams = ctx.node.params.generateInstruction?.trim() ?? ''
  if (fromParams) return fromParams
  return flattenTextValues(ctx.inputs['in-text'] ?? [])
    .map((item) => item.text.trim())
    .filter(Boolean)
    .join('\n')
    .trim()
}

export async function runModelBlenderDshJob(
  ctx: NodeExecuteContext,
  kind: BlenderDshJobKind,
  model: GraphAssetValue,
  instruction: string
): Promise<{ relativePath: string; result: BlenderJobResult }> {
  if (!ctx.runBlenderDshJob) throw new Error(blenderDshError(kind, 'DSH'))
  const sourceRelativePath = model.relativePath?.trim()
  if (!sourceRelativePath) throw new Error(blenderDshError(kind, 'NO_MODEL'))
  return ctx.runBlenderDshJob({
    kind,
    node: ctx.node,
    sourceRelativePath,
    instruction,
    locale: ctx.locale,
    timeoutMs: BLENDER_DSH_TIMEOUT_MS[kind],
    skillId: BLENDER_DSH_SKILL_ID[kind],
    model: ctx.node.params.generateModel?.trim() || undefined,
    providerInstanceId: ctx.node.params.generateProviderInstanceId?.trim() || undefined,
    signal: ctx.signal
  })
}

export function modelJobOutputs(
  ctx: NodeExecuteContext,
  model: GraphAssetValue,
  relativePath: string,
  result: BlenderJobResult
): Record<string, GraphValue> {
  return persistModelGeneration(
    ctx,
    {
      relativePath,
      assetId: model.assetId,
      ...(result.rigMeta ? { rigMeta: result.rigMeta } : {}),
      ...(result.rigQa ? { rigQa: result.rigQa } : {}),
      ...(result.bonePose ? { bonePose: result.bonePose } : {}),
      ...(result.clip
        ? {
            clip: {
              name: result.clip.name,
              fps: result.clip.fps,
              frameRange: result.clip.frameRange,
              keyframes: result.clip.keyframes,
              ...(result.clip.presetId ? { presetId: result.clip.presetId } : {})
            }
          }
        : {})
    },
    {
      ...model,
      kind: 'asset',
      assetType: 'model',
      relativePath
    }
  )
}
