import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ensureBuiltinNodeTypes, getNodeType, listAddableNodeTypes } from '../src/shared/graph'
import { MCP_GRAPH_EDIT_SCOPE } from '../src/shared/graph/mcpGraphEdit'

/**
 * 「决策判定」的两条入口必须互相指路，Agent 才不会走贵的那条。
 *
 * 两条路都能拿到判定，但代价差一个数量级：
 * - `decide`（MCP 工具）：一次调用就回结论，不落盘、不必跑图；
 * - `decisions.judge`（图节点）：要 graph_edit 建节点 + task_run **跑整张图**
 *   （可能连带重跑上游生图等昂贵节点），只有「把判定留在图里」才值。
 *
 * Agent 只会读工具描述与节点 description（后者随 graph_node_types 带出去），
 * 所以两处都得写明分工；这里把文案钉住，避免以后被精简掉。
 */

const MCP_SERVICE = readFileSync(
  join(process.cwd(), 'src/main/services/mcpServerService.ts'),
  'utf8'
)

/** 取出某个 MCP 工具的 description 字面量（源码级契约，同 mcpGenToolSchema 的做法） */
function toolDescription(name: string): string {
  const marker = `name: '${name}',`
  const start = MCP_SERVICE.indexOf(marker)
  expect(start, `未找到工具 ${name}`).toBeGreaterThan(-1)
  const next = MCP_SERVICE.indexOf('\n  {\n', start + marker.length)
  const block = MCP_SERVICE.slice(start, next > 0 ? next : undefined)
  const match = block.match(/description:\s*\n?\s*'([\s\S]*?)',\n/)
  expect(match, `${name} 没有 description 字面量`).toBeTruthy()
  return match![1]!
}

describe('决策判定两条入口的互相指路', () => {
  it('decide 工具描述点明「要留在图里才改走节点」以及跑整图的代价', () => {
    const description = toolDescription('decide')
    expect(description).toContain('decisions.judge')
    // 关键取舍：节点那条要跑整张图
    expect(description).toContain('task_run')
    expect(description).toMatch(/留在图里/)
  })

  it('节点 description 点明「Agent 只要一次性结论请用 decide 工具」', () => {
    ensureBuiltinNodeTypes()
    const def = getNodeType('decisions.judge')
    expect(def).toBeTruthy()
    expect(def!.description).toBeTruthy()
    expect(def!.description).toMatch(/decide 工具/)
    expect(def!.description).toMatch(/留在图里/)
  })

  it('节点 description 确实会随 graph_node_types 带出去（Agent 读得到）', () => {
    ensureBuiltinNodeTypes()
    // graph_node_types 的清单与 graph_edit 同源白名单
    expect(listAddableNodeTypes(MCP_GRAPH_EDIT_SCOPE).map((d) => d.typeId)).toContain(
      'decisions.judge'
    )
    // 工具实现把 def.description 一并返回（不是只回 typeId）
    expect(MCP_SERVICE).toMatch(/description:\s*def\.description/)
  })
})
