/**
 * `model.pose`：给带骨骼的 3D 模型生成静帧姿势。
 *
 * 上游 3D 模型 → 读骨骼 → 预设本地计算或 LLM+Blender → 输出同一模型并附带 bonePose。
 * 导演台从 `in-model` 实例化时套用这份姿势。
 */
import type { StageVec3 } from '../../domain'
import {
  buildBlenderListArmatureBonesScript,
  computePresetPoseReadback,
  decideBlenderPoseStrategy,
  parseBlenderArmatureBoneList,
  parseBlenderDrivePoseMeta,
  parseBlenderPoseReadback,
  runBlenderAiPoseAgent,
  type BlenderBoneRole,
  type BlenderPoseReadback
} from '../../blenderPoseGeneration'
import { GRAPH_OUT_ALL_PORT_ID } from '../ports'
import { collectIncomingValues } from './incoming'
import { flattenAssetValues, flattenTextValues } from './gallery'
import type { GraphAssetValue, GraphValue, NodeExecuteContext } from './types'

export interface ModelSkeletonBone {
  name: string
  parent: string | null
}

function readIncomingModel(ctx: NodeExecuteContext): GraphAssetValue | null {
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

function readInstruction(ctx: NodeExecuteContext): string {
  const fromParams = ctx.node.params.generateInstruction?.trim() ?? ''
  if (fromParams) return fromParams
  const fromText = flattenTextValues(ctx.inputs['in-text'] ?? [])
    .map((item) => item.text.trim())
    .filter(Boolean)
    .join('\n')
    .trim()
  return fromText
}

function inferBoneRole(boneName: string): BlenderBoneRole {
  const key = boneName
    .trim()
    .replace(/^mixamorig:/i, '')
    .replace(/^mixamorig/i, '')
    .replace(/^bip01[_\s-]*/i, '')
    .replace(/^bone[_\s-]*/i, '')
    .replace(/[_\s\-.:|]+/g, '')
    .toLowerCase()
  if (!key) return 'other'
  if (
    /(^|[^a-z])(hips|hip|pelvis|root)([^a-z]|$)/.test(key) ||
    key === 'hips' ||
    key.endsWith('hips')
  )
    return 'hips'
  if (/spine|chest|torso|ribcage/.test(key)) return 'spine'
  if (/neck/.test(key)) return 'neck'
  if (/head/.test(key)) return 'head'
  if (/left/.test(key) && /shoulder|clavicle|collar/.test(key)) return 'l_shoulder'
  if (/right/.test(key) && /shoulder|clavicle|collar/.test(key)) return 'r_shoulder'
  if (/left/.test(key) && /upperarm|arm(?!ature)/.test(key) && !/fore|lower/.test(key))
    return 'l_upperarm'
  if (/right/.test(key) && /upperarm|arm(?!ature)/.test(key) && !/fore|lower/.test(key))
    return 'r_upperarm'
  if (/left/.test(key) && /(forearm|lowerarm)/.test(key)) return 'l_forearm'
  if (/right/.test(key) && /(forearm|lowerarm)/.test(key)) return 'r_forearm'
  if (/left/.test(key) && /hand|wrist/.test(key)) return 'l_hand'
  if (/right/.test(key) && /hand|wrist/.test(key)) return 'r_hand'
  if (/left/.test(key) && /(upleg|thigh|upperleg)/.test(key)) return 'l_thigh'
  if (/right/.test(key) && /(upleg|thigh|upperleg)/.test(key)) return 'r_thigh'
  if (/left/.test(key) && /(leg|calf|shin|lowerleg)/.test(key) && !/upleg|thigh|upperleg/.test(key))
    return 'l_shin'
  if (
    /right/.test(key) &&
    /(leg|calf|shin|lowerleg)/.test(key) &&
    !/upleg|thigh|upperleg/.test(key)
  )
    return 'r_shin'
  if (/left/.test(key) && /foot|ankle/.test(key)) return 'l_foot'
  if (/right/.test(key) && /foot|ankle/.test(key)) return 'r_foot'
  if (/left/.test(key) && /toe/.test(key)) return 'l_toe'
  if (/right/.test(key) && /toe/.test(key)) return 'r_toe'
  if (/finger|thumb|index|middle|ring|pinky/.test(key)) return 'finger'
  return 'other'
}

export function bonePoseFromReadback(readback: BlenderPoseReadback): Record<string, StageVec3> {
  const bonePose: Record<string, StageVec3> = {}
  for (const [name, triple] of Object.entries(readback)) {
    const key = name.trim()
    if (!key || !triple || triple.length < 3) continue
    const x = Number(triple[0])
    const y = Number(triple[1])
    const z = Number(triple[2])
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue
    if (x === 0 && y === 0 && z === 0) continue
    bonePose[key] = { x, y, z }
  }
  return bonePose
}

function stripPythonCodeFence(raw: string): string {
  const trimmed = raw.trim()
  const fenced = trimmed.match(/^```(?:python|py|python3)?\s*([\s\S]*?)\s*```$/i)
  if (fenced?.[1]) return fenced[1].trim()
  return trimmed
}

function buildBoneMaps(hierarchy: ModelSkeletonBone[]): {
  boneRoles: Record<string, BlenderBoneRole>
  boneParents: Record<string, string | null>
} {
  const boneRoles: Record<string, BlenderBoneRole> = {}
  const boneParents: Record<string, string | null> = {}
  for (const bone of hierarchy) {
    const name = bone.name.trim()
    if (!name) continue
    boneRoles[name] = inferBoneRole(name)
    boneParents[name] = bone.parent?.trim() || null
  }
  return { boneRoles, boneParents }
}

async function generateAiPoseReadback(
  ctx: NodeExecuteContext,
  input: {
    instruction: string
    locale: string
    boneRoles: Record<string, BlenderBoneRole>
    boneParents: Record<string, string | null>
    total: number
  }
): Promise<BlenderPoseReadback> {
  if (!ctx.generateText) throw new Error('GRAPH_MODEL_POSE_NO_TEXT_MODEL')
  if (!ctx.runBlenderMcpTool) throw new Error('GRAPH_MODEL_POSE_MCP')
  const model = ctx.node.params.generateModel?.trim()
  const providerInstanceId = ctx.node.params.generateProviderInstanceId?.trim()
  if (!model || !providerInstanceId) throw new Error('GRAPH_MODEL_POSE_NO_TEXT_MODEL')

  const historyLabel = '[Conversation history — previous tool results are listed here]'
  const historyEmpty = '(None — this is the first turn)'
  const continuePrompt =
    'Continue. Call try_blender_pose with Python, or finalize_pose when the pose is ready.'

  const blenderRun = ctx.runBlenderMcpTool
  const generateText = ctx.generateText
  let lastReadback: BlenderPoseReadback = {}

  const agentResult = await runBlenderAiPoseAgent(
    {
      instruction: input.instruction,
      boneRoles: input.boneRoles,
      boneParents: input.boneParents,
      locale: input.locale
    },
    {
      modelClient: async ({ system, messages, tools }) => {
        void tools
        const history = messages
          .filter((m) => m.role !== 'system')
          .map((m) => {
            if (m.role === 'user') return `USER: ${m.content}`
            if (m.role === 'assistant') {
              const toolSummary = m.tool_calls.length
                ? '\n  tool_calls: ' +
                  JSON.stringify(m.tool_calls.map((c) => ({ name: c.function.name })))
                : ''
              return `ASSISTANT: ${m.content}${toolSummary}`
            }
            return `TOOL_RESULT[${m.tool_call_id}]: ${m.content}`
          })
          .join('\n\n')
        const composedSystem = `${system}\n\n${historyLabel}\n${history || historyEmpty}`
        const result = await generateText({
          providerInstanceId,
          model,
          system: composedSystem,
          prompt: continuePrompt
        })
        const stripped = stripPythonCodeFence(result.text)
        if (!stripped.trim()) return { text: result.text, toolCalls: [] }
        return {
          text: result.text,
          toolCalls: [
            {
              id: `auto_${Date.now()}`,
              type: 'function' as const,
              function: {
                name: 'try_blender_pose',
                arguments: JSON.stringify({ python_code: stripped })
              }
            }
          ]
        }
      },
      blenderRun: async (code) => {
        const outcome = await blenderRun({
          name: 'execute_blender_code',
          args: { code },
          timeoutMs: 60000
        })
        if (outcome.error) throw new Error(outcome.error)
        const readback = parseBlenderPoseReadback(outcome)
        const meta = parseBlenderDrivePoseMeta(outcome)
        lastReadback = readback
        return { readback, meta }
      },
      listArmatureBones: async () => {
        const outcome = await blenderRun({
          name: 'execute_blender_code',
          args: { code: buildBlenderListArmatureBonesScript() },
          timeoutMs: 30000
        })
        return parseBlenderArmatureBoneList(outcome)
      },
      applyToRenderer: (readback) => {
        lastReadback = readback
        return { matched: Object.keys(readback).length, total: input.total }
      }
    }
  )

  if (!agentResult.ok) {
    throw new Error(`GRAPH_MODEL_POSE_FAILED:${agentResult.reason}`)
  }
  const readback = Object.keys(lastReadback).length ? lastReadback : {}
  if (!Object.keys(readback).length) throw new Error('GRAPH_MODEL_POSE_NO_MATCH')
  return readback
}

function modelOutputs(model: GraphAssetValue, bonePose: Record<string, StageVec3>): Record<
  string,
  GraphValue
> {
  const value: GraphAssetValue = {
    ...model,
    kind: 'asset',
    assetType: 'model',
    ...(Object.keys(bonePose).length ? { bonePose } : {})
  }
  return { out: value, [GRAPH_OUT_ALL_PORT_ID]: value }
}

export async function executeModelPoseNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const model = readIncomingModel(ctx)
  if (!model) throw new Error('GRAPH_MODEL_POSE_NO_MODEL')

  const instruction = readInstruction(ctx)
  if (!instruction) throw new Error('GRAPH_PROCESS_NO_INPUT')

  if (!ctx.inspectModelSkeleton) throw new Error('GRAPH_MODEL_POSE_INSPECT')
  const hierarchy = await ctx.inspectModelSkeleton({
    relativePath: model.relativePath,
    assetId: model.assetId
  })
  if (!hierarchy.length) throw new Error('GRAPH_MODEL_POSE_NO_BONES')

  const { boneRoles, boneParents } = buildBoneMaps(hierarchy)
  const locale = ctx.locale?.trim() || 'zh-CN'
  const dispatch = decideBlenderPoseStrategy({ instruction, locale, boneRoles })

  let readback: BlenderPoseReadback
  if (dispatch.strategy === 'preset' && dispatch.presetId) {
    readback = computePresetPoseReadback({ presetId: dispatch.presetId, boneRoles })
  } else {
    readback = await generateAiPoseReadback(ctx, {
      instruction,
      locale,
      boneRoles,
      boneParents,
      total: hierarchy.length
    })
  }
  const bonePose = bonePoseFromReadback(readback)
  if (!Object.keys(bonePose).length) throw new Error('GRAPH_MODEL_POSE_NO_MATCH')

  ctx.node.params = {
    ...ctx.node.params,
    bonePose,
    ...(dispatch.presetId ? { posePresetId: dispatch.presetId } : { posePresetId: undefined })
  }
  ctx.patchNode?.({
    params: {
      bonePose,
      posePresetId: dispatch.presetId ?? undefined
    }
  })

  return modelOutputs(model, bonePose)
}
