import { describe, expect, it, vi } from 'vitest'
import {
  BLENDER_RIG_DRIVE_META_MARKER,
  BLENDER_RIG_RESULT_MARKER,
  listBlenderRigPresetInstructions
} from '../src/shared/blenderRigSkinGeneration'
import {
  executeModelRigSkinNode,
  type GraphNode,
  type NodeExecuteContext
} from '../src/shared/graph'
import type { McpToolCallOutcome } from '../src/shared/mcpProtocol'

function rigSkinNode(params: Record<string, unknown> = {}): GraphNode {
  return {
    id: 'rigskin-1',
    typeId: 'model.rigSkin',
    category: 'note',
    position: { x: 0, y: 0 },
    params
  } as GraphNode
}

const incomingModel = {
  kind: 'asset' as const,
  assetId: 'model-1',
  assetType: 'model' as const,
  relativePath: 'Cache/Models/hero.glb',
  title: 'Hero'
}

function makeRigStdout(rigObj: unknown, metaObj: unknown): string {
  return (
    'before-line\n' +
    BLENDER_RIG_RESULT_MARKER +
    JSON.stringify(rigObj) +
    '\nmid-line\n' +
    BLENDER_RIG_DRIVE_META_MARKER +
    JSON.stringify(metaObj) +
    '\n'
  )
}

function makeBlenderOutcome(stdout: string): McpToolCallOutcome {
  // addon wrapper：execute_blender_code result = { executed, result: stdout }
  return { result: { executed: true, result: stdout } }
}

describe('executeModelRigSkinNode — 统一 Blender 派发', () => {
  it('预设路径必须经过 runBlenderMcpTool（不再走本地 computePresetRigReadback short-circuit）', async () => {
    const presetInstruction = listBlenderRigPresetInstructions('zh-CN').find(
      (p) => p.id === 'humanoid-simple'
    )!.text
    const blenderRun = vi.fn(async (_input: unknown) => {
      return makeBlenderOutcome(
        makeRigStdout(
          {
            armature: 'RigHumanoidSimple',
            bones: ['Hips', 'Spine', 'Head'],
            vertexGroups: ['Spine', 'Head']
          },
          { bonesMatched: 3, vertexGroupsMatched: 2, armature: 'RigHumanoidSimple' }
        )
      )
    })

    const patched: Array<{ params?: Record<string, unknown> }> = []
    const ctx = {
      node: rigSkinNode({ generateInstruction: presetInstruction }),
      inputs: { 'in-model': [incomingModel] },
      locale: 'zh-CN',
      runBlenderMcpTool: blenderRun,
      patchNode: (patch: { params?: Record<string, unknown> }) => {
        if (patch.params) patched.push(patch)
      }
    } as unknown as NodeExecuteContext

    const out = await executeModelRigSkinNode(ctx)

    // 1. 必须真的调用 Blender MCP（统一派发的核心约束）
    expect(blenderRun).toHaveBeenCalledTimes(1)
    const call = blenderRun.mock.calls[0]![0] as {
      name: string
      args?: Record<string, unknown>
      timeoutMs?: number
    }
    expect(call.name).toBe('execute_blender_code')
    expect(call.timeoutMs).toBeGreaterThanOrEqual(30000)
    expect(typeof call.args?.code).toBe('string')
    expect((call.args?.code as string).length).toBeGreaterThan(200)

    // 2. 输出 rigMeta 真从 Blender stdout 解析，含 vertexGroups（之前本地 short-circuit 永远为空）
    const value = out['out']
    expect(value.kind).toBe('asset')
    if (value.kind !== 'asset') return
    expect(value.rigMeta?.armature).toBe('RigHumanoidSimple')
    expect(value.rigMeta?.bones).toEqual(['Hips', 'Spine', 'Head'])
    expect(value.rigMeta?.vertexGroups).toEqual(['Spine', 'Head'])
    expect(value.rigMeta?.presetId).toBe('humanoid-simple')

    // 3. 节点参数与 patchNode 都写入该节
    expect(ctx.node.params.rigMeta).toEqual(value.rigMeta)
    expect(ctx.node.params.rigPresetId).toBe('humanoid-simple')
    expect(patched[0]?.params?.rigPresetId).toBe('humanoid-simple')
  })

  it('未注入 runBlenderMcpTool 时抛 GRAPH_MODEL_RIG_MCP（不区分预设 vs AI）', async () => {
    const presetInstruction = listBlenderRigPresetInstructions('zh-CN').find(
      (p) => p.id === 'quadruped'
    )!.text
    const ctx = {
      node: rigSkinNode({ generateInstruction: presetInstruction }),
      inputs: { 'in-model': [incomingModel] },
      locale: 'zh-CN'
      // 故意不提供 runBlenderMcpTool
    } as unknown as NodeExecuteContext

    await expect(executeModelRigSkinNode(ctx)).rejects.toThrow('GRAPH_MODEL_RIG_MCP')
  })

  it('Blender 失败（outcome.error）抛 MCP 错误，AI 路径也覆盖', async () => {
    const presetInstruction = listBlenderRigPresetInstructions('zh-CN').find(
      (p) => p.id === 'prop-rigid'
    )!.text
    const blenderRun = vi.fn(async () => ({ error: 'BLENDER_DISCONNECTED' }) as McpToolCallOutcome)
    const ctx = {
      node: rigSkinNode({ generateInstruction: presetInstruction }),
      inputs: { 'in-model': [incomingModel] },
      locale: 'zh-CN',
      runBlenderMcpTool: blenderRun
    } as unknown as NodeExecuteContext

    await expect(executeModelRigSkinNode(ctx)).rejects.toThrow('BLENDER_DISCONNECTED')
    expect(blenderRun).toHaveBeenCalledTimes(1)
  })

  it('上游无模型抛 GRAPH_MODEL_RIG_NO_MODEL；空指令抛 GRAPH_PROCESS_NO_INPUT', async () => {
    await expect(
      executeModelRigSkinNode({
        node: rigSkinNode({ generateInstruction: 'x' }),
        inputs: {}
      } as unknown as NodeExecuteContext)
    ).rejects.toThrow('GRAPH_MODEL_RIG_NO_MODEL')

    await expect(
      executeModelRigSkinNode({
        node: rigSkinNode({}),
        inputs: { 'in-model': [incomingModel] }
      } as unknown as NodeExecuteContext)
    ).rejects.toThrow('GRAPH_PROCESS_NO_INPUT')
  })
})
