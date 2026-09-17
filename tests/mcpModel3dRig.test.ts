import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { MODEL3D_RIG_PROVIDER_KINDS, supportsModel3dRig } from '@shared/modelProvider'

/**
 * 3D 蒙皮（rig）此前只活在节点参数与各上游适配器里：MCP `generate_model3d` 的 inputSchema
 * 既不暴露 `rig` / `rigType` / `rigAnimation`、描述里也没提，Agent 只能靠 `extraParams`
 * 夹带（无类型、无校验），对上不支持蒙皮的上游会被静默吞掉。本测试锁住三件事：
 * 1. 共享白名单（UI 蒙皮控件与 MCP 校验共用一份，不能各写一套）；
 * 2. `generate_model3d` 暴露三个入参并在 handler 里做提交前校验；
 * 3. 节点卡片改用共享白名单判定，不再自建 Set。
 */
const MCP_SRC = readFileSync(resolve('src/main/services/mcpServerService.ts'), 'utf8')
const NODE_CARD_SRC = readFileSync(resolve('src/renderer/src/components/GraphNodeCard.vue'), 'utf8')

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

describe('3D 蒙皮上游白名单', () => {
  it('只放行 Tripo / Meshy / Rodin(hyper3d)', () => {
    expect([...MODEL3D_RIG_PROVIDER_KINDS].sort()).toEqual(['hyper3d', 'meshy', 'tripo'])
  })

  it('不提供蒙皮的上游一律判否（含大小写 / 空白等脏值）', () => {
    for (const kind of ['luma', 'lux3d', 'openrouter', 'comfyui', '', ' Tripo'])
      expect(supportsModel3dRig(kind), `${kind} 不该被判定支持蒙皮`).toBe(false)
    for (const kind of MODEL3D_RIG_PROVIDER_KINDS)
      expect(supportsModel3dRig(kind), `${kind} 应支持蒙皮`).toBe(true)
  })
})

describe('MCP generate_model3d 暴露蒙皮入参', () => {
  it('inputSchema 含 rig / rigType / rigAnimation', () => {
    const schema = extractInputSchemaBlock(MCP_SRC, 'generate_model3d')
    expect(schema).toMatch(/rig:\s*{\s*type:\s*'boolean'/)
    expect(schema).toMatch(/['"]?rigType['"]?\s*:\s*{/)
    expect(schema).toMatch(/['"]?rigAnimation['"]?\s*:\s*{/)
  })

  it('rig 声明需配 rig: true，且写清支持与不支持的上游', () => {
    const schema = extractInputSchemaBlock(MCP_SRC, 'generate_model3d')
    expect(schema).toMatch(/Tripo \/ Meshy \/ Rodin/)
    expect(schema).toMatch(/Luma \/ Lux3D/)
    expect(schema).toMatch(/rig: true/)
  })

  it('描述里点名蒙皮与上游支持面', () => {
    const block = extractToolBlock(MCP_SRC, 'generate_model3d')
    expect(block).toMatch(/骨骼蒙皮/)
    expect(block).toMatch(/rig: true/)
    expect(block).toMatch(/Cache\/Models/)
  })
})

describe('MCP generate_model3d handler 提交前校验', () => {
  const block = extractToolBlock(MCP_SRC, 'generate_model3d')

  it('顶层显式传参优先于 extraParams 透传', () => {
    expect(block).toMatch(/applyModel3dRigArgs\(input, args\)/)
    expect(MCP_SRC).toMatch(/typeof args\.rig === 'boolean'/)
  })

  it('走共享白名单 + 解析实际上游，不支持时明确报错', () => {
    expect(MCP_SRC).toMatch(/function validateModel3dRigArgs\(/)
    expect(MCP_SRC).toMatch(/supportsModel3dRig\(provider\.providerKind\)/)
    expect(MCP_SRC).toMatch(/resolveActiveProvider\(\s*'model3d',/)
    expect(MCP_SRC).toMatch(/MODEL3D_RIG_PROVIDER_KINDS\.join/)
  })

  it('未开 rig 却传骨架类型 / 动画时直接报错，不静默吞', () => {
    expect(MCP_SRC).toMatch(/rigType \/ rigAnimation 只在 rig: true 时生效/)
  })

  it('Tripo 忽略骨架类型 / 动画时回 warnings', () => {
    expect(MCP_SRC).toMatch(/provider\.providerKind === 'tripo'/)
    expect(MCP_SRC).toMatch(/已被上游忽略/)
    expect(block).toMatch(/warnings: rigNotes/)
  })

  it('蒙皮参数进执行日志（rig / rigType / rigAnimation）', () => {
    expect(block).toMatch(/rig: input\.rig === true \|\| undefined/)
    expect(block).toMatch(/rigType: input\.rigType\?\.trim\(\) \|\| undefined/)
    expect(block).toMatch(/rigAnimation: input\.rigAnimation\?\.trim\(\) \|\| undefined/)
  })
})

describe('节点卡片蒙皮控件与 MCP 共用同一白名单', () => {
  it('GraphNodeCard 用 supportsModel3dRig，不再自建 Set', () => {
    expect(NODE_CARD_SRC).toMatch(/supportsModel3dRig\(/)
    expect(NODE_CARD_SRC).toMatch(/import { supportsModel3dRig } from '@shared\/modelProvider'/)
    expect(NODE_CARD_SRC).not.toMatch(/MODEL3D_RIG_SUPPORTED_KINDS/)
  })
})
