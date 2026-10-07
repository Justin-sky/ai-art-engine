import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 编辑器打开时也能远程编辑（MCP `graph_edit`）。
 *
 * ## 这是一个自锁死循环
 *
 * `task_run` 会自动**打开**该资产的图编辑器（为了把运行状态实时显示在画布上）。
 * 而 `graph_edit` 原先在「编辑器已打开」时一律拒绝 —— 于是 Agent 先跑一次工作流，
 * 应用弹出编辑器，Agent 随后的编辑全部失败，提示用户「请先关闭编辑器」。
 * 用户什么都没做，却被应用自己弹出的窗口挡住。
 *
 * ## 修法：换成以**实时文档**为基准
 *
 * 拒绝的本意是防「互相覆盖」：store 里那份 `graphJson` 可能落后于编辑器，
 * 在它上面套用 ops 再写回会抹掉用户未落盘的改动。
 * 改用编辑器实时文档后这个理由不成立 —— 改动叠加在编辑器当前状态之上，
 * 再由编辑器自己的落盘链路写回。
 */
const read = (...parts: string[]): string => readFileSync(resolve(...parts), 'utf8')

/** 剥离注释：解释这条约束的注释里会写出被禁的标识符，直接断言会假失败 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')
}

const RUNNER = read('src/renderer/src/features/mcp/mcpTaskRunner.ts')
const MCP = read('src/main/services/mcpServerService.ts')

/** 取 handleGraphEdit 的函数体（到下一个月注释分节为止） */
function graphEditBody(): string {
  const at = RUNNER.indexOf('async function handleGraphEdit')
  expect(at, '应当能找到 handleGraphEdit').toBeGreaterThan(0)
  const end = RUNNER.indexOf('\n/**', at)
  return stripComments(RUNNER.slice(at, end))
}

describe('graph_edit 不再因编辑器打开而拒绝', () => {
  it('函数体里不再有那句拒绝提示', () => {
    expect(graphEditBody()).not.toContain('为避免互相覆盖请先关闭编辑器')
  })

  it('**精修路径仍拒绝**（另一种情况，不要顺手也放开）', () => {
    /*
      `graph_icon_refine` 与 graph_edit 不同：它要在渲染层生图并写回逐枚覆盖，
      依赖编辑器已落盘的状态；这条拒绝仍然成立。此断言是防止有人「统一口径」把它一起放开。
    */
    expect(RUNNER).toContain('请先关闭编辑器再远程精修')
  })

  it('改为以**实时文档**为基准', () => {
    const body = graphEditBody()
    expect(body).toContain('graphEditorHosts.getLiveAssetDocument(payload.assetId)')
    // 落盘交给编辑器自身的链路（applyExternalGraph → commitAssetGraph → persistAssetRecord）
    expect(body).toContain('graphEditorHosts.applyExternalGraph(hostId, liveResult.graph)')
    // 等落盘完成再回报，对调用方才是持久的
    expect(body).toContain('await graphEditorHosts.flush(hostId)')
  })

  it('**先判断编辑器是否打开，再取 store 副本**', () => {
    const body = graphEditBody()
    const openCheck = body.indexOf('isGraphEditorOpen(payload.assetId)')
    const storeCopy = body.indexOf('graphJson')
    expect(openCheck).toBeGreaterThan(-1)
    // 草稿资产的图只存在于编辑器里，先走 store 会误报「资产不存在或不含图文档」
    expect(openCheck, '编辑器分支必须早于读 store 副本').toBeLessThan(storeCopy)
  })

  it('取不到实时图时给出可重试的错误，而不是静默失败', () => {
    const body = graphEditBody()
    expect(body).toMatch(/if \(!live\) \{/)
    expect(body).toContain('取不到实时图')
  })

  it('编辑器关闭时的原路径保持不变（仍写 store 副本）', () => {
    const body = graphEditBody()
    expect(body).toContain('const result = applyGraphEditOps(graphJson, payload.ops)')
    expect(body).toContain('persistAssetRecord(payload.assetId,')
  })
})

describe('自锁的成因仍被记录', () => {
  it('task_run 确实会自动打开编辑器（因此才必须让编辑可用）', () => {
    // 这条断言是这件事的「因」：如果哪天不再自动打开，上面的放宽就有讨论空间
    expect(RUNNER).toContain('openMcpWorkflowAssetEditor(payload.assetId)')
  })
})

describe('工具说明与行为一致', () => {
  it('描述里不再说「图正在编辑器中打开时会拒绝」', () => {
    expect(MCP).not.toContain('图正在编辑器中打开时会拒绝')
    expect(MCP).toContain('图正在编辑器中打开时同样可用')
  })
})
