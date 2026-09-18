/**
 * `model.animation`：经 dsh 指挥 Blender 做关键帧动作，导出带 AnimationClip 的 GLB + clip overlay。
 */
import { blenderDshError } from '../../blenderDshJob'
import {
  modelJobOutputs,
  readIncomingModel,
  readModelInstruction,
  runModelBlenderDshJob
} from './blenderDsh'
import type { GraphValue, NodeExecuteContext } from './types'

export async function executeModelAnimationNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const model = readIncomingModel(ctx)
  if (!model) throw new Error(blenderDshError('anim', 'NO_MODEL'))

  const instruction = readModelInstruction(ctx)
  if (!instruction) throw new Error('GRAPH_PROCESS_NO_INPUT')

  const { relativePath, result } = await runModelBlenderDshJob(ctx, 'anim', model, instruction)
  if (!result.clip?.name) throw new Error(blenderDshError('anim', 'NO_MATCH'))

  ctx.node.params = {
    ...ctx.node.params,
    clip: result.clip,
    animationModelRelativePath: relativePath,
    animationSourceAssetId: model.assetId
  }
  ctx.patchNode?.({
    params: {
      clip: result.clip,
      animationModelRelativePath: relativePath,
      animationSourceAssetId: model.assetId
    }
  })
  return modelJobOutputs(model, relativePath, result)
}
