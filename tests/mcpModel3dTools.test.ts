import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = readFileSync(resolve('src/main/services/mcpServerService.ts'), 'utf8')

function toolBlock(toolName: string): string {
  const marker = `name: '${toolName}',`
  const start = SRC.indexOf(marker)
  expect(start, `找不到工具 ${toolName} 的定义`).toBeGreaterThanOrEqual(0)
  const nextTool = SRC.indexOf("name: '", start + marker.length)
  const arrayEnd = SRC.indexOf('\n]\n', start + marker.length)
  const candidates = [nextTool, arrayEnd].filter((n) => n > 0)
  const end = candidates.length ? Math.min(...candidates) : SRC.length
  return SRC.slice(start, end)
}

const ANIMS = toolBlock('list_model3d_animations')
const GRAPH_EDIT = toolBlock('graph_edit')

describe('3D 加工统一走画布节点（graph_edit + task_run）', () => {
  it('已移除 rig_model3d / segment_model3d / post_process_model3d 直调工具', () => {
    for (const name of ['rig_model3d', 'segment_model3d', 'post_process_model3d']) {
      expect(SRC).not.toContain(`name: '${name}',`)
    }
  })

  it('graph_edit 描述引导使用 asset.model3d / model3d.rig / model3d.segment / model3d.postProcess 画布节点', () => {
    expect(GRAPH_EDIT).toContain('asset.model3d')
    expect(GRAPH_EDIT).toContain('model3d.rig')
    expect(GRAPH_EDIT).toContain('model3d.segment')
    expect(GRAPH_EDIT).toContain('model3d.postProcess')
  })
})

describe('list_model3d_animations', () => {
  it('只读工具：不产生费用、不写资产、无需生成闸门', () => {
    expect(ANIMS).toMatch(/只读操作，不产生费用、不写资产/)
    expect(ANIMS).not.toMatch(/runGenActivity/)
  })

  it('入参是 search 而不是 model（与 ListModel3dAnimationsInput 一致）', () => {
    expect(ANIMS).toMatch(/search: optionalString\(args, 'search'\)/)
    expect(ANIMS).not.toMatch(/model: optionalString/)
  })

  it('返回总数与清单，供重定向节点选动作', () => {
    expect(ANIMS).toMatch(/total: actions\.length/)
    expect(ANIMS).toMatch(/actions/)
  })

  it('GATED_TOOLS 只拦截 task_run 等耗时作业，不拦截只读动作库', () => {
    const gated = SRC.slice(SRC.indexOf('const GATED_TOOLS'), SRC.indexOf('interface McpToolDef'))
    expect(gated).toContain("'task_run'")
    expect(gated).not.toContain("'list_model3d_animations'")
  })
})
