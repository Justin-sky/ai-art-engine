import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MODEL3D_RIG_PROVIDER_KINDS, supportsModel3dRig } from '@shared/modelProvider'

/**
 * 生成节点不再内联蒙皮；独立蒙皮走 `model.rigSkin` → Meshy/Tripo Rigging API。
 * 本测试锁住：白名单、MCP 不再暴露 gen-side rig、节点卡片过滤供应商。
 */
const MCP_SRC = readFileSync(resolve('src/main/services/mcpServerService.ts'), 'utf8')
const NODE_CARD_SRC = readFileSync(resolve('src/renderer/src/components/GraphNodeCard.vue'), 'utf8')
const EXECUTE_SRC = readFileSync(resolve('src/shared/graph/execute/modelRigSkin.ts'), 'utf8')

function extractInputSchemaBlock(source: string, toolName: string): string {
  const marker = `name: '${toolName}',`
  const toolStart = source.indexOf(marker)
  expect(toolStart, `找不到工具 ${toolName} 的定义`).toBeGreaterThanOrEqual(0)
  const inputStart = source.indexOf('inputSchema:', toolStart)
  expect(inputStart).toBeGreaterThanOrEqual(0)
  const braceStart = source.indexOf('{', inputStart)
  let depth = 1
  let i = braceStart + 1
  for (; i < source.length; i++) {
    const ch = source[i]
    if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) break
    }
  }
  return source.slice(braceStart, i + 1)
}

function extractToolBlock(source: string, toolName: string): string {
  const marker = `name: '${toolName}',`
  const start = source.indexOf(marker)
  expect(start).toBeGreaterThanOrEqual(0)
  const nextTool = source.indexOf('\n  {\n', start + marker.length)
  const end = nextTool > 0 ? nextTool : source.length
  return source.slice(start, end)
}

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

describe('MCP generate_model3d 不再暴露生成侧蒙皮', () => {
  it('inputSchema 不含 rig / rigType / rigAnimation', () => {
    const schema = extractInputSchemaBlock(MCP_SRC, 'generate_model3d')
    expect(schema).not.toMatch(/rig:\s*{\s*type:\s*'boolean'/)
    expect(schema).not.toMatch(/['"]?rigType['"]?\s*:\s*{/)
    expect(schema).not.toMatch(/['"]?rigAnimation['"]?\s*:\s*{/)
  })

  it('描述引导改用 3D 骨骼蒙皮节点', () => {
    const block = extractToolBlock(MCP_SRC, 'generate_model3d')
    expect(block).toMatch(/3D 骨骼蒙皮/)
    expect(block).toMatch(/Rigging API/)
    expect(block).not.toMatch(/applyModel3dRigArgs/)
  })

  it('已移除 apply/validate 辅助函数', () => {
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

describe('节点卡片蒙皮供应商过滤', () => {
  it('GraphNodeCard 用 supportsModel3dRig 过滤 modelRigSkin', () => {
    expect(NODE_CARD_SRC).toMatch(/supportsModel3dRig\(/)
    expect(NODE_CARD_SRC).toMatch(/import { supportsModel3dRig } from '@shared\/modelProvider'/)
    expect(NODE_CARD_SRC).toMatch(/instructionKind\.value === 'modelRigSkin'/)
    expect(NODE_CARD_SRC).toMatch(/showModel3dRigType/)
  })
})
