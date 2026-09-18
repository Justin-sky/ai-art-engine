/**
 * `model.pose`：经 dsh 指挥 Blender 做静帧姿势，导出新 GLB + bonePose overlay。
 */
import { blenderDshError } from '../../blenderDshJob'
import {
  modelJobOutputs,
  readIncomingModel,
  readModelInstruction,
  runModelBlenderDshJob
} from './blenderDsh'
import type { GraphValue, NodeExecuteContext } from './types'

export async function executeModelPoseNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const model = readIncomingModel(ctx)
  if (!model) throw new Error(blenderDshError('pose', 'NO_MODEL'))

  const instruction = readModelInstruction(ctx)
  if (!instruction) throw new Error('GRAPH_PROCESS_NO_INPUT')

  const { relativePath, result } = await runModelBlenderDshJob(ctx, 'pose', model, instruction)
  if (!result.bonePose) throw new Error(blenderDshError('pose', 'NO_MATCH'))

  ctx.node.params = {
    ...ctx.node.params,
    bonePose: result.bonePose,
    poseModelRelativePath: relativePath,
    poseSourceAssetId: model.assetId
  }
  ctx.patchNode?.({
    params: {
      bonePose: result.bonePose,
      poseModelRelativePath: relativePath,
      poseSourceAssetId: model.assetId
    }
  })
  return modelJobOutputs(model, relativePath, result)
}
