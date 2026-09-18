/**
 * `model.rigSkin`：经 dsh 指挥 Blender 绑骨蒙皮，导出 rigged GLB + rigMeta overlay。
 */
import { blenderDshError } from '../../blenderDshJob'
import {
  modelJobOutputs,
  readIncomingModel,
  readModelInstruction,
  runModelBlenderDshJob
} from './blenderDsh'
import type { GraphValue, NodeExecuteContext } from './types'

export async function executeModelRigSkinNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const model = readIncomingModel(ctx)
  if (!model) throw new Error(blenderDshError('rig', 'NO_MODEL'))

  const instruction = readModelInstruction(ctx)
  if (!instruction) throw new Error('GRAPH_PROCESS_NO_INPUT')

  const { relativePath, result } = await runModelBlenderDshJob(ctx, 'rig', model, instruction)
  if (!result.rigMeta?.bones.length) throw new Error(blenderDshError('rig', 'NO_MATCH'))

  ctx.node.params = {
    ...ctx.node.params,
    rigMeta: result.rigMeta,
    rigModelRelativePath: relativePath
  }
  ctx.patchNode?.({
    params: {
      rigMeta: result.rigMeta,
      rigModelRelativePath: relativePath
    }
  })
  return modelJobOutputs(model, relativePath, result)
}
