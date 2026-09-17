/**
 * `model.rigSkin`：给静态 3D 模型加骨骼蒙皮（armature + 自动权重）。
 *
 * 上游 3D 模型 → 统一发 Blender MCP → 输出同一模型并附带 rigMeta。
 * 两条分支共享同一条派发路径：
 *   - 预设派发：跳过 LLM，直接把预生成 Python 脚本经 `execute_blender_code` 发到 Blender，
 *     自动权重由 Blender `parent_set(type='ARMATURE_AUTO')` 算；
 *   - 自由文本：LLM 多轮 chat + Agent loop（`runBlenderRigAgent`）现场生成 Python 同样发 MCP。
 * 与 `modelPose.ts` 共用同一套 MCP / LLM 协议接口，按 Blender tool 同等约束。
 */
import {
  decideBlenderRigStrategy,
  parseBlenderRigReadback,
  type BlenderRigPresetId,
  type BlenderRigReadback,
  type BlenderDriveRigMeta
} from '../../blenderRigSkinGeneration'
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
  rigMeta: NonNullable<GraphAssetValue['rigMeta']>
): Record<string, GraphValue> {
  const value: GraphAssetValue = {
    ...model,
    kind: 'asset',
    assetType: 'model',
    rigMeta
  }
  return { out: value, [GRAPH_OUT_ALL_PORT_ID]: value }
}

async function runBlenderRigScript(
  ctx: NodeExecuteContext,
  presetId: BlenderRigPresetId | null,
  code: string
): Promise<BlenderRigReadback> {
  // 统一派发：无论预设还是 AI，最终都走同一条 MCP `execute_blender_code` 链路
  // ——预设脚本（buildBlenderPresetRigScript 生成的 Python）或 LLM 多轮产物
  // 都在 Blender 端真实烤进原文件（armature + 自动蒙皮权重）后回传 stdout readback。
  if (!ctx.runBlenderMcpTool) throw new Error('GRAPH_MODEL_RIG_MCP')
  const outcome = await ctx.runBlenderMcpTool({
    name: 'execute_blender_code',
    args: { code },
    timeoutMs: 90000
  })
  // parseBlenderRigReadback 已自行处理 outcome.error 与 marker 缺失
  return parseBlenderRigReadback(outcome, presetId)
}

async function generateAiRigReadback(
  ctx: NodeExecuteContext,
  input: { instruction: string; locale: string; modelName: string }
): Promise<BlenderRigReadback> {
  if (!ctx.generateText) throw new Error('GRAPH_MODEL_RIG_NO_TEXT_MODEL')
  if (!ctx.runBlenderMcpTool) throw new Error('GRAPH_MODEL_RIG_MCP')
  const model = ctx.node.params.generateModel?.trim()
  const providerInstanceId = ctx.node.params.generateProviderInstanceId?.trim()
  if (!model || !providerInstanceId) throw new Error('GRAPH_MODEL_RIG_NO_TEXT_MODEL')

  // 为避免和 modelPose.ts 互相 import，按需从模块内取
  const { parseBlenderDriveRigMeta, runBlenderRigAgent } =
    await import('../../blenderRigSkinGeneration')

  const blenderRun = ctx.runBlenderMcpTool
  const generateText = ctx.generateText
  let lastReadback: BlenderRigReadback = {
    armature: null,
    bones: [],
    vertexGroups: [],
    presetId: null
  }

  const agentResult = await runBlenderRigAgent(
    {
      instruction: input.instruction,
      locale: input.locale,
      modelName: input.modelName
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
            'Continue. Call try_blender_rig with Python, or finalize_rig when the rig is ready.'
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
                name: 'try_blender_rig',
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
        const readback = parseBlenderRigReadback(outcome, null)
        const meta: BlenderDriveRigMeta | null = parseBlenderDriveRigMeta(outcome)
        lastReadback = readback
        return { readback, meta }
      },
      applyToRenderer: (readback) => {
        lastReadback = readback
        return {
          bonesMatched: readback.bones.length,
          vertexGroupsMatched: readback.vertexGroups.length
        }
      }
    }
  )

  if (!agentResult.ok) throw new Error(`GRAPH_MODEL_RIG_FAILED:${agentResult.reason}`)
  if (!lastReadback.armature || !lastReadback.bones.length) {
    throw new Error('GRAPH_MODEL_RIG_NO_MATCH')
  }
  return lastReadback
}

export async function executeModelRigSkinNode(
  ctx: NodeExecuteContext
): Promise<Record<string, GraphValue>> {
  const model = readIncomingModel(ctx)
  if (!model) throw new Error('GRAPH_MODEL_RIG_NO_MODEL')

  const instruction = readInstruction(ctx)
  if (!instruction) throw new Error('GRAPH_PROCESS_NO_INPUT')

  const locale = ctx.locale?.trim() || 'zh-CN'
  const modelName = model.label?.trim() || model.assetId
  const dispatch = decideBlenderRigStrategy({
    instruction,
    locale,
    modelName
  })

  let readback: BlenderRigReadback
  if (dispatch.strategy === 'preset' && dispatch.code) {
    // 预设派发：跳过 LLM、直接把预先生成的 Python 发 Blender 跑——确定性、无 token 成本，
    // 但与 AI 路径同样经过 Blender MCP，armature + 自动蒙皮权重真烤进原文件，
    // vertexGroups 由 Blender `parent_set(type='ARMATURE_AUTO')` 回写。
    readback = await runBlenderRigScript(ctx, dispatch.presetId, dispatch.code)
  } else {
    // 自由文本：LLM 多轮 chat + Agent loop（runBlenderRigAgent 内部也走 MCP）。
    readback = await generateAiRigReadback(ctx, {
      instruction,
      locale,
      modelName
    })
  }

  if (!readback.armature || !readback.bones.length) throw new Error('GRAPH_MODEL_RIG_NO_MATCH')

  const rigMeta: NonNullable<GraphAssetValue['rigMeta']> = {
    armature: readback.armature,
    bones: readback.bones.slice(),
    vertexGroups: readback.vertexGroups.slice(),
    ...(readback.presetId ? { presetId: readback.presetId as BlenderRigPresetId } : {})
  }

  ctx.node.params = {
    ...ctx.node.params,
    rigMeta,
    ...(dispatch.presetId ? { rigPresetId: dispatch.presetId } : { rigPresetId: undefined }),
    rigModelRelativePath: model.relativePath?.trim() || undefined
  }
  ctx.patchNode?.({
    params: {
      rigMeta,
      rigPresetId: dispatch.presetId ?? undefined,
      rigModelRelativePath: model.relativePath?.trim() || undefined
    }
  })

  return modelOutputs(model, rigMeta)
}
