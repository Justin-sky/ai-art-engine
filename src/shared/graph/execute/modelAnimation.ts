/**
 * `model.animation`：给带骨架的 3D 模型创建关键帧动作（action）。
 *
 * 上游 3D 模型（应先经 `model.rigSkin` 或自带骨架） → 预设派发本地算关键帧 或
 * LLM+Blender → 输出同一模型并附带 clip。
 */
import {
  computePresetAnimReadback,
  decideBlenderAnimStrategy,
  type BlenderAnimClip,
  type BlenderAnimPresetId,
  type BlenderDriveAnimMeta
} from '../../blenderAnimationGeneration'
import { GRAPH_OUT_ALL_PORT_ID } from '../ports'
import { collectIncomingValues } from './incoming'
import { flattenAssetValues, flattenTextValues } from './gallery'
import type { GraphAssetValue, GraphValue, NodeExecuteContext } from './types'

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

function modelOutputs(
  model: GraphAssetValue,
  clip: NonNullable<GraphAssetValue['clip']>
): Record<string, GraphValue> {
  const value: GraphAssetValue = {
    ...model,
    kind: 'asset',
    assetType: 'model',
    clip
  }
  return { out: value, [GRAPH_OUT_ALL_PORT_ID]: value }
}

async function generateAiAnimClip(
  ctx: NodeExecuteContext,
  input: { instruction: string; locale: string; armatureName: string }
): Promise<BlenderAnimClip> {
  if (!ctx.generateText) throw new Error('GRAPH_MODEL_ANIM_NO_TEXT_MODEL')
  if (!ctx.runBlenderMcpTool) throw new Error('GRAPH_MODEL_ANIM_MCP')
  const model = ctx.node.params.generateModel?.trim()
  const providerInstanceId = ctx.node.params.generateProviderInstanceId?.trim()
  if (!model || !providerInstanceId) throw new Error('GRAPH_MODEL_ANIM_NO_TEXT_MODEL')

  const { parseBlenderAnimReadback, parseBlenderDriveAnimMeta, runBlenderAnimAgent } =
    await import('../../blenderAnimationGeneration')

  const blenderRun = ctx.runBlenderMcpTool
  const generateText = ctx.generateText
  let lastClip: BlenderAnimClip = {
    action: '',
    fps: 24,
    frameRange: [1, 24],
    keyframes: {},
    presetId: null
  }

  const agentResult = await runBlenderAnimAgent(
    {
      instruction: input.instruction,
      locale: input.locale,
      armatureName: input.armatureName
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
        const composedSystem =
          system + '\n\n[Conversation history — previous tool results are listed here]\n' + history
        const result = await generateText({
          providerInstanceId,
          model,
          system: composedSystem,
          prompt:
            'Continue. Call try_blender_anim with Python, or finalize_anim when the clip is ready.'
        })
        const stripped = result.text
          .replace(/^```(?:python|py|python3)?\s*\n?/i, '')
          .replace(/\n?```$/i, '')
          .trim()
        if (!stripped) return { text: result.text, toolCalls: [] }
        return {
          text: result.text,
          toolCalls: [
            {
              id: `auto_${Date.now()}`,
              type: 'function' as const,
              function: {
                name: 'try_blender_anim',
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
          timeoutMs: 90000
        })
        if (outcome.error) throw new Error(outcome.error)
        const readback = parseBlenderAnimReadback(outcome, null)
        const meta: BlenderDriveAnimMeta | null = parseBlenderDriveAnimMeta(outcome)
        lastClip = readback
        return { readback, meta }
      },
      applyToRenderer: (clip) => ({
        bonesMatched: Object.keys(clip.keyframes).length,
        keyframeCount: Object.values(clip.keyframes).reduce((s, v) => s + Object.keys(v).length, 0)
      })
    }
  )

  if (!agentResult.ok) throw new Error(`GRAPH_MODEL_ANIM_FAILED:${agentResult.reason}`)
  if (!lastClip.action || !Object.keys(lastClip.keyframes).length) {
    throw new Error('GRAPH_MODEL_ANIM_NO_MATCH')
  }
  return lastClip
}

export async function executeModelAnimationNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const model = readIncomingModel(ctx)
  if (!model) throw new Error('GRAPH_MODEL_ANIM_NO_MODEL')

  const instruction = readInstruction(ctx)
  if (!instruction) throw new Error('GRAPH_PROCESS_NO_INPUT')

  const locale = ctx.locale?.trim() || 'zh-CN'
  const armatureName = model.rigMeta?.armature?.trim() || ''

  const dispatch = decideBlenderAnimStrategy({
    instruction,
    locale,
    armatureName
  })

  let clipReadback: BlenderAnimClip
  if (dispatch.strategy === 'preset' && dispatch.presetId) {
    clipReadback = computePresetAnimReadback({ presetId: dispatch.presetId })
  } else {
    if (!armatureName) throw new Error('GRAPH_MODEL_ANIM_NO_ARMATURE')
    clipReadback = await generateAiAnimClip(ctx, {
      instruction,
      locale,
      armatureName
    })
  }

  if (!clipReadback.action || !Object.keys(clipReadback.keyframes).length) {
    throw new Error('GRAPH_MODEL_ANIM_NO_MATCH')
  }

  const clip: NonNullable<GraphAssetValue['clip']> = {
    name: clipReadback.action,
    fps: clipReadback.fps,
    frameRange: [clipReadback.frameRange[0], clipReadback.frameRange[1]],
    keyframes: Object.fromEntries(
      Object.entries(clipReadback.keyframes).map(([bone, frames]) => [
        bone,
        Object.fromEntries(Object.entries(frames).map(([f, v]) => [f, [v[0], v[1], v[2]]]))
      ])
    ),
    ...(clipReadback.presetId ? { presetId: clipReadback.presetId as BlenderAnimPresetId } : {})
  }

  ctx.node.params = {
    ...ctx.node.params,
    clip,
    ...(dispatch.presetId ? { animPresetId: dispatch.presetId } : { animPresetId: undefined }),
    animationModelRelativePath: model.relativePath?.trim() || undefined,
    animationSourceAssetId: model.assetId ?? undefined
  }
  ctx.patchNode?.({
    params: {
      clip,
      animPresetId: dispatch.presetId ?? undefined,
      animationModelRelativePath: model.relativePath?.trim() || undefined,
      animationSourceAssetId: model.assetId ?? undefined
    }
  })

  return modelOutputs(model, clip)
}
