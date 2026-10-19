import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MODEL3D_RIG_PROVIDER_KINDS, supportsModel3dRig } from '@shared/modelProvider'

/**
 * 3D 生成与骨骼蒙皮均通过画布节点（`asset.model3d`、`model.rigSkin` / `model3d.rig`）+ `task_run` 实时执行。
 */
const MCP_SRC = readFileSync(resolve('src/main/services/mcpServerService.ts'), 'utf8')
const NODE_CARD_SRC = readFileSync(resolve('src/renderer/src/components/GraphNodeCard.vue'), 'utf8')
const EXECUTE_SRC = readFileSync(resolve('src/shared/graph/execute/modelRigSkin.ts'), 'utf8')

describe('独立骨骼蒙皮上游白名单', () => {
  it('只放行 Meshy / Tripo', () => {
    expect([...MODEL3D_RIG_PROVIDER_KINDS].sort()).toEqual(['meshy', 'tripo'])
  })

  it('不提供独立蒙皮的上游一律判否', () => {
    for (const kind of ['luma', 'lux3d', 'hyper3d', 'openrouter', 'comfyui', '', ' Tripo'])
      expect(supportsModel3dRig(kind), `${kind} 不该被判定支持蒙皮`).toBe(false)
    for (const kind of MODEL3D_RIG_PROVIDER_KINDS)
      expect(supportsModel3dRig(kind), `${kind} 应支持蒙皮`).toBe(true)
  })
})

describe('MCP 已移除 generate_model3d / rig_model3d 直调工具，统一走画布节点', () => {
  it('已移除旧直调工具与 apply/validate 辅助函数', () => {
    expect(MCP_SRC).not.toContain("name: 'generate_model3d',")
    expect(MCP_SRC).not.toContain("name: 'rig_model3d',")
    expect(MCP_SRC).not.toMatch(/function applyModel3dRigArgs\(/)
    expect(MCP_SRC).not.toMatch(/function validateModel3dRigArgs\(/)
  })
})

describe('model.rigSkin Cook 走云端 Rigging API', () => {
  it('execute 调用 ctx.rigModel3d 而非 Blender dsh', () => {
    expect(EXECUTE_SRC).toMatch(/ctx\.rigModel3d\(/)
    expect(EXECUTE_SRC).not.toMatch(/runBlenderDshJob/)
    expect(EXECUTE_SRC).not.toMatch(/runModelBlenderDshJob/)
  })

  it('engine 把 options.rigModel3d 注入 NodeExecuteContext', () => {
    const engineSrc = readFileSync(resolve('src/shared/graph/execute/engine.ts'), 'utf8')
    expect(engineSrc).toMatch(/rigModel3d:\s*options\.rigModel3d/)
  })
})

describe('节点卡片加工供应商过滤（能力矩阵驱动）', () => {
  it('GraphNodeCard 用 meshOpSupported 过滤 3D 加工节点', () => {
    expect(NODE_CARD_SRC).toMatch(/meshOpSupported\(/)
    expect(NODE_CARD_SRC).toMatch(/from '@shared\/meshOps'/)
    expect(NODE_CARD_SRC).toMatch(/meshOpForInstructionKind/)
    expect(NODE_CARD_SRC).not.toMatch(/tripoOnly/)
    expect(NODE_CARD_SRC).not.toMatch(/supportsModel3d(?:Rig|Segment|PostProcess)\(/)
  })

  it('每个 3D 加工节点都能映射到一个能力矩阵 op', () => {
    for (const [kind, op] of [
      ['modelRigSkin', 'rig'],
      ['modelSegment', 'segment'],
      ['modelMeshComplete', 'meshComplete'],
      ['modelRetopology', 'retopology'],
      ['modelRigCheck', 'rigCheck'],
      ['modelRetarget', 'retarget'],
      ['modelConvert', 'convert'],
      ['modelTexture', 'texture']
    ] as const) {
      expect(NODE_CARD_SRC).toMatch(new RegExp(`case '${kind}':\\s*\\n\\s*return '${op}'`))
    }
  })
})
