/**
 * `model.rigSkin`：上传上游模型 → 调用 Meshy/Tripo 独立 Rigging API → 下载带骨骼 GLB。
 */
import { blenderDshError } from '../../blenderDshJob'
import { supportsModel3dRig } from '../../modelProvider'
import { modelJobOutputs, readIncomingModel } from './blenderDsh'
import type { GraphValue, NodeExecuteContext } from './types'

const RIG_TYPE_KEYS = new Set([
  'humanoid',
  'quadruped',
  'bipedal',
  'creature',
  'biped',
  'hexapod',
  'octopod',
  'avian',
  'serpentine',
  'aquatic'
])

/** 旧 Blender 长指令 → 骨架类型关键字 */
function inferRigTypeFromLegacyInstruction(raw: string): string | undefined {
  const text = raw.trim().toLowerCase()
  if (!text) return undefined
  if (RIG_TYPE_KEYS.has(text)) return text
  const first = text.split(/[\s,，]+/)[0]
  if (first && RIG_TYPE_KEYS.has(first)) return first
  if (text.includes('quadruped') || raw.includes('四足')) return 'quadruped' // cjk-ok（短指令匹配）
  if (
    text.includes('creature') ||
    raw.includes('生物') || // cjk-ok
    raw.includes('道具') || // cjk-ok
    text.includes('prop')
  )
    return 'creature'
  if (
    text.includes('humanoid') ||
    text.includes('mixamo') ||
    text.includes('biped') ||
    raw.includes('人形') || // cjk-ok
    raw.includes('双足') // cjk-ok
  )
    return 'humanoid'
  return undefined
}

function resolveRigType(ctx: NodeExecuteContext): string {
  const fromParam = ctx.node.params.generateRigType?.trim()
  if (fromParam) return fromParam
  return inferRigTypeFromLegacyInstruction(ctx.node.params.generateInstruction ?? '') || 'humanoid'
}

/**
 * 旧节点可能仍绑着 Blender dsh 文本模型（如 deepseek-flash）。
 * 云端 Rig 只认 Meshy/Tripo：无效选型交给 facade 的 resolveActiveProvider 默认。
 */
function sanitizeCloudRigSelection(ctx: NodeExecuteContext): {
  providerInstanceId?: string
  model?: string
} {
  const providerInstanceId = ctx.node.params.generateProviderInstanceId?.trim() || undefined
  const model = ctx.node.params.generateModel?.trim() || undefined
  // 明显是文本模型 id 时丢弃，避免 resolveActiveProvider('model3d', …) 被脏参带偏
  if (model && /deepseek|gpt|claude|moonshot|qwen|flash|chat|instruct/i.test(model)) {
    return {}
  }
  return { providerInstanceId, model }
}

export async function executeModelRigSkinNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const model = readIncomingModel(ctx)
  if (!model?.relativePath?.trim()) throw new Error(blenderDshError('rig', 'NO_MODEL'))

  if (!ctx.rigModel3d) throw new Error(blenderDshError('rig', 'DSH'))

  const rigType = resolveRigType(ctx)
  const selection = sanitizeCloudRigSelection(ctx)

  // 一进 Cook 就清掉旧 Blender QA / skill，避免失败时 Inspector 仍显示过期 QA
  ctx.patchNode?.({
    params: {
      skillId: undefined,
      generateRigType: rigType,
      rigQa: undefined
    }
  })

  const result = await ctx.rigModel3d({
    modelRelativePath: model.relativePath.trim(),
    providerInstanceId: selection.providerInstanceId,
    model: selection.model,
    rigType,
    name: ctx.node.title,
    graphBinding: {
      nodeId: ctx.node.id,
      assetId: ctx.resolveHostAssetId?.()
    }
  })

  // 清理旧 Blender 残留（skillId / QA / 长指令），避免 Inspector 误导
  const cleanedInstruction = RIG_TYPE_KEYS.has(
    (ctx.node.params.generateInstruction ?? '').trim().toLowerCase()
  )
    ? ctx.node.params.generateInstruction
    : rigType

  ctx.node.params = {
    ...ctx.node.params,
    skillId: undefined,
    generateRigType: rigType,
    generateInstruction: cleanedInstruction,
    generateModel: selection.model ?? '',
    generateProviderInstanceId: selection.providerInstanceId ?? '',
    rigModelRelativePath: result.relativePath,
    // 云端 Rig 无 Blender QA
    rigQa: undefined
  }
  ctx.patchNode?.({
    params: {
      skillId: undefined,
      generateRigType: rigType,
      generateInstruction: cleanedInstruction,
      generateModel: selection.model ?? '',
      generateProviderInstanceId: selection.providerInstanceId ?? '',
      rigModelRelativePath: result.relativePath,
      rigQa: undefined
    }
  })

  return modelJobOutputs(ctx, model, result.relativePath, {
    ok: true,
    kind: 'rig',
    rigMeta: {
      armature: 'Armature',
      bones: [],
      vertexGroups: []
    }
  })
}

/** 供测试 / UI：当前节点所选供应商是否支持独立蒙皮 */
export function rigSkinProviderSupported(kind: string | undefined): boolean {
  return !!kind && supportsModel3dRig(kind)
}
